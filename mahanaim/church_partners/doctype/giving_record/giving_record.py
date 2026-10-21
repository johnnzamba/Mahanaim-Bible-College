# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import escape_html, flt, getdate, nowdate, validate_email_address

from mahanaim.utils import fmt_money, normalize_phone

GIVER_LINK = {"Sponsor": "sponsor", "Partner Church": "partner_church", "Student": "student"}


class GivingRecord(Document):
	def validate(self):
		if flt(self.amount) <= 0:
			frappe.throw(_("The amount must be greater than zero."))
		if getdate(self.posting_date) > getdate(nowdate()):
			frappe.throw(_("The posting date cannot be in the future."))
		if not frappe.db.get_value("Giving Type", self.giving_type, "is_active"):
			frappe.throw(_("Giving type {0} is inactive.").format(self.giving_type))
		needed = GIVER_LINK.get(self.giver_type)
		for field in GIVER_LINK.values():
			if field != needed:
				self.set(field, None)
		if needed and not self.get(needed):
			frappe.throw(_("Select the {0} who gave.").format(_(self.meta.get_label(needed))))
		if self.giver_type == "Anonymous" or not self.giver_name:
			from mahanaim.services.church import giver_name_for

			self.giver_name = giver_name_for(self) or self.giver_name
		if self.giver_type in ("Other", "Staff") and not self.giver_name:
			frappe.throw(_("Enter the giver's name (or choose Anonymous)."))
		self.msisdn = normalize_phone(self.msisdn)
		self.giver_email = (self.giver_email or "").strip().lower() or None
		if self.giver_email:
			validate_email_address(self.giver_email, throw=True)
		if self.mode_of_payment in ("M-Pesa", "Bank", "Cheque") and not self.reference_no:
			frappe.throw(_("Enter the {0} reference number.").format(_(self.mode_of_payment)))
		if self.reference_no:
			self.reference_no = self.reference_no.strip().upper()
			clash = frappe.db.get_value(
				"Giving Record",
				{"reference_no": self.reference_no, "docstatus": ["<", 2], "name": ["!=", self.name or ""]},
				"name",
			)
			if clash:
				frappe.throw(
					_("Reference {0} was already recorded on {1}.").format(self.reference_no, clash),
					frappe.DuplicateEntryError,
				)

	def on_submit(self):
		from mahanaim.services.church import post_giving_journal_entry, refresh_chapel_offering

		post_giving_journal_entry(self)
		refresh_chapel_offering(self.chapel_service)
		self.send_receipt()

	def on_cancel(self):
		from mahanaim.services.church import cancel_giving_journal_entry, refresh_chapel_offering

		cancel_giving_journal_entry(self)
		refresh_chapel_offering(self.chapel_service)

	def receipt_recipient(self) -> dict | None:
		from mahanaim.services.communication import recipient_for_sponsor, recipient_for_student

		if self.sponsor:
			return recipient_for_sponsor(self.sponsor)
		if self.student:
			return recipient_for_student(self.student)
		if self.partner_church:
			c = frappe.db.get_value(
				"Partner Church", self.partner_church, ["email", "phone", "church_name"], as_dict=True
			)
			return {"email": c.email, "phone": c.phone, "name": c.church_name} if c else None
		if self.giver_email or self.msisdn:
			return {"email": self.giver_email, "phone": self.msisdn, "name": self.giver_name}
		return None

	def send_receipt(self):
		from mahanaim.services.communication import notify

		recipient = self.receipt_recipient()
		if not recipient or not (recipient.get("email") or recipient.get("phone") or recipient.get("user")):
			return
		amount = fmt_money(self.amount)
		notify(
			"Giving Receipt",
			doc=self,
			recipients=[recipient],
			context={"giving": self, "amount": amount},
			category="Finance",
			fallback={
				"subject": _("Thank you for your gift — {0}").format(self.name),
				"message": _(
					"<p>Dear {0},</p><p>We have received your {1} of <b>{2}</b> (ref {3}). "
					"Thank you for partnering with us in training servants for the harvest.</p>"
				).format(
					escape_html(recipient.get("name") or self.giver_name or _("friend")),
					escape_html(_(self.giving_type)),
					amount,
					self.reference_no or self.name,
				),
				"sms": _("Thank you! We received your {0} of {1}. Ref {2}.").format(
					_(self.giving_type), amount, self.reference_no or self.name
				),
				"send_sms": 1,
			},
		)
		self.db_set("receipt_sent", 1, update_modified=False)
