"""Frappe LMS bridge (owned by backend domain B2). LMS is a SOFT dependency (has_app("lms")).

CONTRACT:
	sync_offering(offering) -> str | None      # create/update LMS Course for a Course Offering
	enrol(course_enrolment) -> str | None      # create LMS Enrollment; respects lms fee clearance
	unenrol(course_enrolment)                  # remove/deactivate LMS Enrollment
	lms_course_url(offering) -> str | None

Design
- The `lms` package is never imported: LMS doctypes are reached through the thin `_lms_*` adapters below
  (patched in tests) and payloads are built by pure functions (`build_course_payload`,
  `build_enrollment_payload`).
- When LMS is not installed every contract function returns None, the offering's `lms_sync_status` becomes
  "Not Installed" and the native Course Module / Learning Resource content is used instead.
- When LMS is installed but LMS Bridge Settings.enabled is off, nothing is touched.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cint, flt, now_datetime, strip_html

from mahanaim.utils import has_app, setting

LMS_APP = "lms"
SETTINGS = "LMS Bridge Settings"
NOT_INSTALLED = "Not Installed"
SYNCED = "Synced"
ERROR = "Error"


# ---------------------------------------------------------------------------------- settings
def lms_available() -> bool:
	return bool(has_app(LMS_APP))


def bridge_settings() -> frappe._dict:
	return frappe._dict(frappe.db.get_singles_dict(SETTINGS) or {})


def bridge_active(settings=None) -> bool:
	settings = settings or bridge_settings()
	return lms_available() and bool(cint(settings.get("enabled")))


# ---------------------------------------------------------------------------------- pure payload builders
def course_title_for(course_code: str, course_title: str, term_label: str | None) -> str:
	title = f"{course_code} — {course_title}"
	return f"{title} ({term_label})" if term_label else title


def build_course_payload(
	offering: dict, course: dict, term_label: str | None, instructors, publish: bool
) -> dict:
	"""Pure: LMS Course document payload for a Course Offering."""
	description = (offering.get("description") or course.get("description") or "").strip()
	plain = " ".join(strip_html(description).split())
	fallback = _("{0} ({1}) at Mahanaim Bible College.").format(
		course.get("course_title") or offering.get("course_title"),
		course.get("course_code") or course.get("name"),
	)
	users = [u for u in dict.fromkeys(instructors or []) if u]
	return {
		"doctype": "LMS Course",
		"title": course_title_for(
			course.get("course_code") or course.get("name"),
			course.get("course_title") or offering.get("course_title"),
			term_label,
		),
		"short_introduction": (plain or fallback)[:280],
		"description": description or f"<p>{fallback}</p>",
		"instructors": [{"instructor": u} for u in users],
		"published": 1 if publish else 0,
		"upcoming": 0,
		"paid_course": 0,
	}


def build_enrollment_payload(user: str, lms_course: str) -> dict:
	"""Pure: LMS Enrollment payload for a student user."""
	return {
		"doctype": "LMS Enrollment",
		"member": user,
		"course": lms_course,
		"member_type": "Student",
		"role": "Member",
	}


# ---------------------------------------------------------------------------------- LMS adapters (patched in tests)
def _lms_exists(doctype: str, name_or_filters) -> str | None:
	value = frappe.db.exists(doctype, name_or_filters)
	return (
		value
		if isinstance(value, str)
		else (name_or_filters if value and isinstance(name_or_filters, str) else None)
	)


def _lms_insert(payload: dict) -> str:
	doc = frappe.get_doc(payload)
	doc.insert(ignore_permissions=True)
	return doc.name


def _lms_update(doctype: str, name: str, values: dict) -> str:
	doc = frappe.get_doc(doctype, name)
	doc.update(values)
	doc.save(ignore_permissions=True)
	return doc.name


def _lms_delete(doctype: str, name: str):
	frappe.delete_doc(doctype, name, ignore_permissions=True, force=True)


# ---------------------------------------------------------------------------------- helpers
def _offering(offering):
	if isinstance(offering, str):
		return frappe.get_doc("Course Offering", offering)
	return offering


def _set_offering_sync(offering: str, status: str, lms_course: str | None = None, error: str | None = None):
	values = {"lms_sync_status": status, "lms_sync_error": (error or "")[:1000] or None}
	if lms_course is not None:
		values["lms_course"] = lms_course
	if status == SYNCED:
		values["lms_last_synced"] = now_datetime()
	frappe.db.set_value("Course Offering", offering, values, update_modified=False)


def _mark_not_installed(offering: str):
	_set_offering_sync(
		offering, NOT_INSTALLED, error=_("Frappe LMS is not installed; native course content is used.")
	)


def course_payload_for(off, settings=None) -> dict:
	settings = settings or bridge_settings()
	course = (
		frappe.db.get_value(
			"Course", off.course, ["name", "course_code", "course_title", "description"], as_dict=True
		)
		or {}
	)
	term_label = frappe.db.get_value("Academic Term", off.academic_term, "term_label") or off.academic_term
	instructors = [r.user for r in off.get("lecturers") or [] if r.user]
	missing = [r.staff_member for r in off.get("lecturers") or [] if not r.user]
	if missing:
		users = frappe.get_all("Staff Member", filters={"name": ["in", missing]}, pluck="user")
		instructors.extend(u for u in users if u)
	return build_course_payload(
		off.as_dict(), course, term_label, instructors, cint(settings.get("publish_on_create"))
	)


# ---------------------------------------------------------------------------------- contract
def sync_offering(offering) -> str | None:
	off = _offering(offering)
	if not lms_available():
		_mark_not_installed(off.name)
		return None
	settings = bridge_settings()
	if not cint(settings.get("enabled")):
		return None
	try:
		payload = course_payload_for(off, settings)
		existing = _lms_exists("LMS Course", off.lms_course) if off.get("lms_course") else None
		if existing:
			values = {
				k: v
				for k, v in payload.items()
				if k not in ("doctype", "published", "upcoming", "paid_course")
			}
			name = _lms_update("LMS Course", existing, values)
		else:
			if payload["published"]:
				payload["status"] = "Approved"
			name = _lms_insert(payload)
		_set_offering_sync(off.name, SYNCED, lms_course=name)
		off.lms_course, off.lms_sync_status = name, SYNCED
		return name
	except Exception as e:
		frappe.log_error(title=f"LMS sync failed: {off.name}")
		_set_offering_sync(off.name, ERROR, error=str(e) or e.__class__.__name__)
		return None


def enrol(course_enrolment) -> str | None:
	ce = (
		frappe.get_doc("Course Enrolment", course_enrolment)
		if isinstance(course_enrolment, str)
		else course_enrolment
	)
	if not lms_available():
		return None
	settings = bridge_settings()
	if not cint(settings.get("enabled")) or not cint(settings.get("auto_enrol_students")):
		return None
	if ce.status != "Enrolled":
		return None
	off = frappe.db.get_value(
		"Course Offering", ce.course_offering, ["name", "lms_course", "lms_sync_status"], as_dict=True
	)
	lms_course = off.lms_course if off and off.lms_course and off.lms_sync_status == SYNCED else None
	if not lms_course and cint(settings.get("auto_create_courses")):
		lms_course = sync_offering(ce.course_offering)
	if not lms_course:
		return None
	if flt(setting("lms_fee_clearance_percent", 0)) > 0:
		from mahanaim.services.exams import fee_clearance_state

		if not fee_clearance_state(ce.student, "lms").get("cleared"):
			return None
	user = frappe.db.get_value("Student", ce.student, "user")
	if not user:
		return None
	try:
		name = _lms_exists("LMS Enrollment", {"member": user, "course": lms_course})
		if not name:
			name = _lms_insert(build_enrollment_payload(user, lms_course))
	except Exception:
		frappe.log_error(title=f"LMS enrolment failed: {ce.name}")
		return None
	frappe.db.set_value("Course Enrolment", ce.name, "lms_enrollment", name, update_modified=False)
	ce.lms_enrollment = name
	return name


def unenrol(course_enrolment):
	ce = (
		frappe.get_doc("Course Enrolment", course_enrolment)
		if isinstance(course_enrolment, str)
		else course_enrolment
	)
	if not lms_available():
		return None
	settings = bridge_settings()
	if not cint(settings.get("enabled")) or not cint(settings.get("remove_enrolment_on_drop")):
		return None
	name = ce.get("lms_enrollment")
	if not name:
		lms_course = frappe.db.get_value("Course Offering", ce.course_offering, "lms_course")
		user = frappe.db.get_value("Student", ce.student, "user")
		name = (
			_lms_exists("LMS Enrollment", {"member": user, "course": lms_course})
			if lms_course and user
			else None
		)
	try:
		if name and _lms_exists("LMS Enrollment", name):
			_lms_delete("LMS Enrollment", name)
	except Exception:
		frappe.log_error(title=f"LMS unenrol failed: {ce.name}")
		return None
	if ce.get("lms_enrollment"):
		frappe.db.set_value("Course Enrolment", ce.name, "lms_enrollment", None, update_modified=False)
	return name


def lms_course_url(offering) -> str | None:
	name = offering if isinstance(offering, str) else offering.name
	row = frappe.db.get_value("Course Offering", name, ["lms_course", "lms_sync_status"], as_dict=True)
	if not row or not row.lms_course or row.lms_sync_status != SYNCED or not lms_available():
		return None
	return f"/lms/courses/{row.lms_course}"


# ---------------------------------------------------------------------------------- bulk operations
def full_sync(term: str | None = None) -> dict:
	"""Sync every (non-cancelled) offering of `term` (all when None) and enrol their students."""
	result = {"offerings": 0, "synced": 0, "failed": 0, "enrolled": 0, "installed": lms_available()}
	if not bridge_active():
		if not lms_available():
			filters = {"status": ["!=", "Cancelled"]}
			if term:
				filters["academic_term"] = term
			for name in frappe.get_all("Course Offering", filters=filters, pluck="name"):
				_mark_not_installed(name)
		return result
	filters = {"status": ["!=", "Cancelled"]}
	if term:
		filters["academic_term"] = term
	offerings = frappe.get_all("Course Offering", filters=filters, pluck="name")
	result["offerings"] = len(offerings)
	for name in offerings:
		if sync_offering(name):
			result["synced"] += 1
		else:
			result["failed"] += 1
		if not frappe.flags.in_test:
			frappe.db.commit()
	if offerings:
		for ce in frappe.get_all(
			"Course Enrolment",
			filters={
				"course_offering": ["in", offerings],
				"status": "Enrolled",
				"lms_enrollment": ["is", "not set"],
			},
			pluck="name",
		):
			if enrol(ce):
				result["enrolled"] += 1
	frappe.db.set_single_value(SETTINGS, "last_full_sync", now_datetime())
	return result


def retry_failed() -> dict:
	names = frappe.get_all("Course Offering", filters={"lms_sync_status": ERROR}, pluck="name")
	synced = len([n for n in names if sync_offering(n)])
	return {"retried": len(names), "synced": synced, "failed": len(names) - synced}


def bridge_status() -> dict:
	settings = bridge_settings()
	installed = lms_available()
	if cint(settings.get("lms_installed")) != int(installed):
		frappe.db.set_single_value(SETTINGS, "lms_installed", int(installed))
	counts = {
		r.lms_sync_status or "Not Synced": r.n
		for r in frappe.get_all(
			"Course Offering",
			filters={"status": ["!=", "Cancelled"]},
			fields=["lms_sync_status", {"COUNT": "*", "as": "n"}],
			group_by="lms_sync_status",
		)
	}
	return {
		"installed": installed,
		"enabled": bool(cint(settings.get("enabled"))),
		"active": installed and bool(cint(settings.get("enabled"))),
		"settings": {
			k: cint(settings.get(k))
			for k in (
				"auto_create_courses",
				"auto_enrol_students",
				"publish_on_create",
				"remove_enrolment_on_drop",
			)
		},
		"lms_fee_clearance_percent": flt(setting("lms_fee_clearance_percent", 0)),
		"last_full_sync": settings.get("last_full_sync"),
		"counts": counts,
		"synced": counts.get(SYNCED, 0),
		"failed": counts.get(ERROR, 0),
		"not_synced": counts.get("Not Synced", 0),
		"not_installed": counts.get(NOT_INSTALLED, 0),
		"enrolments_synced": frappe.db.count("Course Enrolment", {"lms_enrollment": ["is", "set"]}),
	}
