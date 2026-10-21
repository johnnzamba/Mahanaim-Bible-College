"""Admissions services (owned by backend domain B1).

CONTRACT:
	mark_application_fee_paid(application: str, payment: str | None = None)
		Called by finance (B3) when an Application Fee Student Payment is submitted / M-Pesa confirms.
		Sets fee_status=Paid, fee_payment, and moves Draft->Submitted if the applicant already finalised.

"Awaiting fee" UX: an application can be submitted before the fee is paid. It stays `Submitted` and the API
returns `awaiting_fee: true` + `next_action: "pay_fee"`; staff cannot start the review until the fee is Paid or
Waived (see docs/api/admissions.md).
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import add_days, cint, flt, getdate, now_datetime, today

from mahanaim.utils import setting

APPLICATION_TRANSITIONS = {
	"Draft": ("Submitted", "Withdrawn"),
	"Submitted": ("Under Review", "Withdrawn"),
	"Under Review": ("Interview", "Admitted", "Waitlisted", "Rejected"),
	"Interview": ("Admitted", "Waitlisted", "Rejected"),
	"Waitlisted": ("Admitted", "Rejected"),
	"Admitted": ("Accepted", "Declined"),
}
TERMINAL_STATUSES = ("Rejected", "Declined", "Withdrawn")
DECISIONS = ("Admitted", "Waitlisted", "Rejected")
FEE_SETTLED = ("Paid", "Waived")

# Required before an application can be submitted.
REQUIRED_ON_SUBMIT = (
	"gender",
	"date_of_birth",
	"national_id",
	"county",
	"nok_name",
	"nok_phone",
	"home_church",
	"pastor_name",
	"pastor_phone",
)
# Each tuple is "one of these document types" (the passport photo may also be the application photo).
REQUIRED_DOCUMENTS = (("National ID",), ("Passport Photo",), ("KCSE Certificate", "Academic Certificate"))

# Fields an applicant may edit while the application is a Draft.
APPLICANT_FIELDS = (
	"first_name",
	"middle_name",
	"last_name",
	"email",
	"phone",
	"photo",
	"gender",
	"date_of_birth",
	"marital_status",
	"national_id",
	"nationality",
	"county",
	"postal_address",
	"disability",
	"nok_name",
	"nok_relationship",
	"nok_phone",
	"programme",
	"campus",
	"study_mode",
	"intake",
	"sponsorship_type",
	"home_church",
	"partner_church",
	"denomination",
	"year_born_again",
	"pastor_name",
	"pastor_phone",
	"ministry_role",
	"testimony",
	"ministry_experience",
	"kcse_mean_grade",
	"kcse_year",
	"highest_qualification",
)

STATUS_EVENTS = {
	"Submitted": (
		"Application Submitted",
		"Application {0} received",
		"We have received your application {0} for {1}.",
	),
	"Under Review": (
		"Application Under Review",
		"Your application is under review",
		"Your application {0} is now under review.",
	),
	"Interview": (
		"Interview Scheduled",
		"Interview scheduled — {0}",
		"You are invited for an admission interview for {1}.",
	),
	"Admitted": (
		"Application Approved",
		"Admission offer from {2}",
		"Congratulations! You have been offered admission to {1}. Sign in to download your admission letter and accept the offer.",
	),
	"Waitlisted": (
		"Application Waitlisted",
		"Update on your application {0}",
		"Your application {0} for {1} has been placed on the waiting list. We will contact you if a place becomes available.",
	),
	"Rejected": (
		"Application Rejected",
		"Update on your application {0}",
		"After careful review we are unable to offer you admission to {1} at this time.",
	),
	"Accepted": (
		"Offer Accepted",
		"Offer accepted — {0}",
		"Thank you for accepting your offer to study {1}. We will send your student details shortly.",
	),
	"Declined": (
		"Offer Declined",
		"Offer declined — {0}",
		"You have declined the offer of admission to {1}. We wish you God's blessing.",
	),
	"Withdrawn": (
		"Application Withdrawn",
		"Application {0} withdrawn",
		"Your application {0} for {1} has been withdrawn.",
	),
}


# ---------------------------------------------------------------------------------- fee helpers
def fee_required() -> bool:
	return bool(cint(setting("application_fee_required", 0)))


def application_fee_for(programme: str | None) -> float:
	if not fee_required():
		return 0.0
	fee = flt(frappe.db.get_value("Programme", programme, "application_fee")) if programme else 0
	return fee or flt(setting("application_fee", 0))


def awaiting_fee(app) -> bool:
	"""Submitted (or finalised draft) application whose fee is still outstanding."""
	return (
		fee_required()
		and flt(app.get("application_fee")) > 0
		and app.get("fee_status") not in FEE_SETTLED
		and app.get("status") in ("Draft", "Submitted")
	)


def next_action(app) -> str | None:
	"""What the applicant should do next (drives the applicant portal call-to-action)."""
	status = app.get("status")
	if status == "Draft":
		return "complete_application"
	if status == "Submitted":
		return "pay_fee" if awaiting_fee(app) else "await_review"
	if status in ("Under Review", "Waitlisted"):
		return "await_decision"
	if status == "Interview":
		return "attend_interview"
	if status == "Admitted":
		if app.get("offer_expiry") and getdate(app.get("offer_expiry")) < getdate(today()):
			return "offer_expired"
		return "accept_offer"
	if status == "Accepted":
		return "go_to_student_portal" if app.get("student") else "await_student_number"
	return None


# ---------------------------------------------------------------------------------- validation
def missing_for_submission(app) -> list[str]:
	meta = frappe.get_meta("Programme Application")
	missing = [_(meta.get_label(f)) for f in REQUIRED_ON_SUBMIT if not app.get(f)]
	have = {d.document_type for d in app.get("documents") or [] if d.file}
	if app.get("photo"):
		have.add("Passport Photo")
	for options in REQUIRED_DOCUMENTS:
		if not have & set(options):
			missing.append(_(" or ").join(_(o) for o in options))
	if not cint(app.get("declaration_accepted")):
		missing.append(_("Declaration"))
	return missing


def validate_submission(app):
	missing = missing_for_submission(app)
	if missing:
		frappe.throw(
			_("Please complete the following before submitting: {0}").format(", ".join(missing)),
			title=_("Application incomplete"),
		)
	programme = (
		frappe.db.get_value("Programme", app.programme, ["status", "is_published"], as_dict=True) or {}
	)
	if programme.get("status") != "Active" or not cint(programme.get("is_published")):
		frappe.throw(_("{0} is not accepting applications.").format(app.programme_name or app.programme))
	if app.intake:
		intake = frappe.get_doc("Intake", app.intake)
		if hasattr(intake, "is_accepting_applications") and not intake.is_accepting_applications():
			frappe.throw(_("Applications for the {0} intake are closed.").format(app.intake))


def validate_programme_options(app):
	"""Campus / study mode must be among those the programme is offered in (when the programme lists any)."""
	if not app.programme:
		return
	campuses = frappe.get_all(
		"Programme Campus", filters={"parent": app.programme, "parenttype": "Programme"}, pluck="campus"
	)
	if app.campus and campuses and app.campus not in campuses:
		frappe.throw(_("{0} is not offered at {1}.").format(app.programme_name or app.programme, app.campus))
	modes = frappe.get_all(
		"Programme Study Mode",
		filters={"parent": app.programme, "parenttype": "Programme"},
		pluck="study_mode",
	)
	if app.study_mode and modes and app.study_mode not in modes:
		frappe.throw(
			_("{0} is not offered by {1} study.").format(app.programme_name or app.programme, app.study_mode)
		)


def find_duplicate(app) -> str | None:
	if app.status in TERMINAL_STATUSES or not app.email or not app.programme:
		return None
	filters = {
		"email": app.email,
		"programme": app.programme,
		"status": ["not in", TERMINAL_STATUSES],
		"intake": app.intake if app.intake else ["is", "not set"],
	}
	if not app.is_new():
		filters["name"] = ["!=", app.name]
	return frappe.db.get_value("Programme Application", filters, "name")


def duplicate_hints(app) -> list[dict]:
	"""Other applications / students that look like the same person (staff review aid)."""
	from mahanaim.services.students import phone_variants

	ors = [["email", "=", app.email]]
	if app.national_id:
		ors.append(["national_id", "=", app.national_id])
	variants = phone_variants(app.phone)
	if variants:
		ors.append(["phone", "in", variants])
	apps = frappe.get_all(
		"Programme Application",
		filters={"name": ["!=", app.name]},
		or_filters=ors,
		fields=[
			"name",
			"full_name",
			"programme_name",
			"intake",
			"status",
			"email",
			"phone",
			"national_id",
			"creation",
		],
		order_by="creation desc",
		limit=20,
	)
	students = frappe.get_all(
		"Student",
		or_filters=ors,
		fields=[
			"name",
			"student_number",
			"full_name",
			"programme_name",
			"status",
			"email",
			"phone",
			"national_id",
		],
		limit=10,
	)
	hints = []
	for row in apps:
		hints.append({"doctype": "Programme Application", **row, "match": _match_reason(app, row, variants)})
	for row in students:
		hints.append({"doctype": "Student", **row, "match": _match_reason(app, row, variants)})
	return hints


def _match_reason(app, row, variants) -> list[str]:
	reasons = []
	if row.get("email") and row.email.lower() == (app.email or "").lower():
		reasons.append("email")
	if app.national_id and row.get("national_id") == app.national_id:
		reasons.append("national_id")
	if row.get("phone") and row.phone in variants:
		reasons.append("phone")
	return reasons


# ---------------------------------------------------------------------------------- status side effects
def apply_status_effects(app, old_status: str | None):
	"""Called from ProgrammeApplication.validate when the status changes."""
	status = app.status
	if status == "Submitted":
		if not app.flags.skip_submission_checks:
			validate_submission(app)
		app.submitted_on = app.submitted_on or now_datetime()
	elif status == "Under Review":
		if awaiting_fee(frappe._dict(app.as_dict(), status="Submitted")) and not app.flags.ignore_fee:
			frappe.throw(_("The application fee has not been paid or waived yet."), title=_("Awaiting fee"))
		app.reviewer = app.reviewer or frappe.session.user
	elif status == "Interview":
		if not app.interview_date:
			frappe.throw(_("Set the interview date and time."))
	elif status == "Admitted":
		app.decision_date = today()
		days = cint(setting("offer_expiry_days", 30))
		if (
			not app.offer_expiry
			or getdate(app.offer_expiry) < getdate(today())
			or not app.flags.keep_offer_expiry
		):
			app.offer_expiry = add_days(today(), days) if days > 0 else None
		app.admission_letter_issued = 1
		app.admission_letter_on = now_datetime()
		app.rejection_reason = None
	elif status in ("Waitlisted", "Rejected"):
		app.decision_date = today()
	elif status == "Accepted":
		if (
			app.offer_expiry
			and getdate(app.offer_expiry) < getdate(today())
			and not app.flags.ignore_offer_expiry
		):
			frappe.throw(
				_("This offer expired on {0}. Please contact the admissions office.").format(
					frappe.utils.formatdate(app.offer_expiry)
				)
			)
		app.accepted_on = now_datetime()


def after_status_change(app, old_status: str | None):
	"""Called from ProgrammeApplication.on_update when the status changed: notify + auto-create student."""
	from mahanaim.services.communication import notify, recipient_for_application

	event = STATUS_EVENTS.get(app.status)
	if event and not app.flags.mute_notifications:
		name, subject, message = event
		college = setting("institution_name", "Mahanaim Bible College")
		args = (app.name, app.programme_name or app.programme, college)
		extra = ""
		if app.status == "Submitted" and awaiting_fee(app):
			extra = " " + _("Please pay the application fee of {0} to complete your submission.").format(
				frappe.utils.fmt_money(app.application_fee, currency=setting("currency", "KES"))
			)
		if app.status == "Interview" and app.interview_date:
			extra = " " + _("Date: {0}.").format(frappe.utils.format_datetime(app.interview_date))
		if app.status == "Rejected" and app.rejection_reason:
			extra = " " + _("Reason: {0}").format(frappe.utils.escape_html(app.rejection_reason))
		notify(
			name,
			doc=app,
			recipients=[recipient_for_application(app)],
			link="/applicant",
			category="Admissions",
			fallback={
				"subject": _(subject).format(*args),
				"message": f"<p>{_('Dear {0},').format(frappe.utils.escape_html(app.first_name))}</p>"
				f"<p>{_(message).format(*args)}{extra}</p>",
			},
		)

	if app.status == "Accepted" and cint(setting("auto_create_student_on_acceptance", 0)) and not app.student:
		savepoint = f"mbc_stu_{frappe.generate_hash(length=6)}"
		frappe.db.savepoint(savepoint)
		try:
			from mahanaim.services.students import create_student_from_application

			app.student = create_student_from_application(app.name)
		except Exception:
			frappe.db.rollback(save_point=savepoint)
			frappe.log_error(title=f"Mahanaim: auto-create student for {app.name} failed")
			frappe.clear_messages()


# ---------------------------------------------------------------------------------- contract
def mark_application_fee_paid(application: str, payment: str | None = None):
	"""CONTRACT (B3 -> B1): the application fee for `application` has been received (idempotent)."""
	from mahanaim.services.communication import notify, recipient_for_application

	app = frappe.get_doc("Programme Application", application)
	if payment and not frappe.db.exists("Student Payment", payment):
		payment = None
	if app.fee_status == "Paid" and (not payment or app.fee_payment == payment):
		return app.name
	already_paid = app.fee_status == "Paid"
	app.fee_status = "Paid"
	if payment:
		app.fee_payment = payment
	if app.status == "Draft" and cint(app.declaration_accepted) and not missing_for_submission(app):
		app.status = "Submitted"
		app.flags.status_note = _("Submitted automatically when the application fee was received")
	app.flags.ignore_permissions = True
	app.flags.mute_notifications = True  # the fee-paid message below covers it
	app.save()
	if not already_paid:
		notify(
			"Application Fee Paid",
			doc=app,
			recipients=[recipient_for_application(app)],
			link="/applicant",
			category="Admissions",
			fallback={
				"subject": _("Application fee received — {0}").format(app.name),
				"message": _(
					"Thank you. Your application fee has been received and your application {0} is now in the review queue."
				).format(app.name),
			},
		)
	return app.name


# ---------------------------------------------------------------------------------- admission letter
def image_data_uri(path: str | None) -> str:
	"""Embed a site file as a data URI so wkhtmltopdf never has to fetch it over HTTP."""
	import base64
	import mimetypes
	import os

	from mahanaim.utils.jinja import absolute_file_url

	if not path:
		return ""
	if path.startswith("data:") or path.startswith("http"):
		return path
	clean = path.split("?", 1)[0]
	if clean.startswith("/private/files/"):
		full = frappe.get_site_path("private", "files", clean[len("/private/files/") :])
	elif clean.startswith("/files/"):
		full = frappe.get_site_path("public", "files", clean[len("/files/") :])
	else:
		return absolute_file_url(path)
	if not os.path.isfile(full):
		return absolute_file_url(path)
	mime = mimetypes.guess_type(full)[0] or "image/png"
	with open(full, "rb") as f:
		return f"data:{mime};base64,{base64.b64encode(f.read()).decode()}"


def render_admission_letter(name: str, fmt: str = "html"):
	"""HTML (str) or PDF (bytes) admission letter for an Admitted/Accepted application."""
	from mahanaim.utils.jinja import mbc_settings, money, qr_data_uri

	app = frappe.get_doc("Programme Application", name)
	if app.status not in ("Admitted", "Accepted"):
		frappe.throw(_("The admission letter is available once you have been admitted."))
	programme = (
		frappe.db.get_value(
			"Programme",
			app.programme,
			[
				"programme_name",
				"level",
				"award_title",
				"duration_years",
				"indicative_fee_per_term",
				"terms_per_year",
			],
			as_dict=True,
		)
		or {}
	)
	intake = (
		frappe.db.get_value(
			"Intake", app.intake, ["intake_name", "start_date", "academic_year"], as_dict=True
		)
		if app.intake
		else None
	) or {}
	campus = (
		frappe.db.get_value(
			"Campus", app.campus, ["campus_name", "address", "town", "phone", "email"], as_dict=True
		)
		or {}
	)
	student_number = frappe.db.get_value("Student", app.student, "student_number") if app.student else None
	settings = mbc_settings()
	verify_url = frappe.utils.get_url(f"/applicant?application={app.name}")
	context = {
		"doc": app,
		"programme": frappe._dict(programme),
		"intake": frappe._dict(intake),
		"campus": frappe._dict(campus),
		"settings": settings,
		"student_number": student_number,
		"letter_date": app.decision_date or today(),
		"qr": qr_data_uri(verify_url),
		"verify_url": verify_url,
		"image": image_data_uri,
		"money": money,
	}
	html = frappe.render_template("mahanaim/templates/print/admission_letter.html", context)
	if fmt == "pdf":
		from frappe.utils.pdf import get_pdf

		return get_pdf(
			html,
			{
				"page-size": "A4",
				"margin-top": "12mm",
				"margin-bottom": "12mm",
				"margin-left": "14mm",
				"margin-right": "14mm",
			},
		)
	return html
