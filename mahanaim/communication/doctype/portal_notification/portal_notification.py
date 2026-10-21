# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

from frappe.model.document import Document
from frappe.utils import now_datetime


class PortalNotification(Document):
	def validate(self):
		if self.is_read and not self.read_on:
			self.read_on = now_datetime()
		elif not self.is_read:
			self.read_on = None
