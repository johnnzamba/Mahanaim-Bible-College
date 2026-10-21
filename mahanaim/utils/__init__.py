"""Small shared helpers used across services, controllers and APIs."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cint, flt, now_datetime

# Role names (single source of truth — also created by install.py)
ROLE_ADMIN = "College Administrator"
ROLE_REGISTRAR = "Registrar"
ROLE_ADMISSIONS = "Admissions Officer"
ROLE_FINANCE = "Finance Officer"
ROLE_DEAN = "Academic Dean"
ROLE_LECTURER = "Lecturer"
ROLE_STUDENT = "Student"
ROLE_APPLICANT = "Applicant"
ROLE_LIBRARY = "Library Officer"
ROLE_SPONSOR = "Sponsor"
ROLE_ALUMNI = "Alumni"
ROLE_AUDITOR = "Auditor"
ROLE_COMMS = "Communications Officer"
ROLE_CHAPLAIN = "Chaplain"

STAFF_ROLES = (
	"System Manager",
	ROLE_ADMIN,
	ROLE_REGISTRAR,
	ROLE_ADMISSIONS,
	ROLE_FINANCE,
	ROLE_DEAN,
	ROLE_LIBRARY,
	ROLE_AUDITOR,
	ROLE_COMMS,
	ROLE_CHAPLAIN,
)
PORTAL_ROLES = (ROLE_STUDENT, ROLE_APPLICANT, ROLE_SPONSOR, ROLE_ALUMNI)


def get_settings():
	return frappe.get_cached_doc("Mahanaim Settings")


def setting(fieldname, default=None):
	value = frappe.db.get_single_value("Mahanaim Settings", fieldname)
	return default if value in (None, "") else value


def has_app(app: str) -> bool:
	return app in frappe.get_installed_apps()


def user_roles(user: str | None = None) -> set[str]:
	return set(frappe.get_roles(user or frappe.session.user))


def is_staff(user: str | None = None) -> bool:
	user = user or frappe.session.user
	if user == "Administrator":
		return True
	return bool(user_roles(user) & set(STAFF_ROLES))


def log_status(doc, to_status: str, note: str | None = None, from_status: str | None = None):
	"""Append a row to a document's `status_log` child table (Mahanaim Status Log)."""
	if not doc.meta.has_field("status_log"):
		return
	if from_status is None:
		before = doc.get_doc_before_save()
		from_status = before.get("status") if before is not None else None
	doc.append(
		"status_log",
		{
			"timestamp": now_datetime(),
			"from_status": from_status,
			"to_status": to_status,
			"note": note,
			"user": frappe.session.user,
		},
	)


def current_term() -> str | None:
	term = setting("current_academic_term")
	if term:
		return term
	return frappe.db.get_value("Academic Term", {"is_current": 1}, "name")


def current_year() -> str | None:
	year = setting("current_academic_year")
	if year:
		return year
	return frappe.db.get_value("Academic Year", {"is_current": 1}, "name")


def currency() -> str:
	return setting("currency", "KES")


def fmt_money(amount, with_currency=True) -> str:
	value = f"{flt(amount):,.2f}"
	return f"{currency()} {value}" if with_currency else value


def normalize_phone(phone: str | None) -> str | None:
	"""Normalise Kenyan numbers to 2547XXXXXXXX / 2541XXXXXXXX (M-Pesa format)."""
	if not phone:
		return None
	digits = "".join(ch for ch in str(phone) if ch.isdigit())
	if digits.startswith("0") and len(digits) == 10:
		digits = "254" + digits[1:]
	elif len(digits) == 9 and digits[0] in "17":
		digits = "254" + digits
	elif digits.startswith("2540"):
		digits = "254" + digits[4:]
	return digits or None


def validate_transition(doc, transitions: dict[str, tuple[str, ...]], field: str = "status"):
	"""Throw if `field` moved from its previous value to one not allowed by `transitions`.

	`transitions` maps a from-status to the tuple of statuses it may move to."""
	before = doc.get_doc_before_save()
	if not before:
		return
	old, new = before.get(field), doc.get(field)
	if old == new or old is None:
		return
	allowed = transitions.get(old, ())
	if new not in allowed:
		frappe.throw(
			_("{0} cannot move from {1} to {2}").format(_(doc.doctype), _(old), _(new)),
			title=_("Invalid status change"),
		)


def pct(part, whole) -> float:
	return round(flt(part) * 100.0 / flt(whole), 2) if flt(whole) else 0.0
