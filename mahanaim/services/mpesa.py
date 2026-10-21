"""M-Pesa Daraja integration (owned by backend domain B3).

CONTRACT:
	initiate_payment(phone, amount, purpose, student=None, application=None, sponsor=None, invoice=None,
	                 initiated_by=None) -> dict {"request": name, "checkout_request_id": str, "customer_message": str}
		purpose in {"Student Fees", "Application Fee", "Event Fee", "Giving", "Other"} (sponsor= marks a sponsor paying for a student)
	expire_stale_requests()  # cron */5
"""

import frappe


def initiate_payment(phone, amount, purpose, student=None, application=None, sponsor=None, invoice=None,
					 initiated_by=None) -> dict:
	raise NotImplementedError


def expire_stale_requests():
	pass
