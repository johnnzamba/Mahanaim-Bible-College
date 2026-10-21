# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import secrets

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint


class MPesaSettings(Document):
	def validate(self):
		if not self.callback_token and not self.get_password("callback_token", raise_exception=False):
			self.callback_token = secrets.token_urlsafe(24)
		self.stk_timeout_seconds = min(max(cint(self.stk_timeout_seconds) or 120, 30), 600)
		if self.callback_base_url:
			self.callback_base_url = self.callback_base_url.strip().rstrip("/")
			if not self.callback_base_url.startswith(("https://", "http://")):
				frappe.throw(_("Callback Base URL must start with https://"))
			if self.environment == "Production" and not self.callback_base_url.startswith("https://"):
				frappe.throw(_("Production callbacks must use an https:// base URL"))
		for field, label in (
			("business_shortcode", _("Business Shortcode")),
			("till_number", _("Till Number")),
		):
			if self.get(field):
				self.set(field, self.get(field).strip())
				if not self.get(field).isdigit():
					frappe.throw(_("{0} must contain digits only").format(label))
		if self.account_reference_prefix:
			self.account_reference_prefix = self.account_reference_prefix.strip()
			if not self.account_reference_prefix.isalnum() or len(self.account_reference_prefix) > 6:
				frappe.throw(_("Account Reference Prefix must be up to 6 letters or digits"))
		if not cint(self.enabled):
			return
		missing = [
			label
			for field, label in (
				("business_shortcode", _("Business Shortcode")),
				("consumer_key", _("Consumer Key")),
				("consumer_secret", _("Consumer Secret")),
				("passkey", _("Passkey")),
				("callback_base_url", _("Callback Base URL")),
			)
			if not self.get(field)
		]
		if self.transaction_type == "CustomerBuyGoodsOnline" and not self.till_number:
			missing.append(_("Till Number"))
		if missing:
			frappe.throw(_("Complete these settings before enabling M-Pesa: {0}").format(", ".join(missing)))

	def on_update(self):
		from mahanaim.services.mpesa import clear_token_cache

		clear_token_cache()
