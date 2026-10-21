# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, getdate, nowdate

from mahanaim.services import library as lib


class LibraryItem(Document):
	def validate(self):
		self.title = " ".join((self.title or "").split())
		for field in ("authors", "isbn", "call_number", "publisher", "edition", "location", "external_url"):
			if self.get(field):
				self.set(field, self.get(field).strip())
		if self.publication_year and not (1400 <= cint(self.publication_year) <= getdate(nowdate()).year + 1):
			frappe.throw(_("Enter a valid publication year."))
		if self.external_url and not self.external_url.lower().startswith(("http://", "https://")):
			frappe.throw(_("The external link must start with http:// or https://"))
		if self.item_type in lib.DIGITAL_TYPES and not lib.is_digital(self):
			frappe.throw(_("{0} items need an uploaded file or an external link.").format(_(self.item_type)))
		self.access_level = self.access_level or "Students"
		self.validate_copies()

	def validate_copies(self):
		if cint(self.total_copies) < 0:
			frappe.throw(_("Total copies cannot be negative."))
		if cint(self.total_copies) == 0 and not lib.is_digital(self):
			frappe.throw(_("A physical item needs at least one copy (or attach a digital file)."))
		on_loan = 0 if self.is_new() else lib.active_loans(self.name)
		if cint(self.total_copies) < on_loan:
			frappe.throw(
				_("{0} copies are on loan, so total copies cannot be less than that.").format(on_loan)
			)
		self.available_copies = cint(self.total_copies) - on_loan
		if not (0 <= cint(self.available_copies) <= cint(self.total_copies)):
			frappe.throw(_("Available copies must be between 0 and the total copies."))

	@property
	def is_digital(self) -> bool:
		return lib.is_digital(self)

	def on_trash(self):
		if frappe.db.exists("Library Loan", {"library_item": self.name, "status": ["!=", "Cancelled"]}):
			frappe.throw(_("{0} has loan history; deactivate it instead of deleting.").format(self.title))
