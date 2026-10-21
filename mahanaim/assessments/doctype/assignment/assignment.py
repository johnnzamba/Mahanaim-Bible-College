# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, flt, get_datetime, now_datetime

from mahanaim.utils import validate_transition

TRANSITIONS = {
	"Draft": ("Published",),
	"Published": ("Closed", "Draft"),
	"Closed": ("Published", "Graded"),
	"Graded": ("Closed",),
}


class Assignment(Document):
	def validate(self):
		self.title = (self.title or "").strip()
		offering = frappe.db.get_value(
			"Course Offering", self.course_offering, ["status", "course_title", "academic_term"], as_dict=True
		)
		if not offering:
			frappe.throw(_("Course Offering {0} does not exist.").format(self.course_offering))
		if offering.status == "Cancelled":
			frappe.throw(_("This course offering has been cancelled."))
		self.course_title = offering.course_title
		self.academic_term = offering.academic_term
		if not self.created_by_staff:
			self.created_by_staff = frappe.db.get_value("Staff Member", {"user": frappe.session.user}, "name")
		self.validate_scores()
		self.validate_dates()
		self.allowed_file_types = (
			",".join(
				dict.fromkeys(
					e.strip().lower().lstrip(".")
					for e in (self.allowed_file_types or "").split(",")
					if e.strip()
				)
			)
			or None
		)
		validate_transition(self, TRANSITIONS)
		before = self.get_doc_before_save()
		if before and before.status == "Published" and self.status == "Draft":
			if frappe.db.exists(
				"Assignment Submission", {"assignment": self.name, "status": ["!=", "Draft"]}
			):
				frappe.throw(
					_("Students have already submitted; close the assignment instead of unpublishing it.")
				)
		if self.status == "Published" and not self.open_date:
			self.open_date = now_datetime()
		if before and get_datetime(before.due_date) != get_datetime(self.due_date):
			self.reminder_sent_on = None

	def validate_scores(self):
		if flt(self.max_score) <= 0:
			frappe.throw(_("Maximum score must be greater than zero."))
		for field in ("late_penalty_percent_per_day", "max_late_penalty_percent"):
			if flt(self.get(field)) < 0 or flt(self.get(field)) > 100:
				frappe.throw(_("{0} must be between 0 and 100.").format(_(self.meta.get_label(field))))
		if self.has_value_changed("max_score") and not self.is_new():
			highest = frappe.get_all(
				"Assignment Submission",
				filters={"assignment": self.name, "raw_score": [">", flt(self.max_score)]},
				pluck="name",
				limit=1,
			)
			if highest:
				frappe.throw(_("Some submissions already score above {0}.").format(flt(self.max_score)))

	def validate_dates(self):
		due = get_datetime(self.due_date)
		if self.open_date and get_datetime(self.open_date) >= due:
			frappe.throw(_("The open date must be before the due date."))
		if cint(self.allow_late):
			if self.late_cutoff and get_datetime(self.late_cutoff) < due:
				frappe.throw(_("The late submission cut-off cannot be before the due date."))
		else:
			self.late_cutoff = None

	def on_update(self):
		before = self.get_doc_before_save()
		if self.status == "Published" and (before is None or before.status == "Draft"):
			from mahanaim.services.assessments import notify_published

			notify_published(self)

	def on_trash(self):
		if frappe.db.exists("Assignment Submission", {"assignment": self.name}):
			frappe.throw(_("This assignment has submissions and cannot be deleted. Close it instead."))
