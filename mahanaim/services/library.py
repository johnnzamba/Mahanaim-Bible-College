"""E-library services (owned by backend domain B4).

* Copies: `available_copies = total_copies - (Issued + Overdue loans)`, recomputed under a row lock whenever a loan
  changes, so concurrent issues cannot oversell the last copy. A Lost copy is written off (total_copies - 1).
* Fines: `fine_per_day()` × days past the due date — Mahanaim Settings `library_fine_per_day` when that field
  exists, else the FINE_PER_DAY constant (KES 10).
* Access levels: guests see Public; students/alumni Public + Students; staff and lecturers see everything.
* Private digital files are served through a short-lived, user-bound download token (see `make_download_token`)
  because borrowers have no read permission on Library Item, so Frappe's own /private/files guard would refuse them.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import add_days, cint, date_diff, escape_html, flt, getdate, nowdate

from mahanaim.utils import (
	ROLE_ALUMNI,
	ROLE_LECTURER,
	ROLE_LIBRARY,
	ROLE_STUDENT,
	fmt_money,
	is_staff,
	user_roles,
)

FINE_PER_DAY = 10  # KES per day overdue, used when Mahanaim Settings has no library_fine_per_day field
LOAN_DAYS = 14
MAX_ACTIVE_LOANS = 5
ACTIVE_STATUSES = ("Issued", "Overdue")
OPEN_STATUSES = ("Requested", "Issued", "Overdue")
CIRCULATED_STATUSES = ("Issued", "Overdue", "Returned", "Lost")
DIGITAL_TYPES = ("E-Book", "Audio", "Video")
ACCESS_LEVELS = ("Public", "Students", "Staff")
DOWNLOAD_TOKEN_TTL = 10 * 60


# ---------------------------------------------------------------------------------- settings
def _settings_value(fieldname: str, default):
	if frappe.get_meta("Mahanaim Settings").has_field(fieldname):
		value = frappe.db.get_single_value("Mahanaim Settings", fieldname)
		if value not in (None, "", 0):
			return value
	return default


def fine_per_day() -> float:
	return flt(_settings_value("library_fine_per_day", FINE_PER_DAY))


def loan_days() -> int:
	return cint(_settings_value("library_loan_days", LOAN_DAYS))


def default_due_date(issue_date=None) -> str:
	return str(add_days(getdate(issue_date or nowdate()), loan_days()))


def compute_fine(due_date, as_of=None) -> float:
	if not due_date:
		return 0.0
	late = date_diff(getdate(as_of or nowdate()), getdate(due_date))
	return flt(late * fine_per_day()) if late > 0 else 0.0


# ---------------------------------------------------------------------------------- access
def access_levels(user: str | None = None) -> tuple[str, ...]:
	user = user or frappe.session.user
	if user == "Guest":
		return ("Public",)
	roles = user_roles(user)
	if user == "Administrator" or is_staff(user) or ROLE_LECTURER in roles or ROLE_LIBRARY in roles:
		return ACCESS_LEVELS
	if roles & {ROLE_STUDENT, ROLE_ALUMNI}:
		return ("Public", "Students")
	return ("Public",)


def can_access(item_access_level: str | None, user: str | None = None) -> bool:
	return (item_access_level or "Students") in access_levels(user)


def is_digital(item) -> bool:
	return bool(item.get("digital_file") or item.get("external_url"))


def borrower_for_user(user: str | None = None) -> dict | None:
	"""{"borrower_type", "student"|"staff_member", "borrower_name", "status"} for a user who can borrow."""
	user = user or frappe.session.user
	if user == "Guest":
		return None
	s = frappe.db.get_value("Student", {"user": user}, ["name", "full_name", "status"], as_dict=True)
	if s:
		return {
			"borrower_type": "Student",
			"student": s.name,
			"borrower_name": s.full_name,
			"status": s.status,
		}
	m = frappe.db.get_value("Staff Member", {"user": user}, ["name", "full_name", "status"], as_dict=True)
	if m:
		return {
			"borrower_type": "Staff",
			"staff_member": m.name,
			"borrower_name": m.full_name,
			"status": m.status,
		}
	return None


# ---------------------------------------------------------------------------------- copies
def active_loans(item: str, exclude: str | None = None) -> int:
	filters = {"library_item": item, "status": ["in", ACTIVE_STATUSES]}
	if exclude:
		filters["name"] = ["!=", exclude]
	return frappe.db.count("Library Loan", filters)


def lock_available_copies(item: str, exclude: str | None = None) -> int:
	"""Copies on the shelf, read under a row lock on the item (call before issuing)."""
	row = frappe.db.get_value("Library Item", item, ["total_copies"], as_dict=True, for_update=True)
	return max(cint(row.total_copies) - active_loans(item, exclude), 0) if row else 0


def refresh_item_counts(item: str | None):
	"""Recompute available copies and the circulation counter under a row lock."""
	if not item:
		return
	row = frappe.db.get_value("Library Item", item, ["total_copies"], as_dict=True, for_update=True)
	if not row:
		return
	circulated = frappe.db.count(
		"Library Loan", {"library_item": item, "status": ["in", CIRCULATED_STATUSES]}
	)
	frappe.db.set_value(
		"Library Item",
		item,
		{"available_copies": max(cint(row.total_copies) - active_loans(item), 0), "loans_count": circulated},
		update_modified=False,
	)


def active_loan_count(borrower_type: str, borrower: str, exclude: str | None = None) -> int:
	field = "student" if borrower_type == "Student" else "staff_member"
	filters = {field: borrower, "status": ["in", ACTIVE_STATUSES]}
	if exclude:
		filters["name"] = ["!=", exclude]
	return frappe.db.count("Library Loan", filters)


# ---------------------------------------------------------------------------------- downloads
def make_download_token(item: str, file_url: str, user: str | None = None) -> str:
	token = frappe.generate_hash(length=32)
	frappe.cache.set_value(
		f"mbc:lib:dl:{token}",
		{"item": item, "file_url": file_url, "user": user or frappe.session.user},
		expires_in_sec=DOWNLOAD_TOKEN_TTL,
	)
	return token


def resolve_download_token(token: str | None) -> dict | None:
	if not token or len(token) > 64:
		return None
	return frappe.cache.get_value(f"mbc:lib:dl:{token}")


def increment_downloads(item: str):
	LI = frappe.qb.DocType("Library Item")
	frappe.qb.update(LI).set(LI.downloads, LI.downloads + 1).where(LI.name == item).run()


# ---------------------------------------------------------------------------------- notifications
def loan_recipient(loan) -> dict | None:
	from mahanaim.services.communication import recipient_for_student, recipient_for_user

	if loan.student:
		return recipient_for_student(loan.student)
	if loan.staff_member:
		m = frappe.db.get_value(
			"Staff Member", loan.staff_member, ["user", "email", "phone", "full_name"], as_dict=True
		)
		if m and m.user:
			return recipient_for_user(m.user)
		if m:
			return {"email": m.email, "phone": m.phone, "name": m.full_name}
	return None


def notify_overdue(loan):
	from mahanaim.services.communication import notify

	recipient = loan_recipient(loan)
	if not recipient:
		return
	fine = fmt_money(loan.fine_amount)
	notify(
		"Library Loan Overdue",
		doc=loan,
		recipients=[recipient],
		context={"loan": loan, "fine": fine},
		category="Library",
		link="/student/library" if loan.student else None,
		fallback={
			"subject": _("Library book overdue: {0}").format(loan.item_title),
			"message": _(
				"<p>Dear {0},</p><p><b>{1}</b> was due back on {2}. Please return it to the library as soon as "
				"possible. Fines accrue at {3} per day (currently {4}).</p>"
			).format(
				escape_html(loan.borrower_name or ""),
				escape_html(loan.item_title or ""),
				frappe.format(loan.due_date, {"fieldtype": "Date"}),
				fmt_money(fine_per_day()),
				fine,
			),
			"sms": _("Library: '{0}' was due on {1}. Please return it. Fine so far {2}.").format(
				(loan.item_title or "")[:40], loan.due_date, fine
			),
			"send_sms": 1,
		},
	)


def library_officer_users() -> list[str]:
	users = frappe.get_all(
		"Has Role", filters={"role": ROLE_LIBRARY, "parenttype": "User"}, pluck="parent", distinct=True
	)
	if not users:
		return []
	return frappe.get_all("User", filters={"name": ["in", users], "enabled": 1}, pluck="name")


def notify_library_officers(title: str, message: str, link: str = "/admin/library/loans", doc=None):
	from mahanaim.services.communication import push_portal_notification

	for user in library_officer_users():
		try:
			push_portal_notification(user, title, message, link=link, category="Library", doc=doc)
		except Exception:
			frappe.log_error(title="Library officer notification failed")


# ---------------------------------------------------------------------------------- scheduler
def _commit():
	if not frappe.flags.in_test:
		frappe.db.commit()  # nosemgrep: scheduler job, commit per unit of work


def mark_overdue_loans() -> int:
	"""Daily: Issued loans past their due date become Overdue (borrower notified once); fines accrue daily."""
	today = nowdate()
	newly_overdue = frappe.get_all(
		"Library Loan", filters={"status": "Issued", "due_date": ["<", today]}, pluck="name"
	)
	for name in newly_overdue:
		try:
			loan = frappe.get_doc("Library Loan", name)
			loan.status = "Overdue"
			loan.flags.ignore_permissions = True
			loan.save()
			notify_overdue(loan)
			_commit()
		except Exception:
			if not frappe.flags.in_test:
				frappe.db.rollback()
			frappe.log_error(title=f"Library overdue marking failed for {name}")
	# Fines on loans that were already overdue: one UPDATE per distinct due date (no per-row saves).
	per_day = fine_per_day()
	LL = frappe.qb.DocType("Library Loan")
	for due in frappe.get_all(
		"Library Loan", filters={"status": "Overdue", "fine_paid": 0}, pluck="due_date", distinct=True
	):
		frappe.qb.update(LL).set(LL.fine_amount, flt(max(date_diff(today, due), 0) * per_day)).where(
			(LL.status == "Overdue") & (LL.fine_paid == 0) & (LL.due_date == due)
		).run()
	_commit()
	return len(newly_overdue)
