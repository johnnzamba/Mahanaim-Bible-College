# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint


class CourseModule(Document):
	def validate(self):
		self.module_title = (self.module_title or "").strip()
		if not self.module_title:
			frappe.throw(_("Module title is required."))
		if cint(self.week) < 0:
			frappe.throw(_("Week cannot be negative."))
		self.sequence = max(cint(self.sequence), 1)
		if self.has_value_changed("course_offering") and not self.is_new():
			if frappe.db.exists("Learning Resource", {"course_module": self.name}):
				frappe.throw(_("Move or delete this module's resources before changing its course."))

	def on_trash(self):
		# resources survive as un-grouped content of the offering
		frappe.db.set_value(
			"Learning Resource", {"course_module": self.name}, "course_module", None, update_modified=False
		)
