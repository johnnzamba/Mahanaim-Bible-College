# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, flt

from mahanaim.services.assessments import (
	GRADED_STATUSES,
	days_late_for,
	final_score_for,
	penalty_for,
)


class AssignmentSubmission(Document):
	def validate(self):
		a = frappe.db.get_value(
			"Assignment",
			self.assignment,
			[
				"title",
				"course_offering",
				"due_date",
				"max_score",
				"allow_late",
				"late_penalty_percent_per_day",
				"max_late_penalty_percent",
			],
			as_dict=True,
		)
		if not a:
			frappe.throw(_("Assignment {0} does not exist.").format(self.assignment))
		clash = frappe.db.get_value(
			"Assignment Submission",
			{"assignment": self.assignment, "student": self.student, "name": ["!=", self.name or ""]},
		)
		if clash:
			frappe.throw(
				_("This student already has a submission for this assignment ({0}).").format(clash),
				frappe.DuplicateEntryError,
			)
		self.assignment_title = a.title
		self.course_offering = a.course_offering
		self.days_late = days_late_for(self.submitted_on, a.due_date) if self.submitted_on else 0
		self.is_late = 1 if self.days_late > 0 else 0
		if self.status == "Submitted" and self.is_late:
			self.status = "Late"
		if self.status in GRADED_STATUSES:
			if flt(self.raw_score) < 0 or flt(self.raw_score) > flt(a.max_score):
				frappe.throw(_("Score must be between 0 and {0}.").format(flt(a.max_score)))
			self.penalty = penalty_for(
				self.raw_score, self.days_late, a.late_penalty_percent_per_day, a.max_late_penalty_percent
			)
			self.final_score = final_score_for(self.raw_score, self.penalty)
		else:
			self.penalty = 0
			self.final_score = 0
			if cint(self.released):
				frappe.throw(_("Only graded submissions can be released to the student."))

	def on_update(self):
		before = self.get_doc_before_save()
		if (
			cint(self.released)
			and self.status in GRADED_STATUSES
			and (before is None or not cint(before.released))
		):
			from mahanaim.services.assessments import notify_graded

			notify_graded(self)
		if not self.flags.skip_counters:
			from mahanaim.services.assessments import refresh_assignment_counters

			refresh_assignment_counters(self.assignment)

	def after_delete(self):
		from mahanaim.services.assessments import refresh_assignment_counters

		refresh_assignment_counters(self.assignment)
