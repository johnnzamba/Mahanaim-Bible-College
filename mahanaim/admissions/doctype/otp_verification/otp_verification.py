# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import add_to_date, cint, now_datetime


class OTPVerification(Document):
	"""One-time code record. Only an HMAC of the code is stored (see mahanaim.services.auth)."""

	def validate(self):
		from mahanaim.services.auth import is_hashed, normalize_recipient, otp_config, otp_hash

		cfg = otp_config()
		self.recipient = normalize_recipient(self.recipient, self.channel)
		if not self.code_hash:
			frappe.throw(_("An OTP record needs a code."))
		if not is_hashed(self.code_hash):
			# Never persist a clear-text code, even if a caller set one directly.
			self.code_hash = otp_hash(self.recipient, self.purpose, self.code_hash)
		if not self.expires_on:
			self.expires_on = add_to_date(now_datetime(), minutes=cfg.expiry)
		if not cint(self.max_attempts):
			self.max_attempts = cfg.max_attempts
		self.attempts = max(cint(self.attempts), 0)
		if cint(self.verified) and not self.verified_on:
			self.verified_on = now_datetime()
