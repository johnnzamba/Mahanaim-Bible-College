# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import validate_email_address

from mahanaim.utils import normalize_phone


class Sponsor(Document):
	def validate(self):
		self.sponsor_name = " ".join((self.sponsor_name or "").split())
		if self.email:
			self.email = self.email.strip().lower()
			validate_email_address(self.email, throw=True)
			clash = frappe.db.get_value(
				"Sponsor", {"email": self.email, "name": ["!=", self.name or ""]}, "name"
			)
			if clash:
				frappe.throw(
					_("Another sponsor ({0}) already uses {1}.").format(clash, self.email),
					frappe.DuplicateEntryError,
				)
		self.phone = normalize_phone(self.phone)
		if self.user:
			other = frappe.db.get_value(
				"Sponsor", {"user": self.user, "name": ["!=", self.name or ""]}, "name"
			)
			if other:
				frappe.throw(_("User {0} is already linked to sponsor {1}.").format(self.user, other))

	def on_update(self):
		if self.email and not self.user and self.flags.create_user is not False and self.status == "Active":
			self.create_portal_user()

	def create_portal_user(self):
		from mahanaim.services.church import ensure_portal_user

		try:
			user = ensure_portal_user(self.email, self.contact_person or self.sponsor_name, self.phone)
		except Exception:
			frappe.log_error(title=f"Sponsor {self.name}: portal user creation failed")
			return
		if user:
			self.db_set("user", user, update_modified=False)

	def refresh_totals(self):
		from mahanaim.services.church import refresh_sponsor_totals

		refresh_sponsor_totals(self.name)
		self.reload()

	def on_trash(self):
		if frappe.db.exists(
			"Sponsorship", {"sponsor": self.name, "status": ["in", ["Active", "Suspended", "Completed"]]}
		):
			frappe.throw(_("This sponsor has sponsorship history; set it Inactive instead of deleting."))
