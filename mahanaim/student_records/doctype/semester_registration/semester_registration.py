# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, flt, now_datetime

from mahanaim.services import students as svc
from mahanaim.utils import is_staff, log_status, setting, validate_transition

OPEN_REGISTRATION = ("Draft", "Submitted")
BLOCKED_OFFERING_STATUSES = ("Cancelled", "Completed")


class SemesterRegistration(Document):
	def validate(self):
		student = frappe.db.get_value(
			"Student",
			self.student,
			["full_name", "programme", "campus", "study_mode", "status", "year_of_study"],
			as_dict=True,
		)
		if not student:
			frappe.throw(_("Student {0} not found.").format(self.student), frappe.DoesNotExistError)
		validate_transition(self, svc.REGISTRATION_TRANSITIONS)
		if self.status in OPEN_REGISTRATION or self.is_new() or self.has_value_changed("status"):
			self.student_name = student.full_name
			if self.status in OPEN_REGISTRATION:
				self.programme, self.campus, self.study_mode = (
					student.programme,
					student.campus,
					student.study_mode,
				)
			if not cint(self.year_of_study):
				self.year_of_study = cint(student.year_of_study) or 1
		self.set_course_details()
		self.total_credits = sum(flt(c.credits) for c in self.courses if c.status == "Registered")
		if self.status in OPEN_REGISTRATION or (
			self.has_value_changed("status") and self.status == "Approved"
		):
			self.validate_student_status(student)
			self.validate_unique()
			self.validate_courses(student)
			if self.status != "Approved":
				self.validate_window()
			if self.status == "Submitted" and self.has_value_changed("status"):
				self.validate_fee_clearance()
		if self.has_value_changed("status"):
			self.on_status_change()

	def on_update(self):
		if self.has_value_changed("status") and self.status == "Approved":
			svc.on_registration_approved(self)

	# ------------------------------------------------------------------ helpers
	@property
	def staff_override(self) -> bool:
		return bool(self.flags.ignore_registration_window) or is_staff()

	def set_course_details(self):
		offerings = [c.course_offering for c in self.courses if c.course_offering]
		info = {
			r.name: r
			for r in frappe.get_all(
				"Course Offering",
				filters={"name": ["in", offerings or [""]]},
				fields=["name", "course", "course_title", "credits"],
			)
		}
		courses = {
			r.name: r
			for r in frappe.get_all(
				"Course",
				filters={"name": ["in", [i.course for i in info.values()] or [""]]},
				fields=["name", "course_title", "credits"],
			)
		}
		for row in self.courses:
			off = info.get(row.course_offering)
			if not off:
				continue
			course = courses.get(off.course) or {}
			row.course = off.course
			row.course_title = off.course_title or course.get("course_title")
			row.credits = flt(off.credits) or flt(course.get("credits"))
			row.status = row.status or "Registered"

	def validate_student_status(self, student):
		if student.status not in svc.REGISTRABLE_STATUSES:
			frappe.throw(
				_("{0} is {1} and cannot register for courses.").format(student.full_name, _(student.status)),
				title=_("Not eligible"),
			)

	def validate_window(self):
		if self.staff_override:
			return
		from mahanaim.mahanaim_setup.doctype.academic_term.academic_term import registration_window

		term = frappe.db.get_value(
			"Academic Term",
			self.academic_term,
			["status", "registration_start", "registration_end", "late_registration_end"],
			as_dict=True,
		)
		window = registration_window(term or {})
		if not window["is_open"]:
			if window["state"] == "upcoming":
				msg = _("Registration for {0} opens on {1}.").format(
					self.academic_term, frappe.utils.formatdate(window["registration_start"])
				)
			else:
				msg = _("Registration for {0} is closed.").format(self.academic_term)
			frappe.throw(msg, title=_("Registration closed"))

	def validate_fee_clearance(self):
		"""Students with arrears from earlier terms cannot self-register (B3 contract; staff may override)."""
		if self.staff_override or self.flags.ignore_fee_clearance:
			return
		result = svc.safe_call("mahanaim.services.fees.fee_clearance", self.student, "registration")
		if isinstance(result, dict) and result.get("cleared") is False:
			frappe.throw(
				result.get("message") or _("Please clear your fee arrears before registering."),
				title=_("Fee clearance required"),
			)

	def validate_unique(self):
		clash = frappe.db.get_value(
			"Semester Registration",
			{
				"student": self.student,
				"academic_term": self.academic_term,
				"status": ["not in", ["Cancelled", "Rejected"]],
				"name": ["!=", self.name or ""],
			},
			"name",
		)
		if clash:
			frappe.throw(
				_("{0} already has a registration ({1}) for {2}.").format(
					self.student_name, clash, self.academic_term
				),
				frappe.DuplicateEntryError,
			)

	def validate_courses(self, student):
		active = [c for c in self.courses if c.status == "Registered"]
		if self.status in ("Submitted", "Approved") and not active:
			frappe.throw(_("Select at least one course."))
		seen_offerings, seen_courses = set(), set()
		for row in self.courses:
			if row.course_offering in seen_offerings or (
				row.status == "Registered" and row.course in seen_courses
			):
				frappe.throw(
					_("{0} is listed more than once.").format(row.course_title or row.course_offering)
				)
			seen_offerings.add(row.course_offering)
			if row.status == "Registered":
				seen_courses.add(row.course)
		if not active:
			return
		offerings = {
			r.name: r
			for r in frappe.get_all(
				"Course Offering",
				filters={"name": ["in", [c.course_offering for c in active]]},
				fields=[
					"name",
					"course",
					"course_title",
					"academic_term",
					"campus",
					"status",
					"capacity",
					"enrolled_count",
				],
			)
		}
		already = set(
			frappe.get_all(
				"Course Enrolment",
				filters={
					"student": self.student,
					"course_offering": ["in", list(offerings) or [""]],
					"status": "Enrolled",
				},
				pluck="course_offering",
			)
		)
		curriculum = svc.curriculum_for(student.programme)
		for row in active:
			off = offerings.get(row.course_offering)
			label = row.course_title or row.course_offering
			if not off:
				frappe.throw(_("Course offering {0} not found.").format(row.course_offering))
			if off.academic_term != self.academic_term:
				frappe.throw(_("{0} is not offered in {1}.").format(label, self.academic_term))
			if off.campus != student.campus:
				frappe.throw(
					_("{0} is offered at {1}, not your campus ({2}).").format(
						label, off.campus, student.campus
					)
				)
			if off.status in BLOCKED_OFFERING_STATUSES:
				frappe.throw(_("{0} is {1} and cannot be registered.").format(label, _(off.status).lower()))
			if not self.staff_override and curriculum and off.course not in curriculum:
				frappe.throw(_("{0} is not part of your programme's curriculum.").format(label))
			if (
				cint(off.capacity)
				and row.course_offering not in already
				and cint(off.enrolled_count) >= cint(off.capacity)
				and not self.flags.ignore_capacity
			):
				frappe.throw(
					_("{0} is full ({1} places).").format(label, off.capacity), title=_("Course full")
				)
			if not row.course_type or row.course_type == "Core":
				row.course_type = (
					(curriculum.get(off.course) or {}).get("course_type") or row.course_type or "Core"
				)

		missing = svc.missing_prerequisites(self.student, [c.course for c in active])
		if missing and not self.flags.ignore_prerequisites:
			lines = []
			for course, prereqs in missing.items():
				title = next((c.course_title for c in active if c.course == course), course)
				lines.append(
					_("{0} requires {1}").format(title, ", ".join(p["title"] or p["course"] for p in prereqs))
				)
			frappe.throw("<br>".join(lines), title=_("Prerequisites not met"))

		max_credits = flt(setting("max_credits_per_term", 24))
		total = sum(flt(c.credits) for c in active)
		if max_credits and total > max_credits and not self.flags.ignore_credit_limit:
			frappe.throw(
				_("You selected {0} credits; the maximum per term is {1}.").format(
					flt(total), flt(max_credits)
				),
				title=_("Credit limit exceeded"),
			)

	def on_status_change(self):
		before = self.get_doc_before_save()
		if self.status == "Approved":
			self.approved_by = frappe.session.user
			self.approved_on = now_datetime()
		elif self.status == "Submitted" and not self.is_new():
			self.approved_by = self.approved_on = None
		log_status(self, self.status, self.flags.status_note, from_status=before.status if before else None)
