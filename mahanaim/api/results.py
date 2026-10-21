"""Grading & results (M11): mark sheet workflow, student results and staff reporting.

Mark sheet workflow: Draft -> Submitted (lecturer) -> Approved (Academic Dean) -> Published (Registrar);
Submitted/Approved -> Returned (with remarks) -> Draft/Submitted. See docs/api/results.md.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cint, flt

from mahanaim.api.academics import (
	doc_dict,
	ensure_exists,
	is_academic_admin,
	offering_lecturers,
	persist_writes,
	require_academic_admin,
	require_academic_reader,
	require_offering_reader,
	require_teaching,
	user_full_names,
)
from mahanaim.api.utils import parse_json, require_roles, require_student
from mahanaim.services import results as svc
from mahanaim.utils import (
	ROLE_ADMIN,
	ROLE_DEAN,
	ROLE_LECTURER,
	ROLE_REGISTRAR,
	STAFF_ROLES,
	user_roles,
)

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
	"published_by",
	"published_on",
	"returned_by",
	"returned_on",
	"return_reason",
]
WORKFLOW_USER_FIELDS = ("submitted_by", "approved_by", "returned_by", "published_by")
SCALE_FIELDS = ("is_default", "pass_mark", "description")
BAND_FIELDS = ("grade", "min_score", "max_score", "grade_points", "description", "is_pass")
CLASSIFICATION_FIELDS = ("classification", "min_cgpa", "max_cgpa")


def _has(roles: set) -> bool:
	return frappe.session.user == "Administrator" or bool(user_roles() & roles)


def _sheet(name: str):
	ensure_exists("Mark Sheet", name)
	return frappe.get_doc("Mark Sheet", name)


def _teaching_sheet(name: str):
	sheet = _sheet(name)
	require_teaching(sheet.course_offering)
	return sheet


def add_workflow_names(rows) -> None:
	"""Add `<field>_name` (full name) beside each workflow user id (submitted/approved/returned/published_by)."""
	names = user_full_names(r.get(f) for r in rows for f in WORKFLOW_USER_FIELDS)
	for r in rows:
		for f in WORKFLOW_USER_FIELDS:
			r[f"{f}_name"] = names.get(r.get(f)) if r.get(f) else None


def sheet_dict(sheet) -> dict:
	out = doc_dict(sheet)
	add_workflow_names([out])
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
	"""The offering's mark sheet, created on first access. While Draft/Returned the figures are recomputed
	from live assessment data for the response only (`stale` = the stored copy is behind them); reads never
	save, so recompute_mark_sheet / save_mark_sheet_entries / submit_mark_sheet persist them."""
	require_teaching(offering)
	sheet, created, stale = svc.read_mark_sheet(offering)
	if created:
		persist_writes()
	return {**sheet_dict(sheet), "stale": stale}


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
	"""Sheets awaiting the caller: Submitted (Dean approves) and/or Approved (Registrar publishes). Read-only
	Auditors see both queues."""
	require_academic_reader()
	if status:
		statuses = [status]
	else:
		statuses = []
		if _has(APPROVER_ROLES):
			statuses.append("Submitted")
		if _has(PUBLISHER_ROLES):
			statuses.append("Approved")
		statuses = statuses or ["Submitted", "Approved"]
	filters = {"status": ["in", statuses or [""]]}
	if term:
		filters["academic_term"] = term
	data = frappe.get_all(
		"Mark Sheet", filters=filters, fields=SHEET_LIST_FIELDS, order_by="submitted_on asc"
	)
	lecturers = offering_lecturers([d.course_offering for d in data])
	for d in data:
		d["lecturers"] = [r.get("staff_name") for r in lecturers.get(d.course_offering, [])]
	add_workflow_names(data)
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
def bulk_publish(term, mark_sheets=None):
	"""Publish every Approved sheet of `term`, or only `mark_sheets` (list or JSON list), which must all be
	Approved sheets of that term."""
	require_roles(ROLE_REGISTRAR)
	ensure_exists("Academic Term", term)
	selected = _selected_sheets(term, mark_sheets)
	result = svc.bulk_publish(term, selected)
	return {
		"term": term,
		"published": result["published"],
		"failed": result["failed"],
		"published_count": len(result["published"]),
		"failed_count": len(result["failed"]),
	}


def _selected_sheets(term: str, mark_sheets) -> list[str] | None:
	if mark_sheets in (None, ""):
		return None
	names = parse_json(mark_sheets, None)
	if isinstance(names, str):
		names = [names]
	if not isinstance(names, list) or not names or not all(isinstance(n, str) and n for n in names):
		frappe.throw(_("mark_sheets must be a non-empty list of mark sheet names."))
	names = list(dict.fromkeys(names))
	rows = {
		r.name: r
		for r in frappe.get_all(
			"Mark Sheet", filters={"name": ["in", names]}, fields=["name", "status", "course_offering"]
		)
	}
	missing = [n for n in names if n not in rows]
	if missing:
		frappe.throw(_("Mark sheet(s) not found: {0}.").format(", ".join(missing)), frappe.DoesNotExistError)
	terms = dict(
		frappe.get_all(
			"Course Offering",
			filters={"name": ["in", list({r.course_offering for r in rows.values()})]},
			fields=["name", "academic_term"],
			as_list=True,
		)
	)
	other_term = [n for n in names if terms.get(rows[n].course_offering) != term]
	if other_term:
		frappe.throw(_("Not in term {0}: {1}.").format(term, ", ".join(other_term)))
	not_approved = [n for n in names if rows[n].status != "Approved"]
	if not_approved:
		frappe.throw(_("Only Approved mark sheets can be published: {0}.").format(", ".join(not_approved)))
	return names


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
	require_academic_reader()
	ensure_exists("Academic Term", term)
	return svc.results_overview(term)


@frappe.whitelist()
def grade_distribution(offering=None, term=None):
	if offering:
		require_offering_reader(offering)
		return svc.grade_distribution(offering=offering)
	require_academic_reader()
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


# ---------------------------------------------------------------------------------- grading scales
def scale_dicts(names: list[str]) -> list[dict]:
	if not names:
		return []
	scales = frappe.get_all(
		"Grading Scale",
		filters={"name": ["in", names]},
		fields=["name", "scale_name", "is_default", "pass_mark", "description", "modified"],
		order_by="is_default desc, scale_name asc",
	)
	bands, classes = {}, {}
	for b in frappe.get_all(
		"Grading Scale Band",
		filters={"parent": ["in", names], "parenttype": "Grading Scale"},
		fields=["parent", *BAND_FIELDS],
		order_by="min_score desc",
	):
		bands.setdefault(b.pop("parent"), []).append(b)
	for c in frappe.get_all(
		"Award Classification Band",
		filters={"parent": ["in", names], "parenttype": "Grading Scale"},
		fields=["parent", *CLASSIFICATION_FIELDS],
		order_by="min_cgpa desc",
	):
		classes.setdefault(c.pop("parent"), []).append(c)
	in_use = {
		r.grading_scale: cint(r.n)
		for r in frappe.get_all(
			"Course Offering",
			filters={"grading_scale": ["in", names]},
			fields=["grading_scale", {"COUNT": "*", "as": "n"}],
			group_by="grading_scale",
		)
	}
	from mahanaim.services.grading import default_scale

	default = default_scale()
	for s in scales:
		s["is_default"] = cint(s.is_default)
		s["is_effective_default"] = s.name == default
		s["bands"] = bands.get(s.name, [])
		s["classifications"] = classes.get(s.name, [])
		s["offering_count"] = in_use.get(s.name, 0)
	return scales


@frappe.whitelist()
def get_grading_scales():
	"""All grading scales with bands (highest first) and classification bands (staff and lecturers, read)."""
	require_roles(*STAFF_ROLES, ROLE_LECTURER)
	from mahanaim.services.grading import default_scale

	return {
		"data": scale_dicts(frappe.get_all("Grading Scale", pluck="name")),
		"default": default_scale(),
	}


def _rows(data: dict, key: str, fields: tuple[str, ...]) -> list[dict]:
	rows = data.get(key) or []
	if not isinstance(rows, list) or not all(isinstance(r, dict) for r in rows):
		frappe.throw(_("{0} must be a list of rows.").format(key))
	return [{f: r.get(f) for f in fields if f in r} for r in rows]


@frappe.whitelist(methods=["POST"])
def save_grading_scale(doc):
	"""Create or update a grading scale by name (Registrar, Academic Dean). `doc`: {name?, scale_name,
	is_default?, pass_mark?, description?, bands?: [...], classifications?: [...]}. Bands must cover 0-100
	without overlaps and grade points must be within 0-MAX_GRADE_POINTS. Client timestamps are ignored."""
	require_roles(ROLE_REGISTRAR, ROLE_DEAN)
	data = parse_json(doc, {}) or {}
	if not isinstance(data, dict):
		frappe.throw(_("doc must be an object."))
	name = (data.get("name") or "").strip() or None
	scale_name = (data.get("scale_name") or "").strip() or name
	if not scale_name:
		frappe.throw(_("Give the grading scale a name."))
	existing = name or scale_name
	if frappe.db.exists("Grading Scale", existing):
		gs = frappe.get_doc("Grading Scale", existing)
		if scale_name != gs.scale_name:
			frappe.throw(_("Renaming a grading scale is not supported; create a new scale instead."))
	else:
		gs = frappe.new_doc("Grading Scale")
		gs.scale_name = scale_name
	for key in SCALE_FIELDS:
		if key in data:
			gs.set(key, data.get(key))
	if "pass_mark" in data:
		gs.pass_mark = flt(data.get("pass_mark"))
	if "bands" in data:
		gs.set("bands", _rows(data, "bands", BAND_FIELDS))
	if "classifications" in data:
		gs.set("classifications", _rows(data, "classifications", CLASSIFICATION_FIELDS))
	if gs.is_new():
		gs.insert(ignore_permissions=True)
	else:
		gs.save(ignore_permissions=True)
	return scale_dicts([gs.name])[0]
