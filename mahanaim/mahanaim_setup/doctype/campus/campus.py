# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import re

import frappe
from frappe import _
from frappe.model.document import Document

from mahanaim.utils import normalize_phone


class Campus(Document):
	def validate(self):
		self.campus_name = (self.campus_name or "").strip()
		self.code = re.sub(r"\s+", "", (self.code or "")).upper()
		if not re.fullmatch(r"[A-Z0-9_-]{1,12}", self.code):
			frappe.throw(_("Campus code must be 1-12 letters, digits, '-' or '_' (e.g. NRB)."))
		clash = frappe.db.get_value("Campus", {"code": self.code, "name": ["!=", self.name or ""]}, "name")
		if clash:
			frappe.throw(_("Campus code {0} is already used by {1}.").format(self.code, clash))
		if self.phone:
			self.phone = normalize_phone(self.phone)
		if self.email:
			frappe.utils.validate_email_address(self.email, throw=True)
