# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class VerificationLog(Document):
	def before_insert(self):
		self.verified_on = self.verified_on or frappe.utils.now_datetime()
