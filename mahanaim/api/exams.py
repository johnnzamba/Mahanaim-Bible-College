"""Online examinations (M10): question bank, exam set-up, the student exam room, marking and analytics.

Security rules: students never receive correct answers before release (and only when the exam allows it);
attempt ownership is checked on every call; all timing uses the server clock. See docs/api/exams.md.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cint, flt, get_datetime, now_datetime

from mahanaim.api.academics import (
	doc_dict,
	ensure_exists,
	is_academic_admin,
	is_academic_reader,
	persist_writes,
	require_academic_reader,
	require_teaching,
)
from mahanaim.api.utils import clean_payload, page_args, parse_json, require_lecturer, require_student
from mahanaim.services import exams as svc

EXAM_FIELDS = (
	"title",
	"exam_type",
	"assessment_component",
	"delivery_mode",
	"start_datetime",
	"end_datetime",
	"duration_minutes",
	"venue",
	"access_code",
	"pass_mark",
	"max_attempts",
	"shuffle_questions",
	"shuffle_options",
	"random_question_count",
	"require_fee_clearance",
	"show_answers_after_release",
	"auto_release_objective",
	"instructions",
)
EXAM_LIST_FIELDS = [
	"name",
	"title",
	"exam_type",
	"assessment_component",
	"course_offering",
	"course_title",
	"delivery_mode",
	"status",
	"start_datetime",
	"end_datetime",
	"duration_minutes",
	"total_marks",
	"pass_mark",
	"max_attempts",
	"attempt_count",
	"submitted_count",
	"average_score",
]
QUESTION_FIELDS = (
	"question_type",
	"question",
	"marks",
	"topic",
	"difficulty",
	"is_active",
	"correct_boolean",
	"accepted_answers",
	"case_sensitive",
	"marking_guide",
	"explanation",
)
QUESTION_LIST_FIELDS = [
	"name",
	"course",
	"question_type",
	"question_title",
	"marks",
	"topic",
	"difficulty",
	"is_active",
	"created_by_staff",
	"modified",
]
IMPORT_LETTERS = "ABCDEF"
MAX_IMPORT_ROWS = 500


# ---------------------------------------------------------------------------------- guards
def _exam(name: str):
	ensure_exists("Exam", name)
	doc = frappe.get_doc("Exam", name)
	require_teaching(doc.course_offering)
	return doc


def _attempt(name: str):
	ensure_exists("Exam Attempt", name, _("Exam Attempt"))
	doc = frappe.get_doc("Exam Attempt", name)
	require_teaching(doc.course_offering)
	return doc


def require_course_access(course: str) -> None:
	"""Academic administrators, or a lecturer who teaches (any offering of) `course`."""
	ensure_exists("Course", course)
	if is_academic_admin():
		return
	require_lecturer()
	taught = frappe.get_all(
		"Course Offering Lecturer",
		filters={"user": frappe.session.user, "parenttype": "Course Offering"},
		pluck="parent",
	)
	if not frappe.db.exists("Course Offering", {"name": ["in", taught or [""]], "course": course}):
		frappe.throw(_("You do not teach this course."), frappe.PermissionError)


def _question(name: str):
	ensure_exists("Question", name)
	doc = frappe.get_doc("Question", name)
	require_course_access(doc.course)
	return doc


# ---------------------------------------------------------------------------------- exams (lecturer)
@frappe.whitelist()
def list_exams(offering=None, status=None, academic_term=None, programme=None, start=0, limit=None):
	"""Per offering (its lecturers, academic administrators, Auditors): `{data, total}`.
	Term-wide, without `offering` (Registrar, Academic Dean, Auditor): `academic_term` required, optional
	`status`/`programme`, paginated with `start`/`limit`, returns `{rows, total, start, limit}`."""
	if not offering:
		return _term_exams(academic_term, status, programme, start, limit)
	if is_academic_reader():
		ensure_exists("Course Offering", offering)
	else:
		require_teaching(offering)
	filters = {"course_offering": offering}
	if status:
		filters["status"] = status
	data = frappe.get_all("Exam", filters=filters, fields=EXAM_LIST_FIELDS, order_by="start_datetime desc")
	_add_exam_counts(data)
	return {"data": data, "total": len(data)}


def _term_exams(term, status, programme, start, limit) -> dict:
	require_academic_reader()
	if not term:
		frappe.throw(_("Pass an offering or an academic_term."))
	ensure_exists("Academic Term", term)
	offering_filters = {"academic_term": term}
	if programme:
		ensure_exists("Programme", programme)
		courses = frappe.get_all(
			"Programme Course", filters={"parent": programme, "parenttype": "Programme"}, pluck="course"
		)
		offering_filters["course"] = ["in", courses or [""]]
	offerings = {
		o.name: o
		for o in frappe.get_all(
			"Course Offering", filters=offering_filters, fields=["name", "campus", "academic_term"]
		)
	}
	filters = {"course_offering": ["in", list(offerings) or [""]]}
	if status:
		filters["status"] = status
	args = page_args(start, limit or 50)
	rows = frappe.get_all(
		"Exam",
		filters=filters,
		fields=EXAM_LIST_FIELDS,
		order_by="start_datetime desc, name desc",
		start=args["start"],
		limit=args["page_length"],
	)
	_add_exam_counts(rows)
	for r in rows:
		off = offerings.get(r.course_offering) or {}
		r["campus"], r["academic_term"] = off.get("campus"), off.get("academic_term")
	return {
		"rows": rows,
		"total": frappe.db.count("Exam", filters),
		"start": args["start"],
		"limit": args["page_length"],
	}


def _add_exam_counts(data) -> None:
	"""to_mark (attempts awaiting marking) and question_count per exam row, batched."""
	pending = {
		r.exam: cint(r.n)
		for r in frappe.get_all(
			"Exam Attempt",
			filters={
				"exam": ["in", [d.name for d in data] or [""]],
				"status": ["in", list(svc.PENDING_ATTEMPT_STATUSES)],
			},
			fields=["exam", {"COUNT": "*", "as": "n"}],
			group_by="exam",
		)
	}
	counts = {
		r.parent: cint(r.n)
		for r in frappe.get_all(
			"Exam Question",
			filters={"parent": ["in", [d.name for d in data] or [""]], "parenttype": "Exam"},
			fields=["parent", {"COUNT": "*", "as": "n"}],
			group_by="parent",
		)
	}
	for d in data:
		d["to_mark"] = pending.get(d.name, 0)
		d["question_count"] = counts.get(d.name, 0)


def exam_dict(doc) -> dict:
	out = doc_dict(doc)
	names = [r.question for r in doc.questions]
	info = {
		q.name: q
		for q in frappe.get_all(
			"Question",
			filters={"name": ["in", names or [""]]},
			fields=["name", "question_title", "difficulty", "is_active"],
		)
	}
	out["questions"] = [
		{
			"question": r.question,
			"question_type": r.question_type,
			"topic": r.topic,
			"marks": flt(r.marks),
			"title": (info.get(r.question) or {}).get("question_title"),
			"difficulty": (info.get(r.question) or {}).get("difficulty"),
		}
		for r in doc.questions
	]
	out["has_manual_questions"] = any(r.question_type in svc.MANUAL_TYPES for r in doc.questions)
	return out


@frappe.whitelist()
def get_exam(name):
	doc = _exam(name)
	before = doc.status
	if svc.ensure_current_status(doc) != before:
		persist_writes()
	return exam_dict(doc)


def _question_rows(value) -> list[dict]:
	rows = []
	for item in parse_json(value, []) or []:
		if isinstance(item, dict):
			if item.get("question"):
				rows.append({"question": item["question"], "marks": flt(item.get("marks")) or None})
		elif item:
			rows.append({"question": item})
	return rows


@frappe.whitelist(methods=["POST"])
def save_exam(data):
	"""Create/update an exam. `questions`: question names or [{question, marks?}] from the course bank."""
	data = parse_json(data, {}) or {}
	values = clean_payload(data, EXAM_FIELDS)
	if data.get("name"):
		doc = _exam(data["name"])
	else:
		offering = data.get("course_offering")
		require_teaching(offering)
		doc = frappe.new_doc("Exam")
		doc.course_offering = offering
		doc.status = "Draft"
	doc.update(values)
	if "questions" in data:
		doc.set("questions", _question_rows(data.get("questions")))
	doc.save(ignore_permissions=True)
	return exam_dict(doc)


def _exam_status(name: str, status: str):
	doc = _exam(name)
	doc.status = status
	doc.save(ignore_permissions=True)
	return exam_dict(doc)


@frappe.whitelist(methods=["POST"])
def schedule_exam(name):
	"""Draft -> Scheduled; notifies enrolled students. The exam opens automatically at start_datetime."""
	return _exam_status(name, "Scheduled")


@frappe.whitelist(methods=["POST"])
def unschedule_exam(name):
	return _exam_status(name, "Draft")


@frappe.whitelist(methods=["POST"])
def cancel_exam(name):
	return _exam_status(name, "Cancelled")


@frappe.whitelist(methods=["POST"])
def close_exam(name):
	"""Close an open exam now: live attempts are auto-submitted; then Marking / Released / Closed."""
	doc = _exam(name)
	svc.ensure_current_status(doc)
	if doc.status != "Open":
		frappe.throw(_("Only an open exam can be closed (status: {0}).").format(_(doc.status)))
	svc.close_exam(doc.name)
	return exam_dict(frappe.get_doc("Exam", doc.name))


@frappe.whitelist(methods=["POST"])
def delete_exam(name):
	doc = _exam(name)
	doc.delete(ignore_permissions=True)
	return {"ok": True, "name": name}


# ---------------------------------------------------------------------------------- question bank
@frappe.whitelist()
def question_bank(course, filters=None, start=0, page_length=50):
	"""filters: {question_type, topic, difficulty, is_active, search}."""
	require_course_access(course)
	f = parse_json(filters, {}) or {}
	qfilters = {"course": course}
	for key in ("question_type", "topic", "difficulty"):
		if f.get(key):
			qfilters[key] = f[key]
	if f.get("is_active") not in (None, ""):
		qfilters["is_active"] = cint(f["is_active"])
	if f.get("search"):
		qfilters["question_title"] = ["like", f"%{f['search'].strip()}%"]
	data = frappe.get_all(
		"Question",
		filters=qfilters,
		fields=QUESTION_LIST_FIELDS,
		order_by="topic asc, modified desc",
		**page_args(start, page_length),
	)
	usage = {}
	for r in frappe.get_all(
		"Exam Question",
		filters={"question": ["in", [d.name for d in data] or [""]], "parenttype": "Exam"},
		fields=["question", "parent"],
	):
		usage.setdefault(r.question, []).append(r.parent)
	for d in data:
		d["used_in"] = usage.get(d.name, [])
	topics = frappe.get_all(
		"Question",
		filters={"course": course, "topic": ["is", "set"]},
		pluck="topic",
		distinct=True,
		order_by="topic asc",
	)
	return {"data": data, "total": frappe.db.count("Question", qfilters), "topics": topics}


def question_dict(doc) -> dict:
	out = doc_dict(doc)
	out["options"] = [
		{"name": o.name, "option_text": o.option_text, "is_correct": cint(o.is_correct)} for o in doc.options
	]
	out["matching_pairs"] = [
		{"name": p.name, "prompt": p.prompt, "match": p.match} for p in doc.matching_pairs
	]
	return out


@frappe.whitelist()
def get_question(name):
	return question_dict(_question(name))


def _set_child_rows(doc, field: str, rows, keys: tuple[str, ...]):
	"""Replace a child table while keeping existing row names (stable option ids) when `name` is sent."""
	existing = {r.name: r for r in doc.get(field)}
	table = []
	for r in rows or []:
		if not isinstance(r, dict):
			frappe.throw(_("Invalid {0} row.").format(field))
		row = existing.get(r.get("name")) if r.get("name") else None
		values = {k: r.get(k) for k in keys if k in r}
		if row:
			row.update(values)
			table.append(row)
		else:
			table.append(values)
	doc.set(field, table)


@frappe.whitelist(methods=["POST"])
def save_question(data):
	data = parse_json(data, {}) or {}
	values = clean_payload(data, QUESTION_FIELDS)
	if data.get("name"):
		doc = _question(data["name"])
	else:
		require_course_access(data.get("course"))
		doc = frappe.new_doc("Question")
		doc.course = data.get("course")
	doc.update(values)
	if "options" in data:
		_set_child_rows(doc, "options", parse_json(data.get("options"), []), ("option_text", "is_correct"))
	if "matching_pairs" in data:
		_set_child_rows(
			doc, "matching_pairs", parse_json(data.get("matching_pairs"), []), ("prompt", "match")
		)
	doc.save(ignore_permissions=True)
	return question_dict(doc)


@frappe.whitelist(methods=["POST"])
def delete_question(name):
	doc = _question(name)
	used = frappe.get_all(
		"Exam Question", filters={"question": name, "parenttype": "Exam"}, pluck="parent", distinct=True
	)
	if used:
		frappe.throw(
			_("This question is used in {0}. Deactivate it instead of deleting it.").format(", ".join(used))
		)
	doc.delete(ignore_permissions=True)
	return {"ok": True, "name": name}


def question_from_row(course: str, row: dict) -> dict:
	"""CSV-like import row -> Question payload (pure).

	Columns: question_type, question, marks, topic, difficulty, option_a..option_f,
	correct (letters "B" / "A,C" for options, True/False, or accepted answers separated by "|"),
	pairs ("left=right|left2=right2"), marking_guide, explanation."""
	row = {str(k).strip().lower(): (v.strip() if isinstance(v, str) else v) for k, v in (row or {}).items()}
	qtype = row.get("question_type") or "Multiple Choice"
	aliases = {"mcq": "Multiple Choice", "tf": "True or False", "true/false": "True or False"}
	qtype = aliases.get(str(qtype).lower(), qtype)
	correct = str(row.get("correct") or "").strip()
	payload = {
		"doctype": "Question",
		"course": course,
		"question_type": qtype,
		"question": row.get("question"),
		"marks": flt(row.get("marks")) or 1,
		"topic": row.get("topic") or None,
		"difficulty": row.get("difficulty") or "Medium",
		"marking_guide": row.get("marking_guide") or None,
		"explanation": row.get("explanation") or None,
		"is_active": 1,
	}
	if qtype in svc.OPTION_TYPES:
		letters = {c.strip().upper() for c in correct.replace(";", ",").split(",") if c.strip()}
		payload["options"] = [
			{"option_text": row[f"option_{c.lower()}"], "is_correct": 1 if c in letters else 0}
			for c in IMPORT_LETTERS
			if row.get(f"option_{c.lower()}")
		]
	elif qtype == "True or False":
		value = svc.normalise_bool(correct)
		payload["correct_boolean"] = {"true": "True", "false": "False"}.get(value or "")
	elif qtype in svc.TEXT_TYPES:
		payload["accepted_answers"] = "\n".join(a.strip() for a in correct.split("|") if a.strip())
		payload["case_sensitive"] = cint(row.get("case_sensitive"))
	elif qtype == "Matching":
		pairs = []
		for chunk in str(row.get("pairs") or "").split("|"):
			if "=" in chunk:
				left, right = chunk.split("=", 1)
				pairs.append({"prompt": left.strip(), "match": right.strip()})
		payload["matching_pairs"] = pairs
	return payload


@frappe.whitelist(methods=["POST"])
def import_questions(course, rows):
	"""Bulk-create questions from CSV-like JSON rows. Valid rows are kept; invalid rows are reported."""
	require_course_access(course)
	rows = parse_json(rows, []) or []
	if not isinstance(rows, list) or not rows:
		frappe.throw(_("No rows to import."))
	if len(rows) > MAX_IMPORT_ROWS:
		frappe.throw(_("Import at most {0} questions at a time.").format(MAX_IMPORT_ROWS))
	created, errors = [], []
	for i, row in enumerate(rows, 1):
		frappe.db.savepoint("mbc_question_import")
		try:
			doc = frappe.get_doc(question_from_row(course, row))
			doc.insert(ignore_permissions=True)
			created.append(doc.name)
		except Exception as e:
			frappe.db.rollback(save_point="mbc_question_import")
			frappe.clear_messages()
			errors.append({"row": i, "error": str(e) or e.__class__.__name__})
	return {"created": len(created), "failed": len(errors), "questions": created, "errors": errors}


# ---------------------------------------------------------------------------------- marking & analytics
@frappe.whitelist()
def marking_queue(exam):
	doc = _exam(exam)
	attempts = frappe.get_all(
		"Exam Attempt",
		filters={"exam": doc.name, "status": ["in", [*svc.PENDING_ATTEMPT_STATUSES, "Marked", "Released"]]},
		fields=[
			"name",
			"student",
			"student_name",
			"attempt_number",
			"status",
			"submitted_on",
			"auto_score",
			"manual_score",
			"total_score",
			"max_score",
			"percentage",
			"focus_lost_count",
		],
		order_by="submitted_on asc",
	)
	unmarked = {
		r.parent: cint(r.n)
		for r in frappe.get_all(
			"Exam Attempt Answer",
			filters={
				"parent": ["in", [a.name for a in attempts] or [""]],
				"parenttype": "Exam Attempt",
				"is_marked": 0,
			},
			fields=["parent", {"COUNT": "*", "as": "n"}],
			group_by="parent",
		)
	}
	for a in attempts:
		a["unmarked"] = unmarked.get(a.name, 0)
	pending = [a for a in attempts if a.status in svc.PENDING_ATTEMPT_STATUSES]
	return {
		"exam": {"name": doc.name, "title": doc.title, "status": doc.status, "total_marks": doc.total_marks},
		"data": attempts,
		"total": len(attempts),
		"pending": len(pending),
		"unmarked_answers": sum(a["unmarked"] for a in pending),
	}


@frappe.whitelist()
def get_attempt_for_marking(attempt):
	doc = _attempt(attempt)
	header = {
		k: doc.get(k)
		for k in (
			"name",
			"exam",
			"student",
			"student_name",
			"course_offering",
			"attempt_number",
			"status",
			"started_on",
			"deadline",
			"submitted_on",
			"auto_score",
			"manual_score",
			"total_score",
			"max_score",
			"percentage",
			"marked_by",
			"marked_on",
			"focus_lost_count",
			"ip_address",
			"remarks",
		)
	}
	header["submission_mode"] = svc.submission_mode(doc)
	return {
		"attempt": header,
		"items": svc.review_items(doc, include_correct=True, include_guide=True),
		"events": [{"timestamp": e.timestamp, "event": e.event, "detail": e.detail} for e in doc.events],
	}


@frappe.whitelist(methods=["POST"])
def mark_answer(attempt, question, marks, feedback=None):
	_attempt(attempt)
	doc = svc.mark_manual(attempt, question, marks, feedback)
	return {
		"ok": True,
		"attempt": doc.name,
		"status": doc.status,
		"total_score": doc.total_score,
		"percentage": doc.percentage,
		"unmarked": len([a for a in doc.answers if not cint(a.is_marked)]),
	}


@frappe.whitelist(methods=["POST"])
def finalise_attempt(attempt):
	_attempt(attempt)
	doc = svc.finalise_attempt(attempt)
	return {"ok": True, "attempt": doc.name, "status": doc.status, "percentage": doc.percentage}


@frappe.whitelist(methods=["POST"])
def void_attempt(attempt, reason):
	"""Void an attempt (e.g. a technical failure) so the student may sit again."""
	doc = _attempt(attempt)
	if not (reason or "").strip():
		frappe.throw(_("Give a reason for voiding this attempt."))
	if doc.status == "Released":
		frappe.throw(_("A released attempt cannot be voided."))
	doc.status = "Void"
	doc.remarks = ((doc.remarks or "") + "\n" + _("Voided: {0}").format(reason.strip())).strip()
	doc.save(ignore_permissions=True)
	svc.refresh_exam_counters(doc.exam)
	return {"ok": True, "attempt": doc.name, "status": doc.status}


@frappe.whitelist(methods=["POST"])
def release_results(exam):
	_exam(exam)
	doc = svc.release_results(exam)
	return exam_dict(doc)


@frappe.whitelist()
def exam_stats(exam):
	_exam(exam)
	return svc.exam_stats(exam)


@frappe.whitelist()
def exam_monitor(exam):
	doc = _exam(exam)
	before = doc.status
	if svc.ensure_current_status(doc) != before:
		persist_writes()
	return svc.exam_monitor(exam)


# ---------------------------------------------------------------------------------- student exam room
@frappe.whitelist()
def my_exams():
	student = require_student()
	return svc.my_exams(student.name)


@frappe.whitelist(methods=["POST"])
def start_exam(exam, access_code=None):
	"""Start (or resume) an attempt. Returns questions WITHOUT answers and the server-side time remaining."""
	student = require_student()
	return svc.start_exam(exam, student.name, access_code)


def _attempt_summary(doc) -> dict:
	return {
		"attempt": doc.name,
		"exam": doc.exam,
		"status": doc.status,
		"attempt_number": doc.attempt_number,
		"started_on": doc.started_on,
		"submitted_on": doc.submitted_on,
		"submission_mode": svc.submission_mode(doc),
		"answered": len([a for a in doc.answers if a.answer not in (None, "")]),
		"questions": len(doc.answers),
		"result_available": doc.status == "Released",
	}


@frappe.whitelist()
def get_attempt(attempt):
	"""Resume view of my in-progress attempt; a short summary once submitted."""
	student = require_student()
	doc = svc.get_owned_attempt(attempt, student.name)
	if doc.status == "In Progress":
		if now_datetime() > get_datetime(doc.deadline):
			doc = svc.submit_attempt(doc.name, student.name, auto=True)
			persist_writes()
		else:
			return svc.attempt_payload(doc)
	return _attempt_summary(doc)


@frappe.whitelist(methods=["POST"])
def save_answer(attempt, question, answer=None):
	student = require_student()
	return svc.save_answer(attempt, student.name, question, answer)


@frappe.whitelist(methods=["POST"])
def log_exam_event(attempt, event_type, details=None):
	student = require_student()
	return svc.log_event(attempt, student.name, event_type, details)


@frappe.whitelist(methods=["POST"])
def submit_attempt(attempt):
	student = require_student()
	doc = svc.submit_attempt(attempt, student.name)
	return {"ok": True, **_attempt_summary(doc)}


@frappe.whitelist()
def my_exam_result(attempt):
	"""My attempt's result. Before release only `{released: False, ...}` with a message (no scores);
	correct answers only when the exam has show_answers_after_release."""
	student = require_student()
	doc = svc.get_owned_attempt(attempt, student.name)
	if doc.status != "Released":
		if doc.status == "In Progress":
			message = _("This attempt has not been submitted yet.")
		elif doc.status == "Void":
			message = _("This attempt was voided by your lecturer.")
		else:
			message = _("Results for this exam have not been released yet.")
		return {
			"released": False,
			"attempt": doc.name,
			"exam": doc.exam,
			"exam_title": doc.exam_title or frappe.db.get_value("Exam", doc.exam, "title"),
			"status": doc.status,
			"submitted_on": doc.submitted_on,
			"message": message,
		}
	exam = frappe.db.get_value(
		"Exam",
		doc.exam,
		[
			"name",
			"title",
			"exam_type",
			"course_title",
			"pass_mark",
			"show_answers_after_release",
			"total_marks",
		],
		as_dict=True,
	)
	from mahanaim.services.grading import grade_for

	grade = grade_for(doc.percentage)
	show = bool(cint(exam.show_answers_after_release))
	return {
		"released": True,
		"exam": exam,
		"attempt": {
			**_attempt_summary(doc),
			"total_score": doc.total_score,
			"max_score": doc.max_score,
			"percentage": doc.percentage,
			"grade": grade.get("grade"),
			"passed": flt(doc.percentage) + 1e-9 >= flt(exam.pass_mark),
		},
		"show_answers": show,
		"items": svc.review_items(doc, include_correct=show),
	}
