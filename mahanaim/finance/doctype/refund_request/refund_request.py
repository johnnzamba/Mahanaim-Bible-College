# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.query_builder.functions import Coalesce, Sum
from frappe.utils import flt, now_datetime, today

from mahanaim.services import fees
from mahanaim.utils import validate_transition

TRANSITIONS = {
	"Pending": ("Approved", "Rejected"),
	"Approved": ("Paid", "Rejected"),
	"Rejected": (),
	"Paid": (),
}


class RefundRequest(Document):
	def validate(self):
		self.student_name = frappe.db.get_value("Student", self.student, "full_name")
		if self.student_name is None:
			frappe.throw(_("Student {0} not found").format(self.student), frappe.DoesNotExistError)
		self.amount = fees.money(self.amount)
		if self.amount <= 0:
			frappe.throw(_("Refund amount must be greater than zero"))
		validate_transition(self, TRANSITIONS)
		before = self.get_doc_before_save()
		old = before.status if before else None
		if old == "Paid" and (fees.money(before.amount) != self.amount or before.student != self.student):
			frappe.throw(_("A paid refund cannot be changed"))
		if self.payment:
			p = frappe.db.get_value("Student Payment", self.payment, ["student", "docstatus"], as_dict=True)
			if not p or p.docstatus != 1 or p.student != self.student:
				frappe.throw(_("Payment {0} is not a confirmed payment of this student").format(self.payment))
		if self.status in ("Pending", "Approved") or (self.status == "Paid" and old != "Paid"):
			self.validate_credit()
		if self.status in ("Approved", "Rejected") and old != self.status:
			self.approved_by, self.approved_on = frappe.session.user, now_datetime()
		if self.status == "Paid" and old != "Paid":
			self.paid_on = self.paid_on or today()
			if self.refund_mode != "Cash" and not self.reference_no:
				frappe.throw(_("Enter the refund transaction reference"))

	def validate_credit(self):
		credit = -fees.get_student_balance(self.student)
		rr = frappe.qb.DocType("Refund Request")
		reserved = (
			frappe.qb.from_(rr)
			.select(Coalesce(Sum(rr.amount), 0))
			.where(rr.student == self.student)
			.where(rr.status.isin(["Pending", "Approved"]))
			.where(rr.name != (self.name or ""))
		).run()[0][0]
		available = fees.money(credit - flt(reserved))
		if self.amount > available:
			frappe.throw(
				_("Refund of {0} exceeds the available credit balance of {1}").format(
					self.amount, max(available, 0)
				),
				title=_("Insufficient credit"),
			)

	def on_update(self):
		if self.status == "Paid" and not frappe.db.exists(
			fees.LEDGER, {"voucher_type": self.doctype, "voucher_no": self.name, "is_cancelled": 0}
		):
			fees.make_ledger_entry(
				self.student,
				self.doctype,
				self.name,
				debit=self.amount,
				posting_date=self.paid_on,
				remarks=_("Refund {0} via {1}").format(self.name, self.refund_mode),
			)
			fees.refresh_student_account(self.student)

	def on_trash(self):
		if self.status == "Paid":
			frappe.throw(_("A paid refund cannot be deleted"))
