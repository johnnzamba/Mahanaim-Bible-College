# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import math

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, flt

from mahanaim.utils import setting


class Programme(Document):
	def before_insert(self):
		self.code = (self.code or "").strip().upper()

	def validate(self):
		self.code = (self.code or "").strip().upper()
		self.programme_name = (self.programme_name or "").strip()
		if flt(self.duration_years) <= 0:
			frappe.throw(_("Duration (years) must be greater than zero."))
		if cint(self.terms_per_year) < 1:
			frappe.throw(_("Terms per year must be at least 1."))
		if flt(self.min_cgpa_to_graduate) < 0:
			frappe.throw(_("Minimum CGPA to graduate cannot be negative."))
		self.validate_curriculum()
		if not flt(self.application_fee):
			self.application_fee = flt(setting("application_fee", 0))

	def validate_curriculum(self):
		courses = [r.course for r in self.curriculum if r.course]
		info = {
			c.name: c
			for c in frappe.get_all(
				"Course",
				filters={"name": ["in", courses or [""]]},
				fields=["name", "course_title", "credits"],
			)
		}
		max_year = max(1, math.ceil(flt(self.duration_years) - 1e-9))
		seen = set()
		for row in self.curriculum:
			if row.course in seen:
				frappe.throw(
					_("Row {0}: course {1} appears more than once in the curriculum.").format(
						row.idx, row.course
					)
				)
			seen.add(row.course)
			course = info.get(row.course)
			if not course:
				frappe.throw(_("Row {0}: course {1} does not exist.").format(row.idx, row.course))
			row.course_title = course.course_title
			row.credits = flt(course.credits)
			if cint(row.year_of_study) < 1 or cint(row.year_of_study) > max_year:
				frappe.throw(
					_(
						"Row {0}: year of study for {1} must be between 1 and {2} (programme duration)."
					).format(row.idx, row.course, max_year)
				)
			if cint(row.term_number) < 1 or cint(row.term_number) > cint(self.terms_per_year):
				frappe.throw(
					_("Row {0}: term number for {1} must be between 1 and {2} (terms per year).").format(
						row.idx, row.course, cint(self.terms_per_year)
					)
				)
		self.curriculum.sort(key=lambda r: (cint(r.year_of_study), cint(r.term_number), cint(r.idx)))
		for i, row in enumerate(self.curriculum, 1):
			row.idx = i
		self.total_credits = round(sum(flt(r.credits) for r in self.curriculum), 2)
