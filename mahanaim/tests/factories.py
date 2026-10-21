"""Shared test factories. Get-or-create helpers so domain tests can build a realistic graph quickly.

Every record created here uses a `_T` prefix/suffix so it is easy to spot. Tests run inside
IntegrationTestCase which rolls the DB back after each class, so nothing persists.

Domain-specific helpers belong in `tests/factories_<domain>.py`, not here.
"""

from __future__ import annotations

import frappe
from frappe.utils import add_days, add_months, getdate, nowdate, random_string


def _get_or_insert(doctype: str, name: str | None, values: dict):
	if name and frappe.db.exists(doctype, name):
		return frappe.get_doc(doctype, name)
	doc = frappe.get_doc({"doctype": doctype, **values})
	doc.insert(ignore_permissions=True)
	return doc


def make_campus(name="Main Campus _T", code="MNT"):
	return _get_or_insert("Campus", name, {"campus_name": name, "code": code, "is_main_campus": 1})


def make_department(name="Biblical Studies _T"):
	return _get_or_insert("Department", name, {"department_name": name})


def make_academic_year(name="2090-2091"):
	start = getdate("2090-01-01")
	return _get_or_insert(
		"Academic Year",
		name,
		{"year_name": name, "start_date": start, "end_date": add_days(add_months(start, 12), -1)},
	)


def make_term(term_name="Term 1", year="2090-2091", start=None, end=None):
	year_doc = make_academic_year(year)
	name = f"{year_doc.name} {term_name}"
	start = getdate(start or nowdate())
	end = getdate(end or add_days(start, 110))
	return _get_or_insert(
		"Academic Term",
		name,
		{
			"academic_year": year_doc.name,
			"term_name": term_name,
			"term_number": 1,
			"start_date": start,
			"end_date": end,
			"registration_start": add_days(start, -14),
			"registration_end": add_days(start, 21),
			"status": "Registration Open",
		},
	)


def make_course(code="TST101", title="Old Testament Survey _T", credits=3, pass_mark=40):
	return _get_or_insert(
		"Course",
		code,
		{"course_code": code, "course_title": title, "credits": credits, "pass_mark": pass_mark},
	)


def make_programme(code="TDBS", name="Diploma in Biblical Studies _T", courses=("TST101",), level="Diploma"):
	if frappe.db.exists("Programme", code):
		return frappe.get_doc("Programme", code)
	for c in courses:
		make_course(c, f"Course {c} _T")
	doc = frappe.get_doc(
		{
			"doctype": "Programme",
			"programme_name": name,
			"code": code,
			"level": level,
			"duration_years": 2,
			"is_published": 1,
			"curriculum": [
				{"course": c, "year_of_study": 1, "term_number": 1, "course_type": "Core"} for c in courses
			],
		}
	)
	doc.insert(ignore_permissions=True)
	return doc


def make_staff(
	first_name="Grace", last_name="Lecturer _T", email=None, campus=None, is_lecturer=1, create_user=True
):
	email = email or f"lecturer.{random_string(6).lower()}@example.com"
	existing = frappe.db.get_value("Staff Member", {"email": email})
	if existing:
		return frappe.get_doc("Staff Member", existing)
	campus = campus or make_campus().name
	doc = frappe.get_doc(
		{
			"doctype": "Staff Member",
			"first_name": first_name,
			"last_name": last_name,
			"email": email,
			"campus": campus,
			"is_lecturer": is_lecturer,
			"staff_type": "Academic",
			"status": "Active",
		}
	)
	doc.flags.create_user = create_user
	doc.insert(ignore_permissions=True)
	return doc


def make_offering(course="TST101", term=None, campus=None, lecturer=None, study_mode="Full Time"):
	course_doc = make_course(course)
	term = term or make_term().name
	campus = campus or make_campus().name
	existing = frappe.db.get_value(
		"Course Offering", {"course": course_doc.name, "academic_term": term, "campus": campus}
	)
	if existing:
		return frappe.get_doc("Course Offering", existing)
	doc = frappe.get_doc(
		{
			"doctype": "Course Offering",
			"course": course_doc.name,
			"academic_term": term,
			"campus": campus,
			"study_mode": study_mode,
			"status": "Open",
			"lecturers": [{"staff_member": lecturer}] if lecturer else [],
		}
	)
	doc.insert(ignore_permissions=True)
	return doc


def make_student(
	first_name="Joseph",
	last_name="Student _T",
	email=None,
	programme=None,
	campus=None,
	status="Active",
	create_user=True,
	phone=None,
):
	programme = programme or make_programme().name
	campus = campus or make_campus().name
	email = email or f"student.{random_string(6).lower()}@example.com"
	existing = frappe.db.get_value("Student", {"email": email})
	if existing:
		return frappe.get_doc("Student", existing)
	doc = frappe.get_doc(
		{
			"doctype": "Student",
			"first_name": first_name,
			"last_name": last_name,
			"email": email,
			"phone": phone or "0712345678",
			"programme": programme,
			"campus": campus,
			"study_mode": "Full Time",
			"status": status,
			"year_of_study": 1,
		}
	)
	doc.flags.create_user = create_user
	doc.insert(ignore_permissions=True)
	return doc


def make_enrolment(student, offering, status="Enrolled"):
	existing = frappe.db.get_value("Course Enrolment", {"student": student, "course_offering": offering})
	if existing:
		return frappe.get_doc("Course Enrolment", existing)
	doc = frappe.get_doc(
		{"doctype": "Course Enrolment", "student": student, "course_offering": offering, "status": status}
	)
	doc.insert(ignore_permissions=True)
	return doc


def make_user(email=None, roles=("Student",), first_name="Test"):
	email = email or f"user.{random_string(6).lower()}@example.com"
	if frappe.db.exists("User", email):
		return frappe.get_doc("User", email)
	user = frappe.get_doc(
		{
			"doctype": "User",
			"email": email,
			"first_name": first_name,
			"send_welcome_email": 0,
			"user_type": "Website User",
		}
	)
	user.insert(ignore_permissions=True)
	user.add_roles(*roles)
	return user
