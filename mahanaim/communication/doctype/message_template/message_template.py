# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import strip_html
from jinja2 import TemplateSyntaxError

BODY_FIELDS = ("subject", "email_body", "sms_body", "in_app_body")
SMS_MAX = 459  # three concatenated SMS parts


class MessageTemplate(Document):
	def validate(self):
		self.validate_channels()
		self.validate_jinja()
		self.validate_unique_event()

	def validate_channels(self):
		if not (self.send_email or self.send_sms or self.send_in_app):
			frappe.throw(_("Enable at least one channel (email, SMS or in-app)."))
		if self.send_email and not strip_html(self.email_body or "").strip():
			frappe.throw(_("Write the email body or turn off the email channel."))
		if self.send_sms and not (self.sms_body or "").strip():
			frappe.throw(_("Write the SMS text or turn off the SMS channel."))
		if self.send_in_app and not (
			(self.in_app_body or "").strip() or strip_html(self.email_body or "").strip()
		):
			frappe.throw(_("Write the in-app text (or an email body to fall back on)."))
		if self.sms_body and "{{" not in self.sms_body and len(self.sms_body) > SMS_MAX:
			frappe.throw(_("SMS text is limited to {0} characters.").format(SMS_MAX))

	def validate_jinja(self):
		"""Reject syntax errors. Templates are only parsed here, never executed."""
		from mahanaim.services.communication import template_env

		jenv = template_env()
		for field in BODY_FIELDS:
			source = self.get(field)
			if not source:
				continue
			try:
				jenv.parse(source)
			except TemplateSyntaxError as e:
				frappe.throw(
					_("{0} has a template error on line {1}: {2}").format(
						_(self.meta.get_label(field)), e.lineno, e.message
					),
					title=_("Invalid template"),
				)

	def validate_unique_event(self):
		if not self.is_active or self.event == "Custom":
			return
		clash = frappe.db.get_value(
			"Message Template", {"event": self.event, "is_active": 1, "name": ["!=", self.name or ""]}, "name"
		)
		if clash:
			frappe.throw(
				_("{0} is already the active template for {1}. Deactivate it first.").format(
					clash, _(self.event)
				)
			)
