"""Guards and helpers shared by every whitelisted API module.

Conventions (see AGENTS.md):
- Every endpoint is `@frappe.whitelist()` and calls exactly one guard first.
- Portal endpoints (`my_*`) resolve the caller's own record server-side; they never trust a
  student/sponsor/applicant id sent by the browser.
- Staff endpoints use `require_roles(...)`; reads use frappe.get_all with explicit fields.
- Errors are raised with `frappe.throw(_(...))` so the SPA shows a readable message.
"""

from __future__ import annotations

import json

import frappe
from frappe import _
from frappe.utils import cint

from mahanaim.utils import (
	ROLE_ADMIN,
	ROLE_APPLICANT,
	ROLE_LECTURER,
	ROLE_SPONSOR,
	ROLE_STUDENT,
	STAFF_ROLES,
	is_staff,
	user_roles,
)


def require_login() -> str:
	if frappe.session.user == "Guest":
		frappe.throw(_("Please sign in to continue."), frappe.AuthenticationError)
	return frappe.session.user


def require_roles(*roles: str) -> str:
	"""Allow System Manager / College Administrator plus any of `roles`."""
	user = require_login()
	if user == "Administrator":
		return user
	have = user_roles(user)
	if have & {"System Manager", ROLE_ADMIN, *roles}:
		return user
	frappe.throw(_("You do not have access to this area."), frappe.PermissionError)


def require_staff() -> str:
	return require_roles(*STAFF_ROLES)


def get_student(user: str | None = None, required: bool = True):
	"""Return the Student doc linked to the session user."""
	user = user or require_login()
	name = frappe.db.get_value("Student", {"user": user}, "name")
	if not name:
		if required:
			frappe.throw(_("No student record is linked to your account."), frappe.PermissionError)
		return None
	return frappe.get_doc("Student", name)


def require_student():
	require_login()
	if ROLE_STUDENT not in user_roles() and not is_staff():
		frappe.throw(_("This area is for registered students."), frappe.PermissionError)
	return get_student()


def get_staff_member(user: str | None = None, required: bool = True):
	user = user or require_login()
	name = frappe.db.get_value("Staff Member", {"user": user}, "name")
	if not name:
		if required:
			frappe.throw(_("No staff profile is linked to your account."), frappe.PermissionError)
		return None
	return frappe.get_doc("Staff Member", name)


def require_lecturer():
	user = require_login()
	roles = user_roles(user)
	if ROLE_LECTURER not in roles and not is_staff(user):
		frappe.throw(_("This area is for lecturers."), frappe.PermissionError)
	return get_staff_member(user, required=ROLE_LECTURER in roles and not is_staff(user))


def require_lecturer_of(course_offering: str) -> None:
	"""Allow the offering's lecturers plus academic administrators."""
	user = require_login()
	if (
		user_roles(user) & {"System Manager", ROLE_ADMIN, "Registrar", "Academic Dean"}
		or user == "Administrator"
	):
		return
	teaches = frappe.db.exists(
		"Course Offering Lecturer", {"parent": course_offering, "parenttype": "Course Offering", "user": user}
	)
	if not teaches:
		frappe.throw(_("You are not assigned to teach this course."), frappe.PermissionError)


def get_sponsor(user: str | None = None, required: bool = True):
	user = user or require_login()
	name = frappe.db.get_value("Sponsor", {"user": user}, "name")
	if not name and required:
		frappe.throw(_("No sponsor profile is linked to your account."), frappe.PermissionError)
	return frappe.get_doc("Sponsor", name) if name else None


def require_sponsor():
	require_login()
	if ROLE_SPONSOR not in user_roles() and not is_staff():
		frappe.throw(_("This area is for sponsors and partner churches."), frappe.PermissionError)
	return get_sponsor()


def require_applicant() -> str:
	user = require_login()
	roles = user_roles(user)
	if not roles & {ROLE_APPLICANT, ROLE_STUDENT} and not is_staff(user):
		frappe.throw(_("This area is for applicants."), frappe.PermissionError)
	return user


def parse_json(value, default=None):
	if value is None or value == "":
		return default
	if isinstance(value, (dict, list)):
		return value
	try:
		return json.loads(value)
	except (TypeError, ValueError):
		frappe.throw(_("Invalid JSON payload."))


def page_args(start=0, page_length=20, max_length=200) -> dict:
	return {"start": max(cint(start), 0), "page_length": min(max(cint(page_length), 1), max_length)}


def clean_payload(data: dict, allowed: tuple[str, ...] | list[str]) -> dict:
	"""Keep only whitelisted keys from a browser payload."""
	data = parse_json(data, {}) or {}
	return {k: data.get(k) for k in allowed if k in data}


def search_filters(search: str | None, fields: tuple[str, ...]) -> list | None:
	if not search:
		return None
	like = f"%{search.strip()}%"
	return [[f, "like", like] for f in fields]
