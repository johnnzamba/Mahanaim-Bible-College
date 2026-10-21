# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, getdate, now_datetime, today

from mahanaim.services import students as svc
from mahanaim.utils import current_term, log_status, validate_transition

OPEN_REQUEST = ("Pending", "Under Review")
# Request types a student may have several of at the same time.
MULTI_OPEN_TYPES = ("Document Request", "Transcript Request", "Course Drop", "Other")


class StudentRequest(Document):
	def validate(self):
		student = frappe.db.get_value(
			"Student", self.student, ["full_name", "programme", "campus", "current_term"], as_dict=True
		)
		if not student:
			frappe.throw(_("Student {0} not found.").format(self.student), frappe.DoesNotExistError)
		self.student_name = student.full_name
		if self.is_new():
			self.validate_request_details(student)
			if self.request_type == "Clearance":
				svc.populate_clearance(self)
		for row in self.get("clearance") or []:
			if row.status == "Cleared" and not row.cleared_on:
				row.cleared_on = now_datetime()
		validate_transition(self, svc.REQUEST_TRANSITIONS)
		self.track_status()

	def on_update(self):
		before = self.get_doc_before_save()
		if before is None or before.status == self.status:
			return
		if self.status == "Approved":
			svc.apply_request_effect(self)
		if not self.flags.mute_notifications:
			svc.request_status_notify(self)

	def validate_request_details(self, student):
		kind = self.request_type
		if self.from_date and self.to_date and getdate(self.to_date) < getdate(self.from_date):
			frappe.throw(_("The end date cannot be before the start date."))
		if kind in ("Deferment", "Withdrawal", "Resumption", "Course Drop") and not self.academic_term:
			self.academic_term = student.current_term or current_term()
		if kind == "Programme Transfer":
			if not self.new_programme:
				frappe.throw(_("Choose the programme you want to transfer to."))
			if self.new_programme == student.programme:
				frappe.throw(_("You are already in {0}.").format(self.new_programme))
		if kind == "Campus Transfer":
			if not self.new_campus:
				frappe.throw(_("Choose the campus you want to transfer to."))
			if self.new_campus == student.campus:
				frappe.throw(_("You are already at {0}.").format(self.new_campus))
		if kind == "Course Drop":
			if not self.course_enrolment:
				frappe.throw(_("Choose the course you want to drop."))
			enrolment = frappe.db.get_value(
				"Course Enrolment",
				self.course_enrolment,
				["student", "status", "academic_term"],
				as_dict=True,
			)
			if not enrolment or enrolment.student != self.student:
				frappe.throw(
					_("That course enrolment does not belong to this student."), frappe.PermissionError
				)
			if enrolment.status != "Enrolled":
				frappe.throw(_("You can only drop a course you are currently enrolled in."))
			self.academic_term = enrolment.academic_term
		if kind in ("Document Request", "Transcript Request"):
			self.copies = max(cint(self.copies), 1)
			if kind == "Document Request" and not self.document_type:
				frappe.throw(_("Which document do you need?"))
		if kind not in MULTI_OPEN_TYPES:
			clash = frappe.db.get_value(
				"Student Request",
				{"student": self.student, "request_type": kind, "status": ["in", OPEN_REQUEST]},
				"name",
			)
			if clash:
				frappe.throw(
					_("There is already an open {0} request ({1}).").format(_(kind).lower(), clash),
					frappe.DuplicateEntryError,
				)
		if kind == "Course Drop":
			clash = frappe.db.get_value(
				"Student Request",
				{
					"course_enrolment": self.course_enrolment,
					"request_type": kind,
					"status": ["in", OPEN_REQUEST],
				},
				"name",
			)
			if clash:
				frappe.throw(_("A drop request for this course is already open ({0}).").format(clash))

	def track_status(self):
		if self.is_new():
			log_status(self, self.status, self.flags.status_note or _("Request submitted"), from_status=None)
			return
		before = self.get_doc_before_save()
		if before is None or before.status == self.status:
			return
		if self.status in ("Approved", "Rejected"):
			self.reviewer = frappe.session.user
			self.decision_date = today()
		if self.status == "Approved":
			svc.validate_request_effect(self)
		log_status(self, self.status, self.flags.status_note, from_status=before.status)
