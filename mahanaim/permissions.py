"""Row-level permission hooks.

Lecturers who are not also academic/admin staff only see the course offerings they teach (and records
that hang off those offerings). Everyone else falls through to standard role + User Permission rules.
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


def course_offering_has_permission(doc, user=None, permission_type=None):
	user = user or frappe.session.user
	if not _is_lecturer_only(user):
		return None
	return doc.name in taught_offerings(user)


def offering_child_has_permission(doc, user=None, permission_type=None):
	user = user or frappe.session.user
	if not _is_lecturer_only(user):
		return None
	if doc.is_new() and not doc.get("course_offering"):
		return True
	return doc.get("course_offering") in taught_offerings(user)


def own_notification_query(user=None, **kwargs):
	user = user or frappe.session.user
	if user == "Administrator" or "System Manager" in user_roles(user):
		return ""
	return f"`tabPortal Notification`.user = {frappe.db.escape(user)}"
