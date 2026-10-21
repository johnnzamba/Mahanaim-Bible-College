# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, flt, getdate, nowdate


class ChapelService(Document):
	def validate(self):
		if self.status == "Held" and getdate(self.service_date) > getdate(nowdate()):
			frappe.throw(_("A service in the future cannot be marked as held."))
		for field in ("men", "women", "children", "visitors"):
			if cint(self.get(field)) < 0:
				frappe.throw(_("{0} cannot be negative.").format(_(self.meta.get_label(field))))
		if flt(self.offering_total) < 0:
			frappe.throw(_("The offering total cannot be negative."))
		if self.preacher_staff and not self.preacher:
			self.preacher = frappe.db.get_value("Staff Member", self.preacher_staff, "full_name")
		self.clean_attendance()
		self.set_totals()

	def clean_attendance(self):
		students = [r.student for r in self.attendance if r.student]
		names = (
			dict(
				frappe.get_all(
					"Student", filters={"name": ["in", students]}, fields=["name", "full_name"], as_list=True
				)
			)
			if students
			else {}
		)
		seen, rows = set(), []
		for row in self.attendance:
			if not row.student or row.student in seen:
				continue
			seen.add(row.student)
			row.student_name = names.get(row.student, row.student_name)
			row.status = row.status or "Present"
			rows.append(row)
		self.set("attendance", rows)

	def set_totals(self):
		headcount = sum(cint(self.get(f)) for f in ("men", "women", "children", "visitors"))
		present = sum(1 for r in self.attendance if r.status == "Present")
		self.total_attendance = max(headcount, present)

	@property
	def present_count(self) -> int:
		return sum(1 for r in self.attendance if r.status == "Present")
