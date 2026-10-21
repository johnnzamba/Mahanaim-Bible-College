# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

from itertools import pairwise

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt

MAX_GAP = 1.0  # tolerate integer bands (0-39, 40-49) and .99 gaps (0-39.99, 40-49.99)
_EPS = 1e-9


def band_errors(bands) -> list[str]:
	"""Pure: problems with a list of {grade, min_score, max_score, grade_points} bands (empty list = valid)."""
	if not bands:
		return [_("Add at least one grade band.")]
	errors, grades = [], set()
	for b in bands:
		label = b.get("grade") or "?"
		key = (b.get("grade") or "").strip().casefold()
		if key in grades:
			errors.append(_("Grade {0} is listed twice.").format(label))
		grades.add(key)
		lo, hi = flt(b.get("min_score")), flt(b.get("max_score"))
		if lo < 0 or hi > 100 or lo > hi:
			errors.append(_("Band {0}: scores must satisfy 0 ≤ min ≤ max ≤ 100.").format(label))
		if flt(b.get("grade_points")) < 0:
			errors.append(_("Band {0}: grade points cannot be negative.").format(label))
	ordered = sorted(bands, key=lambda b: flt(b.get("min_score")))
	if flt(ordered[0].get("min_score")) > _EPS:
		errors.append(_("The lowest band must start at 0."))
	if flt(ordered[-1].get("max_score")) < 100 - _EPS:
		errors.append(_("The highest band must end at 100."))
	for prev, nxt in pairwise(ordered):
		gap = flt(nxt.get("min_score")) - flt(prev.get("max_score"))
		if gap < -_EPS:
			errors.append(_("Bands {0} and {1} overlap.").format(prev.get("grade"), nxt.get("grade")))
		elif gap > MAX_GAP + _EPS:
			errors.append(
				_("There is a gap between {0} (max {1}) and {2} (min {3}).").format(
					prev.get("grade"), flt(prev.get("max_score")), nxt.get("grade"), flt(nxt.get("min_score"))
				)
			)
		if flt(nxt.get("grade_points")) < flt(prev.get("grade_points")):
			errors.append(
				_("Grade points must not decrease as scores rise ({0} vs {1}).").format(
					prev.get("grade"), nxt.get("grade")
				)
			)
	return errors


def classification_errors(rows) -> list[str]:
	"""Pure: problems with award classification bands (empty list = valid)."""
	errors, names = [], set()
	for r in rows:
		key = (r.get("classification") or "").strip().casefold()
		if key in names:
			errors.append(_("Classification {0} is listed twice.").format(r.get("classification")))
		names.add(key)
		if flt(r.get("min_cgpa")) < 0 or flt(r.get("min_cgpa")) > flt(r.get("max_cgpa")):
			errors.append(
				_("Classification {0}: min CGPA must be between 0 and max CGPA.").format(
					r.get("classification")
				)
			)
	ordered = sorted(rows, key=lambda r: flt(r.get("min_cgpa")))
	for prev, nxt in pairwise(ordered):
		if flt(nxt.get("min_cgpa")) < flt(prev.get("max_cgpa")) - _EPS:
			errors.append(
				_("Classifications {0} and {1} overlap.").format(
					prev.get("classification"), nxt.get("classification")
				)
			)
	return errors


class GradingScale(Document):
	def validate(self):
		if flt(self.pass_mark) < 0 or flt(self.pass_mark) > 100:
			frappe.throw(_("Pass mark must be between 0 and 100."))
		errors = band_errors([b.as_dict() for b in self.bands]) + classification_errors(
			[c.as_dict() for c in self.classifications]
		)
		if errors:
			frappe.throw("<br>".join(errors), title=_("Invalid grading scale"))
		self.bands.sort(key=lambda b: -flt(b.min_score))
		for i, b in enumerate(self.bands, 1):
			b.idx = i
		self.classifications.sort(key=lambda c: -flt(c.min_cgpa))
		for i, c in enumerate(self.classifications, 1):
			c.idx = i
		if self.is_default:
			other = frappe.db.get_value(
				"Grading Scale", {"is_default": 1, "name": ["!=", self.name or ""]}, "name"
			)
			if other:
				frappe.throw(
					_("{0} is already the default grading scale. Untick it there first.").format(other),
					title=_("Only one default"),
				)

	def on_update(self):
		from mahanaim.services.grading import clear_cache

		clear_cache()

	def on_trash(self):
		if frappe.db.get_single_value("Mahanaim Settings", "default_grading_scale") == self.name:
			frappe.throw(_("This scale is the default in Mahanaim Settings and cannot be deleted."))
		from mahanaim.services.grading import clear_cache

		clear_cache()
