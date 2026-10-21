# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import get_time

from mahanaim.utils import validate_transition

TRANSITIONS = {
	"Scheduled": ("Held", "Cancelled", "Rescheduled"),
	"Rescheduled": ("Scheduled", "Held", "Cancelled"),
	"Held": ("Scheduled",),
	"Cancelled": ("Scheduled",),
}
ATTENDANCE_STATUSES = ("Present", "Absent", "Late", "Excused")


class ClassSession(Document):
	def validate(self):
		if not self.start_time or not self.end_time or get_time(self.start_time) >= get_time(self.end_time):
			frappe.throw(_("The session must end after it starts."))
		offering = frappe.db.get_value(
			"Course Offering", self.course_offering, ["status", "course_title"], as_dict=True
		)
		if not offering:
			frappe.throw(_("Course Offering {0} does not exist.").format(self.course_offering))
		if offering.status == "Cancelled" and self.status != "Cancelled":
			frappe.throw(_("This course offering has been cancelled."))
		self.course_title = offering.course_title
		self.topic = (self.topic or "").strip() or None
		self.validate_meeting_link()
		validate_transition(self, TRANSITIONS)
		if self.status != "Cancelled":
			self.validate_clashes()
		self.validate_attendance()

	def validate_meeting_link(self):
		link = (self.meeting_link or "").strip()
		if self.mode == "In Person":
			self.meeting_link = link or None
			return
		if self.mode == "Online" and not link:
			frappe.throw(_("Add the meeting link for an online session."))
		if link and not link.lower().startswith(("https://", "http://")):
			frappe.throw(_("The meeting link must start with https://"))
		self.meeting_link = link or None

	def validate_clashes(self):
		base = {
			"session_date": self.session_date,
			"status": ["!=", "Cancelled"],
			"name": ["!=", self.name or ""],
			"start_time": ["<", self.end_time],
			"end_time": [">", self.start_time],
		}
		clash = frappe.db.get_value(
			"Class Session", {**base, "course_offering": self.course_offering}, "name"
		)
		if clash:
			frappe.throw(_("This course already has a session at that time ({0}).").format(clash))
		if self.venue and self.mode != "Online":
			clash = frappe.db.get_value(
				"Class Session",
				{**base, "venue": self.venue, "mode": ["!=", "Online"]},
				["name", "course_title"],
				as_dict=True,
			)
			if clash:
				frappe.throw(
					_("{0} is already booked at that time for {1} ({2}).").format(
						self.venue, clash.course_title, clash.name
					)
				)
		if self.lecturer:
			clash = frappe.db.get_value(
				"Class Session", {**base, "lecturer": self.lecturer}, ["name", "course_title"], as_dict=True
			)
			if clash:
				frappe.throw(
					_("The lecturer already teaches {0} at that time ({1}).").format(
						clash.course_title, clash.name
					)
				)

	def validate_attendance(self):
		if not self.attendance:
			self.attendance_taken = 0
			self.present_count = self.absent_count = 0
			return
		seen = set()
		for row in self.attendance:
			if row.student in seen:
				frappe.throw(_("Student {0} appears twice in the attendance list.").format(row.student))
			seen.add(row.student)
			if row.status not in ATTENDANCE_STATUSES:
				frappe.throw(_("Invalid attendance status {0}.").format(row.status))
		self.attendance_taken = 1
		self.present_count = len([r for r in self.attendance if r.status in ("Present", "Late")])
		self.absent_count = len([r for r in self.attendance if r.status == "Absent"])
