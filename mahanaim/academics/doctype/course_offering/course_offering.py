# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, flt, getdate

from mahanaim.academics.doctype.course.course import validate_weight_rows
from mahanaim.utils import validate_transition

TRANSITIONS = {
	"Planned": ("Open", "In Progress", "Cancelled"),
	"Open": ("Planned", "In Progress", "Completed", "Cancelled"),
	"In Progress": ("Open", "Completed", "Cancelled"),
	"Completed": ("In Progress",),
	"Cancelled": ("Planned",),
}


class CourseOffering(Document):
	def validate(self):
		self.section = (self.section or "A").strip().upper()
		self.set_course_details()
		self.set_term_details()
		self.validate_unique()
		if cint(self.capacity) < 0:
			frappe.throw(_("Capacity cannot be negative."))
		self.set_lecturers()
		if not self.assessment_weights:
			for row in frappe.get_all(
				"Assessment Weight",
				filters={"parent": self.course, "parenttype": "Course"},
				fields=["component", "weight", "label"],
				order_by="idx asc",
			):
				self.append("assessment_weights", row)
		validate_weight_rows(self.assessment_weights, _("Offering"))
		validate_transition(self, TRANSITIONS)
		if not self.is_new() and (
			self.has_value_changed("course") or self.has_value_changed("academic_term")
		):
			if frappe.db.exists("Course Enrolment", {"course_offering": self.name}):
				frappe.throw(
					_("Students are enrolled in this offering; its course and term can no longer change.")
				)
		if self.status == "Cancelled" and not self.is_new() and self.has_value_changed("status"):
			enrolled = frappe.db.count(
				"Course Enrolment", {"course_offering": self.name, "status": "Enrolled"}
			)
			if enrolled:
				frappe.throw(
					_(
						"{0} student(s) are still enrolled. Drop or move them before cancelling this offering."
					).format(enrolled)
				)

	def set_course_details(self):
		course = frappe.db.get_value(
			"Course", self.course, ["course_title", "credits", "is_active"], as_dict=True
		)
		if not course:
			frappe.throw(_("Course {0} does not exist.").format(self.course))
		if self.is_new() and not cint(course.is_active):
			frappe.throw(_("Course {0} is inactive and cannot be offered.").format(self.course))
		self.course_title = course.course_title
		self.credits = flt(course.credits)

	def set_term_details(self):
		term = frappe.db.get_value(
			"Academic Term", self.academic_term, ["academic_year", "start_date", "end_date"], as_dict=True
		)
		if not term:
			frappe.throw(_("Academic Term {0} does not exist.").format(self.academic_term))
		self.academic_year = term.academic_year
		self.start_date = self.start_date or term.start_date
		self.end_date = self.end_date or term.end_date
		if self.start_date and self.end_date and getdate(self.start_date) > getdate(self.end_date):
			frappe.throw(_("Start date cannot be after the end date."))

	def validate_unique(self):
		filters = {
			"course": self.course,
			"academic_term": self.academic_term,
			"campus": self.campus,
			"section": self.section,
			"study_mode": self.study_mode if self.study_mode else ["is", "not set"],
			"name": ["!=", self.name or ""],
		}
		clash = frappe.db.get_value("Course Offering", filters, "name")
		if clash:
			frappe.throw(
				_("{0} is already offered in {1} at this campus (section {2}, {3}): {4}").format(
					self.course, self.academic_term, self.section, self.study_mode or _("any mode"), clash
				),
				frappe.DuplicateEntryError,
			)

	def set_lecturers(self):
		staff = [r.staff_member for r in self.lecturers if r.staff_member]
		info = {
			s.name: s
			for s in frappe.get_all(
				"Staff Member", filters={"name": ["in", staff or [""]]}, fields=["name", "full_name", "user"]
			)
		}
		seen = set()
		for row in self.lecturers:
			if row.staff_member in seen:
				frappe.throw(_("Lecturer {0} is listed twice.").format(row.staff_member))
			seen.add(row.staff_member)
			s = info.get(row.staff_member)
			if not s:
				frappe.throw(_("Staff Member {0} does not exist.").format(row.staff_member))
			row.staff_name = s.full_name
			row.user = s.user
			row.role = row.role or "Lead"

	def on_update(self):
		if self.status == "Cancelled":
			return
		watched = ("course", "academic_term", "description", "lecturers", "status")
		if not (
			self.is_new()
			or self.lms_sync_status != "Synced"
			or any(self.has_value_changed(f) for f in watched)
		):
			return
		settings = frappe.db.get_singles_dict("LMS Bridge Settings") or {}
		if cint(settings.get("enabled")) and cint(settings.get("auto_create_courses")):
			frappe.enqueue(
				"mahanaim.services.lms_bridge.sync_offering",
				offering=self.name,
				queue="short",
				job_id=f"mbc-lms-sync-{self.name}",
				deduplicate=True,
				enqueue_after_commit=True,
			)

	def on_trash(self):
		if self.results_status == "Published":
			frappe.throw(_("Results for this offering have been published; it cannot be deleted."))
