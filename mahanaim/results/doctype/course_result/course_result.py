# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, flt, today


class CourseResult(Document):
	def validate(self):
		clash = frappe.db.get_value(
			"Course Result",
			{
				"student": self.student,
				"course_offering": self.course_offering,
				"attempt": self.attempt,
				"name": ["!=", self.name or ""],
			},
		)
		if clash:
			frappe.throw(
				_("A {0} result already exists for this course offering ({1}).").format(
					_(self.attempt), clash
				),
				frappe.DuplicateEntryError,
			)
		off = frappe.db.get_value(
			"Course Offering",
			self.course_offering,
			["course", "course_title", "academic_term", "academic_year", "credits"],
			as_dict=True,
		)
		if not off:
			frappe.throw(_("Course Offering {0} does not exist.").format(self.course_offering))
		self.course, self.course_title = off.course, off.course_title
		self.academic_term, self.academic_year = off.academic_term, off.academic_year
		self.credits = flt(off.credits)
		if flt(self.total_score) < 0 or flt(self.total_score) > 100:
			frappe.throw(_("Total score must be between 0 and 100."))
		if not self.grade and self.result_status not in ("Incomplete", "Absent"):
			from mahanaim.services.grading import grade_for

			g = grade_for(self.total_score)
			self.grade, self.grade_points = g["grade"], g["grade_points"]
		self.quality_points = round(flt(self.grade_points) * flt(self.credits), 2)
		if cint(self.is_published):
			self.published_on = self.published_on or today()
		else:
			self.published_on = None

	def on_update(self):
		if self.flags.skip_standing:
			return
		before = self.get_doc_before_save()
		if cint(self.is_published) or (before is not None and cint(before.is_published)):
			from mahanaim.services.grading import refresh_student_standing

			refresh_student_standing(self.student)

	def after_delete(self):
		if cint(self.is_published):
			from mahanaim.services.grading import refresh_student_standing

			refresh_student_standing(self.student)
