"""Online examination engine (owned by backend domain B2).

Flow
	start_exam -> (create | resume) Exam Attempt with a frozen `question_order` (random subset / shuffles)
	save_answer (autosave, server-clock deadline) -> log_event (focus lost, paste...) -> submit_attempt
	submit -> auto-mark objective questions -> status Marked (no manual questions) or Marking (essays)
	lecturer mark_manual / finalise_attempt -> release_results (Exam Released, attempts Released)

Security rules
- Students never receive correct answers before release (`attempt_payload` only exposes ids/texts).
- Every attempt call is checked against the owning student; the server clock is the only clock.

Scheduler
	auto_submit_expired_attempts()  cron */5   In Progress attempts past their deadline -> auto submitted
	update_exam_statuses()          hourly     Scheduled -> Open -> Closed/Marking (+ lazy promotion on access)

Answer wire formats
	Multiple Choice  "<option id>"            Multiple Select  ["<option id>", ...]
	True or False    "true" | "false"         Short Answer / Fill in the Blank / Essay  "text"
	Matching         {"<pair id>": "<match text>", ...}
"""

from __future__ import annotations

import hmac
import json
import random

import frappe
from frappe import _
from frappe.utils import (
	add_to_date,
	cint,
	flt,
	format_datetime,
	get_datetime,
	now_datetime,
	strip_html,
	time_diff_in_seconds,
)
from frappe.utils.html_utils import sanitize_html

from mahanaim.services.assessments import (
	ENROLLED,
	enrolled_students,
	is_enrolled,
	recipients_for_students,
	student_offerings,
)
from mahanaim.services.communication import notify
from mahanaim.utils import setting

OPTION_TYPES = ("Multiple Choice", "Multiple Select")
TEXT_TYPES = ("Short Answer", "Fill in the Blank")
MANUAL_TYPES = ("Essay",)
CAT_EXAM_TYPES = ("CAT", "Quiz")
FINAL_EXAM_TYPES = ("Main Exam", "Special")
FINAL_ATTEMPT_STATUSES = ("Marked", "Released")
PENDING_ATTEMPT_STATUSES = ("Submitted", "Auto Submitted", "Marking")
VISIBLE_EXAM_STATUSES = ("Scheduled", "Open", "Closed", "Marking", "Released")
EVENT_TYPES = {
	"focus_lost": "Focus Lost",
	"focus_regained": "Focus Regained",
	"fullscreen_exit": "Fullscreen Exit",
	"copy": "Copy",
	"paste": "Paste",
	"reconnect": "Reconnect",
	"resumed": "Resumed",
}
SUBMIT_GRACE_SECONDS = 30
MAX_SHORT_ANSWER = 1000
MAX_ESSAY_ANSWER = 60000
MAX_EVENTS_PER_ATTEMPT = 1000
MONITOR_EVENTS_PER_ATTEMPT = 20

_rng = random.SystemRandom()


# ---------------------------------------------------------------------------------- pure helpers
def normalise_text(value, case_sensitive: bool = False) -> str:
	text = " ".join(str(value if value is not None else "").split())
	return text if case_sensitive else text.casefold()


def normalise_bool(value) -> str | None:
	if isinstance(value, bool):
		return "true" if value else "false"
	text = normalise_text(value)
	if text in ("true", "t", "1", "yes"):
		return "true"
	if text in ("false", "f", "0", "no"):
		return "false"
	return None


def split_accepted(text: str | None) -> list[str]:
	return [line.strip() for line in str(text or "").splitlines() if line.strip()]


def decode_answer(question_type: str, raw):
	if raw in (None, ""):
		return None
	if question_type in ("Multiple Select", "Matching"):
		try:
			value = json.loads(raw) if isinstance(raw, str) else raw
		except ValueError:
			return None
		if question_type == "Multiple Select":
			return value if isinstance(value, list) else None
		return value if isinstance(value, dict) else None
	return raw


def mark_answer(question_type: str, answer, key: dict, marks) -> dict | None:
	"""Pure auto-marker. Returns {marks, is_correct} or None for manually marked types (Essay)."""
	marks = flt(marks)
	if question_type in MANUAL_TYPES:
		return None
	if answer in (None, "", [], {}):
		return {"marks": 0.0, "is_correct": False}

	if question_type == "Multiple Choice":
		correct = key.get("correct") or []
		ok = len(correct) == 1 and str(answer) == str(correct[0])
		return {"marks": marks if ok else 0.0, "is_correct": ok}

	if question_type == "True or False":
		given = normalise_bool(answer)
		ok = given is not None and given == normalise_bool(key.get("boolean"))
		return {"marks": marks if ok else 0.0, "is_correct": ok}

	if question_type == "Multiple Select":
		correct = {str(c) for c in key.get("correct") or []}
		selected = {str(a) for a in (answer if isinstance(answer, list) else [answer])}
		if not correct:
			return {"marks": 0.0, "is_correct": False}
		fraction = max(0.0, (len(selected & correct) - len(selected - correct)) / len(correct))
		return {"marks": round(marks * fraction, 2), "is_correct": selected == correct}

	if question_type in TEXT_TYPES:
		case_sensitive = cint(key.get("case_sensitive"))
		given = normalise_text(answer, case_sensitive)
		ok = bool(given) and any(
			given == normalise_text(a, case_sensitive) for a in key.get("accepted") or []
		)
		return {"marks": marks if ok else 0.0, "is_correct": ok}

	if question_type == "Matching":
		pairs = key.get("pairs") or {}
		if not pairs or not isinstance(answer, dict):
			return {"marks": 0.0, "is_correct": False}
		right = sum(
			1
			for pair_id, match in pairs.items()
			if normalise_text(answer.get(pair_id)) == normalise_text(match)
		)
		return {"marks": round(marks * right / len(pairs), 2), "is_correct": right == len(pairs)}

	return {"marks": 0.0, "is_correct": False}


# ---------------------------------------------------------------------------------- question data
def answer_keys(questions) -> dict:
	"""Correct-answer keys for marking/review. NEVER send this to a student before release."""
	questions = list({q for q in questions or [] if q})
	if not questions:
		return {}
	rows = frappe.get_all(
		"Question",
		filters={"name": ["in", questions]},
		fields=[
			"name",
			"question_type",
			"correct_boolean",
			"accepted_answers",
			"case_sensitive",
			"marks",
			"question",
			"question_title",
			"explanation",
			"marking_guide",
			"topic",
			"difficulty",
		],
	)
	options = frappe.get_all(
		"Question Option",
		filters={"parent": ["in", questions], "parenttype": "Question"},
		fields=["name", "parent", "option_text", "is_correct"],
		order_by="idx asc",
	)
	pairs = frappe.get_all(
		"Question Match Pair",
		filters={"parent": ["in", questions], "parenttype": "Question"},
		fields=["name", "parent", "prompt", "match"],
		order_by="idx asc",
	)
	keys = {}
	for q in rows:
		keys[q.name] = {
			"type": q.question_type,
			"marks": flt(q.marks),
			"text": q.question,
			"title": q.question_title,
			"topic": q.topic,
			"difficulty": q.difficulty,
			"explanation": q.explanation,
			"marking_guide": q.marking_guide,
			"boolean": normalise_bool(q.correct_boolean),
			"accepted": split_accepted(q.accepted_answers),
			"case_sensitive": cint(q.case_sensitive),
			"options": [],
			"correct": [],
			"pair_rows": [],
			"pairs": {},
		}
	for o in options:
		k = keys.get(o.parent)
		if k is not None:
			k["options"].append({"id": o.name, "text": o.option_text, "is_correct": cint(o.is_correct)})
			if cint(o.is_correct):
				k["correct"].append(o.name)
	for p in pairs:
		k = keys.get(p.parent)
		if k is not None:
			k["pair_rows"].append({"id": p.name, "prompt": p.prompt, "match": p.match})
			k["pairs"][p.name] = p.match
	return keys


def correct_answer_view(key: dict):
	"""Correct answer in wire format (lecturer marking and post-release review only)."""
	qtype = key.get("type")
	if qtype in OPTION_TYPES:
		return [o["id"] for o in key["options"] if o["is_correct"]]
	if qtype == "True or False":
		return key["boolean"]
	if qtype in TEXT_TYPES:
		return key["accepted"]
	if qtype == "Matching":
		return {p["id"]: p["match"] for p in key["pair_rows"]}
	return None


# ---------------------------------------------------------------------------------- fee clearance wrapper
def fee_clearance_state(student: str, purpose: str = "exam") -> dict:
	"""Wrap the B3 contract so a missing/broken implementation never crashes the exam engine."""
	from mahanaim.services import fees

	try:
		state = dict(fees.fee_clearance(student, purpose) or {})
	except NotImplementedError:
		state = {"cleared": True, "message": ""}
	except Exception:
		frappe.log_error(title=f"fee_clearance failed for {student}")
		state = {
			"cleared": False,
			"message": _("Your fee clearance could not be verified. Please contact the finance office."),
		}
	state.setdefault("cleared", True)
	state.setdefault("message", "")
	return state


def exam_requires_fee_clearance(exam) -> bool:
	"""The exam's own flag decides (lecturers may waive clearance); Mahanaim Settings
	`exam_fee_clearance_percent` is only the threshold, and 0 switches the check off everywhere."""
	if not cint(exam.get("require_fee_clearance")):
		return False
	return flt(setting("exam_fee_clearance_percent", 100)) > 0


def fee_block_message(state: dict) -> str:
	return state.get("message") or _("Please clear your fee balance to sit this exam.")


# ---------------------------------------------------------------------------------- status handling
def _conditional_status(exam: str, from_status: str, to_status: str) -> bool:
	"""Race-free status move (many students may trigger lazy promotion at the same moment)."""
	frappe.db.sql(
		"update `tabExam` set status=%s, modified=%s where name=%s and status=%s",
		(to_status, now_datetime(), exam, from_status),
	)
	return frappe.db.get_value("Exam", exam, "status") == to_status


def ensure_current_status(exam, now=None) -> str:
	"""Bring an exam's status in line with the clock (Scheduled -> Open -> Closed). Returns the status."""
	now = get_datetime(now or now_datetime())
	status = exam.status
	if status == "Scheduled" and now >= get_datetime(exam.start_datetime):
		if _conditional_status(exam.name, "Scheduled", "Open"):
			status = "Open"
	if status == "Open" and now >= get_datetime(exam.end_datetime):
		status = close_exam(exam.name)
	exam.status = status
	return status


def has_manual_questions(exam_name: str) -> bool:
	return bool(
		frappe.db.exists(
			"Exam Question",
			{"parent": exam_name, "parenttype": "Exam", "question_type": ["in", list(MANUAL_TYPES)]},
		)
	)


def close_exam(exam_name: str) -> str:
	"""Close an exam: auto-submit live attempts, then Closed -> Marking (essays) / Released (auto release)."""
	for attempt in frappe.get_all(
		"Exam Attempt", filters={"exam": exam_name, "status": "In Progress"}, pluck="name"
	):
		submit_attempt(attempt, auto=True)
	_conditional_status(exam_name, "Open", "Closed")
	status = frappe.db.get_value("Exam", exam_name, "status")
	if status != "Closed":
		return status
	pending = frappe.db.exists("Exam Attempt", {"exam": exam_name, "status": "Marking"})
	if pending and has_manual_questions(exam_name):
		_conditional_status(exam_name, "Closed", "Marking")
		return "Marking"
	auto_release = cint(frappe.db.get_value("Exam", exam_name, "auto_release_objective"))
	if (
		auto_release
		and not pending
		and frappe.db.exists("Exam Attempt", {"exam": exam_name, "status": "Marked"})
	):
		release_results(exam_name)
		return "Released"
	return "Closed"


def update_exam_statuses():
	"""Hourly (and lazily on access): Scheduled -> Open at start; Open -> Closed / Marking at end."""
	now = now_datetime()
	rows = frappe.get_all(
		"Exam",
		filters={"status": ["in", ["Scheduled", "Open"]]},
		fields=["name", "status", "start_datetime", "end_datetime"],
	)
	changed = 0
	for row in rows:
		before = row.status
		try:
			if ensure_current_status(row, now) != before:
				changed += 1
			if not frappe.flags.in_test:
				frappe.db.commit()
		except Exception:
			if not frappe.flags.in_test:
				frappe.db.rollback()
			frappe.log_error(title=f"Exam status update failed: {row.name}")
	return changed


def auto_submit_expired_attempts():
	"""Cron */5: submit In Progress attempts whose deadline has passed."""
	expired = frappe.get_all(
		"Exam Attempt", filters={"status": "In Progress", "deadline": ["<", now_datetime()]}, pluck="name"
	)
	for name in expired:
		try:
			submit_attempt(name, auto=True)
			if not frappe.flags.in_test:
				frappe.db.commit()
		except Exception:
			if not frappe.flags.in_test:
				frappe.db.rollback()
			frappe.log_error(title=f"Exam auto-submit failed: {name}")
	return len(expired)


def refresh_exam_counters(exam: str):
	rows = frappe.get_all(
		"Exam Attempt", filters={"exam": exam, "status": ["!=", "Void"]}, fields=["status", "percentage"]
	)
	finals = [flt(r.percentage) for r in rows if r.status in FINAL_ATTEMPT_STATUSES]
	frappe.db.set_value(
		"Exam",
		exam,
		{
			"attempt_count": len(rows),
			"submitted_count": len([r for r in rows if r.status != "In Progress"]),
			"average_score": round(sum(finals) / len(finals), 2) if finals else 0,
		},
		update_modified=False,
	)


# ---------------------------------------------------------------------------------- eligibility
def _window_reason(exam, now) -> str | None:
	if exam.status == "Cancelled":
		return _("This exam has been cancelled.")
	if exam.status == "Draft":
		return _("This exam has not been scheduled yet.")
	if now < get_datetime(exam.start_datetime):
		return _("This exam opens on {0}.").format(format_datetime(exam.start_datetime))
	if now >= get_datetime(exam.end_datetime) or exam.status not in ("Scheduled", "Open"):
		return _("This exam closed on {0}.").format(format_datetime(exam.end_datetime))
	return None


def _in_person_reason(exam) -> str:
	return _("This exam is sat in person{0}.").format(f" ({exam.venue})" if exam.get("venue") else "")


def attempts_used(exam: str, student: str) -> int:
	return frappe.db.count(
		"Exam Attempt", {"exam": exam, "student": student, "status": ["not in", ["Void", "In Progress"]]}
	)


def eligibility(
	exam, student: str, now=None, fee_state: dict | None = None, attempts: int | None = None
) -> list[str]:
	"""Non-throwing list of reasons the student cannot start `exam` now (empty list = may start)."""
	now = get_datetime(now or now_datetime())
	if not is_enrolled(student, exam.course_offering):
		return [_("You are not enrolled in this course.")]
	reasons = []
	window = _window_reason(exam, now)
	if window:
		reasons.append(window)
	used = attempts_used(exam.name, student) if attempts is None else attempts
	if used >= max(cint(exam.max_attempts), 1):
		reasons.append(
			_("You have used all {0} attempt(s) for this exam.").format(max(cint(exam.max_attempts), 1))
		)
	if exam_requires_fee_clearance(exam):
		state = fee_state if fee_state is not None else fee_clearance_state(student, "exam")
		if not state.get("cleared"):
			reasons.append(fee_block_message(state))
	if exam.delivery_mode != "Online":
		reasons.append(_in_person_reason(exam))
	return reasons


# ---------------------------------------------------------------------------------- attempts
def _request_meta() -> tuple[str | None, str | None]:
	ip = getattr(frappe.local, "request_ip", None)
	agent = frappe.get_request_header("User-Agent") if getattr(frappe.local, "request", None) else None
	return ip, ((agent or "")[:500] or None)


def _build_question_order(exam, keys: dict) -> list[dict]:
	rows = sorted(exam.questions, key=lambda r: cint(r.idx))
	count = cint(exam.random_question_count)
	selected = _rng.sample(rows, count) if 0 < count < len(rows) else list(rows)
	if cint(exam.shuffle_questions):
		_rng.shuffle(selected)
	else:
		selected.sort(key=lambda r: cint(r.idx))
	order = []
	for row in selected:
		key = keys.get(row.question)
		if not key:
			continue
		entry = {"question": row.question, "type": key["type"], "marks": flt(row.marks) or key["marks"]}
		if key["type"] in OPTION_TYPES:
			ids = [o["id"] for o in key["options"]]
			if cint(exam.shuffle_options):
				_rng.shuffle(ids)
			entry["options"] = ids
		elif key["type"] == "Matching":
			pair_ids = [p["id"] for p in key["pair_rows"]]
			if cint(exam.shuffle_options):
				_rng.shuffle(pair_ids)
			matches = list(dict.fromkeys(p["match"] for p in key["pair_rows"]))
			_rng.shuffle(matches)
			entry["pairs"] = pair_ids
			entry["matches"] = matches
		order.append(entry)
	return order


def _create_attempt(exam, student: str, attempt_number: int, now):
	keys = answer_keys([r.question for r in exam.questions])
	order = _build_question_order(exam, keys)
	if not order:
		frappe.throw(_("This exam has no questions yet. Please contact your lecturer."))
	deadline = min(add_to_date(now, minutes=cint(exam.duration_minutes)), get_datetime(exam.end_datetime))
	ip, agent = _request_meta()
	doc = frappe.get_doc(
		{
			"doctype": "Exam Attempt",
			"exam": exam.name,
			"student": student,
			"attempt_number": attempt_number,
			"status": "In Progress",
			"started_on": now,
			"deadline": deadline,
			"max_score": round(sum(flt(o["marks"]) for o in order), 2),
			"question_order": json.dumps(order),
			"ip_address": ip,
			"user_agent": agent,
			"answers": [
				{"question": o["question"], "question_type": o["type"], "max_marks": o["marks"]}
				for o in order
			],
			"events": [{"timestamp": now, "event": "Started", "detail": ip}],
		}
	)
	doc.insert(ignore_permissions=True)
	refresh_exam_counters(exam.name)
	return doc


def start_exam(exam_name: str, student: str, access_code: str | None = None) -> dict:
	"""Checks (in order): enrolment, status/window, access code, attempts, fee clearance, delivery mode.

	An In Progress attempt inside its deadline is resumed (same frozen paper, saved answers)."""
	if not frappe.db.exists("Exam", exam_name):
		frappe.throw(_("Exam not found."), frappe.DoesNotExistError)
	exam = frappe.get_doc("Exam", exam_name)
	now = now_datetime()
	if not is_enrolled(student, exam.course_offering):
		frappe.throw(_("You are not enrolled in this course."), frappe.PermissionError)
	ensure_current_status(exam, now)
	window = _window_reason(exam, now)
	if window or exam.status != "Open":
		frappe.throw(window or _("This exam is not open."))
	if exam.access_code:
		given = (access_code or "").strip().encode()
		if not hmac.compare_digest(given, exam.access_code.strip().encode()):
			frappe.throw(_("The access code is incorrect."), frappe.PermissionError)

	frappe.db.get_value("Student", student, "name", for_update=True)  # serialise concurrent starts
	live = frappe.db.get_value(
		"Exam Attempt", {"exam": exam.name, "student": student, "status": "In Progress"}
	)
	if live:
		attempt = frappe.get_doc("Exam Attempt", live, for_update=True)
		if now <= get_datetime(attempt.deadline):
			_insert_event(attempt.name, "Resumed", _request_meta()[0], now)
			return attempt_payload(attempt, now)
		submit_attempt(attempt.name, auto=True)

	used = attempts_used(exam.name, student)
	if used >= max(cint(exam.max_attempts), 1):
		frappe.throw(
			_("You have used all {0} attempt(s) for this exam.").format(max(cint(exam.max_attempts), 1))
		)
	if exam_requires_fee_clearance(exam):
		state = fee_clearance_state(student, "exam")
		if not state.get("cleared"):
			frappe.throw(fee_block_message(state), title=_("Fee clearance required"))
	if exam.delivery_mode != "Online":
		frappe.throw(_in_person_reason(exam))
	attempt = _create_attempt(exam, student, used + 1, now)
	return attempt_payload(attempt, now)


def get_owned_attempt(attempt: str, student: str, for_update: bool = False):
	if not attempt or not frappe.db.exists("Exam Attempt", attempt):
		frappe.throw(_("Exam attempt not found."), frappe.PermissionError)
	doc = frappe.get_doc("Exam Attempt", attempt, for_update=for_update)
	if doc.student != student:
		frappe.throw(_("Exam attempt not found."), frappe.PermissionError)
	return doc


def time_remaining(deadline, now=None) -> int:
	if not deadline:
		return 0
	return max(0, int(time_diff_in_seconds(get_datetime(deadline), get_datetime(now or now_datetime()))))


def attempt_payload(attempt, now=None) -> dict:
	"""Student-facing attempt: questions WITHOUT any correct-answer information."""
	now = now or now_datetime()
	order = json.loads(attempt.question_order or "[]")
	names = [o["question"] for o in order] or [""]
	texts = {
		q.name: q.question
		for q in frappe.get_all("Question", filters={"name": ["in", names]}, fields=["name", "question"])
	}
	options = {
		o.name: o.option_text
		for o in frappe.get_all(
			"Question Option",
			filters={"parent": ["in", names], "parenttype": "Question"},
			fields=["name", "option_text"],
		)
	}
	prompts = {
		p.name: p.prompt
		for p in frappe.get_all(
			"Question Match Pair",
			filters={"parent": ["in", names], "parenttype": "Question"},
			fields=["name", "prompt"],
		)
	}
	saved = {a.question: decode_answer(a.question_type, a.answer) for a in attempt.answers}
	items = []
	for number, entry in enumerate(order, 1):
		qtype = entry["type"]
		item = {
			"no": number,
			"question": entry["question"],
			"question_type": qtype,
			"marks": flt(entry["marks"]),
			"text": texts.get(entry["question"]),
			"answer": saved.get(entry["question"]),
		}
		if qtype in OPTION_TYPES:
			item["options"] = [
				{"id": i, "text": options[i]} for i in entry.get("options", []) if i in options
			]
		elif qtype == "True or False":
			item["options"] = [{"id": "true", "text": _("True")}, {"id": "false", "text": _("False")}]
		elif qtype == "Matching":
			item["prompts"] = [{"id": i, "text": prompts[i]} for i in entry.get("pairs", []) if i in prompts]
			item["matches"] = entry.get("matches", [])
		items.append(item)
	exam = (
		frappe.db.get_value(
			"Exam",
			attempt.exam,
			["title", "course_title", "exam_type", "instructions", "end_datetime", "duration_minutes"],
			as_dict=True,
		)
		or {}
	)
	return {
		"attempt": attempt.name,
		"status": attempt.status,
		"attempt_number": attempt.attempt_number,
		"exam": {"name": attempt.exam, **exam},
		"started_on": attempt.started_on,
		"deadline": attempt.deadline,
		"server_time": now,
		"time_remaining": time_remaining(attempt.deadline, now) if attempt.status == "In Progress" else 0,
		"max_score": flt(attempt.max_score),
		"answered": len([v for v in saved.values() if v not in (None, "", [], {})]),
		"questions": items,
	}


def _answer_json(value: str):
	try:
		return json.loads(value)
	except (TypeError, ValueError):
		frappe.throw(_("Invalid answer format."))


def encode_answer(entry: dict, answer) -> str | None:
	"""Validate a student's answer against the frozen question entry and encode it for storage."""
	qtype = entry["type"]
	if answer in (None, "", [], {}):
		return None
	if qtype == "Multiple Choice":
		if str(answer) not in entry.get("options", []):
			frappe.throw(_("Invalid option."))
		return str(answer)
	if qtype == "Multiple Select":
		value = answer
		if isinstance(answer, str) and answer.strip().startswith("["):
			value = _answer_json(answer)
		value = value if isinstance(value, list) else [value]
		ids = list(dict.fromkeys(str(v) for v in value))
		if any(i not in entry.get("options", []) for i in ids):
			frappe.throw(_("Invalid option."))
		return json.dumps(ids)
	if qtype == "True or False":
		value = normalise_bool(answer)
		if value is None:
			frappe.throw(_("Answer must be true or false."))
		return value
	if qtype in TEXT_TYPES:
		text = strip_html(str(answer)).strip()
		if len(text) > MAX_SHORT_ANSWER:
			frappe.throw(_("Your answer is too long (maximum {0} characters).").format(MAX_SHORT_ANSWER))
		return text or None
	if qtype in MANUAL_TYPES:
		text = str(answer)
		text = sanitize_html(text) if "<" in text else text
		if len(text) > MAX_ESSAY_ANSWER:
			frappe.throw(_("Your answer is too long (maximum {0} characters).").format(MAX_ESSAY_ANSWER))
		return text.strip() or None
	if qtype == "Matching":
		value = _answer_json(answer) if isinstance(answer, str) else answer
		if not isinstance(value, dict):
			frappe.throw(_("Matching answers must map each prompt to a match."))
		pairs, matches = set(entry.get("pairs", [])), set(entry.get("matches", []))
		clean = {}
		for key, match in value.items():
			if key not in pairs or (match not in (None, "") and match not in matches):
				frappe.throw(_("Invalid matching answer."))
			if match not in (None, ""):
				clean[key] = match
		return json.dumps(clean) if clean else None
	return str(answer)


def save_answer(attempt: str, student: str, question: str, answer) -> dict:
	row = frappe.db.get_value(
		"Exam Attempt",
		attempt,
		["name", "student", "status", "deadline", "question_order"],
		as_dict=True,
		for_update=True,
	)
	if not row or row.student != student:
		frappe.throw(_("Exam attempt not found."), frappe.PermissionError)
	if row.status != "In Progress":
		frappe.throw(_("This attempt has already been submitted."))
	now = now_datetime()
	if now > get_datetime(row.deadline):
		frappe.throw(_("Time is up. Answers can no longer be changed."), title=_("Time is up"))
	entry = next((o for o in json.loads(row.question_order or "[]") if o["question"] == question), None)
	if not entry:
		frappe.throw(_("This question is not part of your exam."))
	value = encode_answer(entry, answer)
	child = frappe.db.get_value(
		"Exam Attempt Answer", {"parent": attempt, "parenttype": "Exam Attempt", "question": question}, "name"
	)
	if child:
		frappe.db.set_value("Exam Attempt Answer", child, "answer", value, update_modified=False)
	return {
		"ok": True,
		"question": question,
		"saved_at": now,
		"time_remaining": time_remaining(row.deadline, now),
	}


def _insert_event(attempt: str, event: str, detail: str | None = None, now=None) -> bool:
	idx = frappe.db.count("Exam Attempt Event", {"parent": attempt, "parenttype": "Exam Attempt"})
	if idx >= MAX_EVENTS_PER_ATTEMPT:
		return False
	now = now or now_datetime()
	frappe.get_doc(
		{
			"doctype": "Exam Attempt Event",
			"parent": attempt,
			"parenttype": "Exam Attempt",
			"parentfield": "events",
			"idx": idx + 1,
			"timestamp": now,
			"event": event,
			"detail": (detail or "")[:500] or None,
			"creation": now,
			"modified": now,
			"owner": frappe.session.user,
			"modified_by": frappe.session.user,
		}
	).db_insert()
	return True


def log_event(attempt: str, student: str, event_type: str, details=None) -> dict:
	row = frappe.db.get_value(
		"Exam Attempt", attempt, ["student", "status", "focus_lost_count"], as_dict=True
	)
	if not row or row.student != student:
		frappe.throw(_("Exam attempt not found."), frappe.PermissionError)
	event = EVENT_TYPES.get(str(event_type or "").strip().lower())
	if not event:
		frappe.throw(_("Unknown exam event: {0}").format(event_type))
	if row.status != "In Progress":
		return {"ok": False, "focus_lost_count": cint(row.focus_lost_count)}
	if isinstance(details, (dict, list)):
		details = json.dumps(details)
	stored = _insert_event(attempt, event, str(details) if details is not None else None)
	count = cint(row.focus_lost_count)
	if stored and event == "Focus Lost":
		frappe.db.sql(
			"update `tabExam Attempt` set focus_lost_count = ifnull(focus_lost_count, 0) + 1 where name=%s",
			attempt,
		)
		count += 1
	return {"ok": True, "focus_lost_count": count}


def recompute_totals(doc):
	total = auto = 0.0
	for a in doc.answers:
		total += flt(a.marks_awarded)
		if cint(a.auto_marked):
			auto += flt(a.marks_awarded)
	doc.total_score = round(total, 2)
	doc.auto_score = round(auto, 2)
	doc.manual_score = round(total - auto, 2)
	doc.percentage = round(total * 100.0 / flt(doc.max_score), 2) if flt(doc.max_score) else 0


def auto_mark(doc) -> bool:
	"""Mark objective answers in place. Returns True if manual marking is still pending."""
	keys = answer_keys([a.question for a in doc.answers])
	pending = False
	for a in doc.answers:
		key = keys.get(a.question) or {"type": a.question_type}
		qtype = a.question_type or key["type"]
		answer = decode_answer(qtype, a.answer)
		result = mark_answer(qtype, answer, key, a.max_marks)
		if result is None:
			a.auto_marked = 0
			if answer in (None, ""):
				a.marks_awarded, a.is_correct, a.is_marked = 0, 0, 1
			elif not cint(a.is_marked):
				pending = True
			continue
		a.marks_awarded = result["marks"]
		a.is_correct = 1 if result["is_correct"] else 0
		a.auto_marked = 1
		a.is_marked = 1
	recompute_totals(doc)
	return pending


def submit_attempt(attempt: str, student: str | None = None, auto: bool = False):
	doc = frappe.get_doc("Exam Attempt", attempt, for_update=True)
	if student and doc.student != student:
		frappe.throw(_("Exam attempt not found."), frappe.PermissionError)
	if doc.status != "In Progress":
		if auto:
			return doc
		frappe.throw(_("This attempt has already been submitted."))
	now = now_datetime()
	late = now > add_to_date(get_datetime(doc.deadline), seconds=SUBMIT_GRACE_SECONDS)
	mode = "Auto Submitted" if (auto or late) else "Submitted"
	doc.submitted_on = min(now, get_datetime(doc.deadline)) if mode == "Auto Submitted" else now
	pending = auto_mark(doc)
	doc.append(
		"events",
		{
			"timestamp": now,
			"event": mode,
			"detail": _("Deadline reached") if mode == "Auto Submitted" else None,
		},
	)
	doc.status = "Marking" if pending else "Marked"
	if not pending:
		doc.marked_on = now
	doc.save(ignore_permissions=True)
	refresh_exam_counters(doc.exam)
	return doc


def submission_mode(doc) -> str | None:
	for e in reversed(doc.get("events") or []):
		if e.event in ("Submitted", "Auto Submitted"):
			return e.event
	return None


# ---------------------------------------------------------------------------------- marking
def mark_manual(attempt: str, question: str, marks, feedback: str | None = None):
	doc = frappe.get_doc("Exam Attempt", attempt, for_update=True)
	if doc.status not in ("Marking", "Marked", "Submitted", "Auto Submitted"):
		frappe.throw(
			_("Only submitted, unreleased attempts can be marked (status: {0}).").format(_(doc.status))
		)
	row = next((a for a in doc.answers if a.question == question), None)
	if not row:
		frappe.throw(_("Question {0} is not part of this attempt.").format(question))
	if marks in (None, "") or flt(marks) < 0 or flt(marks) > flt(row.max_marks):
		frappe.throw(_("Marks must be between 0 and {0}.").format(flt(row.max_marks)))
	row.marks_awarded = flt(marks)
	row.is_correct = 1 if flt(marks) >= flt(row.max_marks) else 0
	row.auto_marked = 0
	row.is_marked = 1
	if feedback is not None:
		row.feedback = feedback
	recompute_totals(doc)
	if doc.status == "Marked":
		doc.marked_by = frappe.session.user
		doc.marked_on = now_datetime()
	doc.save(ignore_permissions=True)
	refresh_exam_counters(doc.exam)
	return doc


def finalise_attempt(attempt: str):
	doc = frappe.get_doc("Exam Attempt", attempt, for_update=True)
	if doc.status == "Marked":
		return doc
	if doc.status not in PENDING_ATTEMPT_STATUSES:
		frappe.throw(_("Only submitted attempts can be finalised."))
	unmarked = [a for a in doc.answers if not cint(a.is_marked)]
	if unmarked:
		frappe.throw(_("{0} answer(s) still need marks.").format(len(unmarked)))
	recompute_totals(doc)
	doc.status = "Marked"
	doc.marked_by = frappe.session.user
	doc.marked_on = now_datetime()
	doc.append("events", {"timestamp": now_datetime(), "event": "Marked"})
	doc.save(ignore_permissions=True)
	refresh_exam_counters(doc.exam)
	return doc


def release_results(exam_name: str):
	exam = frappe.get_doc("Exam", exam_name)
	ensure_current_status(exam)
	exam.reload()
	if exam.status not in ("Closed", "Marking"):
		frappe.throw(
			_("Results can only be released after the exam has closed (status: {0}).").format(_(exam.status))
		)
	pending = frappe.db.count(
		"Exam Attempt", {"exam": exam.name, "status": ["in", list(PENDING_ATTEMPT_STATUSES)]}
	)
	if pending:
		frappe.throw(_("{0} attempt(s) still need marking before results can be released.").format(pending))
	attempts = frappe.get_all(
		"Exam Attempt", filters={"exam": exam.name, "status": "Marked"}, fields=["name", "student"]
	)
	now = now_datetime()
	for a in attempts:
		frappe.db.set_value("Exam Attempt", a.name, "status", "Released", update_modified=False)
		_insert_event(a.name, "Released", None, now)
	exam.status = "Released"
	exam.save(ignore_permissions=True)
	refresh_exam_counters(exam.name)
	notify(
		"Exam Results Released",
		doc=exam,
		recipients=recipients_for_students([a.student for a in attempts]),
		link="/student/exams",
		category="Exam",
		fallback={
			"subject": _("Results released: {0}").format(exam.title),
			"message": _("Your results for {0} ({1}) are now available in the student portal.").format(
				exam.title, exam.course_title
			),
		},
	)
	return exam


def notify_scheduled(exam):
	notify(
		"Exam Scheduled",
		doc=exam,
		recipients=recipients_for_students(enrolled_students(exam.course_offering, ENROLLED)),
		link="/student/exams",
		category="Exam",
		fallback={
			"subject": _("{0} scheduled: {1}").format(_(exam.exam_type), exam.title),
			"message": _("{0} ({1}) opens {2} and lasts {3} minutes.").format(
				exam.title, exam.course_title, format_datetime(exam.start_datetime), exam.duration_minutes
			),
		},
	)


# ---------------------------------------------------------------------------------- student views
def my_exams(student: str) -> dict:
	now = now_datetime()
	out = {"upcoming": [], "open": [], "past": [], "server_time": now}
	offerings = student_offerings(student)
	if not offerings:
		return out
	exams = frappe.get_all(
		"Exam",
		filters={"course_offering": ["in", offerings], "status": ["in", list(VISIBLE_EXAM_STATUSES)]},
		fields=[
			"name",
			"title",
			"exam_type",
			"course_offering",
			"course_title",
			"status",
			"delivery_mode",
			"venue",
			"start_datetime",
			"end_datetime",
			"duration_minutes",
			"max_attempts",
			"total_marks",
			"pass_mark",
			"require_fee_clearance",
			"access_code",
			"instructions",
		],
		order_by="start_datetime asc",
	)
	if not exams:
		return out
	attempts = frappe.get_all(
		"Exam Attempt",
		filters={"student": student, "exam": ["in", [e.name for e in exams]], "status": ["!=", "Void"]},
		fields=["name", "exam", "status", "attempt_number", "percentage", "deadline"],
		order_by="attempt_number asc",
	)
	by_exam = {}
	for a in attempts:
		by_exam.setdefault(a.exam, []).append(a)
	fee_state = (
		fee_clearance_state(student, "exam") if any(exam_requires_fee_clearance(e) for e in exams) else None
	)
	for e in exams:
		mine = by_exam.get(e.name, [])
		live = next((a for a in mine if a.status == "In Progress"), None)
		used = len([a for a in mine if a.status != "In Progress"])
		effective = e.status
		if effective == "Scheduled" and now >= get_datetime(e.start_datetime):
			effective = "Open"
		if effective == "Open" and now >= get_datetime(e.end_datetime):
			effective = "Closed"
		reasons = [] if live else eligibility(e, student, now, fee_state, used)
		released = [flt(a.percentage) for a in mine if a.status == "Released"]
		item = {
			"name": e.name,
			"title": e.title,
			"exam_type": e.exam_type,
			"course_offering": e.course_offering,
			"course_title": e.course_title,
			"status": effective,
			"delivery_mode": e.delivery_mode,
			"venue": e.venue,
			"start_datetime": e.start_datetime,
			"end_datetime": e.end_datetime,
			"duration_minutes": e.duration_minutes,
			"total_marks": e.total_marks,
			"max_attempts": e.max_attempts,
			"instructions": e.instructions,
			"attempts_used": used,
			"requires_access_code": bool(e.access_code),
			"in_progress_attempt": live.name if live else None,
			"time_remaining": time_remaining(live.deadline, now) if live else None,
			"can_start": bool(live) or not reasons,
			"reasons": reasons,
			"attempts": [
				{
					"name": a.name,
					"attempt_number": a.attempt_number,
					"status": a.status,
					"percentage": a.percentage if a.status == "Released" else None,
				}
				for a in mine
			],
			"best_percentage": max(released) if released else None,
		}
		if effective == "Scheduled":
			out["upcoming"].append(item)
		elif effective == "Open":
			out["open"].append(item)
		else:
			out["past"].append(item)
	out["past"].reverse()
	return out


def review_items(doc, include_correct: bool, include_guide: bool = False) -> list[dict]:
	"""Per-question review rows for an attempt (correct answers only when `include_correct`)."""
	keys = answer_keys([a.question for a in doc.answers])
	position = {o["question"]: i for i, o in enumerate(json.loads(doc.question_order or "[]"))}
	items = []
	for a in sorted(doc.answers, key=lambda r: position.get(r.question, 9999)):
		key = keys.get(a.question) or {}
		item = {
			"question": a.question,
			"question_type": a.question_type,
			"text": key.get("text"),
			"answer": decode_answer(a.question_type, a.answer),
			"marks_awarded": flt(a.marks_awarded),
			"max_marks": flt(a.max_marks),
			"is_correct": cint(a.is_correct),
			"is_marked": cint(a.is_marked),
			"auto_marked": cint(a.auto_marked),
			"feedback": a.feedback,
		}
		if key.get("type") in OPTION_TYPES:
			item["options"] = [{"id": o["id"], "text": o["text"]} for o in key["options"]]
		elif key.get("type") == "True or False":
			item["options"] = [{"id": "true", "text": _("True")}, {"id": "false", "text": _("False")}]
		elif key.get("type") == "Matching":
			item["prompts"] = [{"id": p["id"], "text": p["prompt"]} for p in key["pair_rows"]]
		if include_correct:
			item["correct_answer"] = correct_answer_view(key) if key else None
			item["explanation"] = key.get("explanation")
		if include_guide:
			item["marking_guide"] = key.get("marking_guide")
		items.append(item)
	return items


def exam_stats(exam_name: str) -> dict:
	from mahanaim.services.grading import grade_for

	exam = frappe.db.get_value(
		"Exam", exam_name, ["name", "title", "pass_mark", "total_marks", "status"], as_dict=True
	)
	attempts = frappe.get_all(
		"Exam Attempt",
		filters={"exam": exam_name, "status": ["in", list(FINAL_ATTEMPT_STATUSES)]},
		fields=["name", "student", "percentage", "total_score"],
	)
	scores = [flt(a.percentage) for a in attempts]
	buckets = [{"range": f"{lo}-{lo + 9 if lo < 90 else 100}", "count": 0} for lo in range(0, 100, 10)]
	grades = {}
	for s in scores:
		buckets[min(int(s // 10), 9)]["count"] += 1
		g = grade_for(s)["grade"]
		grades[g] = grades.get(g, 0) + 1
	answers = frappe.get_all(
		"Exam Attempt Answer",
		filters={"parent": ["in", [a.name for a in attempts] or [""]], "parenttype": "Exam Attempt"},
		fields=["question", "question_type", "marks_awarded", "max_marks", "is_correct", "answer"],
	)
	per_q = {}
	for a in answers:
		q = per_q.setdefault(
			a.question,
			{
				"question": a.question,
				"question_type": a.question_type,
				"responses": 0,
				"answered": 0,
				"correct": 0,
				"marks": 0.0,
				"max": 0.0,
			},
		)
		q["responses"] += 1
		q["answered"] += 1 if a.answer not in (None, "") else 0
		q["correct"] += cint(a.is_correct)
		q["marks"] += flt(a.marks_awarded)
		q["max"] += flt(a.max_marks)
	titles = {
		q.name: q.question_title
		for q in frappe.get_all(
			"Question", filters={"name": ["in", list(per_q) or [""]]}, fields=["name", "question_title"]
		)
	}
	questions = []
	for q in per_q.values():
		facility = round(q["marks"] * 100.0 / q["max"], 1) if q["max"] else 0.0
		questions.append(
			{
				"question": q["question"],
				"title": titles.get(q["question"]),
				"question_type": q["question_type"],
				"responses": q["responses"],
				"answered": q["answered"],
				"correct_rate": round(q["correct"] * 100.0 / q["responses"], 1) if q["responses"] else 0.0,
				"facility": facility,
				"difficulty": "Easy" if facility >= 70 else ("Medium" if facility >= 40 else "Hard"),
			}
		)
	questions.sort(key=lambda q: q["facility"])
	passed = len([s for s in scores if s + 1e-9 >= flt(exam.pass_mark)])
	return {
		"exam": exam_name,
		"title": exam.title,
		"status": exam.status,
		"count": len(scores),
		"average": round(sum(scores) / len(scores), 2) if scores else 0.0,
		"highest": max(scores) if scores else 0.0,
		"lowest": min(scores) if scores else 0.0,
		"pass_rate": round(passed * 100.0 / len(scores), 1) if scores else 0.0,
		"distribution": buckets,
		"grades": [{"grade": g, "count": c} for g, c in sorted(grades.items(), key=lambda kv: str(kv[0]))],
		"questions": questions,
	}


def exam_monitor(exam_name: str) -> dict:
	now = now_datetime()
	exam = frappe.db.get_value(
		"Exam",
		exam_name,
		["name", "title", "status", "course_offering", "start_datetime", "end_datetime"],
		as_dict=True,
	)
	attempts = frappe.get_all(
		"Exam Attempt",
		filters={"exam": exam_name, "status": ["!=", "Void"]},
		fields=[
			"name",
			"student",
			"student_name",
			"status",
			"attempt_number",
			"started_on",
			"deadline",
			"submitted_on",
			"focus_lost_count",
			"percentage",
			"ip_address",
		],
		order_by="started_on desc",
	)
	names = [a.name for a in attempts] or [""]
	answered = {
		r.parent: cint(r.n)
		for r in frappe.get_all(
			"Exam Attempt Answer",
			filters={"parent": ["in", names], "parenttype": "Exam Attempt", "answer": ["is", "set"]},
			fields=["parent", {"COUNT": "*", "as": "n"}],
			group_by="parent",
		)
	}
	totals = {
		r.parent: cint(r.n)
		for r in frappe.get_all(
			"Exam Attempt Answer",
			filters={"parent": ["in", names], "parenttype": "Exam Attempt"},
			fields=["parent", {"COUNT": "*", "as": "n"}],
			group_by="parent",
		)
	}
	events = recent_events([a.name for a in attempts], MONITOR_EVENTS_PER_ATTEMPT)
	rows = [
		{
			**a,
			"answered": answered.get(a.name, 0),
			"questions": totals.get(a.name, 0),
			"time_left": time_remaining(a.deadline, now) if a.status == "In Progress" else 0,
			"events": events.get(a.name, []),
		}
		for a in attempts
	]
	started = {a.student for a in attempts}
	not_started = [s for s in enrolled_students(exam.course_offering, ENROLLED) if s not in started]
	students = {
		r.name: r
		for r in frappe.get_all(
			"Student",
			filters={"name": ["in", not_started or [""]]},
			fields=["name", "full_name", "student_number"],
		)
	}
	return {
		"exam": exam,
		"server_time": now,
		"attempts": rows,
		"in_progress": len([a for a in attempts if a.status == "In Progress"]),
		"submitted": len([a for a in attempts if a.status != "In Progress"]),
		"not_started": not_started,
		"not_started_students": sorted(
			(
				{
					"name": s,
					"full_name": (students.get(s) or {}).get("full_name"),
					"student_number": (students.get(s) or {}).get("student_number"),
				}
				for s in not_started
			),
			key=lambda r: ((r["full_name"] or "").casefold(), r["name"]),
		),
	}


def recent_events(attempts, limit: int) -> dict[str, list[dict]]:
	"""{attempt: [{type, event, timestamp, detail}, ...]}: the newest `limit` events per attempt, newest first."""
	attempts = [a for a in attempts or [] if a]
	if not attempts:
		return {}
	rows = frappe.db.sql(
		"""
		select parent, event, timestamp, detail from (
			select parent, event, timestamp, detail, idx,
				row_number() over (partition by parent order by timestamp desc, idx desc) as rn
			from `tabExam Attempt Event`
			where parenttype = 'Exam Attempt' and parent in %(attempts)s
		) recent
		where rn <= %(limit)s
		order by parent, timestamp desc, idx desc
		""",
		{"attempts": attempts, "limit": cint(limit)},
		as_dict=True,
	)
	out: dict[str, list[dict]] = {}
	for r in rows:
		out.setdefault(r.parent, []).append(
			{
				"type": (r.event or "").lower().replace(" ", "_"),
				"event": r.event,
				"timestamp": r.timestamp,
				"detail": r.detail,
			}
		)
	return out
