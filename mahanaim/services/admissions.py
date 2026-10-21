"""Admissions services (owned by backend domain B1).

CONTRACT:
	mark_application_fee_paid(application: str, payment: str | None = None)
		Called by finance (B3) when an Application Fee Student Payment is submitted / M-Pesa confirms.
		Sets fee_status=Paid, fee_payment, and moves Draft->Submitted if the applicant already finalised.
"""

import frappe


def mark_application_fee_paid(application: str, payment: str | None = None):
	raise NotImplementedError
