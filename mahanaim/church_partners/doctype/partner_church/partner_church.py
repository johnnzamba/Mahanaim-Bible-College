# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import validate_email_address
from frappe.utils.nestedset import NestedSet

from mahanaim.utils import normalize_phone


class PartnerChurch(NestedSet):
	nsm_parent_field = "parent_partner_church"

	def validate(self):
		self.church_name = " ".join((self.church_name or "").split())
		if self.parent_partner_church:
			if self.parent_partner_church == self.name:
				frappe.throw(_("A church cannot be its own parent."))
			if not frappe.db.get_value("Partner Church", self.parent_partner_church, "is_group"):
				frappe.throw(
					_("{0} is not a group. Tick 'Is Group' on it before adding branches under it.").format(
						self.parent_partner_church
					)
				)
		if self.church_code:
			self.church_code = self.church_code.strip().upper()
			clash = frappe.db.get_value(
				"Partner Church", {"church_code": self.church_code, "name": ["!=", self.name or ""]}, "name"
			)
			if clash:
				frappe.throw(_("Church code {0} is already used by {1}.").format(self.church_code, clash))
		if self.email:
			self.email = self.email.strip().lower()
			validate_email_address(self.email, throw=True)
		self.phone = normalize_phone(self.phone)
		if not self.is_new() and not self.is_group and self.has_branches():
			frappe.throw(_("{0} has branches, so it must remain a group.").format(self.church_name))

	def has_branches(self) -> bool:
		return bool(frappe.db.exists("Partner Church", {"parent_partner_church": self.name}))

	def on_trash(self):
		linked = frappe.db.exists("Student", {"partner_church": self.name}) or frappe.db.exists(
			"Sponsor", {"partner_church": self.name}
		)
		if linked:
			frappe.throw(
				_("{0} is linked to students or sponsors; set it Inactive instead.").format(self.church_name)
			)
		super().on_trash()
