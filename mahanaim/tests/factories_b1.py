"""B1 test helpers (auth, admissions, student lifecycle). Builds on `mahanaim.tests.factories`."""

from __future__ import annotations

import contextlib
from unittest.mock import patch

import frappe
from frappe.utils import add_days, nowdate, random_string

from mahanaim.tests import factories as f

SETTINGS = "Mahanaim Settings"


def code(prefix="T", length=5) -> str:
	return (prefix + random_string(length)).upper()


@contextlib.contextmanager
def settings(**values):
	"""Temporarily change Mahanaim Settings (restored afterwards)."""
	previous = {k: frappe.db.get_single_value(SETTINGS, k, cache=False) for k in values}
	try:
		for key, value in values.items():
			frappe.db.set_single_value(SETTINGS, key, value)
		frappe.db.value_cache.clear()
		frappe.clear_document_cache(SETTINGS, SETTINGS)
		yield
	finally:
		for key, value in previous.items():
			frappe.db.set_single_value(SETTINGS, key, value)
		frappe.db.value_cache.clear()
		frappe.clear_document_cache(SETTINGS, SETTINGS)


def use_settings(test, **values):
	"""Apply `settings(**values)` for the rest of a test case method."""
	cm = settings(**values)
	cm.__enter__()
	test.addCleanup(cm.__exit__, None, None, None)


def no_commit(test):
	"""Block implicit commits (login sessions, attempt trackers) so the class rollback stays effective."""
	patcher = patch.object(frappe.local.db, "commit", lambda *a, **k: None)
	patcher.start()
	test.addCleanup(patcher.stop)


def as_user(test, user: str):
	frappe.set_user(user)
	test.addCleanup(frappe.set_user, "Administrator")


def web_request(test, path="/", method="POST"):
	"""Fake an HTTP request so LoginManager / rate limiting behave like a real call."""
	from frappe.auth import CookieManager, LoginManager

	saved = {
		a: getattr(frappe.local, a)
		for a in ("request", "login_manager", "cookie_manager", "request_ip")
		if hasattr(frappe.local, a)
	}
	frappe.utils.set_request(path=path, method=method)
	frappe.local.request_ip = f"10.{random_int()}.{random_int()}.{random_int()}"
	frappe.local.cookie_manager = CookieManager()
	frappe.local.login_manager = LoginManager()

	def cleanup():
		for attr in ("request", "login_manager", "cookie_manager", "request_ip"):
			if attr in saved:
				setattr(frappe.local, attr, saved[attr])
			else:
				with contextlib.suppress(AttributeError):
					delattr(frappe.local, attr)
		frappe.set_user("Administrator")

	test.addCleanup(cleanup)


def random_int(low=1, high=250) -> int:
	import secrets

	return low + secrets.randbelow(high - low)


def unique_phone() -> str:
	return "07" + "".join(str(random_int(0, 10)) for _ in range(8))


def make_programme(code_=None, courses=None, credits=3, **values):
	code_ = code_ or code("P")
	courses = courses or (f"{code_}101", f"{code_}102")
	for course in courses:
		f.make_course(course, f"Course {course} _T", credits=credits)
	doc = f.make_programme(code=code_, name=f"Programme {code_} _T", courses=courses)
	if values:
		doc.update(values)
		doc.save(ignore_permissions=True)
	return doc


def make_intake(start=None, applications_open=1, **values):
	name = f"Intake {random_string(6)} _T"
	doc = frappe.get_doc(
		{
			"doctype": "Intake",
			"intake_name": name,
			"start_date": start or nowdate(),
			"applications_open": applications_open,
			**values,
		}
	)
	doc.insert(ignore_permissions=True)
	return doc


def make_applicant(email=None, phone=None):
	user = f.make_user(
		email or f"applicant.{random_string(6).lower()}@example.com", roles=("Applicant",), first_name="Ann"
	)
	if phone:
		frappe.db.set_value("User", user.name, "mobile_no", phone)
	return user


def application_values(**overrides) -> dict:
	values = {
		"first_name": "Ann",
		"last_name": "Applicant _T",
		"phone": unique_phone(),
		"gender": "Female",
		"date_of_birth": "1995-05-05",
		"national_id": random_string(8).upper(),
		"county": "Nairobi",
		"nok_name": "Peter Next",
		"nok_relationship": "Brother",
		"nok_phone": "0722000111",
		"home_church": "Grace Fellowship _T",
		"pastor_name": "Pastor John",
		"pastor_phone": "0733000222",
		"ministry_role": "Youth leader",
		"study_mode": "Full Time",
		"declaration_accepted": 1,
		"documents": [
			{"document_type": "National ID", "file": f"/private/files/id_{random_string(5)}.pdf"},
			{"document_type": "Passport Photo", "file": f"/private/files/photo_{random_string(5)}.jpg"},
			{"document_type": "KCSE Certificate", "file": f"/private/files/kcse_{random_string(5)}.pdf"},
		],
	}
	values.update(overrides)
	return values


def make_application(user=None, programme=None, intake=None, campus=None, status="Draft", **overrides):
	user = user or make_applicant().name
	programme = programme or make_programme().name
	intake = intake if intake is not None else make_intake().name
	campus = campus or f.make_campus().name
	doc = frappe.get_doc(
		{
			"doctype": "Programme Application",
			**application_values(**overrides),
			"email": overrides.get("email") or user,
			"user": user,
			"programme": programme,
			"intake": intake,
			"campus": campus,
			"status": "Draft",
		}
	)
	doc.insert(ignore_permissions=True)
	if status != "Draft":
		advance(doc, status)
	return doc


_PATH = {
	"Submitted": ("Submitted",),
	"Under Review": ("Submitted", "Under Review"),
	"Interview": ("Submitted", "Under Review", "Interview"),
	"Admitted": ("Submitted", "Under Review", "Admitted"),
	"Waitlisted": ("Submitted", "Under Review", "Waitlisted"),
	"Rejected": ("Submitted", "Under Review", "Rejected"),
	"Accepted": ("Submitted", "Under Review", "Admitted", "Accepted"),
}


def advance(doc, target: str):
	"""Walk an application through the allowed statuses up to `target`."""
	for status in _PATH[target]:
		if doc.status == status:
			continue
		if status == "Interview" and not doc.interview_date:
			doc.interview_date = add_days(nowdate(), 3)
		doc.status = status
		doc.flags.ignore_fee = True
		doc.save(ignore_permissions=True)
	return doc


def make_term(start=None, **values):
	term = f.make_term(f"Term {random_string(5)}", start=start)
	if values:
		frappe.db.set_value("Academic Term", term.name, values)
		term.reload()
	return term


def make_course_result(student, course, offering=None, term=None, status="Pass", published=1):
	"""Insert a published Course Result row directly (B2 owns the controller; we only need the data)."""
	doc = frappe.get_doc(
		{
			"doctype": "Course Result",
			"student": student,
			"course": course,
			"course_offering": offering,
			"academic_term": term,
			"result_status": status,
			"total_score": 70 if status == "Pass" else 20,
			"is_published": published,
		}
	)
	doc.set_new_name()
	doc.db_insert()
	return doc
