# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.permissions import AUTOMATIC_ROLES
from frappe.utils import cint

from mahanaim.utils import ROLE_ADMIN, ROLE_LECTURER, normalize_phone, setting

UNSCOPED_ROLES = {"System Manager", ROLE_ADMIN}
STANDARD_USERS = ("Administrator", "Guest")


class StaffMember(Document):
	def validate(self):
		self.first_name = (self.first_name or "").strip()
		self.last_name = (self.last_name or "").strip()
		self.full_name = " ".join(p for p in (self.first_name, self.last_name) if p)
		self.email = (self.email or "").strip().lower()
		frappe.utils.validate_email_address(self.email, throw=True)
		if self.phone:
			self.phone = normalize_phone(self.phone)
		if not self.staff_number:
			from mahanaim.services.numbering import next_serial

			self.staff_number = next_serial(f"{setting('short_name', 'MBC')}/STF/", 4)
		clash = frappe.db.get_value(
			"Staff Member", {"email": self.email, "name": ["!=", self.name or ""]}, "name"
		)
		if clash:
			frappe.throw(_("Another staff profile ({0}) already uses {1}.").format(clash, self.email))
		self.validate_campuses()
		self.sync_user_email()
		self.ensure_user()

	def validate_campuses(self):
		seen = set()
		for row in list(self.get("additional_campuses") or []):
			if row.campus == self.campus or row.campus in seen:
				self.remove(row)
			seen.add(row.campus)

	def sync_user_email(self):
		"""Carry an email change over to the linked login. Frappe user ids are the email address, so the User
		is renamed (links, owners and sessions follow; the person signs in again with the new address)."""
		if self.is_new() or not self.user or self.flags.sync_user_email is False:
			return
		before = self.get_doc_before_save()
		if before is None or (before.email or "").strip().lower() == self.email:
			return
		if (frappe.db.get_value("User", self.user, "email") or "").lower() == self.email:
			return
		self.check_can_change_login_email()
		if self.user in STANDARD_USERS:
			frappe.db.set_value("User", self.user, "email", self.email)
			return
		if frappe.db.exists("User", self.email):
			frappe.throw(
				_("Another user account already uses {0}. Choose a different email address.").format(
					self.email
				)
			)
		from frappe.model.rename_doc import rename_doc

		old = self.user
		opts = {"ignore_permissions": True, "show_alert": False, "rebuild_search": False}
		# User.after_rename renames this one without ignore_permissions (fails for non-admin editors), so do it first
		if frappe.db.exists("Notification Settings", old):
			rename_doc(doctype="Notification Settings", old=old, new=self.email, force=True, **opts)
		self.user = rename_doc(doctype="User", old=old, new=self.email, **opts)

	def check_can_change_login_email(self):
		"""Changing a login email hands the account to whoever owns the new address, so only administrators may
		do it for accounts holding roles the editor lacks (Lecturer excepted: staff editors grant it anyway)."""
		editor = frappe.session.user
		if editor == "Administrator":
			return
		editor_roles = set(frappe.get_roles(editor))
		if editor_roles & UNSCOPED_ROLES:
			return
		extra = set(frappe.get_roles(self.user)) - editor_roles - set(AUTOMATIC_ROLES) - {ROLE_LECTURER}
		if extra:
			frappe.throw(
				_(
					"Only a College Administrator can change the sign-in email of an account with the {0} role(s)."
				).format(", ".join(sorted(extra))),
				frappe.PermissionError,
			)

	def ensure_user(self):
		if self.user or self.flags.create_user is False or not self.email:
			return
		from mahanaim.services.students import _ensure_user

		roles = (ROLE_LECTURER,) if cint(self.is_lecturer) else ()
		self.user, created = _ensure_user(
			self.email, self.first_name, self.last_name, self.phone, roles=roles, user_type="System User"
		)
		self.flags.user_created = created

	def on_update(self):
		if not self.user:
			return
		self.sync_roles()
		self.sync_user_enabled()
		self.sync_campus_permissions()
		if self.flags.user_created:
			from mahanaim.services.communication import notify, recipient_for_user

			notify(
				"Account Created",
				doc=self,
				recipients=[recipient_for_user(self.user)],
				link="/signin",
				category="System",
				fallback={
					"subject": _("Your {0} staff account").format(setting("short_name", "MBC")),
					"message": _(
						"Your Digital Campus staff account is ready. Use 'Forgot password' on the sign-in page to set your password."
					),
				},
			)
			self.flags.user_created = False

	def sync_roles(self):
		before = self.get_doc_before_save()
		has_lecturer = frappe.db.exists(
			"Has Role", {"parent": self.user, "parenttype": "User", "role": ROLE_LECTURER}
		)
		if cint(self.is_lecturer) and not has_lecturer:
			frappe.get_doc("User", self.user).add_roles(ROLE_LECTURER)
		elif not cint(self.is_lecturer) and has_lecturer and before and cint(before.is_lecturer):
			frappe.get_doc("User", self.user).remove_roles(ROLE_LECTURER)

	def sync_user_enabled(self):
		enabled = 0 if self.status == "Inactive" else 1
		if (
			cint(frappe.db.get_value("User", self.user, "enabled")) != enabled
			and self.user != "Administrator"
		):
			user = frappe.get_doc("User", self.user)
			user.enabled = enabled
			user.save(ignore_permissions=True)

	def sync_campus_permissions(self):
		"""Campus-scoped staff get one User Permission per campus they serve; admins stay unscoped."""
		roles = set(frappe.get_roles(self.user))
		if roles & UNSCOPED_ROLES or self.user == "Administrator":
			wanted = set()
		else:
			wanted = {self.campus, *(r.campus for r in self.get("additional_campuses") or [])} - {None, ""}
		existing = frappe.get_all(
			"User Permission",
			filters={"user": self.user, "allow": "Campus"},
			fields=["name", "for_value", "is_default"],
		)
		for row in existing:
			if row.for_value not in wanted:
				frappe.delete_doc("User Permission", row.name, ignore_permissions=True, force=True)
			elif cint(row.is_default) != cint(row.for_value == self.campus):
				frappe.db.set_value(
					"User Permission", row.name, "is_default", cint(row.for_value == self.campus)
				)
		have = {row.for_value for row in existing}
		for campus in sorted(wanted - have):
			frappe.get_doc(
				{
					"doctype": "User Permission",
					"user": self.user,
					"allow": "Campus",
					"for_value": campus,
					"apply_to_all_doctypes": 1,
					"is_default": 1 if campus == self.campus else 0,
				}
			).insert(ignore_permissions=True)

	def on_trash(self):
		if self.user:
			for name in frappe.get_all(
				"User Permission", filters={"user": self.user, "allow": "Campus"}, pluck="name"
			):
				frappe.delete_doc("User Permission", name, ignore_permissions=True, force=True)
