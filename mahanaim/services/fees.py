"""Fees, invoicing and student ledger (owned by backend domain B3).

CONTRACT (other domains import these; keep signatures):
	create_invoice_for_registration(registration) -> str | None
		Called by B1 when a Semester Registration is approved (if settings.auto_invoice_on_registration).
	get_student_balance(student: str) -> float      # sum(debit - credit) on non-cancelled ledger entries
	fee_clearance(student: str, purpose: str) -> dict
		purpose in {"exam", "lms", "transcript", "registration"}; returns
		{"cleared": bool, "balance": float, "paid_percent": float, "required_percent": float, "message": str}
"""

import frappe


def create_invoice_for_registration(registration) -> str | None:
	return None


def get_student_balance(student: str) -> float:
	return 0.0


def fee_clearance(student: str, purpose: str) -> dict:
	return {"cleared": True, "balance": 0.0, "paid_percent": 100.0, "required_percent": 0.0, "message": ""}


def mark_overdue_invoices():
	pass


def send_fee_reminders():
	pass
