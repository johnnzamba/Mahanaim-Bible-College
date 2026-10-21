# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, getdate, nowdate


class Intake(Document):
	def validate(self):
		self.intake_name = (self.intake_name or "").strip()
		if (
			self.application_open_date
			and self.application_close_date
			and getdate(self.application_open_date) > getdate(self.application_close_date)
		):
			frappe.throw(_("Applications cannot close before they open."))
		if cint(self.capacity) < 0:
			frappe.throw(_("Capacity cannot be negative."))
		if self.academic_year and self.start_date:
			start, end = frappe.db.get_value("Academic Year", self.academic_year, ["start_date", "end_date"])
			if start and end and not (getdate(start) <= getdate(self.start_date) <= getdate(end)):
				frappe.throw(
					_("Intake start date must fall within academic year {0} ({1} to {2}).").format(
						self.academic_year, frappe.format(start, "Date"), frappe.format(end, "Date")
					)
				)

	def is_accepting_applications(self, on_date=None) -> bool:
		"""True when the intake is flagged open and `on_date` is inside the optional open/close dates."""
		if not cint(self.applications_open):
			return False
		day = getdate(on_date or nowdate())
		if self.application_open_date and day < getdate(self.application_open_date):
			return False
		if self.application_close_date and day > getdate(self.application_close_date):
			return False
		return True
