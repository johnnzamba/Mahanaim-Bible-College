# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint

from mahanaim.utils import has_app


class LMSBridgeSettings(Document):
	def validate(self):
		self.lms_installed = 1 if has_app("lms") else 0
		if cint(self.enabled) and not self.lms_installed:
			frappe.msgprint(
				_(
					"Frappe LMS is not installed on this site. The bridge stays idle and native course content is used."
				),
				indicator="orange",
				alert=True,
			)
