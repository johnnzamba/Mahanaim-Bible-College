# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import re

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, flt


class MahanaimSettings(Document):
	def validate(self):
		self.validate_numbering()
		self.validate_ranges()
		self.validate_otp()
		self.validate_sms()
		self.sync_current_year()
		if self.email:
			frappe.utils.validate_email_address(self.email, throw=True)

	def validate_numbering(self):
		fmt = (self.student_number_format or "").strip()
		if not re.search(r"\{#+\}", fmt):
			frappe.throw(
				_("Student number format must contain a sequence token such as {0}.").format("{####}"),
				title=_("Invalid numbering rule"),
			)
		known = {"programme_code", "campus_code", "year", "yy", "short_name"}
		for token in re.findall(r"\{([^}#]+)\}", fmt):
			if token not in known:
				frappe.throw(
					_("Unknown token {0} in student number format. Allowed: {1}").format(
						"{" + token + "}", ", ".join("{" + k + "}" for k in sorted(known))
					)
				)
		self.student_number_format = fmt

	def validate_ranges(self):
		for field in ("exam_fee_clearance_percent", "lms_fee_clearance_percent"):
			value = flt(self.get(field))
			if value < 0 or value > 100:
				frappe.throw(_("{0} must be between 0 and 100.").format(_(self.meta.get_label(field))))
		for field in ("application_fee", "offer_expiry_days", "payment_terms_days", "overdue_reminder_days"):
			if flt(self.get(field)) < 0:
				frappe.throw(_("{0} cannot be negative.").format(_(self.meta.get_label(field))))
		if flt(self.max_credits_per_term) <= 0:
			frappe.throw(_("Maximum credits per term must be greater than zero."))

	def validate_otp(self):
		if not 4 <= cint(self.otp_length) <= 8:
			frappe.throw(_("OTP length must be between 4 and 8 digits."))
		if not 1 <= cint(self.otp_expiry_minutes) <= 60:
			frappe.throw(_("OTP expiry must be between 1 and 60 minutes."))
		if not 1 <= cint(self.otp_max_attempts) <= 10:
			frappe.throw(_("OTP maximum attempts must be between 1 and 10."))
		if not 0 <= cint(self.otp_resend_cooldown_seconds) <= 3600:
			frappe.throw(_("OTP resend cooldown must be between 0 and 3600 seconds."))

	def validate_sms(self):
		if not cint(self.sms_enabled):
			return
		if self.sms_provider in (None, "", "None"):
			frappe.throw(_("Choose an SMS provider or disable SMS."))
		if self.sms_provider == "Africa's Talking" and not self.sms_username:
			frappe.throw(_("Africa's Talking needs a username."))
		if self.sms_provider == "Generic HTTP" and not self.sms_generic_url:
			frappe.throw(_("Generic HTTP SMS needs a gateway URL."))

	def sync_current_year(self):
		if self.current_academic_term:
			year = frappe.db.get_value("Academic Term", self.current_academic_term, "academic_year")
			if year:
				self.current_academic_year = year

	def on_update(self):
		before = self.get_doc_before_save()
		if self.current_academic_term and (
			not before or before.current_academic_term != self.current_academic_term
		):
			frappe.db.set_value(
				"Academic Term",
				{"is_current": 1, "name": ["!=", self.current_academic_term]},
				"is_current",
				0,
				update_modified=False,
			)
			frappe.db.set_value(
				"Academic Term", self.current_academic_term, "is_current", 1, update_modified=False
			)
		if self.current_academic_year and (
			not before or before.current_academic_year != self.current_academic_year
		):
			frappe.db.set_value(
				"Academic Year",
				{"is_current": 1, "name": ["!=", self.current_academic_year]},
				"is_current",
				0,
				update_modified=False,
			)
			frappe.db.set_value(
				"Academic Year", self.current_academic_year, "is_current", 1, update_modified=False
			)
