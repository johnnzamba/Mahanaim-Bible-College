# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import add_days, cint, flt, getdate, today

from mahanaim.services import fees
from mahanaim.utils import current_term, setting


class StudentInvoice(Document):
	def validate(self):
		self.set_student_details()
		if self.fee_structure and not self.get("items"):
			self.set_items_from_fee_structure()
		self.validate_items()
		self.validate_duplicate()
		self.set_due_date()
		self.set_installments()
		self.validate_installments()
		if self.docstatus == 0:
			self.paid_amount = 0
			self.credit_applied = 0
			self.outstanding_amount = self.total_amount
			self.status = "Draft"

	def set_student_details(self):
		s = frappe.db.get_value("Student", self.student, ["full_name", "programme", "campus"], as_dict=True)
		if not s:
			frappe.throw(_("Student {0} not found").format(self.student), frappe.DoesNotExistError)
		self.student_name, self.programme, self.campus = s.full_name, s.programme, s.campus
		self.posting_date = self.posting_date or today()
		self.academic_term = self.academic_term or current_term()
		if self.fee_structure:
			fs = frappe.db.get_value(
				"Fee Structure", self.fee_structure, ["programme", "is_active"], as_dict=True
			)
			if not fs:
				frappe.throw(_("Fee structure {0} not found").format(self.fee_structure))

	def set_items_from_fee_structure(self):
		self.set("items", fees.get_items_from_fee_structure(self.fee_structure))

	def validate_items(self):
		if not self.get("items"):
			frappe.throw(_("An invoice needs at least one fee item"))
		for row in self.items:
			row.amount = fees.money(row.amount)
			if row.amount <= 0:
				frappe.throw(_("Row {0}: amount must be greater than zero").format(row.idx))
			row.description = row.description or row.fee_component
		self.total_amount = fees.money(sum(flt(r.amount) for r in self.items))

	def validate_duplicate(self):
		if not (self.fee_structure and self.academic_term) or self.docstatus != 0:
			return
		dup = frappe.db.get_value(
			"Student Invoice",
			{
				"student": self.student,
				"academic_term": self.academic_term,
				"fee_structure": ["is", "set"],
				"docstatus": ["<", 2],
				"name": ["!=", self.name],
			},
			"name",
		)
		if dup:
			frappe.throw(
				_("{0} has already been invoiced for {1} ({2})").format(
					self.student_name, self.academic_term, dup
				),
				frappe.DuplicateEntryError,
			)

	def set_due_date(self):
		if not self.due_date:
			self.due_date = add_days(self.posting_date, cint(setting("payment_terms_days", 30)))
		if getdate(self.due_date) < getdate(self.posting_date):
			frappe.throw(_("Due date cannot be before the posting date"))

	def set_installments(self):
		if self.get("installments") or not self.fee_structure:
			return
		if not cint(frappe.db.get_value("Fee Structure", self.fee_structure, "allow_installments")):
			return
		plan = frappe.get_all(
			"Fee Installment",
			filters={"parent": self.fee_structure, "parenttype": "Fee Structure"},
			fields=["label", "percent", "due_days", "due_date", "amount"],
			order_by="idx asc",
		)
		self.set("installments", fees.split_installments(self.total_amount, plan, self.posting_date))

	def validate_installments(self):
		if not self.get("installments"):
			return
		for row in self.installments:
			row.amount = fees.money(row.amount)
			if not row.due_date:
				row.due_date = add_days(self.posting_date, cint(row.due_days))
		total = fees.money(sum(flt(r.amount) for r in self.installments))
		if total != self.total_amount:
			frappe.throw(
				_("Installments add up to {0} but the invoice total is {1}").format(total, self.total_amount),
				title=_("Installments do not match"),
			)

	def before_submit(self):
		if self.total_amount <= 0:
			frappe.throw(_("Cannot submit an invoice with a zero total"))

	def on_submit(self):
		fees.make_ledger_entry(
			self.student,
			self.doctype,
			self.name,
			debit=self.total_amount,
			posting_date=self.posting_date,
			academic_term=self.academic_term,
			remarks=_("Invoice {0}").format(self.name),
		)
		fees.sync_invoice_doc(self, fees.refresh_student_account(self.student))
		fees.post_invoice_journal(self)
		if not self.flags.mute_notification:
			fees.notify_invoice(self)

	def before_cancel(self):
		payments = frappe.get_all(
			"Payment Allocation",
			filters={"invoice": self.name, "parenttype": "Student Payment", "docstatus": 1},
			pluck="parent",
			distinct=True,
		)
		adjustments = frappe.get_all(
			"Fee Adjustment", filters={"invoice": self.name, "docstatus": 1}, pluck="name"
		)
		if payments or adjustments:
			frappe.throw(
				_("Cancel the documents allocated to this invoice first: {0}").format(
					", ".join(sorted(set(payments)) + adjustments)
				),
				frappe.LinkExistsError,
			)
		self.ignore_linked_doctypes = ("Student Ledger Entry", "Semester Registration", "M-Pesa Request")

	def on_cancel(self):
		fees.cancel_ledger_entries(self.doctype, self.name)
		self.db_set({"status": "Cancelled", "outstanding_amount": 0}, update_modified=False)
		fees.refresh_student_account(self.student)
		fees.cancel_journal(self.journal_entry)
		if (
			self.semester_registration
			and frappe.db.get_value("Semester Registration", self.semester_registration, "fee_invoice")
			== self.name
		):
			frappe.db.set_value(
				"Semester Registration",
				self.semester_registration,
				"fee_invoice",
				None,
				update_modified=False,
			)
