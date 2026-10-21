# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt


class MPesaTransaction(Document):
	def validate(self):
		self.trans_id = (self.trans_id or "").strip().upper()
		self.amount = flt(self.amount, 2)
		if self.amount <= 0:
			frappe.throw(_("Transaction amount must be greater than zero"))
		if self.payment and self.status in ("Unmatched", "Matched"):
			self.status = "Allocated"

	def on_trash(self):
		if self.payment:
			frappe.throw(_("Cancel payment {0} before deleting this transaction").format(self.payment))
