# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class Department(Document):
	def validate(self):
		self.department_name = (self.department_name or "").strip()
		if self.code:
			self.code = self.code.strip().upper()
			clash = frappe.db.get_value(
				"Department", {"code": self.code, "name": ["!=", self.name or ""]}, "name"
			)
			if clash:
				frappe.throw(_("Department code {0} is already used by {1}.").format(self.code, clash))
