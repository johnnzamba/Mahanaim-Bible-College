# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, getdate, today

from mahanaim.services import students as svc
from mahanaim.utils import ROLE_STUDENT, log_status, normalize_phone, validate_transition


class Student(Document):
	def validate(self):
		self.clean_personal_details()
		self.programme_name = (
			frappe.db.get_value("Programme", self.programme, "programme_name") if self.programme else None
		)
		if cint(self.year_of_study) < 1:
			self.year_of_study = 1
		self.set_student_number()
		if not self.flags.force_status:
			validate_transition(self, svc.STUDENT_TRANSITIONS)
		self.track_status()
		self.ensure_user()
		self.validate_user_link()

	def on_update(self):
		if self.has_value_changed("status") or self.flags.user_linked:
			self.sync_user_access()

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
		if (
			self.enrollment_date
			and self.expected_completion
			and getdate(self.expected_completion) < getdate(self.enrollment_date)
		):
			frappe.throw(_("Expected completion cannot be before the enrolment date."))

	def set_student_number(self):
		if self.student_number:
			self.student_number = self.student_number.strip().upper()
			clash = frappe.db.get_value(
				"Student", {"student_number": self.student_number, "name": ["!=", self.name or ""]}, "name"
			)
			if clash:
				frappe.throw(
					_("Student number {0} is already used by {1}.").format(self.student_number, clash)
				)
			return
		if self.status == "Applicant":
			return
		from mahanaim.services.numbering import next_student_number

		self.student_number = next_student_number(
			self.programme, self.campus, self.enrollment_date or today()
		)

	def track_status(self):
		if self.is_new():
			log_status(
				self, self.status, self.flags.status_note or _("Student record created"), from_status=None
			)
			return
		before = self.get_doc_before_save()
		if before is None or before.status == self.status:
			return
		note = self.flags.status_note
		if self.flags.force_status and self.status not in svc.STUDENT_TRANSITIONS.get(before.status, ()):
			note = _("Forced by {0}").format(frappe.session.user) + (f": {note}" if note else "")
		if self.status == "Completed" and not self.completion_date:
			self.completion_date = today()
		log_status(self, self.status, note, from_status=before.status)

	def ensure_user(self):
		if self.user or self.flags.create_user is False or not self.email:
			return
		self.user = svc.ensure_user(
			self.email, self.first_name, self.last_name, self.phone, roles=(ROLE_STUDENT,)
		)
		self.flags.user_linked = True

	def validate_user_link(self):
		if not self.user:
			return
		other = frappe.db.get_value(
			"Student",
			{"user": self.user, "name": ["!=", self.name or ""], "status": ["in", svc.OPEN_STUDENT_STATUSES]},
			"name",
		)
		if other and self.status in svc.OPEN_STUDENT_STATUSES:
			frappe.throw(_("The account {0} is already linked to student {1}.").format(self.user, other))

	def sync_user_access(self):
		"""Withdrawn students lose portal access; alumni keep it and gain the Alumni role."""
		if not self.user:
			return
		from mahanaim.services.auth import is_staff_user

		if self.status == "Withdrawn":
			if not is_staff_user(self.user):
				svc.set_user_enabled(self.user, False)
		else:
			before = self.get_doc_before_save()
			if before is not None and before.status == "Withdrawn":
				svc.set_user_enabled(self.user, True)
			svc.add_roles(self.user, ROLE_STUDENT)
		if self.status == "Alumni":
			svc.mark_alumni(self)
