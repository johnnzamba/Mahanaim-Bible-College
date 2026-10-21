# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt

from mahanaim.utils import validate_transition

TRANSITIONS = {
	"In Progress": ("Submitted", "Auto Submitted", "Marking", "Marked", "Void"),
	"Submitted": ("Marking", "Marked", "Void"),
	"Auto Submitted": ("Marking", "Marked", "Void"),
	"Marking": ("Marked", "Void"),
	"Marked": ("Marking", "Released", "Void"),
	"Released": ("Marking", "Marked"),
	"Void": (),
}


class ExamAttempt(Document):
	def validate(self):
		if self.is_new():
			clash = frappe.db.exists(
				"Exam Attempt", {"exam": self.exam, "student": self.student, "status": "In Progress"}
			)
			if clash:
				frappe.throw(_("The student already has an attempt in progress ({0}).").format(clash))
		validate_transition(self, TRANSITIONS)
		for a in self.answers:
			if flt(a.marks_awarded) < 0 or flt(a.marks_awarded) > flt(a.max_marks) + 1e-9:
				frappe.throw(
					_("Marks for question {0} must be between 0 and {1}.").format(
						a.question, flt(a.max_marks)
					)
				)
