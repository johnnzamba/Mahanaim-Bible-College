"""Portal routing helpers used by hooks."""

from __future__ import annotations

import frappe

from mahanaim.utils import (
	ROLE_APPLICANT,
	ROLE_LECTURER,
	ROLE_SPONSOR,
	ROLE_STUDENT,
	is_staff,
	user_roles,
)


def portal_for(user: str | None = None) -> str:
	"""Return the SPA portal path a user should land on after sign-in."""
	user = user or frappe.session.user
	if user == "Guest":
		return "signin"
	roles = user_roles(user)
	if is_staff(user):
		return "admin"
	if ROLE_LECTURER in roles:
		return "lecturer"
	if ROLE_STUDENT in roles:
		return "student"
	if ROLE_SPONSOR in roles:
		return "sponsor"
	if ROLE_APPLICANT in roles:
		return "applicant"
	return "applicant"


def get_website_user_home_page(user):
	return portal_for(user)
