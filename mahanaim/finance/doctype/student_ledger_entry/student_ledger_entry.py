# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt


class StudentLedgerEntry(Document):
	"""Immutable posting created only by finance controllers (see mahanaim.services.fees)."""

	def validate(self):
		self.debit, self.credit = flt(self.debit, 2), flt(self.credit, 2)
		if self.debit < 0 or self.credit < 0:
			frappe.throw(_("Ledger amounts cannot be negative"))
		if self.debit and self.credit:
			frappe.throw(_("A ledger entry is either a debit or a credit"))
		if not self.is_new() and not self.flags.from_fees_service:
			before = self.get_doc_before_save()
			if before and (
				flt(before.debit) != self.debit
				or flt(before.credit) != self.credit
				or before.student != self.student
			):
				frappe.throw(_("Ledger entries cannot be edited; cancel the source document instead"))

	def on_trash(self):
		if not self.is_cancelled:
			frappe.throw(_("Ledger entries cannot be deleted; cancel the source document instead"))
