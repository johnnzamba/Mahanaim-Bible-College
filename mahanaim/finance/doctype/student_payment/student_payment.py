# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, today

from mahanaim.services import fees

REFERENCE_REQUIRED = ("M-Pesa", "Bank Deposit", "Bank Transfer", "Cheque")


class StudentPayment(Document):
	def validate(self):
		self.amount = fees.money(self.amount)
		if self.amount <= 0:
			frappe.throw(_("Payment amount must be greater than zero"))
		self.posting_date = self.posting_date or today()
		self.validate_party()
		self.validate_reference()
		self.set_allocations()
		if self.docstatus == 0:
			self.status = "Draft"

	def validate_party(self):
		if self.payment_for == "Student Fees" and not self.student:
			frappe.throw(_("Select the student this fee payment is for"))
		if self.payment_for == "Application Fee" and not self.programme_application:
			frappe.throw(_("Select the application this fee is for"))
		if self.student:
			name = frappe.db.get_value("Student", self.student, "full_name")
			if name is None:
				frappe.throw(_("Student {0} not found").format(self.student), frappe.DoesNotExistError)
			self.payer_name = self.payer_name or name
		if self.programme_application and not self.payer_name:
			self.payer_name = frappe.db.get_value(
				"Programme Application", self.programme_application, "full_name"
			)
		if self.sponsor and not self.payer_name:
			self.payer_name = frappe.db.get_value("Sponsor", self.sponsor, "sponsor_name")
		if self.payment_for != "Student Fees" and self.get("allocations"):
			frappe.throw(_("Only student fee payments can be allocated to invoices"))

	def validate_reference(self):
		self.reference_no = (self.reference_no or "").strip() or None
		if self.reference_no and self.mode_of_payment == "M-Pesa":
			self.reference_no = self.reference_no.upper()
		if self.mode_of_payment in REFERENCE_REQUIRED and not self.reference_no:
			frappe.throw(_("Enter the {0} reference number").format(_(self.mode_of_payment)))
		if not self.reference_no:
			return
		dup = frappe.db.get_value(
			"Student Payment",
			{
				"mode_of_payment": self.mode_of_payment,
				"reference_no": self.reference_no,
				"docstatus": ["<", 2],
				"name": ["!=", self.name],
			},
			"name",
		)
		if dup:
			frappe.throw(
				_("{0} reference {1} is already recorded on {2}").format(
					_(self.mode_of_payment), self.reference_no, dup
				),
				frappe.DuplicateEntryError,
			)

	def set_allocations(self):
		if self.payment_for != "Student Fees":
			self.set("allocations", [])
		elif not self.get("allocations") and not self.flags.skip_auto_allocate:
			self.set(
				"allocations", fees.fifo_allocations(self.student, self.amount, self.flags.preferred_invoice)
			)
		self.validate_allocations()

	def validate_allocations(self):
		rows = self.get("allocations") or []
		info = {}
		if rows:
			info = {
				r.name: r
				for r in frappe.get_all(
					"Student Invoice",
					filters={"name": ["in", [r.invoice for r in rows]]},
					fields=["name", "student", "docstatus", "outstanding_amount", "academic_term"],
				)
			}
		seen, total = set(), 0.0
		for row in rows:
			row.allocated_amount = fees.money(row.allocated_amount)
			inv = info.get(row.invoice)
			if not inv or inv.docstatus != 1:
				frappe.throw(
					_("Row {0}: invoice {1} is not a submitted invoice").format(row.idx, row.invoice)
				)
			if inv.student != self.student:
				frappe.throw(
					_("Row {0}: invoice {1} belongs to another student").format(row.idx, row.invoice)
				)
			if row.invoice in seen:
				frappe.throw(_("Row {0}: invoice {1} is allocated twice").format(row.idx, row.invoice))
			seen.add(row.invoice)
			if row.allocated_amount <= 0:
				frappe.throw(_("Row {0}: allocated amount must be greater than zero").format(row.idx))
			row.academic_term = inv.academic_term
			row.invoice_outstanding = fees.money(inv.outstanding_amount)
			if row.allocated_amount > row.invoice_outstanding:
				frappe.throw(
					_("Row {0}: {1} exceeds the outstanding {2} on invoice {3}").format(
						row.idx, row.allocated_amount, row.invoice_outstanding, row.invoice
					)
				)
			total = fees.money(total + row.allocated_amount)
		if total > self.amount:
			frappe.throw(_("Allocated {0} is more than the payment amount {1}").format(total, self.amount))
		self.allocated_amount = total
		self.unallocated_amount = fees.money(self.amount - total)

	def posts_to_ledger(self) -> bool:
		return self.payment_for == "Student Fees" and bool(self.student)

	def on_submit(self):
		self.db_set("status", "Confirmed", update_modified=False)
		if self.posts_to_ledger():
			fees.make_ledger_entry(
				self.student,
				self.doctype,
				self.name,
				credit=self.amount,
				posting_date=self.posting_date,
				academic_term=self.allocations[0].academic_term if self.get("allocations") else None,
				remarks=_("Payment {0} via {1}{2}").format(
					self.name, self.mode_of_payment, f" ({self.reference_no})" if self.reference_no else ""
				),
			)
		if self.student:
			fees.refresh_student_account(self.student)
		if self.payment_for == "Application Fee" and self.programme_application:
			self.mark_application_fee_paid()
		fees.post_payment_journal(self)
		if not self.flags.mute_notification:
			self.send_receipt()

	def mark_application_fee_paid(self):
		try:
			from mahanaim.services.admissions import mark_application_fee_paid

			frappe.db.savepoint("mbc_app_fee")
			mark_application_fee_paid(self.programme_application, self.name)
		except Exception:
			frappe.db.rollback(save_point="mbc_app_fee")
			frappe.log_error(title=f"Could not mark application fee paid for {self.programme_application}")
			# keep the application in sync even if the admissions service is unavailable
			frappe.db.set_value(
				"Programme Application",
				self.programme_application,
				{"fee_status": "Paid", "fee_payment": self.name},
				update_modified=False,
			)

	def send_receipt(self):
		if fees.notify_payment(self):
			self.db_set("receipt_sent", 1, update_modified=False)

	def before_cancel(self):
		self.ignore_linked_doctypes = (
			"Student Ledger Entry",
			"M-Pesa Transaction",
			"M-Pesa Request",
			"Programme Application",
			"Refund Request",
		)

	def on_cancel(self):
		fees.cancel_ledger_entries(self.doctype, self.name)
		self.db_set("status", "Cancelled", update_modified=False)
		if self.student:
			fees.refresh_student_account(self.student)
		trans = frappe.db.get_value("M-Pesa Transaction", {"payment": self.name}, "name")
		if trans:
			frappe.db.set_value(
				"M-Pesa Transaction",
				trans,
				{
					"payment": None,
					"status": "Unmatched",
					"remarks": _("Payment {0} was cancelled; reconcile again.").format(self.name),
				},
			)
		fees.cancel_journal(self.journal_entry)
