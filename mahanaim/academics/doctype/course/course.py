# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt

WEIGHT_TOLERANCE = 0.01


def find_prerequisite_cycle(course: str, prerequisites, graph: dict) -> list[str] | None:
	"""Pure: return a cycle path [course, ..., course] if giving `course` these `prerequisites` closes a loop.

	`graph` maps every other course to the list of its (stored) prerequisites."""
	edges = dict(graph)
	edges[course] = list(prerequisites)
	stack = [(p, [course, p]) for p in prerequisites]
	visited = set()
	while stack:
		node, path = stack.pop()
		if node == course:
			return path
		if node in visited:
			continue
		visited.add(node)
		for nxt in edges.get(node, []):
			stack.append((nxt, [*path, nxt]))
	return None


def validate_weight_rows(rows, label: str):
	"""Shared by Course and Course Offering: unique components, positive weights totalling 100."""
	rows = list(rows or [])
	if not rows:
		return
	seen = set()
	for row in rows:
		if row.component in seen:
			frappe.throw(_("{0}: assessment component {1} is listed twice.").format(label, _(row.component)))
		seen.add(row.component)
		if flt(row.weight) <= 0 or flt(row.weight) > 100:
			frappe.throw(_("{0}: weight for {1} must be between 0 and 100.").format(label, _(row.component)))
	total = sum(flt(r.weight) for r in rows)
	if abs(total - 100) > WEIGHT_TOLERANCE:
		frappe.throw(
			_("{0}: assessment weights must total 100% (currently {1}%).").format(label, round(total, 2))
		)


class Course(Document):
	def before_insert(self):
		self.course_code = (self.course_code or "").strip().upper()

	def validate(self):
		self.course_code = (self.course_code or "").strip().upper()
		self.course_title = (self.course_title or "").strip()
		if flt(self.credits) <= 0:
			frappe.throw(_("Credits must be greater than zero."))
		if flt(self.pass_mark) < 0 or flt(self.pass_mark) > 100:
			frappe.throw(_("Pass mark must be between 0 and 100."))
		self.validate_prerequisites()
		validate_weight_rows(self.assessment_weights, _("Course {0}").format(self.course_code))

	def validate_prerequisites(self):
		me = self.name or self.course_code
		seen = set()
		for row in self.prerequisites:
			if row.prerequisite in (me, self.course_code):
				frappe.throw(_("A course cannot be its own prerequisite."))
			if row.prerequisite in seen:
				frappe.throw(_("Prerequisite {0} is listed twice.").format(row.prerequisite))
			seen.add(row.prerequisite)
		if not seen:
			return
		graph = {}
		for edge in frappe.get_all(
			"Course Prerequisite",
			filters={"parenttype": "Course", "parent": ["!=", me]},
			fields=["parent", "prerequisite"],
		):
			graph.setdefault(edge.parent, []).append(edge.prerequisite)
		cycle = find_prerequisite_cycle(me, [r.prerequisite for r in self.prerequisites], graph)
		if cycle:
			frappe.throw(
				_("Circular prerequisite chain: {0}").format(" → ".join(cycle)),
				title=_("Invalid prerequisites"),
			)
