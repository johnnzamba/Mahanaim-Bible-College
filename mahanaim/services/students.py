"""Student lifecycle services (owned by backend domain B1).

CONTRACT (other domains import these; keep signatures):
	ensure_user(email, first_name, last_name=None, phone=None, roles=(), user_type="Website User") -> str (User.name)
	create_student_from_application(application) -> str (Student.name)
	sync_user_profile_link(doc, method=None)  # User.on_update hook

Also used by B1 controllers/APIs: registration validation helpers, approval side effects, student request
effects and `safe_call` (wraps other domains' contracts so a stub or failure never breaks our transaction).
"""

from __future__ import annotations

import re
from html import unescape

import frappe
from frappe import _
from frappe.utils import add_months, cint, cstr, flt, getdate, now_datetime, nowdate, strip_html

from mahanaim.utils import (
	ROLE_ADMIN,
	ROLE_ALUMNI,
	ROLE_APPLICANT,
	ROLE_LECTURER,
	ROLE_SPONSOR,
	ROLE_STUDENT,
	current_year,
	fmt_money,
	normalize_phone,
	setting,
	user_roles,
)

STUDENT_TRANSITIONS = {
	"Applicant": ("Admitted",),
	"Admitted": ("Registered", "Active", "Withdrawn", "Deferred"),
	"Registered": ("Active", "Deferred", "Suspended", "Withdrawn"),
	"Active": ("Deferred", "Suspended", "Withdrawn", "Completed"),
	"Deferred": ("Active", "Withdrawn"),
	"Suspended": ("Active", "Withdrawn"),
	"Completed": ("Alumni",),
}
# Students who may register for courses.
REGISTRABLE_STATUSES = ("Admitted", "Registered", "Active")
# A user may only be linked to one student record in one of these states at a time.
OPEN_STUDENT_STATUSES = ("Applicant", "Admitted", "Registered", "Active", "Deferred", "Suspended")

REGISTRATION_TRANSITIONS = {
	"Draft": ("Submitted", "Cancelled"),
	"Submitted": ("Approved", "Rejected", "Cancelled", "Draft"),
}

REQUEST_TRANSITIONS = {
	"Pending": ("Under Review", "Approved", "Rejected", "Cancelled"),
	"Under Review": ("Approved", "Rejected", "Cancelled"),
	"Approved": ("Completed",),
}
CLEARANCE_DEPARTMENTS = ("Finance", "Library", "Academics", "Dean of Students")

# Which roles may sign off each clearance department (admins pass everything).
CLEARANCE_ROLES = {
	"Finance": ("Finance Officer",),
	"Library": ("Library Officer",),
	"Academics": ("Registrar", "Academic Dean"),
	"Dean of Students": ("Academic Dean", "Chaplain"),
	"Chaplaincy": ("Chaplain",),
	"Hostel": ("Registrar",),
	"ICT": ("Registrar",),
}


# ---------------------------------------------------------------------------------- cross-domain calls
def safe_call(path, *args, default=None, **kwargs):
	"""Call another domain's contract (dotted path or callable); a stub (NotImplementedError) or any error
	returns `default`.

	Runs inside a savepoint so a half-finished write by the callee is rolled back before we continue, and
	drops any message the failed callee queued so it does not surface as an error toast."""
	fn = frappe.get_attr(path) if isinstance(path, str) else path
	label = path if isinstance(path, str) else getattr(path, "__qualname__", repr(path))
	messages = (
		frappe.local.message_log if isinstance(getattr(frappe.local, "message_log", None), list) else []
	)
	queued = len(messages)
	savepoint = f"mbc_{frappe.generate_hash(length=8)}"
	frappe.db.savepoint(savepoint)
	try:
		return fn(*args, **kwargs)
	except NotImplementedError:
		frappe.db.rollback(save_point=savepoint)
		del messages[queued:]
		return default
	except Exception:
		frappe.db.rollback(save_point=savepoint)
		del messages[queued:]
		frappe.log_error(title=f"Mahanaim: {label} failed")
		return default


# ---------------------------------------------------------------------------------- browser-supplied files
LOCAL_FILE_PREFIXES = ("/files/", "/private/files/")


def local_file_url(value, label: str | None = None) -> str | None:
	"""Validate an Attach value sent by a browser: empty -> None, otherwise a site file path.

	Only `/files/…` and `/private/files/…` are accepted; external links, `javascript:`/`data:` values and path
	tricks are rejected. (Frappe also allows remote-URL File records, so a File row alone is not enough.)"""
	value = cstr(value).strip()
	if not value:
		return None
	if (
		not value.startswith(LOCAL_FILE_PREFIXES)
		or ".." in value
		or "\\" in value
		or any(ord(c) < 32 for c in value)
	):
		frappe.throw(
			_("{0} must be a file uploaded through the portal, not a link.").format(label or _("The file")),
			title=_("Invalid file"),
		)
	return value


def error_text(exc: BaseException) -> str:
	"""Plain-text message of an exception for bulk-result rows. Frappe joins several messages with `<br>`, so
	line-break tags become newlines before the HTML is stripped (otherwise the messages run together)."""
	text = re.sub(r"(?i)<br\s*/?>|</(p|div|li|tr|h[1-6])>", "\n", cstr(exc))
	lines = (line.strip() for line in unescape(strip_html(text)).splitlines())
	return "\n".join(line for line in lines if line) or exc.__class__.__name__


# ---------------------------------------------------------------------------------- users
def phone_variants(phone: str | None) -> list[str]:
	phone = normalize_phone(phone)
	if not phone:
		return []
	variants = {phone, "+" + phone}
	if phone.startswith("254") and len(phone) == 12:
		variants.add("0" + phone[3:])
	return sorted(variants)


def phone_owner(phone: str | None, exclude_user: str | None = None) -> str | None:
	"""User that already uses `phone` as mobile number (any common spelling)."""
	variants = phone_variants(phone)
	if not variants:
		return None
	filters = {"mobile_no": ["in", variants]}
	if exclude_user:
		filters["name"] = ["!=", exclude_user]
	return frappe.db.get_value("User", filters, "name")


def add_roles(user: str, *roles: str) -> bool:
	"""Add missing roles to a user. Returns True when the user changed."""
	roles = [r for r in roles if r]
	if not user or not roles or user in ("Administrator", "Guest"):
		return False
	have = set(frappe.get_all("Has Role", filters={"parent": user, "parenttype": "User"}, pluck="role"))
	missing = [r for r in roles if r not in have]
	if not missing:
		return False
	doc = frappe.get_doc("User", user)
	doc.append_roles(*missing)
	doc.save(ignore_permissions=True)
	return True


def remove_roles(user: str, *roles: str) -> bool:
	if not user or user in ("Administrator", "Guest"):
		return False
	have = set(frappe.get_all("Has Role", filters={"parent": user, "parenttype": "User"}, pluck="role"))
	drop = [r for r in roles if r in have]
	if not drop:
		return False
	frappe.get_doc("User", user).remove_roles(*drop)
	return True


def _ensure_user(email, first_name, last_name=None, phone=None, roles=(), user_type="Website User"):
	"""Get-or-create a User for `email`; returns (user_name, created)."""
	email = (email or "").strip().lower()
	if not email:
		frappe.throw(_("An email address is required to create an account."))
	frappe.utils.validate_email_address(email, throw=True)
	phone = normalize_phone(phone)
	name = frappe.db.get_value("User", email, "name") or frappe.db.get_value("User", {"email": email}, "name")
	if name:
		user = frappe.get_doc("User", name)
		changed = False
		if phone and not user.mobile_no and not phone_owner(phone, exclude_user=name):
			user.mobile_no = phone
			changed = True
		have = {d.role for d in user.get("roles")}
		missing = [r for r in roles or () if r and r not in have]
		if missing:
			user.append_roles(*missing)
			changed = True
		if changed:
			user.save(ignore_permissions=True)
		return user.name, False

	user = frappe.get_doc(
		{
			"doctype": "User",
			"email": email,
			"first_name": (first_name or email.split("@")[0]).strip(),
			"last_name": (last_name or "").strip() or None,
			"mobile_no": phone if phone and not phone_owner(phone) else None,
			"user_type": user_type or "Website User",
			"send_welcome_email": 0,
			"enabled": 1,
		}
	)
	if roles:
		user.append_roles(*[r for r in roles if r])
	user.flags.no_welcome_mail = True
	user.insert(ignore_permissions=True)
	return user.name, True


def ensure_user(email, first_name, last_name=None, phone=None, roles=(), user_type="Website User") -> str:
	"""CONTRACT: get-or-create the User for `email`, add `roles`, set the mobile number when it is free."""
	return _ensure_user(email, first_name, last_name, phone, roles, user_type)[0]


def set_user_enabled(user: str | None, enabled: bool):
	if not user or user in ("Administrator", "Guest"):
		return
	if cint(frappe.db.get_value("User", user, "enabled")) == cint(enabled):
		return
	doc = frappe.get_doc("User", user)
	doc.enabled = cint(enabled)
	doc.save(ignore_permissions=True)


def sync_user_profile_link(doc, method=None):
	"""User.on_update: link Student / Staff Member / Sponsor records that carry this email but no user.

	Cheap by design: only runs for new users or when the email changes (three small lookups)."""
	if doc.name in ("Administrator", "Guest") or not doc.email:
		return
	before = doc.get_doc_before_save()
	if before is not None and (before.email or "").lower() == doc.email.lower():
		return
	roles = []
	for doctype, role in (("Student", ROLE_STUDENT), ("Staff Member", None), ("Sponsor", ROLE_SPONSOR)):
		names = frappe.get_all(doctype, filters={"email": doc.email, "user": ["is", "not set"]}, pluck="name")
		if not names:
			continue
		for name in names:
			frappe.db.set_value(doctype, name, "user", doc.name, update_modified=False)
		if role:
			roles.append(role)
		if doctype == "Staff Member" and frappe.db.exists(
			"Staff Member", {"name": ["in", names], "is_lecturer": 1}
		):
			roles.append(ROLE_LECTURER)
	have = {d.role for d in doc.get("roles")}
	added = False
	for role in roles:
		if role not in have and frappe.db.exists("Role", role):
			# Insert the row directly (and keep it on the in-memory doc) to avoid re-saving the User here.
			row = doc.append("roles", {"role": role})
			row.db_insert()
			have.add(role)
			added = True
	if added:
		frappe.clear_cache(user=doc.name)


# ---------------------------------------------------------------------------------- admissions -> student
APPLICATION_TO_STUDENT_FIELDS = (
	"first_name",
	"middle_name",
	"last_name",
	"photo",
	"gender",
	"date_of_birth",
	"marital_status",
	"national_id",
	"nationality",
	"email",
	"phone",
	"county",
	"postal_address",
	"nok_name",
	"nok_relationship",
	"nok_phone",
	"home_church",
	"partner_church",
	"denomination",
	"pastor_name",
	"pastor_phone",
	"ministry_role",
	"programme",
	"campus",
	"study_mode",
	"intake",
)


def create_student_from_application(application) -> str:
	"""CONTRACT: create (once) the Student for an Admitted/Accepted Programme Application."""
	from mahanaim.services.communication import notify, recipient_for_student

	name = application if isinstance(application, str) else application.name
	# Row lock: a double click on "Convert" (or accept + convert) must not create two students.
	locked = frappe.db.get_value(
		"Programme Application", name, ["student", "status"], as_dict=True, for_update=True
	)
	if not locked:
		frappe.throw(_("Application {0} not found.").format(name), frappe.DoesNotExistError)
	if locked.student and frappe.db.exists("Student", locked.student):
		return locked.student
	app = frappe.get_doc("Programme Application", name)
	existing = frappe.db.get_value("Student", {"programme_application": name}, "name")
	if existing:
		app.db_set("student", existing)
		return existing
	if app.status not in ("Admitted", "Accepted"):
		frappe.throw(
			_("Only admitted applicants can become students (application is {0}).").format(_(app.status))
		)

	if app.user:
		user = app.user
		add_roles(user, ROLE_STUDENT, ROLE_APPLICANT)
	else:
		user = ensure_user(
			app.email, app.first_name, app.last_name, app.phone, roles=(ROLE_STUDENT, ROLE_APPLICANT)
		)

	intake = (
		frappe.db.get_value("Intake", app.intake, ["academic_year", "start_date"], as_dict=True)
		if app.intake
		else None
	) or {}
	start = getdate(intake.get("start_date") or nowdate())
	duration = flt(frappe.db.get_value("Programme", app.programme, "duration_years"))
	student = frappe.get_doc(
		{
			"doctype": "Student",
			**{f: app.get(f) for f in APPLICATION_TO_STUDENT_FIELDS},
			"status": "Admitted",
			"user": user,
			"programme_application": app.name,
			"admission_year": intake.get("academic_year") or current_year(),
			"enrollment_date": start,
			"expected_completion": add_months(start, round(duration * 12)) if duration else None,
			"year_of_study": 1,
			"fee_category": "Sponsored"
			if app.sponsorship_type in ("Church", "Sponsor", "Scholarship")
			else "Standard",
		}
	)
	student.flags.status_note = _("Created from application {0}").format(app.name)
	student.insert(ignore_permissions=True)
	app.db_set("student", student.name)
	notify(
		"Student Created",
		doc=student,
		recipients=[recipient_for_student(student)],
		link="/student",
		category="Admissions",
		fallback={
			"subject": _("Welcome, student {0}").format(student.student_number),
			"message": _(
				"Welcome to {0}! Your student number is <b>{1}</b>. Sign in to the student portal to register for courses."
			).format(setting("institution_name", "Mahanaim Bible College"), student.student_number),
		},
	)
	return student.name


# ---------------------------------------------------------------------------------- registration helpers
def passed_courses(student: str) -> set[str]:
	return set(
		frappe.get_all(
			"Course Result",
			filters={"student": student, "is_published": 1, "result_status": "Pass"},
			pluck="course",
		)
	)


def failed_courses(student: str) -> set[str]:
	failed = set(
		frappe.get_all(
			"Course Result",
			filters={
				"student": student,
				"is_published": 1,
				"result_status": ["in", ["Fail", "Supplementary"]],
			},
			pluck="course",
		)
	)
	return failed - passed_courses(student) if failed else failed


def prerequisites_for(courses) -> dict[str, list[dict]]:
	courses = list({c for c in courses if c})
	if not courses:
		return {}
	rows = frappe.get_all(
		"Course Prerequisite",
		filters={"parent": ["in", courses], "parenttype": "Course"},
		fields=["parent", "prerequisite", "prerequisite_title"],
	)
	out: dict[str, list[dict]] = {}
	for r in rows:
		out.setdefault(r.parent, []).append({"course": r.prerequisite, "title": r.prerequisite_title})
	return out


def missing_prerequisites(student: str, courses, passed: set[str] | None = None) -> dict[str, list[dict]]:
	"""{course: [missing prerequisite rows]} for courses whose prerequisites are not passed + published."""
	prereqs = prerequisites_for(courses)
	if not prereqs:
		return {}
	passed = passed_courses(student) if passed is None else passed
	return {
		course: [p for p in rows if p["course"] not in passed]
		for course, rows in prereqs.items()
		if any(p["course"] not in passed for p in rows)
	}


def curriculum_for(programme: str) -> dict[str, dict]:
	rows = frappe.get_all(
		"Programme Course",
		filters={"parent": programme, "parenttype": "Programme"},
		fields=["course", "course_title", "credits", "year_of_study", "term_number", "course_type"],
		order_by="year_of_study asc, term_number asc, idx asc",
	)
	return {r.course: r for r in rows}


def offering_lecturers(offerings) -> dict[str, list[dict]]:
	offerings = list({o for o in offerings if o})
	if not offerings:
		return {}
	rows = frappe.get_all(
		"Course Offering Lecturer",
		filters={"parent": ["in", offerings], "parenttype": "Course Offering"},
		fields=["parent", "staff_member", "staff_name", "role"],
		order_by="idx asc",
	)
	out: dict[str, list[dict]] = {}
	for r in rows:
		out.setdefault(r.parent, []).append(
			{"staff_member": r.staff_member, "name": r.staff_name, "role": r.role}
		)
	return out


def refresh_enrolled_count(offering: str | None, exclude: str | None = None):
	if not offering or not frappe.db.exists("Course Offering", offering):
		return
	filters = {"course_offering": offering, "status": "Enrolled"}
	if exclude:
		filters["name"] = ["!=", exclude]
	count = frappe.db.count("Course Enrolment", filters)
	frappe.db.set_value("Course Offering", offering, "enrolled_count", count, update_modified=False)


def on_registration_approved(reg):
	"""Side effects of an approved Semester Registration (idempotent)."""
	from mahanaim.services.communication import notify, recipient_for_student

	offerings = [c.course_offering for c in reg.courses if c.status == "Registered"]
	existing = {
		r.course_offering: r
		for r in frappe.get_all(
			"Course Enrolment",
			filters={"student": reg.student, "course_offering": ["in", offerings or [""]]},
			fields=["name", "course_offering", "status", "semester_registration"],
		)
	}
	for offering in offerings:
		current = existing.get(offering)
		if not current:
			frappe.get_doc(
				{
					"doctype": "Course Enrolment",
					"student": reg.student,
					"course_offering": offering,
					"semester_registration": reg.name,
					"status": "Enrolled",
					"enrolled_on": nowdate(),
				}
			).insert(ignore_permissions=True)
		elif current.status in ("Dropped", "Withdrawn"):
			enrolment = frappe.get_doc("Course Enrolment", current.name)
			enrolment.status = "Enrolled"
			enrolment.semester_registration = reg.name
			enrolment.save(ignore_permissions=True)
		elif not current.semester_registration:
			frappe.db.set_value("Course Enrolment", current.name, "semester_registration", reg.name)

	student = frappe.get_doc("Student", reg.student)
	changed = False
	if student.current_term != reg.academic_term:
		student.current_term = reg.academic_term
		changed = True
	if cint(reg.year_of_study) and cint(reg.year_of_study) != cint(student.year_of_study):
		student.year_of_study = cint(reg.year_of_study)
		changed = True
	if student.status in ("Admitted", "Registered"):
		student.status = "Active"
		student.flags.status_note = _("Registration {0} approved").format(reg.name)
		changed = True
	if changed:
		student.save(ignore_permissions=True)

	if cint(setting("auto_invoice_on_registration", 0)) and not reg.fee_invoice:
		invoice = safe_call("mahanaim.services.fees.create_invoice_for_registration", reg.name)
		if invoice and isinstance(invoice, str):
			reg.db_set("fee_invoice", invoice, update_modified=False)

	notify(
		"Registration Approved",
		doc=reg,
		recipients=[recipient_for_student(student)],
		link="/student/registration",
		category="Academic",
		fallback={
			"subject": _("Course registration approved — {0}").format(reg.academic_term),
			"message": _("Your course registration for {0} has been approved ({1} credits).").format(
				reg.academic_term, flt(reg.total_credits)
			),
		},
	)


def lms_sync_enrolment(enrolment: str, action: str = "enrol"):
	"""Background job: push a Course Enrolment to (or remove it from) the LMS via the B2 bridge."""
	if action == "unenrol":
		safe_call("mahanaim.services.lms_bridge.unenrol", enrolment)
		return
	result = safe_call("mahanaim.services.lms_bridge.enrol", enrolment)
	if result and isinstance(result, str) and frappe.db.exists("Course Enrolment", enrolment):
		if frappe.db.get_value("Course Enrolment", enrolment, "lms_enrollment") != result:
			frappe.db.set_value(
				"Course Enrolment", enrolment, "lms_enrollment", result, update_modified=False
			)


def enqueue_lms(enrolment: str, action: str = "enrol"):
	frappe.enqueue(
		"mahanaim.services.students.lms_sync_enrolment",
		queue="default",
		enqueue_after_commit=True,
		enrolment=enrolment,
		action=action,
	)


# ---------------------------------------------------------------------------------- student requests
def populate_clearance(req):
	have = {r.department for r in req.get("clearance") or []}
	for dept in CLEARANCE_DEPARTMENTS:
		if dept not in have:
			req.append("clearance", {"department": dept, "status": "Pending"})
	auto_check_finance(req)


def auto_check_finance(req):
	row = next((r for r in req.get("clearance") or [] if r.department == "Finance"), None)
	if not row or row.status == "Cleared":
		return
	balance = safe_call("mahanaim.services.fees.get_student_balance", req.student)
	if balance is None:
		row.remarks = _("Automatic finance check unavailable — verify manually.")
		return
	if flt(balance) <= 0:
		row.status = "Cleared"
		row.cleared_on = now_datetime()
		row.remarks = _("Auto-cleared: no outstanding fee balance.")
	else:
		row.status = "Not Cleared"
		row.remarks = _("Outstanding balance {0}").format(fmt_money(balance))


def _set_student_status(student, status: str, note: str):
	if student.status == status:
		return
	if status not in STUDENT_TRANSITIONS.get(student.status, ()):
		frappe.throw(
			_("Student {0} is {1} and cannot be moved to {2}.").format(
				student.name, _(student.status), _(status)
			)
		)
	student.status = status
	student.flags.status_note = note


def _withdraw_term_enrolments(student: str, term: str | None, status: str = "Withdrawn"):
	if not term:
		return
	for name in frappe.get_all(
		"Course Enrolment",
		filters={"student": student, "academic_term": term, "status": "Enrolled"},
		pluck="name",
	):
		doc = frappe.get_doc("Course Enrolment", name)
		doc.status = status
		doc.save(ignore_permissions=True)


def validate_request_effect(req):
	"""Raise a readable error before approval if the request's effect cannot be applied."""
	student = frappe.db.get_value("Student", req.student, ["status", "programme", "campus"], as_dict=True)
	target = {"Deferment": "Deferred", "Withdrawal": "Withdrawn", "Resumption": "Active"}.get(
		req.request_type
	)
	if target and student.status != target and target not in STUDENT_TRANSITIONS.get(student.status, ()):
		frappe.throw(
			_("This {0} request cannot be approved while the student is {1}.").format(
				_(req.request_type).lower(), _(student.status)
			)
		)
	if req.request_type == "Programme Transfer" and not req.new_programme:
		frappe.throw(_("Choose the programme to transfer to."))
	if req.request_type == "Campus Transfer" and not req.new_campus:
		frappe.throw(_("Choose the campus to transfer to."))
	if req.request_type == "Course Drop":
		if not req.course_enrolment:
			frappe.throw(_("Choose the course to drop."))
		if frappe.db.get_value("Course Enrolment", req.course_enrolment, "student") != req.student:
			frappe.throw(_("That course enrolment does not belong to this student."))
	if req.request_type == "Clearance":
		pending = [r.department for r in req.get("clearance") or [] if r.status != "Cleared"]
		if pending:
			frappe.throw(_("Clearance is still pending for: {0}").format(", ".join(_(d) for d in pending)))


def apply_request_effect(req):
	"""Apply an approved Student Request to the student record."""
	note = _("{0} request {1} approved").format(_(req.request_type), req.name)
	kind = req.request_type
	if kind in ("Deferment", "Withdrawal", "Resumption", "Programme Transfer", "Campus Transfer"):
		student = frappe.get_doc("Student", req.student)
		term = req.academic_term or student.current_term
		if kind == "Deferment":
			_set_student_status(student, "Deferred", note)
			_withdraw_term_enrolments(student.name, term)
		elif kind == "Withdrawal":
			_set_student_status(student, "Withdrawn", note)
			_withdraw_term_enrolments(student.name, term)
		elif kind == "Resumption":
			_set_student_status(student, "Active", note)
		elif kind == "Programme Transfer":
			student.programme = req.new_programme
			student.programme_name = frappe.db.get_value("Programme", req.new_programme, "programme_name")
		elif kind == "Campus Transfer":
			student.campus = req.new_campus
		student.save(ignore_permissions=True)
	elif kind == "Course Drop":
		enrolment = frappe.get_doc("Course Enrolment", req.course_enrolment)
		if enrolment.status == "Enrolled":
			enrolment.status = "Dropped"
			enrolment.save(ignore_permissions=True)
		if enrolment.semester_registration:
			_mark_registration_course_dropped(enrolment.semester_registration, enrolment.course_offering)
	elif kind in ("Transcript Request", "Document Request"):
		_create_transcript_for_request(req)


def _mark_registration_course_dropped(registration: str, offering: str):
	rows = frappe.get_all(
		"Semester Registration Course",
		filters={"parent": registration, "parenttype": "Semester Registration", "course_offering": offering},
		pluck="name",
	)
	for row in rows:
		frappe.db.set_value("Semester Registration Course", row, "status", "Dropped", update_modified=False)
	credits = frappe.get_all(
		"Semester Registration Course",
		filters={"parent": registration, "parenttype": "Semester Registration", "status": "Registered"},
		pluck="credits",
	)
	frappe.db.set_value(
		"Semester Registration",
		registration,
		"total_credits",
		sum(flt(c) for c in credits),
		update_modified=False,
	)


def _create_transcript_for_request(req):
	"""Draft Transcript for B3's credentials desk, linked back via Transcript.request."""
	if frappe.db.exists("Transcript", {"request": req.name}):
		return
	kind = (req.document_type or "").strip().title()
	savepoint = f"mbc_trn_{frappe.generate_hash(length=6)}"
	frappe.db.savepoint(savepoint)
	try:
		doc = frappe.get_doc(
			{
				"doctype": "Transcript",
				"student": req.student,
				"transcript_type": kind if kind in ("Provisional", "Official", "Final") else "Official",
				"status": "Draft",
				"request": req.name,
				"as_of_term": req.academic_term,
			}
		)
		doc.flags.ignore_mandatory = True
		doc.insert(ignore_permissions=True)
	except Exception:
		frappe.db.rollback(save_point=savepoint)
		frappe.log_error(title=f"Mahanaim: draft transcript for {req.name} failed")
		frappe.msgprint(
			_("The request was approved but the draft transcript could not be created automatically."),
			indicator="orange",
			alert=True,
		)


def request_status_notify(req):
	from mahanaim.services.communication import notify, recipient_for_student

	notes = f"<br>{frappe.utils.escape_html(req.review_notes)}" if req.review_notes else ""
	notify(
		"Student Request Update",
		doc=req,
		recipients=[recipient_for_student(req.student)],
		link="/student/requests",
		category="Academic",
		fallback={
			"subject": _("{0} request {1}: {2}").format(_(req.request_type), req.name, _(req.status)),
			"message": _("Your {0} request is now <b>{1}</b>.").format(
				_(req.request_type).lower(), _(req.status)
			)
			+ notes,
		},
	)


def can_clear(department: str, user: str | None = None) -> bool:
	user = user or frappe.session.user
	if user == "Administrator":
		return True
	roles = user_roles(user)
	if roles & {"System Manager", ROLE_ADMIN}:
		return True
	return bool(roles & set(CLEARANCE_ROLES.get(department, ())))


def mark_alumni(student):
	if student.user:
		add_roles(student.user, ROLE_ALUMNI)
