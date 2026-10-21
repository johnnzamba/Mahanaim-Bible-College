# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import escape_html, validate_email_address

from mahanaim.utils import normalize_phone, validate_transition

TRANSITIONS = {
	"New": ("In Progress", "Responded", "Closed"),
	"In Progress": ("Responded", "Closed", "New"),
	"Responded": ("Closed", "In Progress"),
	"Closed": ("In Progress",),
}


class ContactEnquiry(Document):
	def validate(self):
		self.full_name = " ".join((self.full_name or "").split())
		self.email = (self.email or "").strip().lower()
		validate_email_address(self.email, throw=True)
		self.phone = normalize_phone(self.phone)
		if not (self.message or "").strip():
			frappe.throw(_("Please write your message."))
		if self.assigned_to and not frappe.db.get_value("User", self.assigned_to, "enabled"):
			frappe.throw(_("{0} is not an active user.").format(self.assigned_to))
		if self.assigned_to and self.status == "New" and not self.is_new():
			self.status = "In Progress"
		validate_transition(self, TRANSITIONS)
		if self.status == "Responded" and not (self.response or "").strip():
			frappe.throw(_("Write the response before marking the enquiry as responded."))

	def on_update(self):
		before = self.get_doc_before_save()
		if self.assigned_to and (not before or before.assigned_to != self.assigned_to):
			self.notify_assignee()
		if self.status == "Responded" and (not before or before.status != "Responded"):
			self.send_response()

	def notify_assignee(self):
		from mahanaim.services.communication import push_portal_notification

		push_portal_notification(
			self.assigned_to,
			_("Enquiry assigned to you: {0}").format(self.full_name),
			_("{0} enquiry from {1}.").format(_(self.subject or "General"), self.full_name),
			link=f"/admin/website/enquiries/{self.name}",
			category="Info",
			doc=self,
		)

	def send_response(self):
		if self.flags.skip_response_email:
			return
		from mahanaim.services.communication import notify

		notify(
			"Enquiry Response",
			doc=self,
			recipients=[{"email": self.email, "name": self.full_name}],
			context={"enquiry": self},
			fallback={
				"subject": _("Re: your {0} enquiry").format(_(self.subject or "General").lower()),
				"message": _(
					"<p>Dear {0},</p>{1}<hr><p><small>Your message:</small></p><blockquote>{2}</blockquote>"
				).format(
					escape_html(self.full_name),
					"<p>" + escape_html(self.response).replace("\n", "<br>") + "</p>",
					escape_html(self.message or ""),
				),
			},
			channels=("Email",),
		)
