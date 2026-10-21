# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt


class Scholarship(Document):
	def validate(self):
		if self.scholarship_type == "Full":
			self.amount_type, self.percentage = "Percentage", 100
		if self.amount_type == "Percentage":
			self.amount = 0
			if not 0 < flt(self.percentage) <= 100:
				frappe.throw(_("Percentage must be between 0 and 100"))
		else:
			self.percentage = 0
			self.amount = flt(self.amount, 2)
			if self.amount <= 0:
				frappe.throw(_("Enter the scholarship amount"))
		self.total_budget = flt(self.total_budget, 2)
		if self.total_budget < 0:
			frappe.throw(_("Budget cannot be negative"))
		if self.total_budget and flt(self.utilised_amount) > self.total_budget:
			frappe.throw(
				_("Budget cannot be lower than the amount already utilised ({0})").format(
					self.utilised_amount
				)
			)
