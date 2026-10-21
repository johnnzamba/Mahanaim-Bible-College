"""Assignments & CATs (M09). Lecturer grading workflow and the student submission portal.

See docs/api/assessments.md.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cint, flt, get_datetime, now_datetime

from mahanaim.api.academics import doc_dict, ensure_exists, require_enrolled, require_teaching
from mahanaim.api.learning import serve_file
from mahanaim.api.utils import clean_payload, parse_json, require_login, require_student
from mahanaim.services import assessments as svc

ASSIGNMENT_FIELDS = (
	"title",
	"assessment_component",
	"instructions",
	"attachment",
	"open_date",
	"due_date",
	"max_score",
	"submission_type",
	"allowed_file_types",
	"allow_late",
	"late_penalty_percent_per_day",
	"late_cutoff",
	"max_late_penalty_percent",
)
ASSIGNMENT_LIST_FIELDS = [
	"name",
	"title",
	"course_offering",
	"course_title",
	"academic_term",
	"assessment_component",
	"status",
	"open_date",
	"due_date",
	"late_cutoff",
	"allow_late",
	"max_score",
	"submission_type",
	"submission_count",
	"graded_count",
	"average_score",
]
SUBMISSION_FIELDS = [
	"name",
	"assignment",
	"student",
	"student_name",
	"status",
	"submitted_on",
	"is_late",
	"days_late",
	"answer_text",
	"attachment",
	"raw_score",
	"penalty",
	"final_score",
	"feedback",
	"feedback_attachment",
	"graded_by",
	"graded_on",
	"released",
]
STUDENT_FILTERS = ("pending", "submitted", "graded", "overdue")


def _assignment(name: str):
	ensure_exists("Assignment", name)
	doc = frappe.get_doc("Assignment", name)
	require_teaching(doc.course_offering)
	return doc


def _submission(name: str):
	ensure_exists("Assignment Submission", name, _("Submission"))
	doc = frappe.get_doc("Assignment Submission", name)
	require_teaching(doc.course_offering)
	return doc


def _assignment_dict(doc) -> dict:
	out = doc_dict(doc)
	out["enrolled_count"] = len(svc.enrolled_students(doc.course_offering, svc.ENROLLED))
	return out


# ---------------------------------------------------------------------------------- lecturer
@frappe.whitelist()
def list_assignments(offering, status=None):
	require_teaching(offering)
	filters = {"course_offering": offering}
	if status:
		filters["status"] = status
	data = frappe.get_all(
		"Assignment", filters=filters, fields=ASSIGNMENT_LIST_FIELDS, order_by="due_date asc"
	)
	enrolled = len(svc.enrolled_students(offering, svc.ENROLLED))
	released = {
		r.assignment: cint(r.n)
		for r in frappe.get_all(
			"Assignment Submission",
			filters={"assignment": ["in", [d.name for d in data] or [""]], "released": 1},
			fields=["assignment", {"COUNT": "*", "as": "n"}],
			group_by="assignment",
		)
	}
	for d in data:
		d["enrolled_count"] = enrolled
		d["released_count"] = released.get(d.name, 0)
		d["to_grade"] = max(cint(d.submission_count) - cint(d.graded_count), 0)
	return {"data": data, "total": len(data)}


@frappe.whitelist()
def get_assignment(name):
	return _assignment_dict(_assignment(name))


@frappe.whitelist(methods=["POST"])
def save_assignment(data):
	data = parse_json(data, {}) or {}
	values = clean_payload(data, ASSIGNMENT_FIELDS)
	if data.get("name"):
		doc = _assignment(data["name"])
	else:
		offering = data.get("course_offering")
		require_teaching(offering)
		doc = frappe.new_doc("Assignment")
		doc.course_offering = offering
		doc.status = "Draft"
	file_name = None
	if values.get("attachment") and values["attachment"] != doc.get("attachment"):
		file_name = svc._validate_attachment(values["attachment"], None, frappe.session.user)
	doc.update(values)
	doc.save(ignore_permissions=True)
	svc.attach_file(file_name, "Assignment", doc.name, "attachment")
	return _assignment_dict(doc)


def _set_status(name: str, status: str):
	doc = _assignment(name)
	doc.status = status
	doc.save(ignore_permissions=True)
	return _assignment_dict(doc)


@frappe.whitelist(methods=["POST"])
def publish_assignment(name):
	"""Draft/Closed -> Published (notifies enrolled students on first publication)."""
	return _set_status(name, "Published")


@frappe.whitelist(methods=["POST"])
def close_assignment(name):
	return _set_status(name, "Closed")


@frappe.whitelist(methods=["POST"])
def delete_assignment(name):
	doc = _assignment(name)
	doc.delete(ignore_permissions=True)
	return {"ok": True, "name": name}


@frappe.whitelist()
def list_submissions(assignment, status=None):
	"""All submissions plus a 'Not Submitted' row for each enrolled student without one."""
	doc = _assignment(assignment)
	rows = frappe.get_all(
		"Assignment Submission",
		filters={"assignment": assignment},
		fields=SUBMISSION_FIELDS,
		order_by="student_name asc",
	)
	have = {r.student for r in rows}
	missing = [s for s in svc.enrolled_students(doc.course_offering, svc.ENROLLED) if s not in have]
	info = {
		r.name: r
		for r in frappe.get_all(
			"Student",
			filters={"name": ["in", list(have | set(missing)) or [""]]},
			fields=["name", "student_number", "full_name"],
		)
	}
	for r in rows:
		r["student_number"] = (info.get(r.student) or {}).get("student_number")
	rows += [
		frappe._dict(
			name=None,
			assignment=assignment,
			student=s,
			student_name=(info.get(s) or {}).get("full_name"),
			student_number=(info.get(s) or {}).get("student_number"),
			status="Not Submitted",
		)
		for s in missing
	]
	if status:
		rows = [r for r in rows if r.status == status]
	rows.sort(key=lambda r: ((r.student_name or "").casefold(), r.student))
	return {"assignment": _assignment_dict(doc), "data": rows, "total": len(rows)}


@frappe.whitelist(methods=["POST"])
def grade_submission(name, raw_score, feedback=None, feedback_attachment=None, release=0):
	_submission(name)
	doc = svc.grade(name, raw_score, feedback, feedback_attachment, released=1 if cint(release) else None)
	return doc_dict(doc)


@frappe.whitelist(methods=["POST"])
def bulk_grade(assignment, rows, release=0):
	"""rows: [{submission? | student, raw_score, feedback?}]. All-or-nothing (any error rolls back)."""
	doc = _assignment(assignment)
	rows = parse_json(rows, []) or []
	if not isinstance(rows, list) or not rows:
		frappe.throw(_("Provide at least one row to grade."))
	by_student = dict(
		frappe.get_all(
			"Assignment Submission",
			filters={"assignment": assignment},
			fields=["student", "name"],
			as_list=True,
		)
	)
	graded = []
	for r in rows:
		if not isinstance(r, dict) or r.get("raw_score") in (None, ""):
			continue
		name = r.get("submission") or by_student.get(r.get("student"))
		if name:
			if frappe.db.get_value("Assignment Submission", name, "assignment") != assignment:
				frappe.throw(_("Submission {0} does not belong to this assignment.").format(name))
			sub = svc.grade(
				name, r.get("raw_score"), r.get("feedback"), released=1 if cint(release) else None
			)
		elif r.get("student"):
			sub = svc.grade_offline(assignment, r["student"], r.get("raw_score"), r.get("feedback"))
			if cint(release):
				sub = svc.grade(sub.name, r.get("raw_score"), released=1)
		else:
			frappe.throw(_("Each row needs a submission or a student."))
		graded.append(sub.name)
	svc.refresh_assignment_counters(doc.name)
	return {"ok": True, "graded": len(graded), "submissions": graded}


@frappe.whitelist(methods=["POST"])
def release_grades(assignment):
	_assignment(assignment)
	count = svc.release_grades(assignment)
	return {"ok": True, "released": count}


@frappe.whitelist()
def assignment_stats(assignment):
	doc = _assignment(assignment)
	rows = frappe.get_all(
		"Assignment Submission",
		filters={"assignment": assignment},
		fields=["status", "final_score", "is_late", "released"],
	)
	enrolled = len(svc.enrolled_students(doc.course_offering, svc.ENROLLED))
	submitted = [r for r in rows if r.status in svc.SUBMITTED_STATUSES]
	graded = [r for r in rows if r.status in svc.GRADED_STATUSES]
	pcts = [flt(r.final_score) * 100.0 / flt(doc.max_score) for r in graded if flt(doc.max_score)]
	buckets = [{"range": f"{lo}-{lo + 9 if lo < 90 else 100}", "count": 0} for lo in range(0, 100, 10)]
	for p in pcts:
		buckets[min(int(p // 10), 9)]["count"] += 1
	scores = [flt(r.final_score) for r in graded]
	return {
		"assignment": assignment,
		"max_score": flt(doc.max_score),
		"enrolled": enrolled,
		"submitted": len(submitted),
		"not_submitted": max(enrolled - len(submitted), 0),
		"late": len([r for r in submitted if cint(r.is_late)]),
		"graded": len(graded),
		"released": len([r for r in graded if cint(r.released)]),
		"to_grade": len(submitted) - len(graded),
		"average": round(sum(scores) / len(scores), 2) if scores else 0.0,
		"highest": max(scores) if scores else 0.0,
		"lowest": min(scores) if scores else 0.0,
		"distribution": buckets,
	}


# ---------------------------------------------------------------------------------- student
def _student_submission_view(sub) -> dict | None:
	if not sub:
		return None
	released = cint(sub.get("released"))
	out = {
		k: sub.get(k)
		for k in (
			"name",
			"status",
			"submitted_on",
			"is_late",
			"days_late",
			"answer_text",
			"attachment",
			"released",
		)
	}
	if released:
		for k in ("raw_score", "penalty", "final_score", "feedback", "graded_on"):
			out[k] = sub.get(k)
		out["has_feedback_attachment"] = bool(sub.get("feedback_attachment"))
	elif out["status"] in svc.GRADED_STATUSES:
		out["status"] = "Submitted" if not cint(sub.get("is_late")) else "Late"
	return out


def _student_state(a, sub, now) -> str:
	if sub and cint(sub.get("released")):
		return "graded"
	if sub and sub.get("status") in svc.SUBMITTED_STATUSES:
		return "submitted"
	if now > get_datetime(a.due_date) and not svc.submission_window(a, sub, now)["can_submit"]:
		return "overdue"
	return "pending"


@frappe.whitelist()
def my_assignments(status=None, offering=None):
	"""status: pending | submitted | graded | overdue (optional)."""
	student = require_student()
	if status and status not in STUDENT_FILTERS:
		frappe.throw(_("Unknown status filter {0}.").format(status))
	if offering:
		require_enrolled(offering)
		offerings = [offering]
	else:
		offerings = svc.student_offerings(student.name)
	if not offerings:
		return {"data": [], "total": 0}
	data = frappe.get_all(
		"Assignment",
		filters={"course_offering": ["in", offerings], "status": ["in", ["Published", "Closed", "Graded"]]},
		fields=[*ASSIGNMENT_LIST_FIELDS[:12], "submission_type"],
		order_by="due_date desc",
	)
	subs = {
		s.assignment: s
		for s in frappe.get_all(
			"Assignment Submission",
			filters={"student": student.name, "assignment": ["in", [d.name for d in data] or [""]]},
			fields=SUBMISSION_FIELDS,
		)
	}
	now = now_datetime()
	out = []
	for d in data:
		sub = subs.get(d.name)
		window = svc.submission_window(d, sub, now)
		d["state"] = _student_state(d, sub, now)
		d["can_submit"] = window["can_submit"]
		d["reason"] = window["reason"]
		d["submission"] = _student_submission_view(sub)
		if not status or d["state"] == status:
			out.append(d)
	return {"data": out, "total": len(out)}


def _student_assignment(name: str):
	ensure_exists("Assignment", name)
	a = frappe.get_doc("Assignment", name)
	student = require_enrolled(a.course_offering)
	if a.status == "Draft":
		frappe.throw(_("Assignment not found."), frappe.DoesNotExistError)
	return student, a


@frappe.whitelist()
def get_my_assignment(name):
	student, a = _student_assignment(name)
	sub_name = frappe.db.get_value("Assignment Submission", {"assignment": name, "student": student.name})
	sub = (
		frappe.db.get_value("Assignment Submission", sub_name, SUBMISSION_FIELDS, as_dict=True)
		if sub_name
		else None
	)
	now = now_datetime()
	window = svc.submission_window(a, sub, now)
	return {
		"assignment": {
			**{
				k: a.get(k)
				for k in (
					"name",
					"title",
					"course_offering",
					"course_title",
					"assessment_component",
					"status",
					"instructions",
					"open_date",
					"due_date",
					"late_cutoff",
					"allow_late",
					"max_score",
					"submission_type",
					"allowed_file_types",
					"late_penalty_percent_per_day",
					"max_late_penalty_percent",
				)
			},
			"has_attachment": bool(a.attachment),
		},
		"submission": _student_submission_view(sub),
		"state": _student_state(a, sub, now),
		"can_submit": window["can_submit"],
		"reason": window["reason"],
		"is_late": window["is_late"],
		"server_time": now,
	}


@frappe.whitelist(methods=["POST"])
def submit_assignment(assignment, answer_text=None, attachment=None):
	student, _a = _student_assignment(assignment)
	doc = svc.submit(assignment, student.name, answer_text, attachment)
	return {"ok": True, "submission": _student_submission_view(doc.as_dict())}


@frappe.whitelist()
def download_assignment_file(name, kind="brief"):
	"""kind=brief: the assignment's attachment (enrolled students / teaching staff).
	kind=feedback: a submission's feedback file (`name` = submission; owner after release, or teaching staff)."""
	require_login()
	is_student = frappe.db.exists("Student", {"user": frappe.session.user})
	if kind == "brief":
		ensure_exists("Assignment", name)
		a = frappe.db.get_value("Assignment", name, ["course_offering", "attachment", "status"], as_dict=True)
		if is_student:
			_student_assignment(name)
		else:
			require_teaching(a.course_offering)
		url = a.attachment
	elif kind == "feedback":
		ensure_exists("Assignment Submission", name, _("Submission"))
		s = frappe.db.get_value(
			"Assignment Submission",
			name,
			["student", "course_offering", "feedback_attachment", "released"],
			as_dict=True,
		)
		if is_student:
			student = require_student()
			if s.student != student.name or not cint(s.released):
				frappe.throw(_("Submission not found."), frappe.PermissionError)
		else:
			require_teaching(s.course_offering)
		url = s.feedback_attachment
	else:
		frappe.throw(_("kind must be 'brief' or 'feedback'."))
	if not url:
		frappe.throw(_("There is no file to download."))
	serve_file(url)
