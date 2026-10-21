"""Programmes, courses, course offerings, timetable and class attendance (M07 / M21).

Guards: academic administrators (Academic Dean, Registrar, College Administrator) manage the catalogue;
lecturers read the catalogue and manage sessions/attendance of the offerings they teach; students read
their own timetable and attendance. See docs/api/academics.md.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import add_days, cint, flt, getdate, nowdate

from mahanaim.api.utils import (
	clean_payload,
	page_args,
	parse_json,
	require_lecturer,
	require_lecturer_of,
	require_roles,
	require_staff,
	require_student,
)
from mahanaim.services.assessments import (
	ENROLLED,
	enrolled_students,
	enrolment_counts,
	is_enrolled,
	student_offerings,
)
from mahanaim.utils import ROLE_ADMIN, ROLE_DEAN, ROLE_REGISTRAR, current_term, is_staff, pct, user_roles

ACADEMIC_ADMIN_ROLES = (ROLE_DEAN, ROLE_REGISTRAR)
MAX_REPEAT_WEEKS = 20

PROGRAMME_FIELDS = (
	"programme_name",
	"level",
	"department",
	"status",
	"is_published",
	"award_title",
	"image",
	"duration_years",
	"terms_per_year",
	"min_credits_to_graduate",
	"min_cgpa_to_graduate",
	"application_fee",
	"indicative_fee_per_term",
	"minimum_entry",
	"overview",
	"description",
	"entry_requirements",
	"career_paths",
)
COURSE_FIELDS = (
	"course_title",
	"department",
	"credits",
	"contact_hours",
	"pass_mark",
	"is_active",
	"description",
	"learning_outcomes",
)
OFFERING_FIELDS = (
	"course",
	"academic_term",
	"campus",
	"study_mode",
	"section",
	"status",
	"capacity",
	"start_date",
	"end_date",
	"grading_scale",
	"description",
	"require_fee_clearance",
)
OFFERING_LIST_FIELDS = [
	"name",
	"course",
	"course_title",
	"credits",
	"academic_term",
	"academic_year",
	"campus",
	"study_mode",
	"section",
	"status",
	"capacity",
	"start_date",
	"end_date",
	"results_status",
	"lms_sync_status",
	"enrolled_count",
]
SESSION_FIELDS = [
	"name",
	"course_offering",
	"course_title",
	"session_date",
	"start_time",
	"end_time",
	"lecturer",
	"venue",
	"mode",
	"meeting_link",
	"status",
	"topic",
	"notes",
	"attendance_taken",
	"present_count",
	"absent_count",
]
SESSION_EDITABLE = (
	"session_date",
	"start_time",
	"end_time",
	"venue",
	"topic",
	"mode",
	"meeting_link",
	"notes",
	"lecturer",
)


# ---------------------------------------------------------------------------------- shared guards
def is_academic_admin(user: str | None = None) -> bool:
	user = user or frappe.session.user
	return user == "Administrator" or bool(
		user_roles(user) & {"System Manager", ROLE_ADMIN, *ACADEMIC_ADMIN_ROLES}
	)


def require_academic_admin() -> str:
	return require_roles(*ACADEMIC_ADMIN_ROLES)


def ensure_exists(doctype: str, name: str | None, label: str | None = None):
	if not name or not frappe.db.exists(doctype, name):
		frappe.throw(
			_("{0} {1} not found.").format(_(label or doctype), name or ""), frappe.DoesNotExistError
		)
	return name


INTERNAL_KEYS = ("doctype", "owner", "modified_by", "docstatus", "parent", "parentfield", "parenttype")


def doc_dict(doc) -> dict:
	"""API view of a document: keeps `name`/`modified` (and child row names), drops framework internals."""
	out = doc.as_dict()
	for key in INTERNAL_KEYS:
		out.pop(key, None)
	for value in out.values():
		if isinstance(value, list):
			for row in value:
				if isinstance(row, dict):
					for key in INTERNAL_KEYS:
						row.pop(key, None)
	return out


def persist_writes() -> None:
	"""Frappe rolls back GET requests; keep lazy writes (status promotion, sheet generation)."""
	frappe.local.flags.commit = True


def require_teaching(offering: str) -> None:
	"""Lecturer of `offering` or an academic administrator."""
	ensure_exists("Course Offering", offering)
	require_lecturer_of(offering)


def require_offering_reader(offering: str) -> None:
	"""Teaching staff of the offering, plus other staff allowed to read the offering."""
	ensure_exists("Course Offering", offering)
	if is_staff() and not is_academic_admin():
		if frappe.has_permission("Course Offering", "read", offering):
			return
	require_lecturer_of(offering)


def require_enrolled(offering: str, statuses=None):
	"""Return the session student when enrolled in `offering`; throws otherwise."""
	student = require_student()
	ensure_exists("Course Offering", offering)
	args = (statuses,) if statuses else ()
	if not is_enrolled(student.name, offering, *args):
		frappe.throw(_("You are not enrolled in this course."), frappe.PermissionError)
	return student


def child_rows(doctype: str, parents, fields, parenttype: str, order_by="idx asc") -> dict:
	parents = list(parents or [])
	out = {p: [] for p in parents}
	if not parents:
		return out
	for row in frappe.get_all(
		doctype,
		filters={"parent": ["in", parents], "parenttype": parenttype},
		fields=["parent", *fields],
		order_by=order_by,
	):
		out.setdefault(row.pop("parent"), []).append(row)
	return out


def offering_lecturers(offerings) -> dict:
	return child_rows(
		"Course Offering Lecturer",
		offerings,
		["staff_member", "staff_name", "user", "role"],
		"Course Offering",
	)


def _count(doctype: str, filters, or_filters=None) -> int:
	rows = frappe.get_list(
		doctype, filters=filters, or_filters=or_filters, fields=[{"COUNT": "*", "as": "total"}]
	)
	return cint(rows[0].total) if rows else 0


def _rows_payload(value, label: str) -> list:
	rows = parse_json(value, []) or []
	if not isinstance(rows, list):
		frappe.throw(_("{0} must be a list.").format(label))
	return rows


# ---------------------------------------------------------------------------------- programmes
@frappe.whitelist()
def list_programmes(search=None, status=None, level=None, department=None, start=0, page_length=50):
	require_lecturer()
	filters = {}
	if status:
		filters["status"] = status
	if level:
		filters["level"] = level
	if department:
		filters["department"] = department
	or_filters = None
	if search:
		like = f"%{search.strip()}%"
		or_filters = [["programme_name", "like", like], ["code", "like", like]]
	data = frappe.get_list(
		"Programme",
		filters=filters,
		or_filters=or_filters,
		fields=[
			"name",
			"code",
			"programme_name",
			"level",
			"department",
			"status",
			"is_published",
			"duration_years",
			"terms_per_year",
			"total_credits",
			"application_fee",
			"image",
		],
		order_by="programme_name asc",
		**page_args(start, page_length),
	)
	counts = {
		r.parent: cint(r.n)
		for r in frappe.get_all(
			"Programme Course",
			filters={"parent": ["in", [d.name for d in data] or [""]], "parenttype": "Programme"},
			fields=["parent", {"COUNT": "*", "as": "n"}],
			group_by="parent",
		)
	}
	for d in data:
		d["course_count"] = counts.get(d.name, 0)
	return {"data": data, "total": _count("Programme", filters, or_filters)}


def group_curriculum(rows) -> list[dict]:
	"""Curriculum rows -> [{year, credits, terms: [{term_number, credits, courses: [...]}]}] (pure)."""
	years = {}
	for r in rows:
		year = years.setdefault(cint(r.get("year_of_study")), {})
		year.setdefault(cint(r.get("term_number")), []).append(r)
	out = []
	for y in sorted(years):
		terms = [
			{
				"term_number": t,
				"credits": round(sum(flt(c.get("credits")) for c in years[y][t]), 2),
				"courses": years[y][t],
			}
			for t in sorted(years[y])
		]
		out.append({"year": y, "credits": round(sum(t["credits"] for t in terms), 2), "terms": terms})
	return out


@frappe.whitelist()
def get_programme(code):
	require_lecturer()
	ensure_exists("Programme", code)
	frappe.has_permission("Programme", "read", code, throw=True)
	doc = frappe.get_doc("Programme", code)
	out = doc_dict(doc)
	curriculum = [
		{
			k: r.get(k)
			for k in (
				"name",
				"course",
				"course_title",
				"credits",
				"year_of_study",
				"term_number",
				"course_type",
			)
		}
		for r in doc.curriculum
	]
	out["curriculum"] = curriculum
	out["curriculum_by_year"] = group_curriculum(curriculum)
	out["campuses"] = [r.campus for r in doc.campuses]
	out["study_modes"] = [r.study_mode for r in doc.study_modes]
	out["student_count"] = frappe.db.count(
		"Student", {"programme": code, "status": ["in", ["Registered", "Active"]]}
	)
	return out


def _link_rows(values, field: str) -> list[dict]:
	rows = []
	for v in _rows_payload(values, field):
		value = v.get(field) if isinstance(v, dict) else v
		if value:
			rows.append({field: value})
	return rows


@frappe.whitelist(methods=["POST"])
def save_programme(data, name=None):
	require_academic_admin()
	data = parse_json(data, {}) or {}
	values = clean_payload(data, PROGRAMME_FIELDS)
	if name:
		ensure_exists("Programme", name)
		doc = frappe.get_doc("Programme", name)
		code = (data.get("code") or "").strip().upper()
		if code and code != doc.name:
			frappe.throw(_("The programme code cannot be changed."))
	else:
		doc = frappe.new_doc("Programme")
		doc.code = (data.get("code") or "").strip()
	doc.update(values)
	if "campuses" in data:
		doc.set("campuses", _link_rows(data.get("campuses"), "campus"))
	if "study_modes" in data:
		doc.set("study_modes", _link_rows(data.get("study_modes"), "study_mode"))
	if "curriculum" in data:
		rows = []
		for r in _rows_payload(data.get("curriculum"), _("Curriculum")):
			if not isinstance(r, dict):
				frappe.throw(_("Each curriculum row must be an object."))
			rows.append(clean_payload(r, ("course", "year_of_study", "term_number", "course_type")))
		doc.set("curriculum", rows)
	frappe.has_permission("Programme", "write" if name else "create", doc, throw=True)
	doc.save()
	return get_programme(doc.name)


# ---------------------------------------------------------------------------------- courses
@frappe.whitelist()
def list_courses(search=None, department=None, is_active=None, start=0, page_length=50):
	require_lecturer()
	filters = {}
	if department:
		filters["department"] = department
	if is_active not in (None, ""):
		filters["is_active"] = cint(is_active)
	or_filters = None
	if search:
		like = f"%{search.strip()}%"
		or_filters = [["course_title", "like", like], ["course_code", "like", like]]
	data = frappe.get_list(
		"Course",
		filters=filters,
		or_filters=or_filters,
		fields=[
			"name",
			"course_code",
			"course_title",
			"department",
			"credits",
			"contact_hours",
			"pass_mark",
			"is_active",
		],
		order_by="course_code asc",
		**page_args(start, page_length),
	)
	prereqs = child_rows("Course Prerequisite", [d.name for d in data], ["prerequisite"], "Course")
	for d in data:
		d["prerequisites"] = [p.prerequisite for p in prereqs.get(d.name, [])]
	return {"data": data, "total": _count("Course", filters, or_filters)}


@frappe.whitelist()
def get_course(code):
	require_lecturer()
	ensure_exists("Course", code)
	frappe.has_permission("Course", "read", code, throw=True)
	doc = frappe.get_doc("Course", code)
	out = doc_dict(doc)
	out["prerequisites"] = [
		{"prerequisite": r.prerequisite, "prerequisite_title": r.prerequisite_title}
		for r in doc.prerequisites
	]
	out["assessment_weights"] = [
		{"component": r.component, "weight": flt(r.weight), "label": r.label} for r in doc.assessment_weights
	]
	out["programmes"] = [
		{"programme": r.pop("parent"), **r}
		for r in frappe.get_all(
			"Programme Course",
			filters={"course": code, "parenttype": "Programme"},
			fields=["parent", "year_of_study", "term_number", "course_type"],
			order_by="parent asc",
		)
	]
	out["offering_count"] = frappe.db.count("Course Offering", {"course": code})
	return out


@frappe.whitelist(methods=["POST"])
def save_course(data, name=None):
	require_academic_admin()
	data = parse_json(data, {}) or {}
	values = clean_payload(data, COURSE_FIELDS)
	if name:
		ensure_exists("Course", name)
		doc = frappe.get_doc("Course", name)
		code = (data.get("course_code") or "").strip().upper()
		if code and code != doc.name:
			frappe.throw(_("The course code cannot be changed."))
	else:
		doc = frappe.new_doc("Course")
		doc.course_code = (data.get("course_code") or "").strip()
	doc.update(values)
	if "prerequisites" in data:
		doc.set("prerequisites", _link_rows(data.get("prerequisites"), "prerequisite"))
	if "assessment_weights" in data:
		doc.set(
			"assessment_weights",
			[
				clean_payload(r, ("component", "weight", "label"))
				for r in _rows_payload(data["assessment_weights"], _("Assessment weights"))
			],
		)
	frappe.has_permission("Course", "write" if name else "create", doc, throw=True)
	doc.save()
	return get_course(doc.name)


# ---------------------------------------------------------------------------------- offerings
@frappe.whitelist()
def list_offerings(
	term=None, campus=None, programme=None, lecturer=None, status=None, search=None, start=0, page_length=50
):
	require_lecturer()
	filters = {}
	if term:
		filters["academic_term"] = term
	if campus:
		filters["campus"] = campus
	if status:
		filters["status"] = status
	if programme:
		courses = frappe.get_all(
			"Programme Course", filters={"parent": programme, "parenttype": "Programme"}, pluck="course"
		)
		filters["course"] = ["in", courses or [""]]
	if lecturer:
		taught = frappe.get_all(
			"Course Offering Lecturer",
			filters={"staff_member": lecturer, "parenttype": "Course Offering"},
			pluck="parent",
		)
		filters["name"] = ["in", taught or [""]]
	or_filters = None
	if search:
		like = f"%{search.strip()}%"
		or_filters = [["course_title", "like", like], ["course", "like", like], ["name", "like", like]]
	data = frappe.get_list(
		"Course Offering",
		filters=filters,
		or_filters=or_filters,
		fields=OFFERING_LIST_FIELDS,
		order_by="academic_term desc, course asc, section asc",
		**page_args(start, page_length),
	)
	names = [d.name for d in data]
	lecturers = offering_lecturers(names)
	counts = enrolment_counts(names)
	for d in data:
		d["lecturers"] = lecturers.get(d.name, [])
		d["enrolled_count"] = counts.get(d.name, 0)
	return {"data": data, "total": _count("Course Offering", filters, or_filters)}


def offering_summary(offering: str) -> dict:
	from mahanaim.services.lms_bridge import lms_course_url

	doc = frappe.get_doc("Course Offering", offering)
	out = doc_dict(doc)
	out["lecturers"] = [
		{"staff_member": r.staff_member, "staff_name": r.staff_name, "user": r.user, "role": r.role}
		for r in doc.lecturers
	]
	out["assessment_weights"] = [
		{"component": r.component, "weight": flt(r.weight), "label": r.label} for r in doc.assessment_weights
	]
	out["enrolled_count"] = enrolment_counts([offering]).get(offering, 0)
	out["lms_url"] = lms_course_url(offering)
	out["mark_sheet"] = frappe.db.get_value("Mark Sheet", {"course_offering": offering}, "name")
	out["counts"] = {
		"assignments": frappe.db.count("Assignment", {"course_offering": offering}),
		"exams": frappe.db.count("Exam", {"course_offering": offering, "status": ["!=", "Cancelled"]}),
		"sessions": frappe.db.count(
			"Class Session", {"course_offering": offering, "status": ["!=", "Cancelled"]}
		),
		"modules": frappe.db.count("Course Module", {"course_offering": offering}),
		"resources": frappe.db.count("Learning Resource", {"course_offering": offering}),
	}
	return out


@frappe.whitelist()
def get_offering(offering):
	require_offering_reader(offering)
	return offering_summary(offering)


def _lecturer_rows(staff_members) -> list[dict]:
	rows = []
	for item in _rows_payload(staff_members, _("Lecturers")):
		if isinstance(item, dict):
			if item.get("staff_member"):
				rows.append({"staff_member": item["staff_member"], "role": item.get("role") or "Lead"})
		elif item:
			rows.append({"staff_member": item, "role": "Lead" if not rows else "Assistant"})
	return rows


@frappe.whitelist(methods=["POST"])
def save_offering(data, name=None):
	require_academic_admin()
	data = parse_json(data, {}) or {}
	values = clean_payload(data, OFFERING_FIELDS)
	if name:
		ensure_exists("Course Offering", name)
		doc = frappe.get_doc("Course Offering", name)
	else:
		doc = frappe.new_doc("Course Offering")
		values.setdefault("status", "Planned")
	doc.update(values)
	if "lecturers" in data:
		doc.set("lecturers", _lecturer_rows(data.get("lecturers")))
	if "assessment_weights" in data:
		doc.set(
			"assessment_weights",
			[
				clean_payload(r, ("component", "weight", "label"))
				for r in _rows_payload(data["assessment_weights"], _("Assessment weights"))
			],
		)
	frappe.has_permission("Course Offering", "write" if name else "create", doc, throw=True)
	doc.save()
	return offering_summary(doc.name)


@frappe.whitelist(methods=["POST"])
def assign_lecturers(offering, staff_members):
	require_academic_admin()
	ensure_exists("Course Offering", offering)
	doc = frappe.get_doc("Course Offering", offering)
	doc.set("lecturers", _lecturer_rows(staff_members))
	doc.save()
	return {
		"ok": True,
		"offering": offering,
		"lecturers": [
			{"staff_member": r.staff_member, "staff_name": r.staff_name, "user": r.user, "role": r.role}
			for r in doc.lecturers
		],
	}


def _programmes_for(campus: str, programme: str | None, study_mode: str | None) -> list[str]:
	if programme:
		ensure_exists("Programme", programme)
		return [programme]
	names = frappe.get_all("Programme", filters={"status": "Active"}, pluck="name")
	campuses = child_rows("Programme Campus", names, ["campus"], "Programme")
	modes = child_rows("Programme Study Mode", names, ["study_mode"], "Programme")
	out = []
	for n in names:
		listed = {r.campus for r in campuses.get(n, [])}
		if listed and campus not in listed:
			continue
		listed_modes = {r.study_mode for r in modes.get(n, [])}
		if study_mode and listed_modes and study_mode not in listed_modes:
			continue
		out.append(n)
	return out


@frappe.whitelist(methods=["POST"])
def generate_offerings(term, campus, programme=None, study_mode=None):
	"""Create Planned offerings for every curriculum course taught in `term`'s term_number (idempotent)."""
	require_academic_admin()
	ensure_exists("Academic Term", term)
	ensure_exists("Campus", campus)
	if study_mode:
		ensure_exists("Study Mode", study_mode)
	term_number = cint(frappe.db.get_value("Academic Term", term, "term_number")) or 1
	programmes = _programmes_for(campus, programme, study_mode)
	rows = frappe.get_all(
		"Programme Course",
		filters={"parent": ["in", programmes or [""]], "parenttype": "Programme", "term_number": term_number},
		fields=["course", "parent"],
		order_by="year_of_study asc, idx asc",
	)
	courses = list(dict.fromkeys(r.course for r in rows))
	active = set(
		frappe.get_all("Course", filters={"name": ["in", courses or [""]], "is_active": 1}, pluck="name")
	)
	existing_filters = {
		"course": ["in", courses or [""]],
		"academic_term": term,
		"campus": campus,
		"status": ["!=", "Cancelled"],
	}
	existing = frappe.get_all(
		"Course Offering", filters=existing_filters, fields=["name", "course", "study_mode"]
	)
	covered = {e.course for e in existing if not study_mode or not e.study_mode or e.study_mode == study_mode}
	created, skipped = [], []
	for course in courses:
		if course in covered:
			skipped.append({"course": course, "reason": _("Already offered")})
			continue
		if course not in active:
			skipped.append({"course": course, "reason": _("Course is inactive")})
			continue
		doc = frappe.get_doc(
			{
				"doctype": "Course Offering",
				"course": course,
				"academic_term": term,
				"campus": campus,
				"study_mode": study_mode or None,
				"section": "A",
				"status": "Planned",
			}
		)
		doc.insert()
		created.append(doc.name)
	return {
		"term": term,
		"term_number": term_number,
		"programmes": programmes,
		"created": len(created),
		"skipped": len(skipped),
		"offerings": created,
		"skipped_courses": skipped,
	}


@frappe.whitelist()
def academics_stats(term=None):
	require_staff()
	term = term or current_term()
	offering_status = {
		r.status: cint(r.n)
		for r in frappe.get_all(
			"Course Offering",
			filters={"academic_term": term or ""},
			fields=["status", {"COUNT": "*", "as": "n"}],
			group_by="status",
		)
	}
	results_status = {
		r.results_status or "Not Started": cint(r.n)
		for r in frappe.get_all(
			"Course Offering",
			filters={"academic_term": term or "", "status": ["!=", "Cancelled"]},
			fields=["results_status", {"COUNT": "*", "as": "n"}],
			group_by="results_status",
		)
	}
	offerings = frappe.get_all(
		"Course Offering", filters={"academic_term": term or "", "status": ["!=", "Cancelled"]}, pluck="name"
	)
	staffed = set(
		frappe.get_all(
			"Course Offering Lecturer",
			filters={"parent": ["in", offerings or [""]], "parenttype": "Course Offering"},
			pluck="parent",
			distinct=True,
		)
	)
	today = getdate(nowdate())
	week_end = add_days(today, 6)
	return {
		"term": term,
		"programmes": {
			"active": frappe.db.count("Programme", {"status": "Active"}),
			"total": frappe.db.count("Programme"),
		},
		"courses": {
			"active": frappe.db.count("Course", {"is_active": 1}),
			"total": frappe.db.count("Course"),
		},
		"offerings": {
			"total": sum(offering_status.values()),
			"by_status": offering_status,
			"without_lecturer": len([o for o in offerings if o not in staffed]),
		},
		"enrolments": frappe.db.count(
			"Course Enrolment", {"academic_term": term or "", "status": "Enrolled"}
		),
		"sessions_this_week": frappe.db.count(
			"Class Session",
			{
				"course_offering": ["in", offerings or [""]],
				"session_date": ["between", [today, week_end]],
				"status": ["!=", "Cancelled"],
			},
		),
		"results_status": results_status,
	}


# ---------------------------------------------------------------------------------- sessions (M21)
def _session_lecturer(offering: str, lecturer: str | None) -> str | None:
	rows = frappe.get_all(
		"Course Offering Lecturer",
		filters={"parent": offering, "parenttype": "Course Offering"},
		fields=["staff_member", "user", "role"],
		order_by="idx asc",
	)
	if lecturer:
		if lecturer not in {r.staff_member for r in rows}:
			frappe.throw(_("{0} does not teach this course offering.").format(lecturer))
		return lecturer
	mine = next((r.staff_member for r in rows if r.user == frappe.session.user), None)
	if mine:
		return mine
	lead = next((r.staff_member for r in rows if r.role == "Lead"), None)
	return lead or (rows[0].staff_member if rows else None)


def session_dict(name: str) -> dict:
	row = frappe.db.get_value("Class Session", name, SESSION_FIELDS, as_dict=True)
	if row:
		row["lecturer_name"] = (
			frappe.db.get_value("Staff Member", row.lecturer, "full_name") if row.lecturer else None
		)
	return row


@frappe.whitelist()
def list_sessions(offering, from_date=None, to_date=None, status=None):
	require_offering_reader(offering)
	filters = {"course_offering": offering}
	if from_date and to_date:
		filters["session_date"] = ["between", [getdate(from_date), getdate(to_date)]]
	elif from_date:
		filters["session_date"] = [">=", getdate(from_date)]
	elif to_date:
		filters["session_date"] = ["<=", getdate(to_date)]
	if status:
		filters["status"] = status
	data = frappe.get_all(
		"Class Session", filters=filters, fields=SESSION_FIELDS, order_by="session_date asc, start_time asc"
	)
	return {"data": data, "total": len(data)}


@frappe.whitelist(methods=["POST"])
def create_session(
	offering,
	date,
	start,
	end,
	venue=None,
	topic=None,
	mode="In Person",
	meeting_url=None,
	lecturer=None,
	notes=None,
	repeat_weeks=0,
):
	"""Schedule a class session; `repeat_weeks` adds the same slot weekly for N more weeks."""
	require_teaching(offering)
	repeat = cint(repeat_weeks)
	if repeat < 0 or repeat > MAX_REPEAT_WEEKS:
		frappe.throw(_("Repeat weeks must be between 0 and {0}.").format(MAX_REPEAT_WEEKS))
	staff = _session_lecturer(offering, lecturer)
	first = getdate(date)
	names = []
	for week in range(repeat + 1):
		doc = frappe.get_doc(
			{
				"doctype": "Class Session",
				"course_offering": offering,
				"session_date": add_days(first, 7 * week),
				"start_time": start,
				"end_time": end,
				"venue": (venue or "").strip() or None,
				"topic": topic,
				"mode": mode or "In Person",
				"meeting_link": meeting_url,
				"lecturer": staff,
				"notes": notes,
				"status": "Scheduled",
			}
		)
		doc.insert(ignore_permissions=True)
		names.append(doc.name)
	out = session_dict(names[0])
	out["series"] = names
	return out


def _get_session(session: str):
	ensure_exists("Class Session", session, _("Class Session"))
	doc = frappe.get_doc("Class Session", session)
	require_lecturer_of(doc.course_offering)
	return doc


@frappe.whitelist(methods=["POST"])
def update_session(session, data):
	doc = _get_session(session)
	data = parse_json(data, {}) or {}
	values = clean_payload(data, SESSION_EDITABLE)
	if "meeting_url" in data:
		values["meeting_link"] = data.get("meeting_url")
	if "lecturer" in values:
		values["lecturer"] = _session_lecturer(doc.course_offering, values["lecturer"])
	moved = any(
		k in values and str(values[k] or "") != str(doc.get(k) or "")
		for k in ("session_date", "start_time", "end_time")
	)
	if moved and doc.status == "Held":
		frappe.throw(_("This session has already been held."))
	doc.update(values)
	if moved and doc.status == "Scheduled":
		doc.status = "Rescheduled"
	doc.save(ignore_permissions=True)
	return session_dict(doc.name)


@frappe.whitelist(methods=["POST"])
def cancel_session(session, reason=None):
	doc = _get_session(session)
	if doc.status == "Held":
		frappe.throw(_("A session that has been held cannot be cancelled."))
	doc.status = "Cancelled"
	if reason:
		doc.notes = ((doc.notes or "") + "\n" + _("Cancelled: {0}").format(reason)).strip()
	doc.save(ignore_permissions=True)
	return session_dict(doc.name)


@frappe.whitelist()
def session_roster(session):
	"""Attendance sheet pre-filled with enrolled students (existing marks kept, others default Present)."""
	doc = _get_session(session)
	marked = {r.student: r for r in doc.attendance}
	roster = enrolled_students(doc.course_offering, ("Enrolled", "Completed", "Failed"))
	students = list(dict.fromkeys(roster + list(marked)))
	info = {
		s.name: s
		for s in frappe.get_all(
			"Student",
			filters={"name": ["in", students or [""]]},
			fields=["name", "full_name", "student_number", "photo"],
		)
	}
	rows = []
	for s in students:
		r = marked.get(s)
		rows.append(
			{
				"student": s,
				"student_name": (info.get(s) or {}).get("full_name"),
				"student_number": (info.get(s) or {}).get("student_number"),
				"photo": (info.get(s) or {}).get("photo"),
				"status": r.status if r else "Present",
				"remarks": r.remarks if r else None,
				"marked": bool(r),
			}
		)
	rows.sort(key=lambda r: ((r["student_name"] or "").casefold(), r["student"]))
	return {"session": session_dict(doc.name), "rows": rows}


@frappe.whitelist(methods=["POST"])
def take_attendance(session, rows):
	"""rows: [{student, status: Present|Absent|Late|Excused, remarks?}]. Unlisted enrolled students = Present."""
	doc = _get_session(session)
	if doc.status == "Cancelled":
		frappe.throw(_("Attendance cannot be taken for a cancelled session."))
	if getdate(doc.session_date) > getdate(nowdate()):
		frappe.throw(_("Attendance can only be taken on or after the session date."))
	given = {}
	for r in _rows_payload(rows, _("Attendance")):
		if not isinstance(r, dict) or not r.get("student"):
			frappe.throw(_("Each attendance row needs a student."))
		given[r["student"]] = r
	roster = enrolled_students(doc.course_offering, ("Enrolled", "Completed", "Failed"))
	unknown = [s for s in given if s not in set(roster) and s not in {a.student for a in doc.attendance}]
	if unknown:
		frappe.throw(_("Not enrolled in this course: {0}").format(", ".join(unknown)))
	existing = {a.student: a for a in doc.attendance}
	table = []
	for s in list(dict.fromkeys(roster + list(existing))):
		r = given.get(s) or {}
		prev = existing.get(s)
		table.append(
			{
				"student": s,
				"status": r.get("status") or (prev.status if prev else "Present"),
				"remarks": (r.get("remarks") if "remarks" in r else (prev.remarks if prev else None)) or None,
			}
		)
	doc.set("attendance", table)
	if doc.status in ("Scheduled", "Rescheduled"):
		doc.status = "Held"
	doc.save(ignore_permissions=True)
	return {"ok": True, "session": session_dict(doc.name)}


# ---------------------------------------------------------------------------------- attendance maths
def attendance_percent(present: int, late: int, held: int, excused: int) -> float:
	"""(present + late) / (held - excused) * 100 (pure)."""
	return (
		pct(cint(present) + cint(late), cint(held) - cint(excused)) if cint(held) - cint(excused) > 0 else 0.0
	)


def attendance_summary(offerings, students=None) -> dict:
	"""{offering: {student: {held, present, late, absent, excused, percentage}}} from held sessions."""
	offerings = list(offerings or [])
	out = {o: {} for o in offerings}
	if not offerings:
		return out
	sessions = {
		s.name: s.course_offering
		for s in frappe.get_all(
			"Class Session",
			filters={"course_offering": ["in", offerings], "status": "Held", "attendance_taken": 1},
			fields=["name", "course_offering"],
		)
	}
	if not sessions:
		return out
	filters = {"parent": ["in", list(sessions)], "parenttype": "Class Session"}
	if students is not None:
		filters["student"] = ["in", list(students) or [""]]
	for r in frappe.get_all("Class Attendance", filters=filters, fields=["parent", "student", "status"]):
		stats = out[sessions[r.parent]].setdefault(
			r.student, {"held": 0, "present": 0, "late": 0, "absent": 0, "excused": 0}
		)
		stats["held"] += 1
		key = (r.status or "Present").lower()
		stats[key] = stats.get(key, 0) + 1
	for per_student in out.values():
		for stats in per_student.values():
			stats["percentage"] = attendance_percent(
				stats["present"], stats["late"], stats["held"], stats["excused"]
			)
	return out


@frappe.whitelist()
def my_timetable(from_date=None, to_date=None):
	student = require_student()
	start = getdate(from_date) if from_date else getdate(nowdate())
	end = getdate(to_date) if to_date else add_days(start, 6)
	if end < start:
		frappe.throw(_("The end date must be after the start date."))
	if (end - start).days > 120:
		frappe.throw(_("Choose a range of at most 120 days."))
	offerings = student_offerings(student.name, ENROLLED)
	sessions = frappe.get_all(
		"Class Session",
		filters={"course_offering": ["in", offerings or [""]], "session_date": ["between", [start, end]]},
		fields=SESSION_FIELDS,
		order_by="session_date asc, start_time asc",
	)
	lecturer_names = dict(
		frappe.get_all(
			"Staff Member",
			filters={"name": ["in", list({s.lecturer for s in sessions if s.lecturer}) or [""]]},
			fields=["name", "full_name"],
			as_list=True,
		)
	)
	for s in sessions:
		s["lecturer_name"] = lecturer_names.get(s.lecturer)
		s.pop("notes", None)
		if s.status == "Cancelled":
			s["meeting_link"] = None
	exams = frappe.get_all(
		"Exam",
		filters={
			"course_offering": ["in", offerings or [""]],
			"status": ["in", ["Scheduled", "Open", "Closed"]],
			"start_datetime": ["<=", f"{end} 23:59:59"],
			"end_datetime": [">=", f"{start} 00:00:00"],
		},
		fields=[
			"name",
			"title",
			"exam_type",
			"course_offering",
			"course_title",
			"start_datetime",
			"end_datetime",
			"delivery_mode",
			"venue",
			"status",
		],
		order_by="start_datetime asc",
	)
	return {"from_date": start, "to_date": end, "sessions": sessions, "exams": exams}


@frappe.whitelist()
def my_attendance(offering=None):
	student = require_student()
	if offering:
		require_enrolled(offering)
		offerings = [offering]
	else:
		offerings = student_offerings(student.name)
	summary = attendance_summary(offerings, [student.name])
	titles = dict(
		frappe.get_all(
			"Course Offering",
			filters={"name": ["in", offerings or [""]]},
			fields=["name", "course_title"],
			as_list=True,
		)
	)
	data = []
	for o in offerings:
		stats = summary.get(o, {}).get(student.name) or {
			"held": 0,
			"present": 0,
			"late": 0,
			"absent": 0,
			"excused": 0,
			"percentage": 0.0,
		}
		data.append({"course_offering": o, "course_title": titles.get(o), **stats})
	out = {"data": data}
	if offering:
		sessions = frappe.get_all(
			"Class Session",
			filters={"course_offering": offering, "status": "Held", "attendance_taken": 1},
			fields=["name", "session_date", "start_time", "topic"],
			order_by="session_date desc",
		)
		marks = {
			r.parent: r
			for r in frappe.get_all(
				"Class Attendance",
				filters={
					"parent": ["in", [s.name for s in sessions] or [""]],
					"parenttype": "Class Session",
					"student": student.name,
				},
				fields=["parent", "status", "remarks"],
			)
		}
		out["sessions"] = [
			{**s, "status": marks[s.name].status, "remarks": marks[s.name].remarks}
			for s in sessions
			if s.name in marks
		]
	return out


@frappe.whitelist()
def attendance_report(offering):
	require_offering_reader(offering)
	roster = enrolled_students(offering)
	sessions = frappe.get_all(
		"Class Session",
		filters={"course_offering": offering, "status": ["!=", "Cancelled"]},
		fields=[
			"name",
			"session_date",
			"start_time",
			"topic",
			"status",
			"attendance_taken",
			"present_count",
			"absent_count",
		],
		order_by="session_date asc, start_time asc",
	)
	stats = attendance_summary([offering]).get(offering, {})
	names = {
		s.name: s
		for s in frappe.get_all(
			"Student",
			filters={"name": ["in", list(set(roster) | set(stats)) or [""]]},
			fields=["name", "full_name", "student_number"],
		)
	}
	students = []
	for s in list(dict.fromkeys(roster + list(stats))):
		row = stats.get(s) or {
			"held": 0,
			"present": 0,
			"late": 0,
			"absent": 0,
			"excused": 0,
			"percentage": 0.0,
		}
		info = names.get(s) or {}
		students.append(
			{
				"student": s,
				"student_name": info.get("full_name"),
				"student_number": info.get("student_number"),
				**row,
			}
		)
	students.sort(key=lambda r: ((r["student_name"] or "").casefold(), r["student"]))
	held = [s for s in sessions if s.status == "Held" and cint(s.attendance_taken)]
	return {
		"offering": offering,
		"sessions": sessions,
		"held": len(held),
		"students": students,
		"average_percentage": round(sum(r["percentage"] for r in students) / len(students), 2)
		if students
		else 0.0,
	}
