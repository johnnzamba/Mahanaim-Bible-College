"""Row-level permission hooks.

Lecturers who are not also academic/admin staff only see the course offerings they teach (and records
that hang off those offerings). Everyone else falls through to standard role + User Permission rules.

Frappe v16 treats any falsy `has_permission` hook result (None included) as a denial, and a hook can
only deny, never grant, so the hooks return True for users they don't restrict.
Campus scoping is done with standard Frappe User Permissions on `Campus` (created from Staff Member).
"""

from __future__ import annotations

import frappe

from mahanaim.utils import ROLE_LECTURER, is_staff, user_roles


def _is_lecturer_only(user: str) -> bool:
	if not user or user in ("Administrator",):
		return False
	return ROLE_LECTURER in user_roles(user) and not is_staff(user)


def taught_offerings(user: str | None = None) -> list[str]:
	user = user or frappe.session.user
	return frappe.get_all(
		"Course Offering Lecturer",
		filters={"user": user, "parenttype": "Course Offering"},
		pluck="parent",
		distinct=True,
	)


def _in_clause(values):
	if not values:
		return "('')"
	return "(" + ", ".join(frappe.db.escape(v) for v in values) + ")"


def course_offering_query(user=None, **kwargs):
	user = user or frappe.session.user
	if not _is_lecturer_only(user):
		return ""
	return f"`tabCourse Offering`.name in {_in_clause(taught_offerings(user))}"


def offering_child_query(user=None, doctype=None, **kwargs):
	user = user or frappe.session.user
	if not doctype or not _is_lecturer_only(user):
		return ""
	return f"`tab{doctype}`.course_offering in {_in_clause(taught_offerings(user))}"


def course_offering_has_permission(doc, ptype=None, user=None, **kwargs):
	user = user or frappe.session.user
	if not _is_lecturer_only(user):
		return True
	return doc.name in taught_offerings(user)


# Records whose controller copies course_offering from a parent link during validate, which runs
# after Frappe's permission check, so the parent's offering is checked as well.
PARENT_OFFERING = {
	"Assignment Submission": ("assignment", "Assignment"),
	"Exam Attempt": ("exam", "Exam"),
}


def offering_child_has_permission(doc, ptype=None, user=None, **kwargs):
	user = user or frappe.session.user
	if not _is_lecturer_only(user):
		return True
	offerings = {doc.get("course_offering")}
	if parent := PARENT_OFFERING.get(doc.doctype):
		field, parent_doctype = parent
		if doc.get(field):
			offerings.add(frappe.db.get_value(parent_doctype, doc.get(field), "course_offering"))
	offerings.discard(None)
	offerings.discard("")
	if not offerings:
		return False
	return offerings <= set(taught_offerings(user))


def _taught_courses(user: str) -> list[str]:
	offerings = taught_offerings(user)
	if not offerings:
		return []
	return frappe.get_all(
		"Course Offering", filters={"name": ["in", offerings]}, pluck="course", distinct=True
	)


def question_query(user=None, **kwargs):
	user = user or frappe.session.user
	if not _is_lecturer_only(user):
		return ""
	return f"`tabQuestion`.course in {_in_clause(_taught_courses(user))}"


def question_has_permission(doc, ptype=None, user=None, **kwargs):
	user = user or frappe.session.user
	if not _is_lecturer_only(user):
		return True
	return bool(doc.get("course")) and doc.course in _taught_courses(user)


def announcement_query(user=None, **kwargs):
	"""Lecturers see their own courses' announcements plus sent college-wide ones."""
	user = user or frappe.session.user
	if not _is_lecturer_only(user):
		return ""
	return (
		f"(`tabAnnouncement`.course_offering in {_in_clause(taught_offerings(user))} "
		"or (ifnull(`tabAnnouncement`.course_offering, '') = '' and `tabAnnouncement`.status = 'Sent'))"
	)


def announcement_has_permission(doc, ptype=None, user=None, **kwargs):
	user = user or frappe.session.user
	if not _is_lecturer_only(user):
		return True
	if doc.get("course_offering"):
		return doc.course_offering in taught_offerings(user)
	return ptype in ("read", "print") and doc.get("status") == "Sent"


def _taught_students_sql(user: str) -> str:
	return (
		"(select ce.student from `tabCourse Enrolment` ce "
		f"where ce.course_offering in {_in_clause(taught_offerings(user))})"
	)


STUDENT_FIELD = {"Student": "name", "Semester Registration": "student"}


def taught_student_query(user=None, doctype=None, **kwargs):
	"""Lecturers see only students enrolled in a course offering they teach."""
	user = user or frappe.session.user
	if doctype not in STUDENT_FIELD or not _is_lecturer_only(user):
		return ""
	own = f"(select s.name from `tabStudent` s where s.user = {frappe.db.escape(user)})"
	field = f"`tab{doctype}`.{STUDENT_FIELD[doctype]}"
	return f"({field} in {_taught_students_sql(user)} or {field} in {own})"


def taught_student_has_permission(doc, ptype=None, user=None, **kwargs):
	user = user or frappe.session.user
	if not _is_lecturer_only(user):
		return True
	student = doc.get(STUDENT_FIELD.get(doc.doctype, "student"))
	if student and frappe.db.get_value("Student", student, "user") == user:
		return True
	offerings = taught_offerings(user)
	return bool(
		student
		and offerings
		and frappe.db.exists("Course Enrolment", {"student": student, "course_offering": ["in", offerings]})
	)


def own_notification_query(user=None, **kwargs):
	user = user or frappe.session.user
	if user == "Administrator" or "System Manager" in user_roles(user):
		return ""
	return f"`tabPortal Notification`.user = {frappe.db.escape(user)}"
