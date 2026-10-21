# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, getdate, today

from mahanaim.services import admissions
from mahanaim.utils import log_status, normalize_phone, validate_transition


class ProgrammeApplication(Document):
	def validate(self):
		self.clean_personal_details()
		self.programme_name = (
			frappe.db.get_value("Programme", self.programme, "programme_name") if self.programme else None
		)
		admissions.validate_programme_options(self)
		self.set_application_fee()
		self.validate_duplicate()
		validate_transition(self, admissions.APPLICATION_TRANSITIONS)
		self.track_status()

	def on_update(self):
		if self.has_value_changed("status"):
			before = self.get_doc_before_save()
			admissions.after_status_change(self, before.status if before else None)

	def clean_personal_details(self):
		for field in ("first_name", "middle_name", "last_name", "national_id"):
			if self.get(field):
				self.set(field, " ".join(str(self.get(field)).split()))
		self.full_name = " ".join(p for p in (self.first_name, self.middle_name, self.last_name) if p)
		self.email = (self.email or "").strip().lower()
		frappe.utils.validate_email_address(self.email, throw=True)
		self.phone = normalize_phone(self.phone)
		if not self.phone or not 9 <= len(self.phone) <= 15:
			frappe.throw(_("Enter a valid phone number, e.g. 0712 345 678."))
		for field in ("nok_phone", "pastor_phone"):
			if self.get(field):
				self.set(field, normalize_phone(self.get(field)))
		if self.date_of_birth and getdate(self.date_of_birth) >= getdate(today()):
			frappe.throw(_("Date of birth must be in the past."))
		year = getdate(today()).year
		if self.kcse_year and not 1960 <= cint(self.kcse_year) <= year:
			frappe.throw(_("Enter a valid KCSE year."))
		if self.year_born_again and not 1900 <= cint(self.year_born_again) <= year:
			frappe.throw(_("Enter a valid year for when you were born again."))
		for row in self.get("academic_records") or []:
			if row.year_completed and not 1950 <= cint(row.year_completed) <= year:
				frappe.throw(_("Row {0}: enter a valid year completed.").format(row.idx))

	def set_application_fee(self):
		if self.fee_status in admissions.FEE_SETTLED:
			return
		if self.is_new() or self.status == "Draft" or self.has_value_changed("programme"):
			self.application_fee = admissions.application_fee_for(self.programme)

	def validate_duplicate(self):
		existing = admissions.find_duplicate(self)
		if existing:
			frappe.throw(
				_("An active application ({0}) already exists for {1} in this intake.").format(
					existing, self.programme_name or self.programme
				),
				frappe.DuplicateEntryError,
				title=_("Duplicate application"),
			)

	def track_status(self):
		if self.is_new():
			if self.status != "Draft":
				admissions.apply_status_effects(self, None)
			log_status(
				self, self.status, self.flags.status_note or _("Application created"), from_status=None
			)
			return
		before = self.get_doc_before_save()
		if before is None or before.status == self.status:
			return
		admissions.apply_status_effects(self, before.status)
		log_status(self, self.status, self.flags.status_note, from_status=before.status)
