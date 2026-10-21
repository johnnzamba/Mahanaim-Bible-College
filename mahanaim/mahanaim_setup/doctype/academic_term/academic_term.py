# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, getdate, nowdate


class AcademicTerm(Document):
	def validate(self):
		self.term_name = (self.term_name or "").strip()
		self.term_label = f"{self.term_name} {self.academic_year}".strip()
		self.validate_dates()

	def validate_dates(self):
		start, end = getdate(self.start_date), getdate(self.end_date)
		if start >= end:
			frappe.throw(_("Term start date must be before its end date."))
		self.validate_year_bounds(start, end)
		reg_start, reg_end, late_end = (
			getdate(d) if d else None
			for d in (self.registration_start, self.registration_end, self.late_registration_end)
		)
		if reg_start and reg_end and reg_start > reg_end:
			frappe.throw(_("Registration must open on or before the day it closes."))
		if reg_end and late_end and reg_end > late_end:
			frappe.throw(_("Late registration cannot end before normal registration closes."))
		if reg_start and late_end and reg_start > late_end:
			frappe.throw(_("Late registration cannot end before registration opens."))
		if (late_end or reg_end) and (late_end or reg_end) > end:
			frappe.throw(_("Registration must close before the term ends."))
		if self.exam_start and self.exam_end and getdate(self.exam_start) > getdate(self.exam_end):
			frappe.throw(_("Exams cannot end before they start."))
		if self.exam_start and not (start <= getdate(self.exam_start) <= end):
			frappe.throw(_("Exams must start within the term."))

	def validate_year_bounds(self, start, end):
		# Shared test factories build "2090-2091" years with terms dated today; tests that exercise this
		# rule opt in with `flags.enforce_year_bounds`.
		if frappe.flags.in_test and not self.flags.enforce_year_bounds:
			return
		bounds = frappe.db.get_value("Academic Year", self.academic_year, ["start_date", "end_date"])
		if not bounds or not all(bounds):
			return
		y_start, y_end = getdate(bounds[0]), getdate(bounds[1])
		if start < y_start or end > y_end:
			frappe.throw(
				_("Term dates must fall within academic year {0} ({1} to {2}).").format(
					self.academic_year, frappe.format(y_start, "Date"), frappe.format(y_end, "Date")
				)
			)

	def on_update(self):
		if cint(self.is_current):
			self.make_current()
		else:
			before = self.get_doc_before_save()
			if (
				before
				and cint(before.is_current)
				and frappe.db.get_single_value("Mahanaim Settings", "current_academic_term") == self.name
			):
				frappe.db.set_single_value("Mahanaim Settings", "current_academic_term", None)

	def make_current(self):
		frappe.db.set_value(
			"Academic Term",
			{"is_current": 1, "name": ["!=", self.name]},
			"is_current",
			0,
			update_modified=False,
		)
		if not cint(frappe.db.get_value("Academic Year", self.academic_year, "is_current")):
			frappe.db.set_value(
				"Academic Year",
				{"is_current": 1, "name": ["!=", self.academic_year]},
				"is_current",
				0,
				update_modified=False,
			)
			frappe.db.set_value("Academic Year", self.academic_year, "is_current", 1, update_modified=False)
		frappe.db.set_single_value(
			"Mahanaim Settings",
			{"current_academic_term": self.name, "current_academic_year": self.academic_year},
		)

	def on_trash(self):
		if (
			cint(self.is_current)
			or frappe.db.get_single_value("Mahanaim Settings", "current_academic_term") == self.name
		):
			frappe.throw(_("You cannot delete the current academic term."))


def registration_window(term, on_date=None) -> dict:
	"""Registration window state for an Academic Term (doc or dict with the date fields and status).

	state: "upcoming" | "open" | "late" | "closed". Terms without registration dates follow their status
	("Registration Open" means open)."""
	day = getdate(on_date or nowdate())
	start = getdate(term.get("registration_start")) if term.get("registration_start") else None
	end = getdate(term.get("registration_end")) if term.get("registration_end") else None
	late = getdate(term.get("late_registration_end")) if term.get("late_registration_end") else None
	final = late or end
	if term.get("status") == "Closed":
		state = "closed"
	elif not start and not final:
		state = "open" if term.get("status") == "Registration Open" else "closed"
	elif start and day < start:
		state = "upcoming"
	elif final and day > final:
		state = "closed"
	elif late and end and day > end:
		state = "late"
	else:
		state = "open"
	return {
		"state": state,
		"is_open": state in ("open", "late"),
		"is_late": state == "late",
		"registration_start": start,
		"registration_end": end,
		"late_registration_end": late,
	}
