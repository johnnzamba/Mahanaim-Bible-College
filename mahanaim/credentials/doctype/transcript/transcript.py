# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document

from mahanaim.services import documents


class Transcript(Document):
	def validate(self):
		documents.validate_credential(self, documents.prepare_transcript_issue)
		if self.status == "Draft" or self.flags.just_issued:
			documents.validate_transcript_request(self)
		if self.status == "Draft" and not self.snapshot:
			try:
				documents.apply_snapshot(self, documents.transcript_snapshot(self.student, self.as_of_term))
			except frappe.ValidationError:
				# preview only; the snapshot is taken again (and enforced) on issue
				frappe.clear_last_message()

	def on_update(self):
		documents.after_credential_update(self)

	def on_trash(self):
		if self.status != "Draft":
			frappe.throw(_("Issued transcripts cannot be deleted; revoke them instead"))
