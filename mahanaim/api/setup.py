"""Setup & master-data endpoints for the admin SPA (M02). See docs/api/setup.md."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.model import no_value_fields, table_fields
from frappe.utils import cint

from mahanaim.api.utils import (
	clean_payload,
	page_args,
	parse_json,
	require_login,
	require_roles,
	require_staff,
	search_filters,
)
from mahanaim.utils import ROLE_DEAN, ROLE_REGISTRAR, current_term, current_year

SETTINGS = "Mahanaim Settings"
MASTERS = ("Campus", "Department", "Academic Year", "Academic Term", "Intake", "Study Mode")
STAFF_FIELDS = (
	"salutation",
	"first_name",
	"last_name",
	"staff_number",
	"photo",
	"status",
	"date_joined",
	"email",
	"phone",
	"staff_type",
	"designation",
	"is_lecturer",
	"department",
	"campus",
	"show_on_website",
	"website_sequence",
	"specialisation",
	"qualifications",
	"bio",
)
STAFF_LIST_FIELDS = [
	"name",
	"staff_number",
	"salutation",
	"full_name",
	"email",
	"phone",
	"status",
	"staff_type",
	"designation",
	"is_lecturer",
	"department",
	"campus",
	"user",
	"photo",
	"date_joined",
]
STAFF_STATUSES = ("Active", "On Leave", "Inactive")
MASK = "********"


def _select_options(doctype: str, fieldname: str) -> list[str]:
	field = frappe.get_meta(doctype).get_field(fieldname)
	return [o for o in (field.options or "").split("\n") if o] if field else []


def _editable_fields(doctype: str) -> list[str]:
	return [
		df.fieldname
		for df in frappe.get_meta(doctype).fields
		if df.fieldtype not in no_value_fields and df.fieldtype not in table_fields and not df.read_only
	]


# ---------------------------------------------------------------------------------- lookups
@frappe.whitelist()
def lookups():
	"""Dropdown data for the admin SPA (one round trip)."""
	require_staff()
	term, year = current_term(), current_year()
	terms = frappe.get_all(
		"Academic Term",
		fields=[
			"name",
			"term_label",
			"term_name",
			"term_number",
			"academic_year",
			"status",
			"is_current",
			"start_date",
			"end_date",
		],
		order_by="start_date desc",
	)
	for t in terms:
		t["is_current"] = int(t.name == term or cint(t.is_current))
	years = frappe.get_all(
		"Academic Year",
		fields=["name", "year_name", "is_current", "start_date", "end_date"],
		order_by="start_date desc",
	)
	return {
		"campuses": frappe.get_all(
			"Campus",
			fields=["name", "campus_name", "code", "is_main_campus", "is_active", "town"],
			order_by="is_main_campus desc, campus_name asc",
		),
		"departments": frappe.get_all(
			"Department",
			fields=["name", "department_name", "code", "is_active"],
			order_by="department_name asc",
		),
		"programmes": frappe.get_all(
			"Programme",
			fields=["name", "code", "programme_name", "level", "status", "department", "duration_years"],
			order_by="programme_name asc",
		),
		"study_modes": frappe.get_all(
			"Study Mode",
			fields=["name", "study_mode_name", "code", "is_online", "is_active"],
			order_by="study_mode_name asc",
		),
		"intakes": frappe.get_all(
			"Intake",
			fields=["name", "intake_name", "academic_year", "start_date", "applications_open"],
			order_by="start_date desc",
		),
		"academic_years": years,
		"terms": terms,
		"lecturers": frappe.get_all(
			"Staff Member",
			filters={"is_lecturer": 1, "status": ["!=", "Inactive"]},
			fields=["name", "full_name", "salutation", "user", "department", "campus"],
			order_by="full_name asc",
		),
		"currencies": frappe.get_all("Currency", filters={"enabled": 1}, pluck="name", order_by="name asc"),
		"current_term": term,
		"current_year": year,
		"options": {
			"student_status": _select_options("Student", "status"),
			"application_status": _select_options("Programme Application", "status"),
			"registration_status": _select_options("Semester Registration", "status"),
			"request_type": _select_options("Student Request", "request_type"),
			"request_status": _select_options("Student Request", "status"),
			"gender": _select_options("Student", "gender"),
			"fee_category": _select_options("Student", "fee_category"),
			"staff_type": _select_options("Staff Member", "staff_type"),
			"staff_status": _select_options("Staff Member", "status"),
			"term_status": _select_options("Academic Term", "status"),
			"programme_level": _select_options("Programme", "level"),
		},
	}


@frappe.whitelist()
def academic_calendar(academic_year: str | None = None):
	"""Academic years with their terms and key dates (any signed-in user)."""
	require_login()
	from mahanaim.mahanaim_setup.doctype.academic_term.academic_term import registration_window

	filters = {"name": academic_year} if academic_year else {}
	years = frappe.get_all(
		"Academic Year",
		filters=filters,
		fields=["name", "year_name", "is_current", "start_date", "end_date"],
		order_by="start_date desc",
		limit=0 if academic_year else 6,
	)
	terms = frappe.get_all(
		"Academic Term",
		filters={"academic_year": ["in", [y.name for y in years] or [""]]},
		fields=[
			"name",
			"term_label",
			"term_name",
			"term_number",
			"academic_year",
			"status",
			"is_current",
			"start_date",
			"end_date",
			"registration_start",
			"registration_end",
			"late_registration_end",
			"exam_start",
			"exam_end",
			"results_release_date",
		],
		order_by="start_date asc",
	)
	by_year: dict[str, list] = {}
	for t in terms:
		t["registration_window"] = registration_window(t)
		by_year.setdefault(t.academic_year, []).append(t)
	for y in years:
		y["terms"] = by_year.get(y.name, [])
	return {"years": years, "current_term": current_term(), "current_year": current_year()}


@frappe.whitelist(methods=["POST"])
def set_current_term(term: str):
	require_roles(ROLE_REGISTRAR, ROLE_DEAN)
	if not frappe.db.exists("Academic Term", term):
		frappe.throw(_("Academic Term {0} not found.").format(term), frappe.DoesNotExistError)
	doc = frappe.get_doc("Academic Term", term)
	if not cint(doc.is_current):
		doc.is_current = 1
		doc.save(ignore_permissions=True)
	return {"current_term": current_term(), "current_year": current_year()}


# ---------------------------------------------------------------------------------- masters
@frappe.whitelist(methods=["POST"])
def save_master(doctype: str, data, name: str | None = None):
	"""Create/update one of the simple masters: Campus, Department, Academic Year, Academic Term, Intake, Study Mode."""
	require_staff()
	if doctype not in MASTERS:
		frappe.throw(_("{0} cannot be edited here.").format(doctype), frappe.PermissionError)
	values = clean_payload(data, _editable_fields(doctype))
	if name:
		if not frappe.db.exists(doctype, name):
			frappe.throw(_("{0} {1} not found.").format(_(doctype), name), frappe.DoesNotExistError)
		doc = frappe.get_doc(doctype, name)
		doc.check_permission("write")
		doc.update(values)
		doc.save()
	else:
		frappe.has_permission(doctype, "create", throw=True)
		doc = frappe.get_doc({"doctype": doctype, **values})
		doc.insert()
	return doc.as_dict(no_default_fields=True, convert_dates_to_str=True) | {"name": doc.name}


# ---------------------------------------------------------------------------------- staff
def _staff_dict(doc) -> dict:
	data = {f: doc.get(f) for f in ("name", *STAFF_FIELDS, "full_name", "user")}
	data["additional_campuses"] = [r.campus for r in doc.get("additional_campuses") or []]
	if doc.user:
		user = (
			frappe.db.get_value("User", doc.user, ["enabled", "last_login", "user_type"], as_dict=True) or {}
		)
		data["user_info"] = {
			**user,
			"roles": sorted(
				frappe.get_all("Has Role", filters={"parent": doc.user, "parenttype": "User"}, pluck="role")
			),
		}
	data["teaching"] = []
	term = current_term()
	if term:
		roles = {
			r.parent: r.role
			for r in frappe.get_all(
				"Course Offering Lecturer",
				filters={"staff_member": doc.name, "parenttype": "Course Offering"},
				fields=["parent", "role"],
			)
		}
		if roles:
			data["teaching"] = [
				{**r, "role": roles.get(r.name)}
				for r in frappe.get_all(
					"Course Offering",
					filters={"name": ["in", list(roles)], "academic_term": term},
					fields=["name", "course", "course_title", "campus", "enrolled_count"],
				)
			]
	return data


@frappe.whitelist()
def list_staff(
	status=None,
	staff_type=None,
	department=None,
	campus=None,
	is_lecturer=None,
	search=None,
	start=0,
	page_length=20,
):
	require_staff()
	filters = []
	for field, value in (
		("status", status),
		("staff_type", staff_type),
		("department", department),
		("campus", campus),
	):
		if value:
			filters.append([field, "=", value])
	if is_lecturer not in (None, ""):
		filters.append(["is_lecturer", "=", cint(is_lecturer)])
	or_filters = search_filters(
		search, ("name", "staff_number", "full_name", "email", "phone", "designation")
	)
	rows = frappe.get_list(
		"Staff Member",
		filters=filters,
		or_filters=or_filters,
		fields=STAFF_LIST_FIELDS,
		order_by="full_name asc",
		**page_args(start, page_length),
	)
	total = frappe.get_list(
		"Staff Member",
		filters=filters,
		or_filters=or_filters,
		fields=[{"COUNT": "*", "as": "total"}],
		order_by=None,
	)
	return {"data": rows, "total": cint(total[0].total) if total else 0}


@frappe.whitelist()
def get_staff(name: str):
	require_staff()
	if not frappe.db.exists("Staff Member", name):
		frappe.throw(_("Staff Member {0} not found.").format(name), frappe.DoesNotExistError)
	doc = frappe.get_doc("Staff Member", name)
	doc.check_permission("read")
	return _staff_dict(doc)


@frappe.whitelist(methods=["POST"])
def save_staff(data, name: str | None = None):
	"""Create/update a staff profile. A login is created for new staff with an email unless create_user=0."""
	require_roles(ROLE_REGISTRAR)
	payload = parse_json(data, {}) or {}
	values = clean_payload(payload, STAFF_FIELDS)
	if name:
		if not frappe.db.exists("Staff Member", name):
			frappe.throw(_("Staff Member {0} not found.").format(name), frappe.DoesNotExistError)
		doc = frappe.get_doc("Staff Member", name)
		doc.check_permission("write")
		doc.update(values)
	else:
		frappe.has_permission("Staff Member", "create", throw=True)
		doc = frappe.get_doc({"doctype": "Staff Member", **values})
	if "additional_campuses" in payload:
		doc.set("additional_campuses", [])
		for campus in parse_json(payload.get("additional_campuses"), []) or []:
			campus = campus if isinstance(campus, str) else (campus or {}).get("campus")
			if campus:
				doc.append("additional_campuses", {"campus": campus})
	if "create_user" in payload:
		doc.flags.create_user = bool(cint(payload.get("create_user")))
	doc.save() if not doc.is_new() else doc.insert()
	return _staff_dict(doc)


@frappe.whitelist(methods=["POST"])
def set_staff_status(name: str, status: str):
	require_roles(ROLE_REGISTRAR)
	if status not in STAFF_STATUSES:
		frappe.throw(_("Status must be one of: {0}").format(", ".join(STAFF_STATUSES)))
	if not frappe.db.exists("Staff Member", name):
		frappe.throw(_("Staff Member {0} not found.").format(name), frappe.DoesNotExistError)
	doc = frappe.get_doc("Staff Member", name)
	doc.check_permission("write")
	doc.status = status
	doc.save()
	return _staff_dict(doc)


# ---------------------------------------------------------------------------------- settings
def _settings_dict() -> dict:
	doc = frappe.get_single(SETTINGS)
	meta = frappe.get_meta(SETTINGS)
	data = {}
	password_fields = []
	for df in meta.fields:
		if df.fieldtype in no_value_fields or df.fieldtype in table_fields:
			continue
		if df.fieldtype == "Password":
			password_fields.append(df.fieldname)
			data[df.fieldname] = MASK if doc.get(df.fieldname) else None
			continue
		data[df.fieldname] = doc.get(df.fieldname)
	data["password_fields"] = password_fields
	data["modified"] = doc.modified
	return data


@frappe.whitelist()
def get_settings():
	"""Mahanaim Settings (College Administrator / System Manager). Password fields are masked."""
	require_roles()
	return _settings_dict()


@frappe.whitelist(methods=["POST"])
def update_settings(data):
	require_roles()
	payload = parse_json(data, {}) or {}
	meta = frappe.get_meta(SETTINGS)
	doc = frappe.get_single(SETTINGS)
	doc.check_permission("write")
	for fieldname in _editable_fields(SETTINGS):
		if fieldname not in payload:
			continue
		value = payload[fieldname]
		if meta.get_field(fieldname).fieldtype == "Password" and (not value or set(str(value)) == {"*"}):
			continue  # unchanged mask / empty means "keep the stored secret"
		doc.set(fieldname, value)
	doc.save()
	return _settings_dict()
