"""Student records & lifecycle endpoints (M06). See docs/api/students.md.

Portal endpoints resolve the Student from the session (`require_student()`); the Student-side doctypes have no
Student-role permissions, so ownership is checked here and writes use ignore_permissions.
Staff endpoints are for Registrars, Academic Deans and College Administrators (Finance Officers may read);
list endpoints use frappe.get_list so campus User Permissions apply.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate, now_datetime, today

from mahanaim.api.utils import (
	clean_payload,
	page_args,
	parse_json,
	require_login,
	require_roles,
	require_student,
	search_filters,
)
from mahanaim.services import students as svc
from mahanaim.utils import (
	ROLE_ADMIN,
	ROLE_DEAN,
	ROLE_FINANCE,
	ROLE_LIBRARY,
	ROLE_REGISTRAR,
	current_term,
	is_staff,
	setting,
	user_roles,
)

STAFF_WRITE = (ROLE_REGISTRAR, ROLE_DEAN)
STAFF_READ = (ROLE_REGISTRAR, ROLE_DEAN, ROLE_FINANCE)
REQUEST_STAFF = (ROLE_REGISTRAR, ROLE_DEAN, ROLE_FINANCE, ROLE_LIBRARY)
OPEN_REGISTRATION = ("Draft", "Submitted")
OPEN_REQUEST = ("Pending", "Under Review")
REQUEST_DECISIONS = ("Under Review", "Approved", "Rejected", "Completed")
PORTAL_LOG_FIELDS = ("timestamp", "from_status", "to_status")
STAFF_LOG_FIELDS = (*PORTAL_LOG_FIELDS, "note", "user")
DASHBOARD_ANNOUNCEMENTS = 5

PROFILE_FIELDS = (
	"name",
	"student_number",
	"first_name",
	"middle_name",
	"last_name",
	"full_name",
	"photo",
	"status",
	"user",
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
	"programme_name",
	"campus",
	"study_mode",
	"intake",
	"admission_year",
	"year_of_study",
	"current_term",
	"enrollment_date",
	"expected_completion",
	"completion_date",
	"graduation_date",
	"fee_category",
	"primary_sponsor",
	"programme_application",
	"cgpa",
	"credits_earned",
	"academic_standing",
	"current_ministry",
	"current_position",
	"alumni_consent",
)
SELF_EDITABLE = (
	"phone",
	"postal_address",
	"county",
	"nok_name",
	"nok_relationship",
	"nok_phone",
	"home_church",
	"pastor_name",
	"pastor_phone",
	"ministry_role",
	"photo",
)
STAFF_EDITABLE = (
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
	"admission_year",
	"year_of_study",
	"current_term",
	"enrollment_date",
	"expected_completion",
	"graduation_date",
	"fee_category",
	"primary_sponsor",
	"current_ministry",
	"current_position",
	"alumni_consent",
	"student_number",
)
REQUEST_FIELDS = (
	"request_type",
	"academic_term",
	"from_date",
	"to_date",
	"reason",
	"attachment",
	"new_programme",
	"new_campus",
	"course_enrolment",
	"document_type",
	"copies",
	"delivery_method",
)
STUDENT_LIST_FIELDS = [
	"name",
	"student_number",
	"full_name",
	"email",
	"phone",
	"gender",
	"status",
	"programme",
	"programme_name",
	"campus",
	"study_mode",
	"intake",
	"year_of_study",
	"current_term",
	"cgpa",
	"academic_standing",
	"fee_balance",
	"photo",
	"user",
	"modified",
]
REGISTRATION_FIELDS = [
	"name",
	"student",
	"student_name",
	"programme",
	"campus",
	"academic_term",
	"year_of_study",
	"study_mode",
	"status",
	"total_credits",
	"fee_invoice",
	"approved_by",
	"approved_on",
	"remarks",
	"creation",
	"modified",
]
REQUEST_LIST_FIELDS = [
	"name",
	"student",
	"student_name",
	"request_type",
	"academic_term",
	"status",
	"from_date",
	"to_date",
	"new_programme",
	"new_campus",
	"course_enrolment",
	"document_type",
	"copies",
	"delivery_method",
	"reviewer",
	"decision_date",
	"review_notes",
	"reason",
	"attachment",
	"creation",
	"modified",
]


# ---------------------------------------------------------------------------------- helpers
def _is_admin(user: str | None = None) -> bool:
	user = user or frappe.session.user
	return user == "Administrator" or bool(user_roles(user) & {"System Manager", ROLE_ADMIN})


def _child_rows(child: str, parent_doctype: str, parents: list[str], fields: list[str]) -> dict[str, list]:
	if not parents:
		return {}
	out: dict[str, list] = {}
	for row in frappe.get_all(
		child,
		filters={"parent": ["in", parents], "parenttype": parent_doctype},
		fields=["parent", *fields],
		order_by="idx asc",
	):
		parent = row.pop("parent")
		out.setdefault(parent, []).append(row)
	return out


def _status_log(doc, staff: bool = False) -> list[dict]:
	fields = STAFF_LOG_FIELDS if staff else PORTAL_LOG_FIELDS
	return [{f: r.get(f) for f in fields} for r in doc.get("status_log") or []]


def _validate_own_file(file_url: str | None, doctype: str, name: str | None, label: str | None = None):
	"""A browser-supplied file URL must be a site file path that is the user's own upload (or already attached
	to this record). Returns the normalised URL (None when empty)."""
	file_url = svc.local_file_url(file_url, label)
	if not file_url:
		return None
	user = frappe.session.user
	if is_staff(user):
		return file_url
	rows = frappe.get_all(
		"File", filters={"file_url": file_url}, fields=["owner", "attached_to_doctype", "attached_to_name"]
	)
	ok = any(
		(r.owner == user and not r.attached_to_name)
		or (name and r.attached_to_doctype == doctype and r.attached_to_name == name)
		for r in rows
	)
	if not ok:
		frappe.throw(_("You can only attach files you uploaded."), frappe.PermissionError)
	return file_url


def _paged_list(
	doctype, fields, filters, or_filters, start, page_length, order_by, count_by: str | None = "status"
):
	rows = frappe.get_list(
		doctype,
		filters=filters,
		or_filters=or_filters,
		fields=fields,
		order_by=order_by,
		**page_args(start, page_length),
	)
	total = frappe.get_list(
		doctype, filters=filters, or_filters=or_filters, fields=[{"COUNT": "*", "as": "total"}], order_by=None
	)
	out = {"data": rows, "total": cint(total[0].total) if total else 0}
	if count_by:
		base = [f for f in filters if f[0] != count_by]
		counts = frappe.get_list(
			doctype,
			filters=base,
			or_filters=or_filters,
			fields=[count_by, {"COUNT": "*", "as": "count"}],
			group_by=count_by,
			order_by=None,
		)
		out[f"counts_by_{count_by}"] = {c.get(count_by): cint(c.count) for c in counts}
	return out


def _filters(**values) -> list:
	filters = []
	for field, value in values.items():
		if value in (None, ""):
			continue
		if isinstance(value, str) and value.startswith("["):
			value = parse_json(value, [])
		filters.append([field, "in" if isinstance(value, list) else "=", value])
	return filters


def _term_info(term: str | None) -> dict | None:
	if not term:
		return None
	from mahanaim.mahanaim_setup.doctype.academic_term.academic_term import registration_window

	row = frappe.db.get_value(
		"Academic Term",
		term,
		[
			"name",
			"term_label",
			"term_name",
			"academic_year",
			"status",
			"is_current",
			"start_date",
			"end_date",
			"registration_start",
			"registration_end",
			"late_registration_end",
			"exam_start",
			"exam_end",
		],
		as_dict=True,
	)
	if not row:
		return None
	row["window"] = registration_window(row)
	return row


def _default_registration_term() -> str | None:
	"""The term whose registration window is open now (earliest first), else the current term."""
	from mahanaim.mahanaim_setup.doctype.academic_term.academic_term import registration_window

	terms = frappe.get_all(
		"Academic Term",
		filters={"status": ["!=", "Closed"], "registration_start": ["<=", today()]},
		fields=["name", "status", "registration_start", "registration_end", "late_registration_end"],
		order_by="start_date asc",
		limit=20,
	)
	for t in terms:
		if registration_window(t)["is_open"]:
			return t.name
	return current_term()


def _brief(student) -> dict:
	return {
		f: student.get(f)
		for f in (
			"name",
			"student_number",
			"full_name",
			"photo",
			"status",
			"programme",
			"programme_name",
			"campus",
			"study_mode",
			"intake",
			"year_of_study",
			"current_term",
			"cgpa",
			"credits_earned",
			"academic_standing",
		)
	}


def _profile(doc, staff: bool = False) -> dict:
	data = {f: doc.get(f) for f in PROFILE_FIELDS}
	data["campus_name"] = frappe.db.get_value("Campus", doc.campus, "campus_name") if doc.campus else None
	data["term_label"] = (
		frappe.db.get_value("Academic Term", doc.current_term, "term_label") if doc.current_term else None
	)
	data["status_log"] = _status_log(doc, staff)
	data["editable_fields"] = list(STAFF_EDITABLE if staff else SELF_EDITABLE)
	if staff:
		data["allowed_transitions"] = list(svc.STUDENT_TRANSITIONS.get(doc.status, ()))
	return data


def _registration_dict(doc) -> dict:
	data = {f: doc.get(f) for f in REGISTRATION_FIELDS}
	data["courses"] = [
		{
			f: r.get(f)
			for f in ("name", "course_offering", "course", "course_title", "credits", "course_type", "status")
		}
		for r in doc.courses
	]
	data["can_cancel"] = doc.status in OPEN_REGISTRATION
	data["term_label"] = frappe.db.get_value("Academic Term", doc.academic_term, "term_label")
	return data


def _registration_list(filters: list | dict, start=0, page_length=50) -> list[dict]:
	rows = frappe.get_all(
		"Semester Registration",
		filters=filters,
		fields=REGISTRATION_FIELDS,
		order_by="creation desc",
		**page_args(start, page_length),
	)
	courses = _child_rows(
		"Semester Registration Course",
		"Semester Registration",
		[r.name for r in rows],
		["name", "course_offering", "course", "course_title", "credits", "course_type", "status"],
	)
	for r in rows:
		r["courses"] = courses.get(r.name, [])
		r["can_cancel"] = r.status in OPEN_REGISTRATION
	return rows


def _request_dict(doc, staff: bool = False) -> dict:
	data = {f: doc.get(f) for f in REQUEST_LIST_FIELDS}
	data["clearance"] = [
		{
			**{f: r.get(f) for f in ("name", "department", "status", "cleared_by", "cleared_on", "remarks")},
			**({"can_clear": svc.can_clear(r.department)} if staff else {}),
		}
		for r in doc.get("clearance") or []
	]
	data["status_log"] = _status_log(doc, staff)
	data["can_cancel"] = doc.status in OPEN_REQUEST
	if doc.course_enrolment:
		data["course"] = frappe.db.get_value(
			"Course Enrolment",
			doc.course_enrolment,
			["course", "course_offering", "academic_term", "status"],
			as_dict=True,
		)
	if doc.request_type in ("Transcript Request", "Document Request"):
		data["transcript"] = (
			frappe.db.get_value("Transcript", {"request": doc.name}, ["name", "status"], as_dict=True)
			if frappe.db.table_exists("Transcript")
			else None
		)
	return data


def _own(doctype: str, name: str, student) -> frappe.model.document.Document:
	if not name or frappe.db.get_value(doctype, name, "student") != student.name:
		frappe.throw(_("{0} not found.").format(_(doctype)), frappe.PermissionError)
	doc = frappe.get_doc(doctype, name)
	doc.flags.ignore_permissions = True
	return doc


def _staff_doc(doctype: str, name: str, ptype: str = "read"):
	if not frappe.db.exists(doctype, name):
		frappe.throw(_("{0} {1} not found.").format(_(doctype), name), frappe.DoesNotExistError)
	doc = frappe.get_doc(doctype, name)
	frappe.has_permission(doctype, ptype, doc, throw=True)
	return doc


def _bulk(names, fn) -> dict:
	names = parse_json(names, []) if isinstance(names, str) else (names or [])
	if not names:
		frappe.throw(_("Select at least one record."))
	if len(names) > 200:
		frappe.throw(_("Process at most 200 records at a time."))
	updated, failed = [], []
	for name in names:
		savepoint = f"bulk_{frappe.generate_hash(length=6)}"
		frappe.db.savepoint(savepoint)
		try:
			fn(name)
			updated.append(name)
		except Exception as e:
			frappe.db.rollback(save_point=savepoint)
			failed.append({"name": name, "error": frappe.utils.strip_html(str(e)) or e.__class__.__name__})
			frappe.clear_messages()
	return {"ok": not failed, "updated": updated, "failed": failed}


# ---------------------------------------------------------------------------------- portal: profile
@frappe.whitelist()
def my_profile():
	return _profile(require_student())


@frappe.whitelist(methods=["POST"])
def update_my_profile(data):
	student = require_student()
	values = clean_payload(data, SELF_EDITABLE)
	if not values:
		frappe.throw(_("Nothing to update."))
	if "photo" in values and values["photo"] != student.photo:
		values["photo"] = _validate_own_file(values["photo"], "Student", student.name, _("Photo"))
	student.update(values)
	student.flags.ignore_permissions = True
	student.save()
	return _profile(student)


@frappe.whitelist()
def my_dashboard():
	student = require_student()
	user = frappe.session.user
	now = now_datetime()
	term = student.current_term or current_term()
	reg_term = _default_registration_term()
	enrolments = frappe.get_all(
		"Course Enrolment",
		filters={"student": student.name, "status": "Enrolled"},
		fields=["name", "course_offering", "course", "academic_term", "status"],
	)
	offerings = [e.course_offering for e in enrolments]
	info = {
		r.name: r
		for r in frappe.get_all(
			"Course Offering",
			filters={"name": ["in", offerings or [""]]},
			fields=["name", "course_title", "credits", "academic_term", "section"],
		)
	}
	lecturers = svc.offering_lecturers(offerings)
	courses = [
		{
			**e,
			"course_title": (info.get(e.course_offering) or {}).get("course_title"),
			"credits": (info.get(e.course_offering) or {}).get("credits"),
			"lecturers": lecturers.get(e.course_offering, []),
		}
		for e in enrolments
		if not term or e.academic_term == term
	]

	assignments = []
	if offerings:
		assignments = frappe.get_all(
			"Assignment",
			filters={"course_offering": ["in", offerings], "status": "Published", "due_date": [">=", now]},
			fields=[
				"name",
				"title",
				"course_offering",
				"course_title",
				"assessment_component",
				"due_date",
				"max_score",
			],
			order_by="due_date asc",
			limit=8,
		)
		done = set(
			frappe.get_all(
				"Assignment Submission",
				filters={
					"student": student.name,
					"assignment": ["in", [a.name for a in assignments] or [""]],
					"status": ["!=", "Draft"],
				},
				pluck="assignment",
			)
		)
		for a in assignments:
			a["submitted"] = a.name in done
	exams = []
	if offerings:
		exams = [
			e
			for e in frappe.get_all(
				"Exam",
				filters={"course_offering": ["in", offerings], "status": ["in", ["Scheduled", "Open"]]},
				fields=[
					"name",
					"title",
					"exam_type",
					"course_offering",
					"course_title",
					"delivery_mode",
					"status",
					"start_datetime",
					"end_datetime",
					"duration_minutes",
					"venue",
				],
				order_by="start_datetime asc",
				limit=20,
			)
			if not (e.end_datetime or e.start_datetime) or (e.end_datetime or e.start_datetime) >= now
		][:8]

	announcements = svc.safe_call(
		"mahanaim.services.messaging.visible_announcements", user, limit=DASHBOARD_ANNOUNCEMENTS, default=[]
	)

	registration = (
		frappe.db.get_value(
			"Semester Registration",
			{
				"student": student.name,
				"academic_term": reg_term,
				"status": ["not in", ["Cancelled", "Rejected"]],
			},
			["name", "status", "total_credits"],
			as_dict=True,
		)
		if reg_term
		else None
	)
	return {
		"student": _brief(student),
		"term": _term_info(term),
		"registration_term": _term_info(reg_term) if reg_term != term else None,
		"registration": registration,
		"courses": courses,
		"credits_this_term": sum(flt(c["credits"]) for c in courses),
		"cgpa": flt(student.cgpa),
		"credits_earned": flt(student.credits_earned),
		"academic_standing": student.academic_standing,
		"fee_balance": svc.safe_call("mahanaim.services.fees.get_student_balance", student.name),
		"currency": setting("currency", "KES"),
		"upcoming_assignments": assignments,
		"upcoming_exams": exams,
		"unread_notifications": frappe.db.count("Portal Notification", {"user": user, "is_read": 0}),
		"announcements": announcements,
		"open_requests": frappe.db.count(
			"Student Request", {"student": student.name, "status": ["in", OPEN_REQUEST]}
		),
		"today_classes": svc.safe_call(_today_classes),
		"attendance_summary": svc.safe_call(_attendance_block, student.name, term),
		"clearance": _clearance_block(student.name),
	}


def _today_classes() -> list[dict]:
	"""Today's sessions for the student's enrolled offerings, via the academics timetable (B2)."""
	day = today()
	timetable = frappe.get_attr("mahanaim.api.academics.my_timetable")(from_date=day, to_date=day)
	return [
		{
			"name": s.get("name"),
			"offering": s.get("course_offering"),
			"course_offering": s.get("course_offering"),
			"course_title": s.get("course_title"),
			"session_date": s.get("session_date"),
			"start_time": s.get("start_time"),
			"end_time": s.get("end_time"),
			"venue": s.get("venue"),
			"mode": s.get("mode"),
			"meeting_link": s.get("meeting_link"),
			"status": s.get("status"),
			"topic": s.get("topic"),
			"lecturer_name": s.get("lecturer_name"),
		}
		for s in (timetable or {}).get("sessions") or []
	]


def _attendance_block(student: str, term: str | None) -> dict | None:
	"""Attendance across the student's offerings in `term`, using the academics attendance maths (B2)."""
	if not term:
		return None
	from mahanaim.api.academics import attendance_percent, attendance_summary
	from mahanaim.services.assessments import student_offerings

	totals = dict.fromkeys(("held", "present", "late", "absent", "excused"), 0)
	for per_student in attendance_summary(student_offerings(student, term=term), [student]).values():
		stats = per_student.get(student) or {}
		for key in totals:
			totals[key] += cint(stats.get(key))
	counted = totals["held"] - totals["excused"]
	return {
		"term": term,
		"percent": attendance_percent(totals["present"], totals["late"], totals["held"], totals["excused"])
		if counted > 0
		else None,
		"sessions": totals["held"],
		"present": totals["present"],
		"late": totals["late"],
		"absent": totals["absent"],
		"excused": totals["excused"],
	}


def _clearance_block(student: str) -> dict | None:
	"""Exam and transcript fee clearance from the fees contract (B3); null when it is unavailable."""
	out = {}
	for purpose in ("exam", "transcript"):
		state = svc.safe_call("mahanaim.services.fees.fee_clearance", student, purpose)
		out[purpose] = (
			{
				"cleared": bool(state.get("cleared")),
				"message": state.get("message") or "",
				"paid_percent": state.get("paid_percent"),
				"required_percent": state.get("required_percent"),
			}
			if isinstance(state, dict)
			else None
		)
	return out if any(out.values()) else None


# ---------------------------------------------------------------------------------- portal: registration
@frappe.whitelist()
def registration_options(term: str | None = None):
	"""Offerings the student may register for in `term` (default: the term whose window is open)."""
	student = require_student()
	term = term or _default_registration_term()
	term_info = _term_info(term)
	if not term_info:
		frappe.throw(_("There is no academic term open for registration."))
	curriculum = svc.curriculum_for(student.programme)
	filters = {
		"academic_term": term,
		"campus": student.campus,
		"status": ["not in", ["Cancelled", "Completed"]],
	}
	if curriculum:
		filters["course"] = ["in", list(curriculum)]
	offerings = frappe.get_all(
		"Course Offering",
		filters=filters,
		fields=[
			"name",
			"course",
			"course_title",
			"credits",
			"section",
			"study_mode",
			"status",
			"capacity",
			"enrolled_count",
			"start_date",
			"end_date",
		],
		order_by="course asc, section asc",
	)
	course_info = {
		r.name: r
		for r in frappe.get_all(
			"Course",
			filters={"name": ["in", [o.course for o in offerings] or [""]]},
			fields=["name", "course_code", "course_title", "credits"],
		)
	}
	prereqs = svc.prerequisites_for([o.course for o in offerings])
	passed = svc.passed_courses(student.name)
	failed = svc.failed_courses(student.name)
	lecturers = svc.offering_lecturers([o.name for o in offerings])
	enrolled = set(
		frappe.get_all(
			"Course Enrolment",
			filters={"student": student.name, "academic_term": term, "status": "Enrolled"},
			pluck="course_offering",
		)
	)
	reg_name = frappe.db.get_value(
		"Semester Registration",
		{"student": student.name, "academic_term": term, "status": ["not in", ["Cancelled", "Rejected"]]},
		"name",
	)
	registration = _registration_dict(frappe.get_doc("Semester Registration", reg_name)) if reg_name else None
	selected = {
		c["course_offering"] for c in (registration or {}).get("courses", []) if c["status"] == "Registered"
	}
	data = []
	for o in offerings:
		course = course_info.get(o.course) or {}
		plan = curriculum.get(o.course) or {}
		rows = [{**p, "satisfied": p["course"] in passed} for p in prereqs.get(o.course, [])]
		capacity = cint(o.capacity)
		data.append(
			{
				**o,
				"course_code": course.get("course_code"),
				"course_title": o.course_title or course.get("course_title"),
				"credits": flt(o.credits) or flt(course.get("credits")),
				"lecturers": lecturers.get(o.name, []),
				"prerequisites": rows,
				"prerequisites_met": all(r["satisfied"] for r in rows),
				"already_passed": o.course in passed,
				"is_retake": o.course in failed,
				"year_of_study": plan.get("year_of_study"),
				"term_number": plan.get("term_number"),
				"course_type": plan.get("course_type") or "Core",
				"recommended": bool(plan)
				and cint(plan.get("year_of_study")) == cint(student.year_of_study or 1),
				"matches_study_mode": not o.study_mode or o.study_mode == student.study_mode,
				"seats_left": max(capacity - cint(o.enrolled_count), 0) if capacity else None,
				"is_full": bool(capacity) and cint(o.enrolled_count) >= capacity and o.name not in enrolled,
				"registered": o.name in selected,
				"enrolled": o.name in enrolled,
			}
		)
	window = term_info["window"]
	eligible = student.status in svc.REGISTRABLE_STATUSES
	return {
		"term": term_info,
		"window": window,
		"student": _brief(student),
		"eligible": eligible,
		"can_register": eligible
		and window["is_open"]
		and (not registration or registration["status"] in OPEN_REGISTRATION),
		"max_credits": flt(setting("max_credits_per_term", 24)),
		"registration": registration,
		"fee_clearance": svc.safe_call("mahanaim.services.fees.fee_clearance", student.name, "registration"),
		"offerings": data,
	}


@frappe.whitelist(methods=["POST"])
def submit_registration(term: str, offerings, submit=1, remarks: str | None = None):
	"""Create/replace the student's registration for `term` with `offerings` (list of Course Offering names)."""
	student = require_student()
	items = parse_json(offerings, []) if isinstance(offerings, str) else (offerings or [])
	names = []
	for o in items:
		name = o if isinstance(o, str) else (o or {}).get("course_offering")
		if name and name not in names:
			names.append(name)
	if not term or not frappe.db.exists("Academic Term", term):
		frappe.throw(_("Choose the academic term to register for."))
	if not names:
		frappe.throw(_("Select at least one course."))
	existing = frappe.db.get_value(
		"Semester Registration",
		{"student": student.name, "academic_term": term, "status": ["not in", ["Cancelled", "Rejected"]]},
		["name", "status"],
		as_dict=True,
	)
	if existing and existing.status not in OPEN_REGISTRATION:
		frappe.throw(
			_(
				"Your registration for {0} has already been approved. To drop a course submit a Course Drop "
				"request; to add one, contact the Registrar."
			).format(term)
		)
	if existing:
		doc = frappe.get_doc("Semester Registration", existing.name)
		doc.set("courses", [])
	else:
		doc = frappe.new_doc("Semester Registration")
		doc.update({"student": student.name, "academic_term": term, "status": "Draft"})
	for name in names:
		doc.append("courses", {"course_offering": name, "status": "Registered"})
	if remarks is not None:
		doc.remarks = remarks
	if cint(submit):
		doc.status = "Submitted"
	doc.flags.ignore_permissions = True
	doc.save()
	return _registration_dict(doc)


@frappe.whitelist(methods=["POST"])
def cancel_registration(name: str):
	student = require_student()
	doc = _own("Semester Registration", name, student)
	if doc.status not in OPEN_REGISTRATION:
		frappe.throw(_("Only draft or submitted registrations can be cancelled."))
	doc.status = "Cancelled"
	doc.save()
	return _registration_dict(doc)


@frappe.whitelist()
def my_registrations():
	student = require_student()
	rows = _registration_list({"student": student.name}, 0, 200)
	labels = dict(
		frappe.get_all(
			"Academic Term",
			filters={"name": ["in", [r.academic_term for r in rows] or [""]]},
			fields=["name", "term_label"],
			as_list=True,
		)
	)
	for r in rows:
		r["term_label"] = labels.get(r.academic_term)
	return {"data": rows, "total": len(rows)}


@frappe.whitelist()
def my_courses(term: str | None = None):
	student = require_student()
	filters = {"student": student.name}
	if term:
		filters["academic_term"] = term
	enrolments = frappe.get_all(
		"Course Enrolment",
		filters=filters,
		fields=[
			"name",
			"course_offering",
			"course",
			"academic_term",
			"status",
			"enrolled_on",
			"lms_enrollment",
		],
		order_by="creation desc",
	)
	offerings = list({e.course_offering for e in enrolments})
	info = {
		r.name: r
		for r in frappe.get_all(
			"Course Offering",
			filters={"name": ["in", offerings or [""]]},
			fields=[
				"name",
				"course_title",
				"credits",
				"section",
				"study_mode",
				"status",
				"start_date",
				"end_date",
				"lms_course",
				"results_status",
			],
		)
	}
	codes = dict(
		frappe.get_all(
			"Course",
			filters={"name": ["in", [e.course for e in enrolments] or [""]]},
			fields=["name", "course_code"],
			as_list=True,
		)
	)
	results = {
		r.course_offering: r
		for r in frappe.get_all(
			"Course Result",
			filters={
				"student": student.name,
				"is_published": 1,
				"course_offering": ["in", offerings or [""]],
			},
			fields=["course_offering", "grade", "total_score", "grade_points", "result_status"],
		)
	}
	lecturers = svc.offering_lecturers(offerings)
	lms_urls = {
		o: svc.safe_call("mahanaim.services.lms_bridge.lms_course_url", o)
		for o, row in info.items()
		if row.lms_course
	}
	labels = dict(
		frappe.get_all(
			"Academic Term",
			filters={"name": ["in", [e.academic_term for e in enrolments] or [""]]},
			fields=["name", "term_label"],
			as_list=True,
		)
	)
	data = []
	for e in enrolments:
		off = info.get(e.course_offering) or {}
		data.append(
			{
				**e,
				"course_code": codes.get(e.course),
				"course_title": off.get("course_title"),
				"credits": off.get("credits"),
				"section": off.get("section"),
				"offering_status": off.get("status"),
				"start_date": off.get("start_date"),
				"end_date": off.get("end_date"),
				"term_label": labels.get(e.academic_term),
				"lecturers": lecturers.get(e.course_offering, []),
				"lms_url": lms_urls.get(e.course_offering),
				"result": results.get(e.course_offering),
			}
		)
	return {"data": data, "total": len(data)}


# ---------------------------------------------------------------------------------- portal: requests
@frappe.whitelist()
def my_requests():
	student = require_student()
	rows = frappe.get_all(
		"Student Request",
		filters={"student": student.name},
		fields=REQUEST_LIST_FIELDS,
		order_by="creation desc",
		limit=200,
	)
	names = [r.name for r in rows]
	clearance = _child_rows(
		"Clearance Item",
		"Student Request",
		[r.name for r in rows if r.request_type == "Clearance"],
		["name", "department", "status", "cleared_on", "remarks"],
	)
	logs = _child_rows("Mahanaim Status Log", "Student Request", names, list(PORTAL_LOG_FIELDS))
	for r in rows:
		r["clearance"] = clearance.get(r.name, [])
		r["status_log"] = logs.get(r.name, [])
		r["can_cancel"] = r.status in OPEN_REQUEST
		r.pop("reviewer", None)
	return {"data": rows, "total": len(rows)}


@frappe.whitelist(methods=["POST"])
def create_request(data):
	student = require_student()
	values = clean_payload(data, REQUEST_FIELDS)
	if not values.get("request_type"):
		frappe.throw(_("Choose the type of request."))
	if "attachment" in values:
		values["attachment"] = _validate_own_file(
			values["attachment"], "Student Request", None, _("Attachment")
		)
	doc = frappe.get_doc(
		{"doctype": "Student Request", **values, "student": student.name, "status": "Pending"}
	)
	doc.insert(ignore_permissions=True)
	return _request_dict(doc)


@frappe.whitelist(methods=["POST"])
def cancel_request(name: str):
	student = require_student()
	doc = _own("Student Request", name, student)
	if doc.status not in OPEN_REQUEST:
		frappe.throw(_("Only pending requests can be cancelled."))
	doc.status = "Cancelled"
	doc.flags.status_note = _("Cancelled by the student")
	doc.save()
	return _request_dict(doc)


# ---------------------------------------------------------------------------------- staff: students
@frappe.whitelist()
def list_students(
	status=None,
	programme=None,
	campus=None,
	intake=None,
	study_mode=None,
	year_of_study=None,
	gender=None,
	academic_standing=None,
	current_term=None,
	search=None,
	start=0,
	page_length=20,
	order_by=None,
):
	require_roles(*STAFF_READ)
	filters = _filters(
		status=status,
		programme=programme,
		campus=campus,
		intake=intake,
		study_mode=study_mode,
		year_of_study=year_of_study,
		gender=gender,
		academic_standing=academic_standing,
		current_term=current_term,
	)
	or_filters = search_filters(
		search, ("name", "student_number", "full_name", "email", "phone", "national_id")
	)
	order = (
		order_by
		if order_by in ("full_name asc", "student_number asc", "modified desc", "creation desc", "cgpa desc")
		else "full_name asc"
	)
	return _paged_list("Student", STUDENT_LIST_FIELDS, filters, or_filters, start, page_length, order)


@frappe.whitelist()
def student_360(name: str):
	require_roles(*STAFF_READ)
	doc = _staff_doc("Student", name)
	enrolments = frappe.get_all(
		"Course Enrolment",
		filters={"student": name},
		fields=[
			"name",
			"course_offering",
			"course",
			"academic_term",
			"status",
			"enrolled_on",
			"final_grade",
			"semester_registration",
		],
		order_by="creation desc",
	)
	titles = dict(
		frappe.get_all(
			"Course",
			filters={"name": ["in", [e.course for e in enrolments] or [""]]},
			fields=["name", "course_title"],
			as_list=True,
		)
	)
	for e in enrolments:
		e["course_title"] = titles.get(e.course)
	results = frappe.get_all(
		"Course Result",
		filters={"student": name, "is_published": 1},
		fields=[
			"name",
			"course",
			"course_title",
			"academic_term",
			"credits",
			"total_score",
			"grade",
			"grade_points",
			"result_status",
			"attempt",
		],
		order_by="academic_term asc, course asc",
	)
	finance = {
		"balance": svc.safe_call("mahanaim.services.fees.get_student_balance", name),
		"totals": svc.safe_call("mahanaim.services.fees.ledger_totals", name),
		"registration_clearance": svc.safe_call("mahanaim.services.fees.fee_clearance", name, "registration"),
		"invoices": frappe.get_all(
			"Student Invoice",
			filters={"student": name, "docstatus": 1},
			fields=[
				"name",
				"posting_date",
				"due_date",
				"academic_term",
				"status",
				"total_amount",
				"paid_amount",
				"outstanding_amount",
			],
			order_by="posting_date desc",
			limit=10,
		),
		"payments": frappe.get_all(
			"Student Payment",
			filters={"student": name, "docstatus": 1},
			fields=["name", "posting_date", "amount", "mode_of_payment", "reference_no", "status"],
			order_by="posting_date desc",
			limit=10,
		),
		"currency": setting("currency", "KES"),
	}
	sponsorships = frappe.get_all(
		"Sponsorship",
		filters={"student": name},
		fields=[
			"name",
			"sponsor",
			"sponsor_name",
			"status",
			"coverage",
			"amount",
			"percentage",
			"start_term",
			"end_term",
		],
		order_by="creation desc",
	)
	sponsor = (
		frappe.db.get_value(
			"Sponsor",
			doc.primary_sponsor,
			["name", "sponsor_name", "sponsor_type", "email", "phone"],
			as_dict=True,
		)
		if doc.primary_sponsor
		else None
	)
	requests = frappe.get_all(
		"Student Request",
		filters={"student": name},
		fields=["name", "request_type", "status", "academic_term", "creation", "decision_date"],
		order_by="creation desc",
		limit=50,
	)
	user = (
		frappe.db.get_value("User", doc.user, ["name", "enabled", "last_login", "mobile_no"], as_dict=True)
		if doc.user
		else None
	)
	application = (
		frappe.db.get_value(
			"Programme Application",
			doc.programme_application,
			["name", "status", "submitted_on", "accepted_on"],
			as_dict=True,
		)
		if doc.programme_application
		else None
	)
	return {
		"profile": _profile(doc, staff=True),
		"user": user,
		"application": application,
		"registrations": _registration_list({"student": name}, 0, 50),
		"enrolments": enrolments,
		"results": {
			"rows": results,
			"cgpa": flt(doc.cgpa),
			"credits_earned": flt(doc.credits_earned),
			"academic_standing": doc.academic_standing,
			"passed": sum(1 for r in results if r.result_status == "Pass"),
			"failed": sum(1 for r in results if r.result_status in ("Fail", "Supplementary")),
		},
		"finance": finance,
		"requests": requests,
		"sponsor": sponsor,
		"sponsorships": sponsorships,
		"status_log": _status_log(doc, staff=True),
	}


@frappe.whitelist(methods=["POST"])
def create_student(data):
	require_roles(*STAFF_WRITE)
	payload = parse_json(data, {}) or {}
	values = clean_payload(payload, (*STAFF_EDITABLE, "status"))
	values.setdefault("status", "Admitted")
	if "photo" in values:
		values["photo"] = svc.local_file_url(values["photo"], _("Photo"))
	doc = frappe.get_doc({"doctype": "Student", **values})
	if "create_user" in payload:
		doc.flags.create_user = bool(cint(payload.get("create_user")))
	doc.insert()
	return _profile(doc, staff=True)


@frappe.whitelist(methods=["POST"])
def update_student(name: str, data):
	require_roles(*STAFF_WRITE)
	doc = _staff_doc("Student", name, "write")
	values = clean_payload(data, STAFF_EDITABLE)
	if not values:
		frappe.throw(_("Nothing to update."))
	if "photo" in values and values["photo"] != doc.photo:
		values["photo"] = svc.local_file_url(values["photo"], _("Photo"))
	doc.update(values)
	doc.save()
	return _profile(doc, staff=True)


@frappe.whitelist(methods=["POST"])
def change_student_status(name: str, status: str, note: str | None = None, force=False):
	require_roles(*STAFF_WRITE)
	doc = _staff_doc("Student", name, "write")
	force = cint(force) if not isinstance(force, bool) else force
	if force and not _is_admin():
		frappe.throw(_("Only a College Administrator can force a status change."), frappe.PermissionError)
	if status == doc.status:
		return _profile(doc, staff=True)
	previous_term = doc.current_term
	doc.status = status
	doc.flags.status_note = note
	doc.flags.force_status = bool(force)
	doc.save()
	if status in ("Withdrawn", "Deferred"):
		svc._withdraw_term_enrolments(doc.name, previous_term)
	if status == "Alumni":
		svc.mark_alumni(doc)
	return _profile(doc, staff=True)


@frappe.whitelist()
def student_stats():
	require_roles(*STAFF_READ)

	def group(field):
		rows = frappe.get_list(
			"Student", fields=[field, {"COUNT": "*", "as": "count"}], group_by=field, order_by=None
		)
		return sorted(
			({"key": r.get(field), "count": cint(r.count)} for r in rows), key=lambda r: -r["count"]
		)

	by_status = group("status")
	totals = {r["key"]: r["count"] for r in by_status}
	programme_names = dict(frappe.get_all("Programme", fields=["name", "programme_name"], as_list=True))
	by_programme = group("programme")
	for r in by_programme:
		r["label"] = programme_names.get(r["key"])
	return {
		"total": sum(totals.values()),
		"active": totals.get("Active", 0) + totals.get("Registered", 0),
		"by_status": totals,
		"by_programme": by_programme,
		"by_campus": group("campus"),
		"by_intake": group("intake"),
		"by_gender": group("gender"),
		"by_year_of_study": group("year_of_study"),
	}


# ---------------------------------------------------------------------------------- staff: registrations
@frappe.whitelist()
def list_registrations(
	term=None,
	status=None,
	programme=None,
	campus=None,
	study_mode=None,
	year_of_study=None,
	student=None,
	search=None,
	start=0,
	page_length=20,
):
	require_roles(*STAFF_READ)
	filters = _filters(
		academic_term=term,
		status=status,
		programme=programme,
		campus=campus,
		study_mode=study_mode,
		year_of_study=year_of_study,
		student=student,
	)
	or_filters = search_filters(search, ("name", "student", "student_name"))
	out = _paged_list(
		"Semester Registration", REGISTRATION_FIELDS, filters, or_filters, start, page_length, "creation desc"
	)
	courses = _child_rows(
		"Semester Registration Course",
		"Semester Registration",
		[r.name for r in out["data"]],
		["course_offering", "course", "course_title", "credits", "status"],
	)
	for r in out["data"]:
		r["courses"] = courses.get(r.name, [])
	return out


@frappe.whitelist()
def get_registration(name: str):
	require_roles(*STAFF_READ)
	doc = _staff_doc("Semester Registration", name)
	data = _registration_dict(doc)
	student = frappe.get_doc("Student", doc.student)
	data["student_info"] = _brief(student)
	data["fee_clearance"] = svc.safe_call("mahanaim.services.fees.fee_clearance", doc.student, "registration")
	data["missing_prerequisites"] = svc.missing_prerequisites(
		doc.student, [c.course for c in doc.courses if c.status == "Registered"]
	)
	data["max_credits"] = flt(setting("max_credits_per_term", 24))
	return data


def _approve(name: str, ignore_capacity=0, ignore_prerequisites=0, ignore_credit_limit=0):
	doc = _staff_doc("Semester Registration", name, "write")
	if doc.status != "Submitted":
		frappe.throw(
			_("Registration {0} is {1}; only submitted registrations can be approved.").format(
				name, _(doc.status)
			)
		)
	doc.status = "Approved"
	doc.flags.ignore_capacity = bool(cint(ignore_capacity))
	doc.flags.ignore_prerequisites = bool(cint(ignore_prerequisites))
	doc.flags.ignore_credit_limit = bool(cint(ignore_credit_limit))
	doc.save()
	return doc


@frappe.whitelist(methods=["POST"])
def approve_registration(name: str, ignore_capacity=0, ignore_prerequisites=0, ignore_credit_limit=0):
	require_roles(*STAFF_WRITE)
	return _registration_dict(_approve(name, ignore_capacity, ignore_prerequisites, ignore_credit_limit))


@frappe.whitelist(methods=["POST"])
def reject_registration(name: str, reason: str):
	require_roles(*STAFF_WRITE)
	if not (reason or "").strip():
		frappe.throw(_("Give a reason for rejecting the registration."))
	doc = _staff_doc("Semester Registration", name, "write")
	if doc.status != "Submitted":
		frappe.throw(_("Only submitted registrations can be rejected."))
	doc.status = "Rejected"
	doc.remarks = reason.strip()
	doc.flags.status_note = reason.strip()
	doc.save()
	from mahanaim.services.communication import notify, recipient_for_student

	notify(
		"Registration Rejected",
		doc=doc,
		recipients=[recipient_for_student(doc.student)],
		link="/student/registration",
		category="Academic",
		fallback={
			"subject": _("Course registration not approved — {0}").format(doc.academic_term),
			"message": _(
				"Your course registration for {0} was not approved. Reason: {1}. Please review your "
				"courses and submit again."
			).format(doc.academic_term, frappe.utils.escape_html(doc.remarks)),
		},
	)
	return _registration_dict(doc)


@frappe.whitelist(methods=["POST"])
def bulk_approve_registrations(names):
	require_roles(*STAFF_WRITE)
	return _bulk(names, _approve)


# ---------------------------------------------------------------------------------- staff: requests
@frappe.whitelist()
def list_requests(
	status=None,
	request_type=None,
	type=None,
	student=None,
	academic_term=None,
	search=None,
	start=0,
	page_length=20,
):
	require_roles(*REQUEST_STAFF)
	filters = _filters(
		status=status, request_type=request_type or type, student=student, academic_term=academic_term
	)
	or_filters = search_filters(search, ("name", "student", "student_name"))
	out = _paged_list(
		"Student Request", REQUEST_LIST_FIELDS, filters, or_filters, start, page_length, "creation desc"
	)
	clearance = _child_rows(
		"Clearance Item",
		"Student Request",
		[r.name for r in out["data"] if r.request_type == "Clearance"],
		["department", "status"],
	)
	for r in out["data"]:
		rows = clearance.get(r.name, [])
		r["clearance"] = rows
		r["clearance_progress"] = (
			{"cleared": sum(1 for c in rows if c.status == "Cleared"), "total": len(rows)} if rows else None
		)
	return out


@frappe.whitelist()
def get_request(name: str):
	require_roles(*REQUEST_STAFF)
	doc = _staff_doc("Student Request", name)
	data = _request_dict(doc, staff=True)
	data["student_info"] = _brief(frappe.get_doc("Student", doc.student))
	data["allowed_transitions"] = list(svc.REQUEST_TRANSITIONS.get(doc.status, ()))
	return data


@frappe.whitelist(methods=["POST"])
def decide_request(name: str, decision: str, notes: str | None = None):
	require_roles(*STAFF_WRITE)
	if decision not in REQUEST_DECISIONS:
		frappe.throw(_("Decision must be one of: {0}").format(", ".join(REQUEST_DECISIONS)))
	doc = _staff_doc("Student Request", name, "write")
	if decision not in svc.REQUEST_TRANSITIONS.get(doc.status, ()):
		frappe.throw(
			_("Request {0} is {1} and cannot be moved to {2}.").format(name, _(doc.status), _(decision))
		)
	if notes:
		doc.review_notes = notes
	doc.status = decision
	doc.flags.status_note = notes
	doc.save()
	return _request_dict(doc, staff=True)


@frappe.whitelist(methods=["POST"])
def update_clearance_item(request: str, row: str, status: str, notes: str | None = None):
	require_login()
	if status not in ("Pending", "Cleared", "Not Cleared"):
		frappe.throw(_("Status must be Pending, Cleared or Not Cleared."))
	if not frappe.db.exists("Student Request", request):
		frappe.throw(_("Request {0} not found.").format(request), frappe.DoesNotExistError)
	doc = frappe.get_doc("Student Request", request)
	item = next((r for r in doc.clearance if r.name == row or r.department == row), None)
	if not item:
		frappe.throw(_("Clearance item not found."))
	if not svc.can_clear(item.department):
		frappe.throw(
			_("You cannot sign off {0} clearance.").format(_(item.department)), frappe.PermissionError
		)
	if doc.status not in OPEN_REQUEST:
		frappe.throw(_("This request is {0}; clearance can no longer be changed.").format(_(doc.status)))
	item.status = status
	item.remarks = notes or item.remarks
	if status == "Cleared":
		item.cleared_by = frappe.session.user
		item.cleared_on = now_datetime()
	else:
		item.cleared_by = item.cleared_on = None
	if doc.status == "Pending":
		doc.status = "Under Review"
		doc.flags.status_note = _("Clearance in progress")
		doc.flags.mute_notifications = True
	doc.flags.ignore_permissions = True
	doc.save()
	return _request_dict(doc, staff=True)
