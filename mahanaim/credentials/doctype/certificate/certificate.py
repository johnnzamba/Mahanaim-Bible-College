# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document

from mahanaim.services import documents


class Certificate(Document):
	def validate(self):
		documents.validate_credential(self, documents.prepare_certificate_issue)
		if self.status == "Draft":
			self.certificate_serial = None
			if not self.award_title and self.programme:
				self.award_title = frappe.db.get_value("Programme", self.programme, "award_title")

	def on_update(self):
		documents.after_credential_update(self)

	def on_trash(self):
		if self.status != "Draft":
			frappe.throw(_("Issued certificates cannot be deleted; revoke them instead"))
