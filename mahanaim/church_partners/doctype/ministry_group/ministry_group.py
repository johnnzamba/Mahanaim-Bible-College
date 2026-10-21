# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import nowdate


class MinistryGroup(Document):
	def validate(self):
		self.group_name = " ".join((self.group_name or "").split())
		students = [r.student for r in self.members if r.student]
		if self.leader and self.leader not in students:
			self.append("members", {"student": self.leader, "role": "Leader", "joined_on": nowdate()})
			students.append(self.leader)
		names = (
			dict(
				frappe.get_all(
					"Student", filters={"name": ["in", students]}, fields=["name", "full_name"], as_list=True
				)
			)
			if students
			else {}
		)
		seen = set()
		for row in self.members:
			if row.student in seen:
				frappe.throw(
					_("{0} is listed twice in the members table.").format(names.get(row.student, row.student))
				)
			seen.add(row.student)
			row.student_name = names.get(row.student, row.student_name)
			row.joined_on = row.joined_on or nowdate()
			if self.leader and row.student == self.leader:
				row.role = "Leader"
			elif row.role == "Leader":
				row.role = "Member" if self.leader else row.role
		if self.patron and frappe.db.get_value("Staff Member", self.patron, "status") == "Inactive":
			frappe.throw(_("The patron must be an active staff member."))

	@property
	def member_count(self) -> int:
		return len(self.members)
