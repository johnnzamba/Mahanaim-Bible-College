# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, now_datetime


class LearningProgress(Document):
	def validate(self):
		clash = frappe.db.get_value(
			"Learning Progress",
			{
				"student": self.student,
				"learning_resource": self.learning_resource,
				"name": ["!=", self.name or ""],
			},
		)
		if clash:
			frappe.throw(_("Progress for this resource is already recorded."), frappe.DuplicateEntryError)
		self.course_offering = frappe.db.get_value(
			"Learning Resource", self.learning_resource, "course_offering"
		)
		self.progress = max(0.0, min(100.0, flt(self.progress)))
		if self.status == "Completed":
			self.progress = 100
		elif self.progress >= 100:
			self.status = "Completed"
		elif self.progress > 0 and self.status == "Not Started":
			self.status = "In Progress"
		self.last_accessed = now_datetime()
