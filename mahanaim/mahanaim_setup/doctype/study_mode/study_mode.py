# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class StudyMode(Document):
	def validate(self):
		self.study_mode_name = (self.study_mode_name or "").strip()
		self.code = (self.code or "").strip().upper()
		if not self.code:
			frappe.throw(_("Study mode code is required."))
		clash = frappe.db.get_value(
			"Study Mode", {"code": self.code, "name": ["!=", self.name or ""]}, "name"
		)
		if clash:
			frappe.throw(_("Study mode code {0} is already used by {1}.").format(self.code, clash))
