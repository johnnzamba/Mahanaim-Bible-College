"""Session bootstrap for the SPA AuthGate."""

from __future__ import annotations

import frappe
from frappe import _

from mahanaim.utils import (
	ROLE_ALUMNI,
	ROLE_APPLICANT,
	ROLE_LECTURER,
	ROLE_SPONSOR,
	ROLE_STUDENT,
	STAFF_ROLES,
	is_staff,
	user_roles,
)
from mahanaim.utils.portal import portal_for

MBC_ROLES = (*STAFF_ROLES, ROLE_LECTURER, ROLE_STUDENT, ROLE_APPLICANT, ROLE_SPONSOR, ROLE_ALUMNI)


def has_admin_access():
	return frappe.session.user != "Guest" and is_staff()


def _settings_brief():
	s = frappe.get_cached_doc("Mahanaim Settings")
	return {
		"institution_name": s.institution_name,
		"short_name": s.short_name,
		"motto": s.motto,
		"logo": s.logo,
		"currency": s.currency or "KES",
		"current_academic_term": s.current_academic_term,
		"current_academic_year": s.current_academic_year,
	}


@frappe.whitelist(allow_guest=True)
def session_info():
	"""Who is signed in, which portals they may open, and the profile records they own."""
	user = frappe.session.user
	settings = _settings_brief()
	if user == "Guest":
		return {"user": "Guest", "roles": [], "portals": [], "home": "signin", "settings": settings}

	roles = user_roles(user)
	u = frappe.db.get_value("User", user, ["full_name", "user_image", "email", "mobile_no"], as_dict=True) or {}
	portals = []
	if is_staff(user):
		portals.append("admin")
	if ROLE_LECTURER in roles:
		portals.append("lecturer")
	student = frappe.db.get_value(
		"Student",
		{"user": user},
		["name", "student_number", "full_name", "programme", "programme_name", "campus", "status", "photo",
		 "year_of_study", "current_term"],
		as_dict=True,
	)
	if student:
		portals.append("student")
	sponsor = frappe.db.get_value("Sponsor", {"user": user}, ["name", "sponsor_name", "sponsor_type"], as_dict=True)
	if sponsor:
		portals.append("sponsor")
	if ROLE_APPLICANT in roles or frappe.db.exists("Programme Application", {"user": user}):
		portals.append("applicant")
	staff = frappe.db.get_value(
		"Staff Member", {"user": user}, ["name", "full_name", "designation", "campus", "photo"], as_dict=True
	)
	return {
		"user": user,
		"full_name": u.get("full_name") or user,
		"email": u.get("email") or user,
		"phone": u.get("mobile_no"),
		"image": u.get("user_image") or (student or {}).get("photo") or (staff or {}).get("photo"),
		"roles": sorted(r for r in roles if r in MBC_ROLES),
		"portals": portals,
		"home": portal_for(user),
		"student": student,
		"staff": staff,
		"sponsor": sponsor,
		"settings": settings,
	}
