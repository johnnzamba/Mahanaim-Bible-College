app_name = "mahanaim"
app_title = "Mahanaim Digital Campus"
app_publisher = "Mahanaim Bible College"
app_description = (
	"Digital Campus for Mahanaim Bible College: public website, online admissions, student lifecycle, "
	"curriculum, LMS bridge, assignments, exams, grading/GPA, fees, M-Pesa, transcripts, certificates, "
	"notifications and church partnerships."
)
app_email = "nzambakitheka@gmail.com"
app_license = "gpl-2.0"
app_icon_url = "/assets/mahanaim/images/logo.svg"
app_icon_title = "Digital Campus"
app_icon_route = "/admin"

# Frappe LMS and ERPNext are optional integrations, detected at runtime.
required_apps = []

add_to_apps_screen = [
	{
		"name": "mahanaim",
		"logo": "/assets/mahanaim/images/logo.svg",
		"title": "Digital Campus",
		"route": "/admin",
		"has_permission": "mahanaim.api.session.has_admin_access",
	}
]

# ---------------------------------------------------------------------------
# Web: one React SPA (www/mbc.html) serves the public website and every portal.
# ---------------------------------------------------------------------------
home_page = "mbc"

_SPA_ROUTES = [
	# public website
	"about",
	"academics",
	"programmes",
	"admissions",
	"fees",
	"e-library",
	"news",
	"events",
	"faculty",
	"contact",
	"faq",
	"verify",
	"apply",
	"give",
	"privacy",
	"terms",
	"search",
	"signin",
	"forgot-password",
	"reset-password",
	# portals
	"applicant",
	"student",
	"lecturer",
	"admin",
	"sponsor",
]
website_route_rules = []
for _r in _SPA_ROUTES:
	website_route_rules += [
		{"from_route": f"/{_r}", "to_route": "mbc"},
		{"from_route": f"/{_r}/<path:app_path>", "to_route": "mbc"},
	]

website_redirects = [
	{"source": "/favicon.ico", "target": "/assets/mahanaim/images/favicon.png", "redirect_http_status": 301},
	{
		"source": "/apple-touch-icon.png",
		"target": "/assets/mahanaim/images/icon-192.png",
		"redirect_http_status": 301,
	},
	{"source": "/portal", "target": "/signin", "redirect_http_status": 302},
]

get_website_user_home_page = "mahanaim.utils.portal.get_website_user_home_page"

# ---------------------------------------------------------------------------
# Install / migrate
# ---------------------------------------------------------------------------
after_install = "mahanaim.install.after_install"
after_migrate = "mahanaim.install.after_migrate"
before_uninstall = "mahanaim.install.before_uninstall"

# ---------------------------------------------------------------------------
# Jinja helpers for print formats and message templates
# ---------------------------------------------------------------------------
jinja = {
	"methods": [
		"mahanaim.utils.jinja.qr_data_uri",
		"mahanaim.utils.jinja.money",
		"mahanaim.utils.jinja.mbc_settings",
		"mahanaim.utils.jinja.verification_url",
		"mahanaim.utils.jinja.absolute_file_url",
	],
}

# ---------------------------------------------------------------------------
# Document events (cross-cutting; doctype-specific logic lives in controllers)
# ---------------------------------------------------------------------------
_WEBSITE_CACHE = {
	"on_update": "mahanaim.services.website.clear_website_cache",
	"on_trash": "mahanaim.services.website.clear_website_cache",
}
_SPONSOR_ROLLUPS = {
	"on_submit": "mahanaim.services.church.refresh_sponsor_rollups",
	"on_cancel": "mahanaim.services.church.refresh_sponsor_rollups",
}

doc_events = {
	"User": {
		"on_update": "mahanaim.services.students.sync_user_profile_link",
	},
	# Public pages cache programme, staff, campus and intake data.
	"Programme": _WEBSITE_CACHE,
	"Staff Member": _WEBSITE_CACHE,
	"Campus": _WEBSITE_CACHE,
	"Intake": _WEBSITE_CACHE,
	# Sponsor totals sum sponsor-paid payments and sponsor credits.
	"Student Payment": _SPONSOR_ROLLUPS,
	"Fee Adjustment": _SPONSOR_ROLLUPS,
}

# Staff MFA (Settings.admin_mfa_required): sessions opened outside mahanaim.api.auth.login + verify_mfa
# (stock /api/method/login, desk /login, key-based reset auto-login) are refused.
on_login = ["mahanaim.services.auth.enforce_staff_mfa"]

# ---------------------------------------------------------------------------
# Permissions: lecturers see only the course offerings they teach (Desk).
# Campus scoping uses standard User Permissions on Campus (see Staff Member).
# ---------------------------------------------------------------------------
permission_query_conditions = {
	"Course Offering": "mahanaim.permissions.course_offering_query",
	"Assignment": "mahanaim.permissions.offering_child_query",
	"Assignment Submission": "mahanaim.permissions.offering_child_query",
	"Exam": "mahanaim.permissions.offering_child_query",
	"Exam Attempt": "mahanaim.permissions.offering_child_query",
	"Mark Sheet": "mahanaim.permissions.offering_child_query",
	"Course Result": "mahanaim.permissions.offering_child_query",
	"Class Session": "mahanaim.permissions.offering_child_query",
	"Course Module": "mahanaim.permissions.offering_child_query",
	"Learning Resource": "mahanaim.permissions.offering_child_query",
	"Question": "mahanaim.permissions.question_query",
	"Announcement": "mahanaim.permissions.announcement_query",
	"Course Enrolment": "mahanaim.permissions.offering_child_query",
	"Learning Progress": "mahanaim.permissions.offering_child_query",
	"Student": "mahanaim.permissions.taught_student_query",
	"Semester Registration": "mahanaim.permissions.taught_student_query",
	"Portal Notification": "mahanaim.permissions.own_notification_query",
}
has_permission = {
	"Course Offering": "mahanaim.permissions.course_offering_has_permission",
	"Assignment": "mahanaim.permissions.offering_child_has_permission",
	"Assignment Submission": "mahanaim.permissions.offering_child_has_permission",
	"Exam": "mahanaim.permissions.offering_child_has_permission",
	"Exam Attempt": "mahanaim.permissions.offering_child_has_permission",
	"Mark Sheet": "mahanaim.permissions.offering_child_has_permission",
	"Course Result": "mahanaim.permissions.offering_child_has_permission",
	"Class Session": "mahanaim.permissions.offering_child_has_permission",
	"Course Module": "mahanaim.permissions.offering_child_has_permission",
	"Learning Resource": "mahanaim.permissions.offering_child_has_permission",
	"Question": "mahanaim.permissions.question_has_permission",
	"Announcement": "mahanaim.permissions.announcement_has_permission",
	"Course Enrolment": "mahanaim.permissions.offering_child_has_permission",
	"Learning Progress": "mahanaim.permissions.offering_child_has_permission",
	"Student": "mahanaim.permissions.taught_student_has_permission",
	"Semester Registration": "mahanaim.permissions.taught_student_has_permission",
}

# ---------------------------------------------------------------------------
# Scheduled jobs
# ---------------------------------------------------------------------------
scheduler_events = {
	"cron": {
		"*/5 * * * *": [
			"mahanaim.services.mpesa.expire_stale_requests",
			"mahanaim.services.exams.auto_submit_expired_attempts",
			"mahanaim.services.communication.dispatch_scheduled_announcements",
		],
	},
	"hourly": [
		"mahanaim.services.exams.update_exam_statuses",
		"mahanaim.services.church.reconcile_online_giving",
	],
	"daily": [
		"mahanaim.services.fees.mark_overdue_invoices",
		"mahanaim.services.fees.send_fee_reminders",
		"mahanaim.services.website.update_event_statuses",
		"mahanaim.services.library.mark_overdue_loans",
		"mahanaim.services.auth.purge_expired_otps",
		"mahanaim.services.assessments.send_due_reminders",
		# sends once, 14 days after an academic term ends
		"mahanaim.services.church.send_termly_sponsor_reports",
	],
}

# Logs that should never block deleting the document they reference
ignore_links_on_delete = [
	"Message Log",
	"Portal Notification",
	"Verification Log",
	"OTP Verification",
]

global_search_doctypes = {
	"Default": [
		{"doctype": "Student", "index": 0},
		{"doctype": "Programme Application", "index": 1},
		{"doctype": "Programme", "index": 2},
		{"doctype": "Course", "index": 3},
		{"doctype": "Staff Member", "index": 4},
		{"doctype": "Sponsor", "index": 5},
		{"doctype": "Library Item", "index": 6},
	]
}

export_python_type_annotations = False
