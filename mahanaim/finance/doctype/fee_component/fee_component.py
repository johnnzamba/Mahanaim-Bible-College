# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

from frappe.model.document import Document
from frappe.utils import flt


class FeeComponent(Document):
	def validate(self):
		if self.code:
			self.code = self.code.strip().upper()
		self.default_amount = flt(self.default_amount, 2)
