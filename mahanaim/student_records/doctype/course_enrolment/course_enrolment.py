# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, nowdate

from mahanaim.services import students as svc

LEFT = ("Dropped", "Withdrawn")


class CourseEnrolment(Document):
	def validate(self):
		offering = frappe.db.get_value(
			"Course Offering",
			self.course_offering,
			["course", "academic_term", "capacity", "status"],
			as_dict=True,
		)
		if not offering:
			frappe.throw(
				_("Course offering {0} not found.").format(self.course_offering), frappe.DoesNotExistError
			)
		self.course = offering.course
		self.academic_term = offering.academic_term
		self.student_name = frappe.db.get_value("Student", self.student, "full_name")
		self.validate_unique()
		if self.status == "Enrolled":
			self.enrolled_on = self.enrolled_on or nowdate()
			if self.is_new() or self.has_value_changed("status") or self.has_value_changed("course_offering"):
				self.validate_capacity(offering)

	def validate_unique(self):
		clash = frappe.db.get_value(
			"Course Enrolment",
			{
				"student": self.student,
				"course_offering": self.course_offering,
				"name": ["!=", self.name or ""],
			},
			"name",
		)
		if clash:
			frappe.throw(
				_("{0} is already enrolled in this course offering ({1}).").format(
					self.student_name or self.student, clash
				),
				frappe.DuplicateEntryError,
			)

	def validate_capacity(self, offering):
		if self.flags.ignore_capacity or not cint(offering.capacity):
			return
		taken = frappe.db.count(
			"Course Enrolment",
			{"course_offering": self.course_offering, "status": "Enrolled", "name": ["!=", self.name or ""]},
		)
		if taken >= cint(offering.capacity):
			frappe.throw(
				_("This course offering is full ({0} places).").format(offering.capacity),
				title=_("Course full"),
			)

	def on_update(self):
		before = self.get_doc_before_save()
		svc.refresh_enrolled_count(self.course_offering)
		if before is not None and before.course_offering != self.course_offering:
			svc.refresh_enrolled_count(before.course_offering)
		if self.flags.skip_lms:
			return
		was = before.status if before is not None else None
		if self.status == "Enrolled" and was != "Enrolled":
			svc.enqueue_lms(self.name, "enrol")
		elif self.status in LEFT and was == "Enrolled":
			svc.enqueue_lms(self.name, "unenrol")

	def on_trash(self):
		if self.status == "Enrolled" and not self.flags.skip_lms:
			# The record is about to disappear, so tell the LMS now rather than in a background job.
			svc.safe_call("mahanaim.services.lms_bridge.unenrol", self.name)

	def after_delete(self):
		svc.refresh_enrolled_count(self.course_offering)
