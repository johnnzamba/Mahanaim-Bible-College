"""Digital learning: native course content (modules/resources/progress) and the Frappe LMS bridge (M08).

See docs/api/learning.md.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cint, flt, now_datetime, nowdate

from mahanaim.api.academics import (
	doc_dict,
	ensure_exists,
	offering_lecturers,
	require_academic_admin,
	require_enrolled,
	require_teaching,
)
from mahanaim.api.utils import clean_payload, parse_json, require_login, require_student
from mahanaim.services import lms_bridge
from mahanaim.services.assessments import _validate_attachment, student_offerings

MODULE_FIELDS = ("module_title", "week", "sequence", "is_published", "description")
RESOURCE_FIELDS = (
	"title",
	"course_module",
	"resource_type",
	"sequence",
	"is_published",
	"downloadable",
	"duration_minutes",
	"file",
	"url",
	"embed_url",
	"body",
)
RESOURCE_LIST_FIELDS = [
	"name",
	"title",
	"course_offering",
	"course_module",
	"resource_type",
	"sequence",
	"is_published",
	"downloadable",
	"duration_minutes",
	"file",
	"url",
	"embed_url",
	"lms_lesson",
]
VIEWABLE_TYPES = ("Video", "Audio", "Image", "PDF")
BRIDGE_SETTINGS = (
	"enabled",
	"auto_create_courses",
	"auto_enrol_students",
	"publish_on_create",
	"remove_enrolment_on_drop",
)


# ---------------------------------------------------------------------------------- bridge (staff)
@frappe.whitelist()
def bridge_status():
	require_academic_admin()
	return lms_bridge.bridge_status()


@frappe.whitelist(methods=["POST"])
def save_bridge_settings(data):
	require_academic_admin()
	values = {k: cint(v) for k, v in clean_payload(data, BRIDGE_SETTINGS).items()}
	doc = frappe.get_doc("LMS Bridge Settings")
	doc.update(values)
	doc.save(ignore_permissions=True)
	return lms_bridge.bridge_status()


@frappe.whitelist(methods=["POST"])
def sync_offering_now(offering):
	require_academic_admin()
	ensure_exists("Course Offering", offering)
	lms_course = lms_bridge.sync_offering(offering)
	row = frappe.db.get_value(
		"Course Offering",
		offering,
		["lms_course", "lms_sync_status", "lms_last_synced", "lms_sync_error"],
		as_dict=True,
	)
	return {
		"ok": bool(lms_course),
		"offering": offering,
		**row,
		"lms_url": lms_bridge.lms_course_url(offering),
	}


@frappe.whitelist(methods=["POST"])
def full_sync(term=None):
	require_academic_admin()
	if term:
		ensure_exists("Academic Term", term)
	job_id = f"mbc-lms-full-sync-{term or 'all'}"
	frappe.enqueue(
		"mahanaim.services.lms_bridge.full_sync",
		term=term or None,
		queue="long",
		timeout=3600,
		job_id=job_id,
		deduplicate=True,
		enqueue_after_commit=True,
	)
	return {"ok": True, "queued": True, "job_id": job_id, "installed": lms_bridge.lms_available()}


@frappe.whitelist(methods=["POST"])
def retry_failed():
	require_academic_admin()
	return lms_bridge.retry_failed()


# ---------------------------------------------------------------------------------- content (lecturer)
def _resource_view(r, progress: dict | None = None) -> dict:
	item = dict(r)
	if r.get("file"):
		item["download_url"] = (
			f"/api/method/mahanaim.api.learning.download_resource?resource={r['name']}"
			if cint(r.get("downloadable")) or r.get("resource_type") in VIEWABLE_TYPES
			else None
		)
	if progress is not None:
		p = progress.get(r["name"])
		item["progress"] = (
			{"status": p.status, "progress": flt(p.progress), "last_accessed": p.last_accessed} if p else None
		)
	return item


def course_content(offering: str, published_only: bool, progress: dict | None = None) -> dict:
	"""Modules (ordered) with their resources plus un-grouped resources."""
	mfilters = {"course_offering": offering}
	rfilters = {"course_offering": offering}
	if published_only:
		mfilters["is_published"] = 1
		rfilters["is_published"] = 1
	modules = frappe.get_all(
		"Course Module",
		filters=mfilters,
		fields=["name", "module_title", "week", "sequence", "is_published", "description"],
		order_by="sequence asc, week asc, creation asc",
	)
	resources = frappe.get_all(
		"Learning Resource",
		filters=rfilters,
		fields=[*RESOURCE_LIST_FIELDS, "body"],
		order_by="sequence asc, creation asc",
	)
	visible = {m.name for m in modules}
	by_module = {}
	loose = []
	for r in resources:
		if r.course_module and r.course_module in visible:
			by_module.setdefault(r.course_module, []).append(_resource_view(r, progress))
		elif not r.course_module or not published_only:
			loose.append(_resource_view(r, progress))
	for m in modules:
		m["resources"] = by_module.get(m.name, [])
	return {"modules": modules, "resources": loose}


@frappe.whitelist()
def list_modules(offering):
	require_teaching(offering)
	return {"offering": offering, **course_content(offering, published_only=False)}


def _owned_doc(doctype: str, name: str):
	ensure_exists(doctype, name)
	doc = frappe.get_doc(doctype, name)
	require_teaching(doc.course_offering)
	return doc


def _next_sequence(doctype: str, filters: dict) -> int:
	rows = frappe.get_all(doctype, filters=filters, fields=[{"MAX": "sequence", "as": "seq"}])
	return cint(rows[0].seq if rows else 0) + 1


@frappe.whitelist(methods=["POST"])
def save_module(data):
	data = parse_json(data, {}) or {}
	values = clean_payload(data, MODULE_FIELDS)
	if data.get("name"):
		doc = _owned_doc("Course Module", data["name"])
	else:
		offering = data.get("course_offering")
		require_teaching(offering)
		doc = frappe.new_doc("Course Module")
		doc.course_offering = offering
		if not cint(values.get("sequence")):
			values["sequence"] = _next_sequence("Course Module", {"course_offering": offering})
	doc.update(values)
	doc.save(ignore_permissions=True)
	return doc_dict(doc)


@frappe.whitelist(methods=["POST"])
def delete_module(name):
	doc = _owned_doc("Course Module", name)
	doc.delete(ignore_permissions=True)
	return {"ok": True, "name": name}


def _apply_order(doctype: str, offering: str, order, extra: dict | None = None) -> list[str]:
	names = [n for n in (parse_json(order, []) or []) if n]
	if not isinstance(names, list) or len(set(names)) != len(names):
		frappe.throw(_("Provide each item once, in the new order."))
	owned = set(frappe.get_all(doctype, filters={"course_offering": offering, **(extra or {})}, pluck="name"))
	stray = [n for n in names if n not in owned]
	if stray:
		frappe.throw(_("These items do not belong to this course: {0}").format(", ".join(stray)))
	for seq, name in enumerate(names, 1):
		frappe.db.set_value(doctype, name, "sequence", seq, update_modified=False)
	return names


@frappe.whitelist(methods=["POST"])
def reorder_modules(offering, order):
	"""order: module names in display order (sequence becomes 1..n)."""
	require_teaching(offering)
	_apply_order("Course Module", offering, order)
	return list_modules(offering)


@frappe.whitelist(methods=["POST"])
def reorder_resources(offering, order, module=None):
	require_teaching(offering)
	_apply_order("Learning Resource", offering, order, {"course_module": module} if module else None)
	return list_modules(offering)


@frappe.whitelist(methods=["POST"])
def save_resource(data):
	"""Create/update a resource. Files: upload with /api/method/upload_file first, then pass its file_url."""
	data = parse_json(data, {}) or {}
	values = clean_payload(data, RESOURCE_FIELDS)
	if data.get("name"):
		doc = _owned_doc("Learning Resource", data["name"])
	else:
		offering = data.get("course_offering")
		if not offering and values.get("course_module"):
			offering = frappe.db.get_value("Course Module", values["course_module"], "course_offering")
		require_teaching(offering)
		doc = frappe.new_doc("Learning Resource")
		doc.course_offering = offering
		if not cint(values.get("sequence")):
			filters = {
				"course_offering": offering,
				"course_module": values.get("course_module") or ["is", "not set"],
			}
			values["sequence"] = _next_sequence("Learning Resource", filters)
	if values.get("file") and values["file"] != doc.get("file"):
		_validate_attachment(values["file"], None, frappe.session.user)
	doc.update(values)
	doc.save(ignore_permissions=True)
	return _resource_view(doc_dict(doc))


@frappe.whitelist(methods=["POST"])
def delete_resource(name):
	doc = _owned_doc("Learning Resource", name)
	doc.delete(ignore_permissions=True)
	return {"ok": True, "name": name}


@frappe.whitelist(methods=["POST"])
def publish_toggle(name, kind="resource", is_published=None):
	"""Publish/unpublish a resource (kind=resource) or module (kind=module); toggles when is_published is null."""
	doctype = {"resource": "Learning Resource", "module": "Course Module"}.get(kind)
	if not doctype:
		frappe.throw(_("kind must be 'resource' or 'module'."))
	doc = _owned_doc(doctype, name)
	doc.is_published = (
		(0 if cint(doc.is_published) else 1) if is_published in (None, "") else cint(is_published)
	)
	doc.save(ignore_permissions=True)
	return {"ok": True, "name": name, "kind": kind, "is_published": cint(doc.is_published)}


# ---------------------------------------------------------------------------------- student
def _progress_map(student: str, offerings) -> dict:
	return {
		p.learning_resource: p
		for p in frappe.get_all(
			"Learning Progress",
			filters={"student": student, "course_offering": ["in", list(offerings) or [""]]},
			fields=["learning_resource", "course_offering", "status", "progress", "last_accessed"],
		)
	}


def _published_resource_counts(offerings) -> dict:
	"""Visible resources per offering (published resource in a published module or un-grouped)."""
	offerings = list(offerings or [])
	if not offerings:
		return {}
	hidden_modules = set(
		frappe.get_all(
			"Course Module", filters={"course_offering": ["in", offerings], "is_published": 0}, pluck="name"
		)
	)
	out = {}
	for r in frappe.get_all(
		"Learning Resource",
		filters={"course_offering": ["in", offerings], "is_published": 1},
		fields=["name", "course_offering", "course_module"],
	):
		if r.course_module in hidden_modules:
			continue
		out.setdefault(r.course_offering, set()).add(r.name)
	return out


def progress_percent(visible: set, progress: dict) -> float:
	if not visible:
		return 0.0
	done = len([n for n in visible if progress.get(n) and progress[n].status == "Completed"])
	return round(done * 100.0 / len(visible), 1)


@frappe.whitelist()
def my_courses(term=None):
	student = require_student()
	offerings = student_offerings(student.name, ("Enrolled", "Completed", "Failed"), term)
	if not offerings:
		return {"data": [], "total": 0}
	rows = frappe.get_all(
		"Course Offering",
		filters={"name": ["in", offerings]},
		fields=[
			"name",
			"course",
			"course_title",
			"credits",
			"academic_term",
			"campus",
			"status",
			"lms_course",
			"lms_sync_status",
		],
		order_by="academic_term desc, course asc",
	)
	enrol_status = dict(
		frappe.get_all(
			"Course Enrolment",
			filters={"student": student.name, "course_offering": ["in", offerings]},
			fields=["course_offering", "status"],
			as_list=True,
		)
	)
	lecturers = offering_lecturers(offerings)
	visible = _published_resource_counts(offerings)
	progress = _progress_map(student.name, offerings)
	lms_on = lms_bridge.lms_available()
	for r in rows:
		r["enrolment_status"] = enrol_status.get(r.name)
		r["lecturers"] = [
			{"staff_name": lec.staff_name, "role": lec.role} for lec in lecturers.get(r.name, [])
		]
		synced = lms_on and r.lms_course and r.lms_sync_status == lms_bridge.SYNCED
		r["lms_url"] = f"/lms/courses/{r.lms_course}" if synced else None
		r["resource_count"] = len(visible.get(r.name, ()))
		r["progress"] = progress_percent(visible.get(r.name, set()), progress)
		r.pop("lms_course", None)
		r.pop("lms_sync_status", None)
	return {"data": rows, "total": len(rows)}


@frappe.whitelist()
def my_course(offering):
	student = require_enrolled(offering)
	off = frappe.db.get_value(
		"Course Offering",
		offering,
		[
			"name",
			"course",
			"course_title",
			"credits",
			"academic_term",
			"campus",
			"status",
			"start_date",
			"end_date",
		],
		as_dict=True,
	)
	course = frappe.db.get_value(
		"Course", off.course, ["course_code", "description", "learning_outcomes", "pass_mark"], as_dict=True
	)
	staff = offering_lecturers([offering]).get(offering, [])
	staff_info = {
		s.name: s
		for s in frappe.get_all(
			"Staff Member",
			filters={"name": ["in", [s.staff_member for s in staff] or [""]]},
			fields=["name", "full_name", "email", "photo", "designation"],
		)
	}
	progress = _progress_map(student.name, [offering])
	content = course_content(offering, published_only=True, progress=progress)
	visible = _published_resource_counts([offering]).get(offering, set())
	now = now_datetime()
	assignments = frappe.get_all(
		"Assignment",
		filters={"course_offering": offering, "status": "Published"},
		fields=[
			"name",
			"title",
			"assessment_component",
			"due_date",
			"late_cutoff",
			"allow_late",
			"max_score",
		],
		order_by="due_date asc",
	)
	submitted = dict(
		frappe.get_all(
			"Assignment Submission",
			filters={"student": student.name, "assignment": ["in", [a.name for a in assignments] or [""]]},
			fields=["assignment", "status"],
			as_list=True,
		)
	)
	for a in assignments:
		a["submission_status"] = submitted.get(a.name)
		a["is_overdue"] = bool(a.due_date and a.due_date < now and not submitted.get(a.name))
	exams = frappe.get_all(
		"Exam",
		filters={
			"course_offering": offering,
			"status": ["in", ["Scheduled", "Open"]],
			"end_datetime": [">=", now],
		},
		fields=[
			"name",
			"title",
			"exam_type",
			"start_datetime",
			"end_datetime",
			"duration_minutes",
			"delivery_mode",
			"venue",
			"status",
		],
		order_by="start_datetime asc",
	)
	announcements = frappe.get_all(
		"Announcement",
		filters={
			"audience": "Course Offering",
			"course_offering": offering,
			"status": "Sent",
			"show_in_portal": 1,
		},
		or_filters=[["expires_on", "is", "not set"], ["expires_on", ">=", nowdate()]],
		fields=["name", "title", "body", "attachment", "sent_on", "is_pinned"],
		order_by="is_pinned desc, sent_on desc",
		limit=20,
	)
	completed = len([n for n in visible if progress.get(n) and progress[n].status == "Completed"])
	return {
		"offering": {**off, **(course or {})},
		"lecturers": [
			{
				"staff_member": s.staff_member,
				"staff_name": s.staff_name,
				"role": s.role,
				"email": (staff_info.get(s.staff_member) or {}).get("email"),
				"photo": (staff_info.get(s.staff_member) or {}).get("photo"),
				"designation": (staff_info.get(s.staff_member) or {}).get("designation"),
			}
			for s in staff
		],
		"lms_url": lms_bridge.lms_course_url(offering),
		**content,
		"progress": {
			"completed": completed,
			"total": len(visible),
			"percentage": progress_percent(visible, progress),
		},
		"assignments": [a for a in assignments if a.due_date >= now or not a["submission_status"]],
		"exams": exams,
		"announcements": announcements,
	}


def _visible_resource(resource: str):
	ensure_exists("Learning Resource", resource, _("Resource"))
	r = frappe.db.get_value(
		"Learning Resource",
		resource,
		["name", "course_offering", "course_module", "is_published", "file", "downloadable", "resource_type"],
		as_dict=True,
	)
	student = require_enrolled(r.course_offering)
	hidden = r.course_module and not cint(
		frappe.db.get_value("Course Module", r.course_module, "is_published")
	)
	if not cint(r.is_published) or hidden:
		frappe.throw(_("Resource not found."), frappe.PermissionError)
	return student, r


@frappe.whitelist(methods=["POST"])
def mark_resource_complete(resource, progress=100):
	student, _r = _visible_resource(resource)
	value = max(0.0, min(100.0, flt(progress)))
	name = frappe.db.get_value("Learning Progress", {"student": student.name, "learning_resource": resource})
	doc = frappe.get_doc("Learning Progress", name) if name else frappe.new_doc("Learning Progress")
	if name and doc.status == "Completed" and value < 100:
		return {"ok": True, "resource": resource, "status": doc.status, "progress": flt(doc.progress)}
	doc.update(
		{
			"student": student.name,
			"learning_resource": resource,
			"progress": value,
			"status": "Completed" if value >= 100 else "In Progress",
		}
	)
	doc.save(ignore_permissions=True)
	return {"ok": True, "resource": resource, "status": doc.status, "progress": flt(doc.progress)}


def serve_file(file_url: str):
	"""Respond with a stored file: redirect for public files, stream private ones (caller checks access)."""
	file_name = frappe.db.get_value("File", {"file_url": file_url}, "name", order_by="creation desc")
	if not file_name:
		frappe.throw(_("The file could not be found."), frappe.DoesNotExistError)
	f = frappe.get_doc("File", file_name)
	if not cint(f.is_private):
		frappe.local.response["type"] = "redirect"
		frappe.local.response["location"] = f.file_url
		return
	frappe.local.response["filename"] = f.file_name
	frappe.local.response["filecontent"] = f.get_content()
	frappe.local.response["type"] = "download"


@frappe.whitelist()
def download_resource(resource):
	"""Serve a resource file to an enrolled student or the offering's teaching staff."""
	require_login()
	if frappe.db.exists("Student", {"user": frappe.session.user}):
		_, r = _visible_resource(resource)
		if not cint(r.downloadable) and r.resource_type not in VIEWABLE_TYPES:
			frappe.throw(_("This resource cannot be downloaded."), frappe.PermissionError)
	else:
		ensure_exists("Learning Resource", resource, _("Resource"))
		r = frappe.db.get_value(
			"Learning Resource", resource, ["name", "course_offering", "file"], as_dict=True
		)
		require_teaching(r.course_offering)
	if not r.file:
		frappe.throw(_("This resource has no file."))
	serve_file(r.file)
