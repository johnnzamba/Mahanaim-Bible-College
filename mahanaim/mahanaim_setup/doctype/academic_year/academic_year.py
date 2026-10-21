# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, getdate


class AcademicYear(Document):
	def validate(self):
		self.year_name = (self.year_name or "").strip()
		if getdate(self.start_date) >= getdate(self.end_date):
			frappe.throw(_("Academic year start date must be before its end date."))

	def on_update(self):
		current = frappe.db.get_single_value("Mahanaim Settings", "current_academic_year")
		if cint(self.is_current):
			frappe.db.set_value(
				"Academic Year",
				{"is_current": 1, "name": ["!=", self.name]},
				"is_current",
				0,
				update_modified=False,
			)
			if current != self.name:
				frappe.db.set_single_value("Mahanaim Settings", "current_academic_year", self.name)
		elif current == self.name:
			frappe.db.set_single_value("Mahanaim Settings", "current_academic_year", None)

	def on_trash(self):
		if (
			cint(self.is_current)
			or frappe.db.get_single_value("Mahanaim Settings", "current_academic_year") == self.name
		):
			frappe.throw(_("You cannot delete the current academic year."))
