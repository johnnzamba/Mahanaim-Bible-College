"""Lecturer portal (M07/M09/M10/M11 aggregation): dashboard, my offerings, offering overview and roster export.

See docs/api/lecturer.md.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import add_days, cint, flt, getdate, now_datetime, nowdate
from frappe.utils.csvutils import to_csv

from mahanaim.api.academics import attendance_summary, offering_summary, require_teaching
from mahanaim.api.utils import require_lecturer
from mahanaim.services.assessments import ACTIVE_ROSTER, ENROLLED, enrolment_counts
from mahanaim.services.exams import (
	CAT_EXAM_TYPES,
	FINAL_ATTEMPT_STATUSES,
	PENDING_ATTEMPT_STATUSES,
	fee_clearance_state,
)
from mahanaim.services.lms_bridge import SYNCED, lms_available
from mahanaim.utils import current_term

OFFERING_FIELDS = [
	"name",
	"course",
	"course_title",
	"credits",
	"academic_term",
	"campus",
	"study_mode",
	"section",
	"status",
	"results_status",
	"lms_course",
	"lms_sync_status",
	"capacity",
]
UPCOMING_DAYS = 14
DASHBOARD_LIMIT = 10


def taught_offerings(term: str | None = None, user: str | None = None, include_cancelled=False) -> list:
	parents = frappe.get_all(
		"Course Offering Lecturer",
		filters={"user": user or frappe.session.user, "parenttype": "Course Offering"},
		fields=["parent", "role"],
	)
	roles = {p.parent: p.role for p in parents}
	filters = {"name": ["in", list(roles) or [""]]}
	if term:
		filters["academic_term"] = term
	if not include_cancelled:
		filters["status"] = ["!=", "Cancelled"]
	rows = frappe.get_all("Course Offering", filters=filters, fields=OFFERING_FIELDS, order_by="course asc")
	for r in rows:
		r["my_role"] = roles.get(r.name)
	return rows


def to_grade_counts(offerings: list[str]) -> dict:
	"""{offering: {"submissions": n, "essay_answers": n, "attempts": n}} (batched)."""
	out = {o: {"submissions": 0, "essay_answers": 0, "attempts": 0} for o in offerings}
	if not offerings:
		return out
	for r in frappe.get_all(
		"Assignment Submission",
		filters={"course_offering": ["in", offerings], "status": ["in", ["Submitted", "Late"]]},
		fields=["course_offering", {"COUNT": "*", "as": "n"}],
		group_by="course_offering",
	):
		out[r.course_offering]["submissions"] = cint(r.n)
	attempts = frappe.get_all(
		"Exam Attempt",
		filters={"course_offering": ["in", offerings], "status": ["in", list(PENDING_ATTEMPT_STATUSES)]},
		fields=["name", "course_offering"],
	)
	owner = {a.name: a.course_offering for a in attempts}
	for a in attempts:
		out[a.course_offering]["attempts"] += 1
	if owner:
		for r in frappe.get_all(
			"Exam Attempt Answer",
			filters={"parent": ["in", list(owner)], "parenttype": "Exam Attempt", "is_marked": 0},
			fields=["parent", {"COUNT": "*", "as": "n"}],
			group_by="parent",
		):
			out[owner[r.parent]]["essay_answers"] += cint(r.n)
	return out


def _decorate(rows: list) -> list:
	names = [r.name for r in rows]
	enrolled = enrolment_counts(names, ENROLLED)
	grading = to_grade_counts(names)
	lms = lms_available() if any(r.lms_course for r in rows) else False
	for r in rows:
		r["enrolled_count"] = enrolled.get(r.name, 0)
		r["to_grade"] = grading.get(r.name)
		r["lms_url"] = (
			f"/lms/courses/{r.lms_course}" if lms and r.lms_course and r.lms_sync_status == SYNCED else None
		)
	return rows


@frappe.whitelist()
def my_offerings(term=None):
	"""Offerings I teach. term: an Academic Term, "all", or empty for the current term."""
	require_lecturer()
	if term == "all":
		term = None
	else:
		term = term or current_term()
	data = _decorate(taught_offerings(term))
	return {"term": term, "data": data, "total": len(data)}


@frappe.whitelist()
def lecturer_dashboard():
	require_lecturer()
	term = current_term()
	offerings = _decorate(taught_offerings(term))
	names = [o.name for o in offerings]
	today = getdate(nowdate())
	sessions, exams, attendance_due = [], [], []
	if names:
		sessions = frappe.get_all(
			"Class Session",
			filters={
				"course_offering": ["in", names],
				"status": ["in", ["Scheduled", "Rescheduled"]],
				"session_date": ["between", [today, add_days(today, UPCOMING_DAYS)]],
			},
			fields=[
				"name",
				"course_offering",
				"course_title",
				"session_date",
				"start_time",
				"end_time",
				"venue",
				"mode",
				"meeting_link",
				"topic",
			],
			order_by="session_date asc, start_time asc",
			limit=DASHBOARD_LIMIT,
		)
		attendance_due = frappe.get_all(
			"Class Session",
			filters={
				"course_offering": ["in", names],
				"status": ["in", ["Scheduled", "Rescheduled"]],
				"session_date": ["<=", today],
				"attendance_taken": 0,
			},
			fields=["name", "course_offering", "course_title", "session_date", "start_time", "topic"],
			order_by="session_date desc",
			limit=DASHBOARD_LIMIT,
		)
		exams = frappe.get_all(
			"Exam",
			filters={
				"course_offering": ["in", names],
				"status": ["in", ["Scheduled", "Open"]],
				"end_datetime": [">=", now_datetime()],
			},
			fields=[
				"name",
				"title",
				"exam_type",
				"course_offering",
				"course_title",
				"status",
				"delivery_mode",
				"start_datetime",
				"end_datetime",
				"attempt_count",
			],
			order_by="start_datetime asc",
			limit=DASHBOARD_LIMIT,
		)
	mark_sheets = {}
	for o in offerings:
		key = o.results_status or "Not Started"
		mark_sheets[key] = mark_sheets.get(key, 0) + 1
	return {
		"term": term,
		"offerings": offerings,
		"totals": {
			"offerings": len(offerings),
			"students": sum(o.enrolled_count for o in offerings),
			"submissions_to_grade": sum(o.to_grade["submissions"] for o in offerings),
			"attempts_to_mark": sum(o.to_grade["attempts"] for o in offerings),
			"answers_to_mark": sum(o.to_grade["essay_answers"] for o in offerings),
			"attendance_due": len(attendance_due),
		},
		"upcoming_sessions": sessions,
		"attendance_due": attendance_due,
		"upcoming_exams": exams,
		"mark_sheets": mark_sheets,
	}


# ---------------------------------------------------------------------------------- offering overview
def _roster(offering: str) -> list:
	enrolments = frappe.get_all(
		"Course Enrolment",
		filters={"course_offering": offering, "status": ["in", list(ACTIVE_ROSTER)]},
		fields=["student", "status", "enrolled_on", "final_grade"],
	)
	students = {
		s.name: s
		for s in frappe.get_all(
			"Student",
			filters={"name": ["in", [e.student for e in enrolments] or [""]]},
			fields=["name", "student_number", "full_name", "email", "phone", "programme", "photo", "status"],
		)
	}
	rows = []
	for e in enrolments:
		s = students.get(e.student) or frappe._dict()
		rows.append(
			frappe._dict(
				student=e.student,
				student_number=s.student_number,
				full_name=s.full_name,
				email=s.email,
				phone=s.phone,
				programme=s.programme,
				photo=s.photo,
				student_status=s.status,
				enrolment_status=e.status,
				enrolled_on=e.enrolled_on,
				final_grade=e.final_grade,
			)
		)
	rows.sort(key=lambda r: ((r.full_name or "").casefold(), r.student))
	return rows


def _assignment_averages(offering: str, assignments: list) -> dict:
	max_scores = {a.name: flt(a.max_score) for a in assignments}
	out = {}
	for s in frappe.get_all(
		"Assignment Submission",
		filters={"course_offering": offering, "status": ["in", ["Graded", "Returned"]]},
		fields=["student", "assignment", "final_score"],
	):
		if max_scores.get(s.assignment):
			out.setdefault(s.student, []).append(flt(s.final_score) * 100.0 / max_scores[s.assignment])
	return {k: round(sum(v) / len(v), 2) for k, v in out.items()}


def _cat_averages(exams: list) -> dict:
	cats = [e.name for e in exams if e.exam_type in CAT_EXAM_TYPES]
	best = {}
	for a in frappe.get_all(
		"Exam Attempt",
		filters={"exam": ["in", cats or [""]], "status": ["in", list(FINAL_ATTEMPT_STATUSES)]},
		fields=["student", "exam", "percentage"],
	):
		key = (a.student, a.exam)
		best[key] = max(best.get(key, 0.0), flt(a.percentage))
	out = {}
	for (student, _exam), pct in best.items():
		out.setdefault(student, []).append(pct)
	return {k: round(sum(v) / len(v), 2) for k, v in out.items()}


def roster_with_metrics(offering: str, include_fees: bool = True) -> tuple[list, list, list]:
	roster = _roster(offering)
	assignments = frappe.get_all(
		"Assignment",
		filters={"course_offering": offering},
		fields=[
			"name",
			"title",
			"assessment_component",
			"status",
			"due_date",
			"max_score",
			"submission_count",
			"graded_count",
			"average_score",
		],
		order_by="due_date asc",
	)
	exams = frappe.get_all(
		"Exam",
		filters={"course_offering": offering, "status": ["!=", "Cancelled"]},
		fields=[
			"name",
			"title",
			"exam_type",
			"status",
			"delivery_mode",
			"start_datetime",
			"end_datetime",
			"total_marks",
			"attempt_count",
			"submitted_count",
			"average_score",
		],
		order_by="start_datetime asc",
	)
	assignment_avg = _assignment_averages(offering, assignments)
	cat_avg = _cat_averages(exams)
	attendance = attendance_summary([offering], [r.student for r in roster]).get(offering, {})
	for r in roster:
		att = attendance.get(r.student) or {}
		r["assignment_average"] = assignment_avg.get(r.student)
		r["cat_average"] = cat_avg.get(r.student)
		r["attendance_percentage"] = att.get("percentage")
		r["sessions_held"] = att.get("held", 0)
		if include_fees:
			# Per-student call into the B3 fee contract (wrapped so a failure never breaks the roster).
			state = fee_clearance_state(r.student, "exam")
			r["fee_cleared"] = bool(state.get("cleared"))
			r["fee_message"] = state.get("message") or None
	return roster, assignments, exams


@frappe.whitelist()
def offering_overview(offering):
	require_teaching(offering)
	roster, assignments, exams = roster_with_metrics(offering)
	today = getdate(nowdate())
	sessions = frappe.get_all(
		"Class Session",
		filters={"course_offering": offering, "status": ["!=", "Cancelled"]},
		fields=["name", "session_date", "start_time", "end_time", "status", "topic", "attendance_taken"],
		order_by="session_date asc, start_time asc",
	)
	sheet = frappe.db.get_value(
		"Mark Sheet",
		{"course_offering": offering},
		["name", "status", "student_count", "pass_count", "average_score", "return_reason"],
		as_dict=True,
	)
	return {
		"offering": offering_summary(offering),
		"roster": roster,
		"assignments": assignments,
		"exams": exams,
		"sessions": {
			"total": len(sessions),
			"held": len([s for s in sessions if s.status == "Held"]),
			"upcoming": [s for s in sessions if getdate(s.session_date) >= today and s.status != "Held"][
				:DASHBOARD_LIMIT
			],
			"attendance_due": [
				s
				for s in sessions
				if getdate(s.session_date) <= today and s.status != "Held" and not cint(s.attendance_taken)
			],
		},
		"to_grade": to_grade_counts([offering])[offering],
		"mark_sheet": sheet or {"name": None, "status": "Not Started"},
	}


@frappe.whitelist()
def roster_csv(offering):
	"""Download the class list (CSV) with assessment averages and attendance."""
	require_teaching(offering)
	roster, _assignments, _exams = roster_with_metrics(offering, include_fees=False)
	title = frappe.db.get_value("Course Offering", offering, ["course", "academic_term"], as_dict=True)
	data = [
		[
			_("Student Number"),
			_("Name"),
			_("Email"),
			_("Phone"),
			_("Programme"),
			_("Enrolment Status"),
			_("Assignment Average %"),
			_("CAT Average %"),
			_("Attendance %"),
			_("Final Grade"),
		]
	]
	for r in roster:
		data.append(
			[
				r.student_number or r.student,
				r.full_name,
				r.email,
				r.phone,
				r.programme,
				r.enrolment_status,
				r.assignment_average if r.assignment_average is not None else "",
				r.cat_average if r.cat_average is not None else "",
				r.attendance_percentage if r.attendance_percentage is not None else "",
				r.final_grade or "",
			]
		)
	safe = "".join(c if c.isalnum() or c in "-_" else "-" for c in f"{title.course}-{title.academic_term}")
	frappe.response["filename"] = f"roster-{safe}.csv"
	frappe.response["filecontent"] = to_csv(data)
	frappe.response["type"] = "download"
