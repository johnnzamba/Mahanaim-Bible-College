# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt

from mahanaim.utils import normalize_phone


class MPesaRequest(Document):
	def validate(self):
		self.phone_number = normalize_phone(self.phone_number)
		self.amount = flt(self.amount, 2)
		if self.amount < 1:
			frappe.throw(_("M-Pesa amount must be at least KES 1"))

	def on_trash(self):
		if self.status == "Completed":
			frappe.throw(_("Completed M-Pesa requests cannot be deleted"))
