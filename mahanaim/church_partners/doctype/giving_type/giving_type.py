# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class GivingType(Document):
	def validate(self):
		self.giving_type_name = " ".join((self.giving_type_name or "").split())

	def on_trash(self):
		if frappe.db.exists("Giving Record", {"giving_type": self.name}):
			frappe.throw(_("{0} has giving records; deactivate it instead.").format(self.name))
