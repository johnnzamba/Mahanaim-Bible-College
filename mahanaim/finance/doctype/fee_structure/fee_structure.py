# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, flt

from mahanaim.services.fees import money


class FeeStructure(Document):
	def validate(self):
		if not self.structure_name:
			self.structure_name = " ".join(
				str(v) for v in (self.programme, self.academic_term or self.academic_year, self.campus) if v
			)
		self.validate_term_year()
		self.validate_items()
		self.validate_installments()

	def validate_term_year(self):
		if self.academic_term:
			year = frappe.db.get_value("Academic Term", self.academic_term, "academic_year")
			if self.academic_year and year and self.academic_year != year:
				frappe.throw(
					_("Academic term {0} does not belong to academic year {1}").format(
						self.academic_term, self.academic_year
					)
				)
			self.academic_year = self.academic_year or year
		if cint(self.year_of_study) < 0:
			frappe.throw(_("Year of study cannot be negative"))

	def validate_items(self):
		if not self.items:
			frappe.throw(_("Add at least one fee component"))
		seen = set()
		for row in self.items:
			if row.fee_component in seen:
				frappe.throw(
					_("Row {0}: fee component {1} is listed more than once").format(
						row.idx, row.fee_component
					)
				)
			seen.add(row.fee_component)
			row.amount = money(row.amount)
			if row.amount <= 0:
				frappe.throw(_("Row {0}: amount must be greater than zero").format(row.idx))
			if not row.description:
				row.description = row.fee_component
		self.total_amount = money(sum(flt(r.amount) for r in self.items))

	def validate_installments(self):
		if not cint(self.allow_installments):
			self.installments = []
			return
		if not self.installments:
			frappe.throw(_("Add the installment plan or untick Allow Installments"))
		total = self.total_amount
		rows = self.installments
		has_amounts = all(flt(r.amount) > 0 for r in rows)
		running = 0.0
		for i, row in enumerate(rows):
			if not has_amounts:
				if flt(row.percent) <= 0:
					frappe.throw(_("Installment {0}: set an amount or a percentage").format(row.idx))
				row.amount = (
					money(total - running) if i == len(rows) - 1 else money(total * flt(row.percent) / 100.0)
				)
			row.amount = money(row.amount)
			row.percent = round(row.amount * 100.0 / total, 4) if total else 0
			running = money(running + row.amount)
			if cint(row.due_days) < 0:
				frappe.throw(_("Installment {0}: due days cannot be negative").format(row.idx))
		if money(running) != money(total):
			frappe.throw(
				_("Installments add up to {0} but the structure total is {1}").format(running, total),
				title=_("Installments do not match"),
			)
