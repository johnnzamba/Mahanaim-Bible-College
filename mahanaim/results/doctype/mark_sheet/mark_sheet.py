# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, now_datetime

from mahanaim.services.results import (
	COMPONENTS,
	EDITABLE_STATUSES,
	SCORE_FIELD,
	SHEET_TRANSITIONS,
	WEIGHT_FIELD,
	evaluate_sheet_entries,
	publish_side_effects,
)
from mahanaim.utils import ROLE_ADMIN, ROLE_DEAN, ROLE_REGISTRAR, user_roles, validate_transition

APPROVERS = {"System Manager", ROLE_ADMIN, ROLE_DEAN}
PUBLISHERS = {"System Manager", ROLE_ADMIN, ROLE_REGISTRAR}
RETURNERS = APPROVERS | PUBLISHERS


def _require(roles: set, action: str):
	if frappe.session.user == "Administrator" or user_roles() & roles:
		return
	frappe.throw(_("You are not allowed to {0} mark sheets.").format(action), frappe.PermissionError)


class MarkSheet(Document):
	def validate(self):
		if not self.grading_scale:
			self.grading_scale = frappe.db.get_value("Course Offering", self.course_offering, "grading_scale")
		self.validate_weights()
		self.validate_entries()
		validate_transition(self, SHEET_TRANSITIONS)
		self.apply_transition()
		evaluate_sheet_entries(self)

	def validate_weights(self):
		total = 0.0
		for c in COMPONENTS:
			w = flt(self.get(WEIGHT_FIELD[c]))
			if w < 0 or w > 100:
				frappe.throw(
					_("{0} must be between 0 and 100.").format(_(self.meta.get_label(WEIGHT_FIELD[c])))
				)
			total += w
		if abs(total - 100) > 0.01:
			frappe.throw(_("Component weights must total 100% (currently {0}%).").format(round(total, 2)))

	def validate_entries(self):
		seen = set()
		for e in self.entries:
			if e.student in seen:
				frappe.throw(_("Student {0} appears twice on the mark sheet.").format(e.student))
			seen.add(e.student)
			for c in COMPONENTS:
				value, cap = flt(e.get(SCORE_FIELD[c])), flt(self.get(WEIGHT_FIELD[c]))
				if value < 0 or value > cap + 1e-6:
					frappe.throw(
						_("{0}: {1} must be between 0 and {2}.").format(
							e.student_name or e.student, _(self.meta.get_label(WEIGHT_FIELD[c])), cap
						)
					)
		before = self.get_doc_before_save()
		locked = before is not None and before.status not in EDITABLE_STATUSES
		if locked and self.signature(before) != self.signature(self):
			frappe.throw(_("Marks are locked while the mark sheet is {0}.").format(_(before.status)))

	@staticmethod
	def signature(doc) -> tuple:
		return (
			tuple(
				(e.student, *(flt(e.get(SCORE_FIELD[c])) for c in COMPONENTS), e.overridden_components)
				for e in doc.get("entries") or []
			),
			tuple(flt(doc.get(WEIGHT_FIELD[c])) for c in COMPONENTS),
		)

	def apply_transition(self):
		before = self.get_doc_before_save()
		if before is None or before.status == self.status:
			return
		now, user = now_datetime(), frappe.session.user
		if self.status == "Submitted":
			if not self.entries:
				frappe.throw(_("There are no students on this mark sheet."))
			self.submitted_by, self.submitted_on = user, now
			self.return_reason = None
		elif self.status == "Approved":
			_require(APPROVERS, _("approve"))
			self.approved_by, self.approved_on = user, now
		elif self.status == "Published":
			_require(PUBLISHERS, _("publish"))
			self.published_by, self.published_on = user, now
		elif self.status == "Returned":
			_require(RETURNERS, _("return"))
			if not (self.return_reason or "").strip():
				frappe.throw(_("Give a reason when returning a mark sheet."))
			self.approved_by = self.approved_on = None
			self.returned_by, self.returned_on = user, now

	def on_update(self):
		frappe.db.set_value(
			"Course Offering", self.course_offering, "results_status", self.status, update_modified=False
		)
		before = self.get_doc_before_save()
		if self.status == "Published" and (before is None or before.status != "Published"):
			publish_side_effects(self)

	def on_trash(self):
		if self.status == "Published":
			frappe.throw(_("A published mark sheet cannot be deleted."))
		frappe.db.set_value(
			"Course Offering", self.course_offering, "results_status", "Not Started", update_modified=False
		)
