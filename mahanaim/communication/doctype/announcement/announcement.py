# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import get_datetime, now_datetime, strip_html

from mahanaim.utils import validate_transition

TRANSITIONS = {
	"Draft": ("Scheduled", "Sent", "Archived"),
	"Scheduled": ("Draft", "Sent", "Archived"),
	"Sent": ("Archived",),
	"Archived": ("Draft", "Sent"),
}
AUDIENCE_FIELD = {"Programme": "programme", "Campus": "campus", "Course Offering": "course_offering"}


class Announcement(Document):
	def validate(self):
		self.title = (self.title or "").strip()
		if not strip_html(self.body or "").strip():
			frappe.throw(_("Please write the announcement text."))
		self.validate_audience()
		self.validate_poster()
		self.validate_dates()
		if self.is_new() and not self.posted_by and frappe.session.user != "Guest":
			self.posted_by = frappe.session.user
		validate_transition(self, TRANSITIONS)
		self.validate_sent_lock()

	def validate_audience(self):
		needed = AUDIENCE_FIELD.get(self.audience)
		for field in AUDIENCE_FIELD.values():
			if field != needed:
				self.set(field, None)
		if needed and not self.get(needed):
			frappe.throw(_("Choose the {0} this announcement is for.").format(_(self.meta.get_label(needed))))

	def validate_poster(self):
		"""Lecturers may only address the course offerings they teach."""
		from mahanaim.services.messaging import is_lecturer_only, teaches

		user = frappe.session.user
		if not is_lecturer_only(user):
			return
		if self.audience != "Course Offering" or not teaches(user, self.course_offering):
			frappe.throw(
				_("Lecturers can only post announcements to a course offering they teach."),
				frappe.PermissionError,
			)
		if not self.is_new() and self.posted_by and self.posted_by != user:
			frappe.throw(_("You can only edit announcements you posted."), frappe.PermissionError)

	def validate_dates(self):
		if self.status == "Scheduled" and not self.publish_on:
			frappe.throw(_("Set the date and time to publish this announcement."))
		if self.expires_on:
			start = get_datetime(self.publish_on) if self.publish_on else now_datetime()
			if get_datetime(self.expires_on) <= start:
				frappe.throw(_("The expiry must be after the publish time."))

	def validate_sent_lock(self):
		before = self.get_doc_before_save()
		if not before or before.status not in ("Sent", "Archived"):
			return
		for field in ("audience", "programme", "campus", "course_offering"):
			if before.get(field) != self.get(field):
				frappe.throw(_("The audience of an announcement that was already sent cannot be changed."))

	def on_trash(self):
		if self.status == "Sent":
			frappe.throw(_("Sent announcements cannot be deleted; archive them instead."))
