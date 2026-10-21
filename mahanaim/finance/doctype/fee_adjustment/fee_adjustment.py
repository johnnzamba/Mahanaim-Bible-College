# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, today

from mahanaim.services import fees
from mahanaim.utils import current_term


class FeeAdjustment(Document):
	@property
	def is_credit(self) -> bool:
		return self.adjustment_type in fees.CREDIT_ADJUSTMENTS

	def validate(self):
		self.student_name = frappe.db.get_value("Student", self.student, "full_name")
		if self.student_name is None:
			frappe.throw(_("Student {0} not found").format(self.student), frappe.DoesNotExistError)
		self.posting_date = self.posting_date or today()
		if self.scholarship and not flt(self.amount):
			self.amount = scholarship_amount(self.scholarship, self.invoice)
		self.amount = fees.money(self.amount)
		if self.amount <= 0:
			frappe.throw(_("Adjustment amount must be greater than zero"))
		if self.adjustment_type == "Sponsor Credit" and not self.sponsor:
			frappe.throw(_("Select the sponsor providing this credit"))
		if self.adjustment_type not in ("Scholarship", "Bursary"):
			self.scholarship = None
		self.validate_invoice()
		self.validate_scholarship()
		self.academic_term = self.academic_term or current_term()

	def validate_invoice(self):
		if not self.invoice:
			return
		inv = frappe.db.get_value(
			"Student Invoice",
			self.invoice,
			["student", "docstatus", "outstanding_amount", "academic_term"],
			as_dict=True,
		)
		if not inv or inv.docstatus != 1:
			frappe.throw(_("Invoice {0} is not a submitted invoice").format(self.invoice))
		if inv.student != self.student:
			frappe.throw(_("Invoice {0} belongs to another student").format(self.invoice))
		self.academic_term = self.academic_term or inv.academic_term
		if self.is_credit:
			if self.amount > fees.money(inv.outstanding_amount):
				frappe.throw(
					_(
						"{0} exceeds the outstanding {1} on invoice {2}. Leave the invoice empty to credit the account."
					).format(self.amount, fees.money(inv.outstanding_amount), self.invoice)
				)

	def validate_scholarship(self):
		if not self.scholarship:
			return
		s = frappe.db.get_value(
			"Scholarship", self.scholarship, ["is_active", "total_budget", "utilised_amount"], as_dict=True
		)
		if not s or not s.is_active:
			frappe.throw(_("Scholarship {0} is not active").format(self.scholarship))
		if flt(s.total_budget) and fees.money(flt(s.utilised_amount) + self.amount) > fees.money(
			s.total_budget
		):
			frappe.throw(
				_("Scholarship {0} has only {1} left in its budget").format(
					self.scholarship, fees.money(flt(s.total_budget) - flt(s.utilised_amount))
				)
			)

	def on_submit(self):
		self.db_set("approved_by", frappe.session.user, update_modified=False)
		fees.make_ledger_entry(
			self.student,
			self.doctype,
			self.name,
			credit=self.amount if self.is_credit else 0,
			debit=0 if self.is_credit else self.amount,
			posting_date=self.posting_date,
			academic_term=self.academic_term,
			remarks=f"{self.adjustment_type}: {self.reason}"[:140],
		)
		fees.refresh_student_account(self.student)
		self.update_scholarship(1)

	def before_cancel(self):
		self.ignore_linked_doctypes = ("Student Ledger Entry",)

	def on_cancel(self):
		fees.cancel_ledger_entries(self.doctype, self.name)
		fees.refresh_student_account(self.student)
		self.update_scholarship(-1)

	def update_scholarship(self, sign: int):
		if self.scholarship and self.is_credit:
			used = flt(frappe.db.get_value("Scholarship", self.scholarship, "utilised_amount"))
			frappe.db.set_value(
				"Scholarship",
				self.scholarship,
				"utilised_amount",
				fees.money(max(used + sign * self.amount, 0)),
				update_modified=False,
			)


def scholarship_amount(scholarship: str, invoice: str | None = None) -> float:
	"""Value of a scholarship for an invoice (percentage of the invoice or of one component)."""
	s = frappe.db.get_value(
		"Scholarship",
		scholarship,
		["amount_type", "amount", "percentage", "applies_to_component"],
		as_dict=True,
	)
	if not s:
		return 0.0
	if s.amount_type != "Percentage":
		return fees.money(s.amount)
	if not invoice:
		return 0.0
	filters = {"parent": invoice, "parenttype": "Student Invoice"}
	if s.applies_to_component:
		filters["fee_component"] = s.applies_to_component
	base = sum(flt(r) for r in frappe.get_all("Student Invoice Item", filters=filters, pluck="amount"))
	return fees.money(base * flt(s.percentage) / 100.0)
