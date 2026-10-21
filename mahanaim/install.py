"""Idempotent install/migrate setup: roles, master defaults, message templates, website defaults.

Every `_ensure_*` function is safe to run repeatedly (after_install and after_migrate both call `setup()`).
Demo data lives in `mahanaim.demo` and is never loaded automatically.
"""

from __future__ import annotations

import frappe
from frappe.utils import cint

from mahanaim.utils import (
	ROLE_ADMIN,
	ROLE_ADMISSIONS,
	ROLE_ALUMNI,
	ROLE_APPLICANT,
	ROLE_AUDITOR,
	ROLE_CHAPLAIN,
	ROLE_COMMS,
	ROLE_DEAN,
	ROLE_FINANCE,
	ROLE_LECTURER,
	ROLE_LIBRARY,
	ROLE_REGISTRAR,
	ROLE_SPONSOR,
	ROLE_STUDENT,
)

ROLES = {
	ROLE_ADMIN: 1,
	ROLE_REGISTRAR: 1,
	ROLE_ADMISSIONS: 1,
	ROLE_FINANCE: 1,
	ROLE_DEAN: 1,
	ROLE_LECTURER: 1,
	ROLE_LIBRARY: 1,
	ROLE_AUDITOR: 1,
	ROLE_COMMS: 1,
	ROLE_CHAPLAIN: 1,
	ROLE_STUDENT: 0,
	ROLE_APPLICANT: 0,
	ROLE_SPONSOR: 0,
	ROLE_ALUMNI: 0,
}

STUDY_MODES = [
	("Full Time", "FT", 0, "Day classes on campus, Monday to Friday."),
	("Part Time", "PT", 0, "Reduced load for working ministers."),
	("Evening", "EV", 0, "Weekday evening classes."),
	("Weekend", "WE", 0, "Friday evening and Saturday classes."),
	("Distance (Online)", "OL", 1, "Fully online through the Digital Campus LMS."),
]

FEE_COMPONENTS = [
	("Tuition", "TUI", "Tuition", 35000, 0),
	("Registration", "REG", "Registration", 2000, 0),
	("Library", "LIB", "Library", 1500, 0),
	("Examination", "EXM", "Examination", 3000, 0),
	("ICT", "ICT", "ICT", 2000, 0),
	("Student Welfare", "WEL", "Welfare", 1000, 0),
	("Application Fee", "APP", "Application", 1000, 0),
	("Graduation", "GRD", "Graduation", 5000, 0),
	("Accommodation", "ACC", "Accommodation", 18000, 1),
]

GIVING_TYPES = ["Tithe", "Offering", "Pledge", "Scholarship Fund", "Building Fund", "Missions", "Thanksgiving"]

GRADE_BANDS = [
	("A", 80, 100, 4.0, "Excellent"),
	("A-", 75, 79.99, 3.7, "Very Good"),
	("B+", 70, 74.99, 3.3, "Good"),
	("B", 65, 69.99, 3.0, "Good"),
	("B-", 60, 64.99, 2.7, "Above Average"),
	("C+", 55, 59.99, 2.3, "Average"),
	("C", 50, 54.99, 2.0, "Satisfactory"),
	("D", 40, 49.99, 1.0, "Pass"),
	("F", 0, 39.99, 0.0, "Fail"),
]
CLASSIFICATIONS = [
	("Distinction", 3.6, 4.0),
	("Credit", 3.0, 3.59),
	("Pass", 2.0, 2.99),
	("Fail", 0.0, 1.99),
]


def after_install():
	setup()


def after_migrate():
	setup()


def before_uninstall():
	pass


def setup():
	_ensure_roles()
	_ensure_currency()
	_ensure_settings()
	_ensure_grading_scale()
	_ensure_study_modes()
	_ensure_fee_components()
	_ensure_giving_types()
	_ensure_message_templates()
	_ensure_website_settings()
	_ensure_lms_bridge_status()
	frappe.db.commit()


def _ensure_roles():
	for role, desk in ROLES.items():
		if not frappe.db.exists("Role", role):
			frappe.get_doc({"doctype": "Role", "role_name": role, "desk_access": desk}).insert(ignore_permissions=True)


def _ensure_currency():
	if frappe.db.exists("DocType", "Currency") and not frappe.db.exists("Currency", "KES"):
		frappe.get_doc(
			{"doctype": "Currency", "currency_name": "KES", "symbol": "KSh", "fraction": "Cent",
			 "fraction_units": 100, "enabled": 1, "number_format": "#,###.##", "smallest_currency_fraction_value": 0.01}
		).insert(ignore_permissions=True)
	elif frappe.db.exists("Currency", "KES"):
		frappe.db.set_value("Currency", "KES", "enabled", 1)


def _ensure_settings():
	s = frappe.get_single("Mahanaim Settings")
	changed = False
	for df in s.meta.fields:
		if df.default and s.get(df.fieldname) in (None, "") and df.fieldtype not in ("Link",):
			s.set(df.fieldname, df.default)
			changed = True
	if not s.currency and frappe.db.exists("Currency", "KES"):
		s.currency = "KES"
		changed = True
	if changed:
		s.flags.ignore_mandatory = True
		s.save(ignore_permissions=True)


def _ensure_grading_scale():
	name = "MBC Standard"
	if not frappe.db.exists("Grading Scale", name):
		doc = frappe.get_doc(
			{
				"doctype": "Grading Scale",
				"scale_name": name,
				"is_default": 1,
				"pass_mark": 40,
				"description": "Default Mahanaim grading scheme (SOW M11).",
				"bands": [
					{"grade": g, "min_score": lo, "max_score": hi, "grade_points": pts, "description": d,
					 "is_pass": 1 if pts > 0 else 0}
					for g, lo, hi, pts, d in GRADE_BANDS
				],
				"classifications": [
					{"classification": c, "min_cgpa": lo, "max_cgpa": hi} for c, lo, hi in CLASSIFICATIONS
				],
			}
		)
		doc.insert(ignore_permissions=True)
	if not frappe.db.get_single_value("Mahanaim Settings", "default_grading_scale"):
		frappe.db.set_single_value("Mahanaim Settings", "default_grading_scale", name)


def _ensure_study_modes():
	for mode, code, online, desc in STUDY_MODES:
		if not frappe.db.exists("Study Mode", mode):
			frappe.get_doc(
				{"doctype": "Study Mode", "study_mode_name": mode, "code": code, "is_online": online,
				 "description": desc}
			).insert(ignore_permissions=True)


def _ensure_fee_components():
	for name, code, ctype, amount, refundable in FEE_COMPONENTS:
		if not frappe.db.exists("Fee Component", name):
			frappe.get_doc(
				{"doctype": "Fee Component", "component_name": name, "code": code, "component_type": ctype,
				 "default_amount": amount, "is_refundable": refundable}
			).insert(ignore_permissions=True)


def _ensure_giving_types():
	for name in GIVING_TYPES:
		if not frappe.db.exists("Giving Type", name):
			frappe.get_doc({"doctype": "Giving Type", "giving_type_name": name}).insert(ignore_permissions=True)


def _ensure_website_settings():
	s = frappe.get_single("Campus Website Settings")
	changed = False
	for df in s.meta.fields:
		if df.default and s.get(df.fieldname) in (None, "", 0):
			s.set(df.fieldname, df.default)
			changed = True
	if changed:
		s.save(ignore_permissions=True)


def _ensure_lms_bridge_status():
	installed = 1 if "lms" in frappe.get_installed_apps() else 0
	if cint(frappe.db.get_single_value("LMS Bridge Settings", "lms_installed")) != installed:
		frappe.db.set_single_value("LMS Bridge Settings", "lms_installed", installed)


# ---------------------------------------------------------------------------------- templates
_SIGN = "<p>God bless you,<br>{{ college }}</p>"

MESSAGE_TEMPLATES = [
	("Welcome — Account Created", "Account Created", 1, 0,
	 "Welcome to the {{ college }} Digital Campus",
	 "<p>Dear {{ recipient.name or 'friend' }},</p><p>Your Digital Campus account is ready. "
	 "Sign in at <a href='{{ site_url }}/signin'>{{ site_url }}/signin</a> to continue.</p>" + _SIGN,
	 "Welcome to {{ college }} Digital Campus. Sign in at {{ site_url }}/signin"),
	("One-Time Code", "OTP Code", 1, 1,
	 "Your {{ college }} verification code: {{ code }}",
	 "<p>Your verification code is <b style='font-size:20px;letter-spacing:4px'>{{ code }}</b>.</p>"
	 "<p>It expires in {{ minutes }} minutes. If you did not request it, ignore this message.</p>" + _SIGN,
	 "{{ code }} is your {{ settings.short_name }} verification code. Expires in {{ minutes }} min."),
	("Application Submitted", "Application Submitted", 1, 1,
	 "Application {{ doc.name }} received",
	 "<p>Dear {{ doc.first_name }},</p><p>We have received your application for "
	 "<b>{{ doc.programme_name }}</b> (ref <b>{{ doc.name }}</b>). We will notify you as it progresses.</p>"
	 "{% if doc.fee_status != 'Paid' and doc.application_fee %}<p>Please pay the application fee of "
	 "{{ frappe.utils.fmt_money(doc.application_fee, currency=settings.currency) }} to complete your submission."
	 "</p>{% endif %}" + _SIGN,
	 "{{ settings.short_name }}: Application {{ doc.name }} for {{ doc.programme_name }} received. Track it at {{ site_url }}/applicant"),
	("Application Fee Paid", "Application Fee Paid", 1, 1,
	 "Application fee received — {{ doc.name }}",
	 "<p>Dear {{ doc.first_name }},</p><p>Thank you. Your application fee has been received and your "
	 "application {{ doc.name }} is now in the review queue.</p>" + _SIGN,
	 "{{ settings.short_name }}: Application fee for {{ doc.name }} received. Thank you."),
	("Application Under Review", "Application Under Review", 0, 0,
	 "Your application is under review", "<p>Dear {{ doc.first_name }}, your application {{ doc.name }} is now under review.</p>" + _SIGN, ""),
	("Interview Scheduled", "Interview Scheduled", 1, 1,
	 "Interview scheduled — {{ doc.name }}",
	 "<p>Dear {{ doc.first_name }},</p><p>You are invited for an admission interview on "
	 "<b>{{ frappe.utils.format_datetime(doc.interview_date) }}</b>.</p>" + _SIGN,
	 "{{ settings.short_name }}: Admission interview on {{ frappe.utils.format_datetime(doc.interview_date) }}. Ref {{ doc.name }}"),
	("Admission Offer", "Application Approved", 1, 1,
	 "Congratulations — admission offer from {{ college }}",
	 "<p>Dear {{ doc.first_name }},</p><p>We are delighted to offer you admission to <b>{{ doc.programme_name }}</b> "
	 "({{ doc.study_mode }}, {{ doc.campus }}). Sign in to download your admission letter and accept the offer"
	 "{% if doc.offer_expiry %} before {{ frappe.utils.formatdate(doc.offer_expiry) }}{% endif %}.</p>" + _SIGN,
	 "Congratulations! {{ college }} has offered you admission to {{ doc.programme_name }}. Accept at {{ site_url }}/applicant"),
	("Application Unsuccessful", "Application Rejected", 1, 0,
	 "Update on your application {{ doc.name }}",
	 "<p>Dear {{ doc.first_name }},</p><p>Thank you for applying to {{ college }}. After careful review we are "
	 "unable to offer you admission at this time.{% if doc.rejection_reason %} Reason: {{ doc.rejection_reason }}{% endif %}</p>" + _SIGN, ""),
	("Student Account Created", "Student Created", 1, 1,
	 "Welcome, student {{ doc.student_number }}",
	 "<p>Dear {{ doc.first_name }},</p><p>Welcome to {{ college }}! Your student number is "
	 "<b>{{ doc.student_number }}</b>. Sign in to the student portal to register for courses.</p>" + _SIGN,
	 "Welcome to {{ college }}. Your student number is {{ doc.student_number }}. Portal: {{ site_url }}/student"),
	("Registration Approved", "Registration Approved", 1, 0,
	 "Course registration approved — {{ doc.academic_term }}",
	 "<p>Dear {{ doc.student_name }},</p><p>Your course registration for {{ doc.academic_term }} has been approved "
	 "({{ doc.total_credits }} credits).</p>" + _SIGN, ""),
	("Invoice Issued", "Invoice Issued", 1, 1,
	 "Fee invoice {{ doc.name }}",
	 "<p>Dear {{ doc.student_name }},</p><p>Invoice <b>{{ doc.name }}</b> of "
	 "{{ frappe.utils.fmt_money(doc.total_amount, currency=settings.currency) }} has been issued"
	 "{% if doc.due_date %}, due {{ frappe.utils.formatdate(doc.due_date) }}{% endif %}. Pay via M-Pesa from the student portal.</p>" + _SIGN,
	 "{{ settings.short_name }}: Invoice {{ doc.name }} KES {{ frappe.utils.fmt_money(doc.total_amount) }} issued. Pay at {{ site_url }}/student/fees"),
	("Payment Receipt", "Payment Received", 1, 1,
	 "Receipt {{ doc.name }} — payment received",
	 "<p>Dear {{ recipient.name }},</p><p>We have received {{ frappe.utils.fmt_money(doc.amount, currency=settings.currency) }} "
	 "via {{ doc.mode_of_payment }}{% if doc.reference_no %} (ref {{ doc.reference_no }}){% endif %}. Receipt no. <b>{{ doc.name }}</b>.</p>"
	 "{% if balance is defined %}<p>Your balance is {{ frappe.utils.fmt_money(balance, currency=settings.currency) }}.</p>{% endif %}" + _SIGN,
	 "{{ settings.short_name }}: Received KES {{ frappe.utils.fmt_money(doc.amount) }} ref {{ doc.reference_no or doc.name }}.{% if balance is defined %} Bal KES {{ frappe.utils.fmt_money(balance) }}{% endif %}"),
	("Fee Reminder", "Fee Reminder", 1, 1,
	 "Fee balance reminder",
	 "<p>Dear {{ recipient.name }},</p><p>This is a friendly reminder that your fee balance is "
	 "{{ frappe.utils.fmt_money(balance, currency=settings.currency) }}. Please clear it to keep access to exams and the LMS.</p>" + _SIGN,
	 "{{ settings.short_name }}: Fee balance KES {{ frappe.utils.fmt_money(balance) }}. Pay via the student portal. Thank you."),
	("Assignment Published", "Assignment Published", 0, 0,
	 "New assignment: {{ doc.title }}",
	 "<p>A new assignment <b>{{ doc.title }}</b> has been posted for {{ doc.course_title }}. "
	 "Due {{ frappe.utils.format_datetime(doc.due_date) }}.</p>", ""),
	("Assignment Due Reminder", "Assignment Due Reminder", 0, 0,
	 "Reminder: {{ doc.title }} is due soon",
	 "<p>{{ doc.title }} ({{ doc.course_title }}) is due {{ frappe.utils.format_datetime(doc.due_date) }}.</p>", ""),
	("Assignment Graded", "Assignment Graded", 0, 0,
	 "Feedback ready: {{ doc.assignment_title }}",
	 "<p>Your submission for {{ doc.assignment_title }} has been graded.</p>", ""),
	("Exam Scheduled", "Exam Scheduled", 1, 0,
	 "{{ doc.exam_type }} scheduled: {{ doc.title }}",
	 "<p>{{ doc.title }} ({{ doc.course_title }}) opens {{ frappe.utils.format_datetime(doc.start_datetime) }} "
	 "and lasts {{ doc.duration_minutes }} minutes.</p>", ""),
	("Exam Reminder", "Exam Reminder", 0, 1,
	 "Reminder: {{ doc.title }} starts soon",
	 "<p>{{ doc.title }} starts {{ frappe.utils.format_datetime(doc.start_datetime) }}.</p>",
	 "{{ settings.short_name }}: {{ doc.title }} starts {{ frappe.utils.format_datetime(doc.start_datetime) }}."),
	("Results Published", "Results Published", 1, 1,
	 "Results published — {{ term }}",
	 "<p>Dear {{ recipient.name }},</p><p>Your results for {{ term }} are now available in the student portal.</p>" + _SIGN,
	 "{{ settings.short_name }}: Your {{ term }} results are out. View at {{ site_url }}/student/results"),
	("Transcript Ready", "Transcript Ready", 1, 1,
	 "Your transcript {{ doc.name }} is ready",
	 "<p>Dear {{ doc.student_name }},</p><p>Your {{ doc.transcript_type|lower }} transcript has been issued. "
	 "Verification code: <b>{{ doc.verification_code }}</b>.</p>" + _SIGN,
	 "{{ settings.short_name }}: Transcript {{ doc.name }} issued. Verify: {{ site_url }}/verify/{{ doc.verification_code }}"),
	("Certificate Ready", "Certificate Ready", 1, 1,
	 "Your certificate is ready",
	 "<p>Dear {{ doc.student_name }},</p><p>Your {{ doc.award_title }} certificate ({{ doc.certificate_serial }}) "
	 "has been issued.</p>" + _SIGN,
	 "{{ settings.short_name }}: Certificate {{ doc.certificate_serial }} issued. Congratulations!"),
	("Student Request Update", "Student Request Update", 1, 0,
	 "{{ doc.request_type }} request {{ doc.name }}: {{ doc.status }}",
	 "<p>Dear {{ doc.student_name }},</p><p>Your {{ doc.request_type|lower }} request is now <b>{{ doc.status }}</b>."
	 "{% if doc.review_notes %}<br>{{ doc.review_notes }}{% endif %}</p>" + _SIGN, ""),
	("Event Registration", "Event Registration", 1, 1,
	 "You're registered: {{ doc.event_title }}",
	 "<p>Dear {{ doc.full_name }},</p><p>Your registration for <b>{{ doc.event_title }}</b> is confirmed "
	 "(ref {{ doc.name }}).</p>" + _SIGN,
	 "{{ settings.short_name }}: Registered for {{ doc.event_title }}. Ref {{ doc.name }}"),
	("Sponsor Progress Report", "Sponsor Report", 1, 0,
	 "Progress update on the students you sponsor",
	 "<p>Dear {{ recipient.name }},</p><p>Thank you for partnering with {{ college }}. A progress update for "
	 "the students you sponsor is available in your sponsor portal.</p>" + _SIGN, ""),
]


def _ensure_message_templates():
	for name, event, email, sms, subject, body, sms_body in MESSAGE_TEMPLATES:
		if frappe.db.exists("Message Template", name):
			continue
		frappe.get_doc(
			{
				"doctype": "Message Template",
				"template_name": name,
				"event": event,
				"is_active": 1,
				"send_email": email,
				"send_sms": sms if sms_body else 0,
				"send_in_app": 1,
				"subject": subject,
				"email_body": body,
				"sms_body": sms_body,
				"in_app_body": frappe.utils.strip_html(body)[:280],
			}
		).insert(ignore_permissions=True)
