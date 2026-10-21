"""Grading and GPA (owned by backend domain B2).

CONTRACT:
	grade_for(score: float, scale: str | None = None) -> dict {grade, grade_points, is_pass, description}
	classification_for(cgpa: float, scale: str | None = None) -> str | None
	compute_gpa(student: str, academic_term: str | None = None) -> dict {gpa, credits, quality_points}
	refresh_student_standing(student: str) -> dict  # updates Student.cgpa / credits_earned / academic_standing

Rules
- Bands are looked up "highest band whose min_score <= score", so the .99 gaps of the standard scale
  (e.g. 39.99 -> 40) can never leave a score ungraded. Scores are clamped to 0..100.
- GPA = sum(grade_points x credits) / sum(credits) over *published* Course Results. Retakes: only the
  best attempt per course counts. "Incomplete" results are excluded until resolved.
- Grading scale bands are cached per request (frappe.local) and cleared when a Grading Scale is saved.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cint, flt

from mahanaim.utils import setting

STANDING_DEANS_LIST = "Dean's List"
STANDING_PROBATION = "Probation"
STANDING_WARNING = "Academic Warning"
STANDING_GOOD = "Good Standing"

DEANS_LIST_GPA = 3.6
PROBATION_CGPA = 2.0
WARNING_GPA = 2.0

# Result statuses that do not (yet) count towards GPA
NON_GPA_STATUSES = ("Incomplete",)
RESULT_FIELDS = [
	"name",
	"student",
	"course",
	"course_title",
	"course_offering",
	"academic_term",
	"credits",
	"total_score",
	"grade",
	"grade_points",
	"result_status",
	"attempt",
	"is_published",
	"published_on",
]
_EPS = 1e-9


# ---------------------------------------------------------------------------------- scale cache
def _cache() -> dict:
	cache = getattr(frappe.local, "mbc_grading_cache", None)
	if cache is None:
		cache = frappe.local.mbc_grading_cache = {}
	return cache


def clear_cache():
	frappe.local.mbc_grading_cache = {}


def default_scale() -> str | None:
	cache = _cache()
	if "__default__" not in cache:
		name = setting("default_grading_scale")
		if not name or not frappe.db.exists("Grading Scale", name):
			name = frappe.db.get_value("Grading Scale", {"is_default": 1}, "name") or frappe.db.get_value(
				"Grading Scale", {}, "name"
			)
		cache["__default__"] = name
	return cache["__default__"]


def scale_data(scale: str | None = None) -> dict:
	"""{name, pass_mark, bands (min desc), classifications (min desc)} for a scale (cached per request)."""
	scale = scale or default_scale()
	if not scale:
		frappe.throw(_("No grading scale is configured. Create one under Grading Scale."))
	cache = _cache()
	if scale not in cache:
		pass_mark = frappe.db.get_value("Grading Scale", scale, "pass_mark")
		if pass_mark is None:
			frappe.throw(_("Grading Scale {0} does not exist.").format(scale), frappe.DoesNotExistError)
		bands = frappe.get_all(
			"Grading Scale Band",
			filters={"parent": scale, "parenttype": "Grading Scale"},
			fields=["grade", "min_score", "max_score", "grade_points", "description", "is_pass"],
			order_by="min_score desc",
		)
		classifications = frappe.get_all(
			"Award Classification Band",
			filters={"parent": scale, "parenttype": "Grading Scale"},
			fields=["classification", "min_cgpa", "max_cgpa"],
			order_by="min_cgpa desc",
		)
		cache[scale] = {
			"name": scale,
			"pass_mark": flt(pass_mark),
			"bands": bands,
			"classifications": classifications,
		}
	return cache[scale]


# ---------------------------------------------------------------------------------- pure helpers
def band_for(score, bands: list) -> dict | None:
	"""Pure: the band for `score` given bands sorted by min_score descending."""
	if not bands:
		return None
	s = max(0.0, min(100.0, round(flt(score), 2)))
	for band in bands:
		if s + _EPS >= flt(band.get("min_score")):
			return band
	return bands[-1]


def standing_for(last_term_gpa: float, cgpa: float) -> str:
	"""Pure: academic standing from the last-term GPA and CGPA (SOW M11)."""
	if flt(last_term_gpa) + _EPS >= DEANS_LIST_GPA:
		return STANDING_DEANS_LIST
	if flt(cgpa) < PROBATION_CGPA - _EPS:
		return STANDING_PROBATION
	if flt(last_term_gpa) < WARNING_GPA - _EPS:
		return STANDING_WARNING
	return STANDING_GOOD


def best_attempts(rows: list) -> list:
	"""Pure: keep the best attempt per course (highest grade points, then highest total)."""
	best = {}
	for row in rows:
		key = row.get("course") or row.get("course_offering")
		current = best.get(key)
		rank = (flt(row.get("grade_points")), flt(row.get("total_score")))
		if current is None or rank > (flt(current.get("grade_points")), flt(current.get("total_score"))):
			best[key] = row
	return list(best.values())


def gpa_summary(rows: list) -> dict:
	"""Pure: {gpa, credits, quality_points, credits_earned} for already de-duplicated result rows."""
	credits = quality_points = earned = 0.0
	for row in rows:
		if row.get("result_status") in NON_GPA_STATUSES:
			continue
		c = flt(row.get("credits"))
		if c <= 0:
			continue
		credits += c
		quality_points += flt(row.get("grade_points")) * c
		if row.get("result_status") == "Pass":
			earned += c
	return {
		"gpa": round(quality_points / credits, 2) if credits else 0.0,
		"credits": round(credits, 2),
		"quality_points": round(quality_points, 2),
		"credits_earned": round(earned, 2),
	}


# ---------------------------------------------------------------------------------- contract
def grade_for(score, scale=None) -> dict:
	band = band_for(score, scale_data(scale)["bands"])
	if not band:
		return {"grade": None, "grade_points": 0.0, "is_pass": False, "description": None}
	return {
		"grade": band.grade,
		"grade_points": flt(band.grade_points),
		"is_pass": bool(cint(band.is_pass)),
		"description": band.description,
	}


def classification_for(cgpa, scale=None):
	value = round(flt(cgpa), 2)
	for row in scale_data(scale)["classifications"]:
		if value + _EPS >= flt(row.min_cgpa):
			return row.classification
	return None


def student_results(students, published_only: bool = True, academic_term: str | None = None) -> list:
	if isinstance(students, str):
		students = [students]
	if not students:
		return []
	filters = {"student": ["in", list(students)]}
	if published_only:
		filters["is_published"] = 1
	if academic_term:
		filters["academic_term"] = academic_term
	return frappe.get_all("Course Result", filters=filters, fields=RESULT_FIELDS, order_by="course asc")


def compute_gpa(student, academic_term=None) -> dict:
	summary = gpa_summary(best_attempts(student_results(student, True, academic_term)))
	return {"gpa": summary["gpa"], "credits": summary["credits"], "quality_points": summary["quality_points"]}


def term_start_dates(terms) -> dict:
	terms = [t for t in set(terms or []) if t]
	if not terms:
		return {}
	rows = frappe.get_all("Academic Term", filters={"name": ["in", terms]}, fields=["name", "start_date"])
	return {r.name: r.start_date for r in rows}


def order_terms(terms, starts: dict | None = None) -> list:
	starts = starts if starts is not None else term_start_dates(terms)
	return sorted({t for t in terms if t}, key=lambda t: (str(starts.get(t) or "9999-12-31"), t))


def refresh_student_standing(student) -> dict:
	rows = student_results(student, published_only=True)
	if not rows:
		values = {"cgpa": 0, "credits_earned": 0, "academic_standing": None}
		frappe.db.set_value("Student", student, values, update_modified=False)
		return {**values, "last_term": None, "last_term_gpa": 0.0, "credits": 0.0}

	overall = gpa_summary(best_attempts(rows))
	last_term, last_gpa = None, 0.0
	for term in reversed(order_terms([r.academic_term for r in rows])):
		summary = gpa_summary(best_attempts([r for r in rows if r.academic_term == term]))
		if summary["credits"]:
			last_term, last_gpa = term, summary["gpa"]
			break
	standing = standing_for(last_gpa, overall["gpa"]) if overall["credits"] else None
	values = {
		"cgpa": overall["gpa"],
		"credits_earned": overall["credits_earned"],
		"academic_standing": standing,
	}
	frappe.db.set_value("Student", student, values, update_modified=False)
	return {**values, "last_term": last_term, "last_term_gpa": last_gpa, "credits": overall["credits"]}
