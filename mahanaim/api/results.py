"""Grading & results (M11): mark sheet workflow, student results and staff reporting.

Mark sheet workflow: Draft -> Submitted (lecturer) -> Approved (Academic Dean) -> Published (Registrar);
Submitted/Approved -> Returned (with remarks) -> Draft/Submitted. See docs/api/results.md.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cint

from mahanaim.api.academics import (
	doc_dict,
	ensure_exists,
	is_academic_admin,
	offering_lecturers,
	persist_writes,
	require_academic_admin,
	require_offering_reader,
	require_teaching,
)
from mahanaim.api.utils import parse_json, require_roles, require_student
from mahanaim.services import results as svc
from mahanaim.utils import ROLE_ADMIN, ROLE_DEAN, ROLE_REGISTRAR, user_roles

APPROVER_ROLES = {"System Manager", ROLE_ADMIN, ROLE_DEAN}
PUBLISHER_ROLES = {"System Manager", ROLE_ADMIN, ROLE_REGISTRAR}
SHEET_LIST_FIELDS = [
	"name",
	"course_offering",
	"course_title",
	"academic_term",
	"campus",
	"status",
	"student_count",
	"pass_count",
	"average_score",
	"highest_score",
	"submitted_by",
	"submitted_on",
	"approved_by",
	"approved_on",
	"published_on",
	"return_reason",
]


def _has(roles: set) -> bool:
	return frappe.session.user == "Administrator" or bool(user_roles() & roles)


def _sheet(name: str):
	ensure_exists("Mark Sheet", name)
	return frappe.get_doc("Mark Sheet", name)


def _teaching_sheet(name: str):
	sheet = _sheet(name)
	require_teaching(sheet.course_offering)
	return sheet


def sheet_dict(sheet) -> dict:
	out = doc_dict(sheet)
	numbers = dict(
		frappe.get_all(
			"Student",
			filters={"name": ["in", [e.student for e in sheet.entries] or [""]]},
			fields=["name", "student_number"],
			as_list=True,
		)
	)
	out["entries"] = [
		{
			**{
				k: e.get(k)
				for k in (
					"student",
					"student_name",
					"cat_score",
					"assignment_score",
					"exam_score",
					"other_score",
					"total",
					"grade",
					"grade_points",
					"result_status",
					"is_absent",
					"remarks",
				)
			},
			"student_number": numbers.get(e.student),
			"pending_components": sorted(svc.split_set(e.pending_components)),
			"overridden_components": sorted(svc.split_set(e.overridden_components)),
		}
		for e in sheet.entries
	]
	out["weights"] = svc.sheet_weights(sheet)
	out["pass_mark"] = svc.sheet_context(sheet)["pass_mark"]
	out["assessments"] = [
		{k: i.get(k) for k in ("kind", "name", "title", "bucket", "status")}
		for i in svc.assessment_items(sheet.course_offering)
	]
	out["lecturers"] = offering_lecturers([sheet.course_offering]).get(sheet.course_offering, [])
	editable = sheet.status in svc.EDITABLE_STATUSES
	out["actions"] = {
		"can_edit": editable,
		"can_submit": editable and bool(sheet.entries),
		"can_approve": sheet.status == "Submitted" and _has(APPROVER_ROLES),
		"can_return": sheet.status in ("Submitted", "Approved") and _has(APPROVER_ROLES | PUBLISHER_ROLES),
		"can_publish": sheet.status == "Approved" and _has(PUBLISHER_ROLES),
	}
	return out


# ---------------------------------------------------------------------------------- lecturer
@frappe.whitelist()
def get_mark_sheet(offering):
	"""The offering's mark sheet, created on first access and recomputed while Draft/Returned."""
	require_teaching(offering)
	sheet = svc.get_or_create_mark_sheet(offering, refresh=True)
	persist_writes()
	return sheet_dict(sheet)


@frappe.whitelist(methods=["POST"])
def recompute_mark_sheet(name):
	sheet = _teaching_sheet(name)
	if sheet.status not in svc.EDITABLE_STATUSES:
		frappe.throw(
			_("Mark sheet is {0}; it can only be recomputed in Draft or Returned.").format(_(sheet.status))
		)
	svc.refresh_entries(sheet)
	sheet.save(ignore_permissions=True)
	return sheet_dict(sheet)


@frappe.whitelist(methods=["POST"])
def save_mark_sheet_entries(name, rows):
	"""rows: [{student, cat_score?, assignment_score?, exam_score?, other_score?, remarks?}] (weighted points;
	null clears an override)."""
	sheet = _teaching_sheet(name)
	rows = parse_json(rows, []) or []
	if not isinstance(rows, list):
		frappe.throw(_("rows must be a list."))
	return sheet_dict(svc.apply_entry_overrides(sheet, rows))


@frappe.whitelist(methods=["POST"])
def update_mark_sheet_weights(name, weights):
	"""weights: {cat_weight, assignment_weight, exam_weight, other_weight} (must total 100)."""
	sheet = _teaching_sheet(name)
	weights = parse_json(weights, {}) or {}
	if not isinstance(weights, dict):
		frappe.throw(_("weights must be an object."))
	return sheet_dict(svc.set_weights(sheet, weights))


@frappe.whitelist(methods=["POST"])
def submit_mark_sheet(name):
	sheet = _teaching_sheet(name)
	if sheet.status not in svc.EDITABLE_STATUSES:
		frappe.throw(_("Mark sheet is already {0}.").format(_(sheet.status)))
	svc.refresh_entries(sheet)
	if not sheet.entries:
		frappe.throw(_("There are no students on this mark sheet."))
	return sheet_dict(svc.transition(sheet, "Submitted"))


# ---------------------------------------------------------------------------------- dean / registrar
@frappe.whitelist()
def pending_mark_sheets(term=None, status=None):
	"""Sheets awaiting the caller: Submitted (Dean approves) and/or Approved (Registrar publishes)."""
	require_academic_admin()
	if status:
		statuses = [status]
	else:
		statuses = []
		if _has(APPROVER_ROLES):
			statuses.append("Submitted")
		if _has(PUBLISHER_ROLES):
			statuses.append("Approved")
	filters = {"status": ["in", statuses or [""]]}
	if term:
		filters["academic_term"] = term
	data = frappe.get_all(
		"Mark Sheet", filters=filters, fields=SHEET_LIST_FIELDS, order_by="submitted_on asc"
	)
	lecturers = offering_lecturers([d.course_offering for d in data])
	for d in data:
		d["lecturers"] = [r.get("staff_name") for r in lecturers.get(d.course_offering, [])]
	return {"data": data, "total": len(data)}


@frappe.whitelist()
def get_mark_sheet_by_name(name):
	"""Read a mark sheet without recomputing it (approvers, publishers and the offering's lecturers)."""
	sheet = _sheet(name)
	require_offering_reader(sheet.course_offering)
	return sheet_dict(sheet)


@frappe.whitelist(methods=["POST"])
def approve_mark_sheet(name):
	require_roles(ROLE_DEAN)
	return sheet_dict(svc.transition(_sheet(name), "Approved"))


@frappe.whitelist(methods=["POST"])
def return_mark_sheet(name, remarks):
	require_academic_admin()
	if not (remarks or "").strip():
		frappe.throw(_("Give the reason for returning this mark sheet."))
	return sheet_dict(svc.transition(_sheet(name), "Returned", remarks.strip()))


@frappe.whitelist(methods=["POST"])
def publish_mark_sheet(name):
	"""Approved -> Published: creates Course Results, updates enrolments and standing, notifies students."""
	require_roles(ROLE_REGISTRAR)
	return sheet_dict(svc.transition(_sheet(name), "Published"))


@frappe.whitelist(methods=["POST"])
def bulk_publish(term):
	require_roles(ROLE_REGISTRAR)
	ensure_exists("Academic Term", term)
	result = svc.bulk_publish(term)
	return {
		"term": term,
		"published": result["published"],
		"failed": result["failed"],
		"published_count": len(result["published"]),
		"failed_count": len(result["failed"]),
	}


# ---------------------------------------------------------------------------------- student
def _filter_terms(data: dict, term: str | None) -> dict:
	if term:
		data["terms"] = [t for t in data["terms"] if t["term"] == term]
	return data


@frappe.whitelist()
def my_results(term=None):
	"""Published results grouped by term (term GPA + running CGPA), with overall CGPA and standing."""
	student = require_student()
	data = svc.transcript_data(student.name, published_only=True)
	header = data["student"]
	return _filter_terms(
		{
			"student": {
				k: header.get(k)
				for k in ("name", "student_number", "full_name", "programme", "programme_name", "campus")
			},
			"terms": data["terms"],
			"cgpa": data["cgpa"],
			"credits_earned": data["total_credits"],
			"credits_attempted": data["credits_attempted"],
			"quality_points": data["quality_points"],
			"standing": header.get("academic_standing"),
			"classification": data["classification"],
			"min_credits_to_graduate": header.get("min_credits_to_graduate"),
		},
		term,
	)


@frappe.whitelist()
def my_transcript_preview():
	student = require_student()
	return svc.transcript_data(student.name, published_only=True)


# ---------------------------------------------------------------------------------- staff reporting
@frappe.whitelist()
def results_overview(term):
	require_academic_admin()
	ensure_exists("Academic Term", term)
	return svc.results_overview(term)


@frappe.whitelist()
def grade_distribution(offering=None, term=None):
	if offering:
		require_offering_reader(offering)
		return svc.grade_distribution(offering=offering)
	require_academic_admin()
	ensure_exists("Academic Term", term)
	return svc.grade_distribution(term=term)


@frappe.whitelist()
def student_results(student, published_only=0):
	"""Full record for staff. Unpublished results are included unless published_only=1."""
	require_academic_admin()
	ensure_exists("Student", student)
	return svc.transcript_data(student, published_only=bool(cint(published_only)))


@frappe.whitelist()
def can_manage_results():
	"""UI helper: which mark sheet actions the session user may perform."""
	return {
		"academic_admin": is_academic_admin(),
		"approve": _has(APPROVER_ROLES),
		"publish": _has(PUBLISHER_ROLES),
	}
