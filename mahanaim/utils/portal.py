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


def set_sw_headers(response=None, request=None, **_kwargs):
	"""Let /assets/mahanaim/app/sw.js control the whole site (Service-Worker-Allowed: /)."""
	req = request or getattr(frappe.local, "request", None)
	if not req:
		return
	path = (req.path or "").split("?")[0]
	if not path.endswith("/mahanaim/app/sw.js"):
		return
	headers = {
		"Service-Worker-Allowed": "/",
		"Content-Type": "application/javascript; charset=utf-8",
		"Cache-Control": "no-cache",
	}
	for target in (getattr(frappe.local, "response", None), response):
		try:
			if target is not None and hasattr(target, "headers"):
				for k, v in headers.items():
					target.headers[k] = v
		except Exception:
			pass
