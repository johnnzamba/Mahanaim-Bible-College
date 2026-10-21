# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, flt, get_datetime, time_diff_in_seconds

from mahanaim.utils import validate_transition

TRANSITIONS = {
	"Draft": ("Scheduled", "Cancelled"),
	"Scheduled": ("Draft", "Open", "Cancelled"),
	"Open": ("Closed", "Cancelled"),
	"Closed": ("Marking", "Released", "Open"),
	"Marking": ("Released", "Closed"),
	"Released": ("Marking",),
	"Cancelled": ("Draft",),
}
EDITABLE_PAPER = ("Draft", "Scheduled")
FINAL_TYPES = ("Main Exam", "Special", "Supplementary")


class Exam(Document):
	def validate(self):
		self.title = (self.title or "").strip()
		offering = frappe.db.get_value(
			"Course Offering",
			self.course_offering,
			["course", "course_title", "academic_term", "status"],
			as_dict=True,
		)
		if not offering:
			frappe.throw(_("Course Offering {0} does not exist.").format(self.course_offering))
		if offering.status == "Cancelled" and self.status != "Cancelled":
			frappe.throw(_("This course offering has been cancelled."))
		self.course_title = offering.course_title
		self.academic_term = offering.academic_term
		if self.exam_type in FINAL_TYPES and self.assessment_component == "CAT":
			self.assessment_component = "Exam"
		if not self.created_by_staff:
			self.created_by_staff = frappe.db.get_value("Staff Member", {"user": frappe.session.user}, "name")
		self.access_code = (self.access_code or "").strip() or None
		self.validate_schedule()
		validate_transition(self, TRANSITIONS)
		self.validate_questions(offering.course)
		if self.status == "Scheduled" and self.delivery_mode == "Online" and not self.questions:
			frappe.throw(_("Add questions before scheduling an online exam."))
		if self.status == "Cancelled" and self.has_value_changed("status"):
			if frappe.db.exists("Exam Attempt", {"exam": self.name, "status": ["!=", "Void"]}):
				frappe.throw(_("Students have already attempted this exam; it cannot be cancelled."))

	def validate_schedule(self):
		start, end = get_datetime(self.start_datetime), get_datetime(self.end_datetime)
		if start >= end:
			frappe.throw(_("The exam must end after it starts."))
		if cint(self.duration_minutes) <= 0:
			frappe.throw(_("Duration must be greater than zero."))
		window = time_diff_in_seconds(end, start) / 60.0
		if cint(self.duration_minutes) > window + 1e-6:
			frappe.throw(
				_("Duration ({0} min) cannot exceed the exam window ({1} min).").format(
					cint(self.duration_minutes), int(window)
				)
			)
		if cint(self.max_attempts) < 1:
			self.max_attempts = 1
		if flt(self.pass_mark) < 0 or flt(self.pass_mark) > 100:
			frappe.throw(_("Pass mark must be a percentage between 0 and 100."))

	def validate_questions(self, course: str):
		before = self.get_doc_before_save()
		changed = before is not None and self.paper_signature(self) != self.paper_signature(before)
		if changed and before.status not in EDITABLE_PAPER:
			frappe.throw(_("Questions cannot be changed once the exam has opened."))
		names = [r.question for r in self.questions]
		info = {
			q.name: q
			for q in frappe.get_all(
				"Question",
				filters={"name": ["in", names or [""]]},
				fields=["name", "course", "question_type", "topic", "marks", "is_active"],
			)
		}
		seen = set()
		for row in self.questions:
			if row.question in seen:
				frappe.throw(_("Question {0} is included twice.").format(row.question))
			seen.add(row.question)
			q = info.get(row.question)
			if not q:
				frappe.throw(_("Question {0} does not exist.").format(row.question))
			if q.course != course:
				frappe.throw(
					_("Question {0} belongs to another course ({1}).").format(row.question, q.course)
				)
			row.question_type = q.question_type
			row.topic = q.topic
			if flt(row.marks) <= 0:
				row.marks = flt(q.marks)
		count = cint(self.random_question_count)
		if count < 0:
			frappe.throw(_("Random question count cannot be negative."))
		if count and count > len(self.questions):
			frappe.throw(
				_("Random question count ({0}) cannot exceed the number of questions ({1}).").format(
					count, len(self.questions)
				)
			)
		marks = [flt(r.marks) for r in self.questions]
		if count and count < len(marks):
			self.total_marks = round(count * sum(marks) / len(marks), 2)
		else:
			self.total_marks = round(sum(marks), 2)

	@staticmethod
	def paper_signature(doc) -> tuple:
		return (
			tuple((r.question, flt(r.marks)) for r in doc.get("questions") or []),
			cint(doc.get("random_question_count")),
		)

	def on_update(self):
		before = self.get_doc_before_save()
		if self.status == "Scheduled" and (before is None or before.status in ("Draft", "Cancelled")):
			from mahanaim.services.exams import notify_scheduled

			notify_scheduled(self)

	def on_trash(self):
		if frappe.db.exists("Exam Attempt", {"exam": self.name}):
			frappe.throw(_("This exam has attempts and cannot be deleted. Cancel or close it instead."))
