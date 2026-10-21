"""Results services: mark sheets, publication and transcripts (owned by backend domain B2).

CONTRACT:
	transcript_data(student: str, as_of_term: str | None = None, published_only: bool = True) -> dict
		{"student": {...}, "terms": [{"term", "label", "courses": [{code,title,credits,total,grade,grade_points,
		 status}], "gpa", "credits"}], "cgpa", "total_credits", "classification"}
		Used by credentials (B3) to snapshot transcripts.

Mark sheet components (stored as weighted points, i.e. percentage x weight / 100)
	cat_score         CAT/Quiz exams + Assignments whose component is CAT (average %)
	assignment_score  Assignments whose component is Assignment (released final scores, average %)
	exam_score        Main Exam / Special exam (best marked attempt %)
	other_score       Project/Practical/Participation assignments when any exist, otherwise manual entry
Missing work counts 0; unmarked/unreleased work makes the component *pending* (result Incomplete);
no attempt at a due online final exam makes the entry *absent*. Lecturer overrides are kept across refreshes.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cint, flt, get_datetime, getdate, now_datetime, today

from mahanaim.services.assessments import (
	ACTIVE_ROSTER,
	GRADED_STATUSES,
	enrolled_students,
	recipients_for_students,
)
from mahanaim.services.communication import notify
from mahanaim.services.grading import (
	best_attempts,
	classification_for,
	clear_cache,
	gpa_summary,
	grade_for,
	order_terms,
	refresh_student_standing,
	scale_data,
	student_results,
	term_start_dates,
)

COMPONENTS = ("cat", "assignment", "exam", "other")
SCORE_FIELD = {c: f"{c}_score" for c in COMPONENTS}
WEIGHT_FIELD = {c: f"{c}_weight" for c in COMPONENTS}
DEFAULT_WEIGHTS = {"cat": 20.0, "assignment": 10.0, "exam": 70.0, "other": 0.0}
WEIGHT_BUCKET = {
	"CAT": "cat",
	"Assignment": "assignment",
	"Exam": "exam",
	"Practical": "other",
	"Participation": "other",
	"Project": "other",
}
CAT_EXAM_TYPES = ("CAT", "Quiz")
FINAL_EXAM_TYPES = ("Main Exam", "Special")
EDITABLE_STATUSES = ("Draft", "Returned")
SHEET_TRANSITIONS = {
	"Draft": ("Submitted",),
	"Submitted": ("Approved", "Returned"),
	"Approved": ("Published", "Returned"),
	"Returned": ("Draft", "Submitted"),
	"Published": (),
}
ABSENT_GRADE = "ABS"
INCOMPLETE_GRADE = "I"
_EPS = 1e-6


# ---------------------------------------------------------------------------------- pure helpers
def split_set(value) -> set:
	return {v.strip() for v in str(value or "").split(",") if v.strip()}


def join_set(values) -> str | None:
	ordered = [c for c in COMPONENTS if c in set(values or [])]
	return ",".join(ordered) or None


def weights_from_rows(rows) -> dict:
	"""Pure: map Assessment Weight rows onto the four mark sheet buckets (defaults when empty)."""
	rows = [r for r in rows or [] if flt(r.get("weight")) > 0]
	if not rows:
		return dict(DEFAULT_WEIGHTS)
	weights = {c: 0.0 for c in COMPONENTS}
	for r in rows:
		weights[WEIGHT_BUCKET.get(r.get("component"), "other")] += flt(r.get("weight"))
	return weights


def points(percentage, weight) -> float:
	return round(max(0.0, min(100.0, flt(percentage))) * flt(weight) / 100.0, 2)


def evaluate_entry(
	scores: dict, weights: dict, pending=(), absent=False, overridden=(), pass_mark=40, scale=None
) -> dict:
	"""Pure-ish (uses grade_for): total, grade, grade_points and result_status for one entry."""
	overridden = set(overridden or [])
	pending = {c for c in pending or [] if flt(weights.get(c)) > 0 and c not in overridden}
	total = round(sum(flt(scores.get(c)) for c in COMPONENTS if flt(weights.get(c)) > 0), 2)
	if absent and "exam" not in overridden:
		return {"total": total, "grade": ABSENT_GRADE, "grade_points": 0.0, "result_status": "Absent"}
	if pending:
		return {"total": total, "grade": INCOMPLETE_GRADE, "grade_points": 0.0, "result_status": "Incomplete"}
	g = grade_for(total, scale)
	status = "Pass" if total + _EPS >= flt(pass_mark) else "Fail"
	return {
		"total": total,
		"grade": g["grade"],
		"grade_points": flt(g["grade_points"]),
		"result_status": status,
	}


def average(values) -> float | None:
	values = [flt(v) for v in values]
	return round(sum(values) / len(values), 4) if values else None


# ---------------------------------------------------------------------------------- component collection
def _item_due(item, now) -> bool:
	if item.kind == "exam":
		return item.status in ("Closed", "Marking", "Released") or now >= get_datetime(item.end_datetime)
	return item.status in ("Closed", "Graded") or now >= get_datetime(item.due_date)


def assessment_items(offering: str) -> list:
	"""Every countable exam/assignment of an offering tagged with its mark sheet bucket."""
	items = []
	for e in frappe.get_all(
		"Exam",
		filters={"course_offering": offering, "status": ["not in", ["Draft", "Cancelled"]]},
		fields=["name", "title", "exam_type", "status", "delivery_mode", "end_datetime"],
	):
		bucket = (
			"cat" if e.exam_type in CAT_EXAM_TYPES else ("exam" if e.exam_type in FINAL_EXAM_TYPES else None)
		)
		if bucket:
			items.append(frappe._dict(e, kind="exam", bucket=bucket))
	for a in frappe.get_all(
		"Assignment",
		filters={"course_offering": offering, "status": ["!=", "Draft"]},
		fields=["name", "title", "assessment_component", "status", "due_date", "max_score"],
	):
		bucket = {"CAT": "cat", "Assignment": "assignment"}.get(a.assessment_component, "other")
		items.append(frappe._dict(a, kind="assignment", bucket=bucket))
	return items


def collect_components(offering: str, students: list[str], now=None) -> dict:
	"""Batched component percentages per student.

	{student: {"pct": {bucket: % | None}, "pending": set, "absent": bool}, "__manual_other__": bool}"""
	now = get_datetime(now or now_datetime())
	all_items = assessment_items(offering)
	items = [i for i in all_items if _item_due(i, now)]
	exams = [i.name for i in items if i.kind == "exam"]
	assignments = [i.name for i in items if i.kind == "assignment"]
	attempts, submissions = {}, {}
	if exams and students:
		for a in frappe.get_all(
			"Exam Attempt",
			filters={"exam": ["in", exams], "student": ["in", students], "status": ["!=", "Void"]},
			fields=["exam", "student", "status", "percentage"],
		):
			attempts.setdefault((a.exam, a.student), []).append(a)
	if assignments and students:
		for s in frappe.get_all(
			"Assignment Submission",
			filters={"assignment": ["in", assignments], "student": ["in", students]},
			fields=["assignment", "student", "status", "released", "final_score"],
		):
			submissions[(s.assignment, s.student)] = s
	max_scores = {i.name: flt(i.max_score) for i in items if i.kind == "assignment"}
	due_buckets = {i.bucket for i in items}
	# "other" is a manual component unless the lecturer created Project/Practical/Participation work
	manual_other = not any(i.bucket == "other" for i in all_items)

	out = {"__manual_other__": manual_other}
	for student in students:
		values = {c: [] for c in COMPONENTS}
		pending, final_marked, final_pending, final_missing = set(), [], False, False
		for item in items:
			if item.kind == "exam":
				rows = attempts.get((item.name, student), [])
				done = [flt(r.percentage) for r in rows if r.status in ("Marked", "Released")]
				if item.bucket == "exam":
					if done:
						final_marked.append(max(done))
					elif rows or item.delivery_mode != "Online":
						final_pending = True
					else:
						final_missing = True
				elif done:
					values[item.bucket].append(max(done))
				elif rows:
					pending.add(item.bucket)
				else:
					values[item.bucket].append(0.0)
			else:
				sub = submissions.get((item.name, student))
				if not sub or sub.status in ("Draft", "Missing"):
					values[item.bucket].append(0.0)
				elif sub.status in GRADED_STATUSES and cint(sub.released):
					maximum = max_scores.get(item.name) or 100
					values[item.bucket].append(flt(sub.final_score) * 100.0 / maximum)
				else:
					pending.add(item.bucket)
		pct = {c: average(values[c]) for c in ("cat", "assignment", "other")}
		pct["exam"] = max(final_marked) if final_marked else None
		absent = False
		if not final_marked:
			if final_pending:
				pending.add("exam")
			elif final_missing:
				absent = True
		for bucket in COMPONENTS:
			if bucket not in due_buckets and not (bucket == "other" and manual_other):
				pending.add(bucket)
		out[student] = {"pct": pct, "pending": pending, "absent": absent}
	return out


# ---------------------------------------------------------------------------------- mark sheets
def sheet_context(sheet) -> dict:
	offering = frappe.db.get_value(
		"Course Offering",
		sheet.course_offering,
		["name", "course", "course_title", "credits", "academic_term", "grading_scale"],
		as_dict=True,
	)
	scale = sheet.get("grading_scale") or offering.grading_scale or None
	pass_mark = flt(frappe.db.get_value("Course", offering.course, "pass_mark"))
	if pass_mark <= 0:
		pass_mark = flt(scale_data(scale).get("pass_mark")) or 40.0
	return {"offering": offering, "scale": scale, "pass_mark": pass_mark}


def sheet_weights(sheet) -> dict:
	return {c: flt(sheet.get(WEIGHT_FIELD[c])) for c in COMPONENTS}


def evaluate_sheet_entries(sheet, ctx: dict | None = None):
	"""Recompute totals/grades/statuses for every entry from stored components and flags (used in validate)."""
	ctx = ctx or sheet_context(sheet)
	weights = sheet_weights(sheet)
	for e in sheet.entries:
		for c in COMPONENTS:
			if flt(weights[c]) <= 0:
				e.set(SCORE_FIELD[c], 0)
		result = evaluate_entry(
			{c: e.get(SCORE_FIELD[c]) for c in COMPONENTS},
			weights,
			split_set(e.pending_components),
			cint(e.is_absent),
			split_set(e.overridden_components),
			ctx["pass_mark"],
			ctx["scale"],
		)
		e.total = result["total"]
		e.grade = result["grade"]
		e.grade_points = result["grade_points"]
		e.result_status = result["result_status"]
	totals = [flt(e.total) for e in sheet.entries]
	sheet.student_count = len(sheet.entries)
	sheet.pass_count = len([e for e in sheet.entries if e.result_status == "Pass"])
	sheet.average_score = round(sum(totals) / len(totals), 2) if totals else 0
	sheet.highest_score = max(totals) if totals else 0


def refresh_entries(sheet, now=None):
	"""Add/remove roster rows and recompute every non-overridden component from live assessment data."""
	roster = enrolled_students(sheet.course_offering, ACTIVE_ROSTER)
	roster_set = set(roster)
	existing = {e.student for e in sheet.entries}
	sheet.set("entries", [e for e in sheet.entries if e.student in roster_set])
	for student in roster:
		if student not in existing:
			sheet.append("entries", {"student": student})
	weights = sheet_weights(sheet)
	data = collect_components(sheet.course_offering, roster, now)
	manual_other = data.get("__manual_other__", True)
	for e in sheet.entries:
		info = data.get(e.student) or {"pct": {}, "pending": set(), "absent": False}
		overridden = split_set(e.overridden_components)
		pending = set()
		for c in COMPONENTS:
			if c in overridden:
				continue
			if c == "other" and manual_other:
				e.other_score = 0
				if flt(weights["other"]) > 0:
					pending.add("other")
				continue
			pct = info["pct"].get(c)
			e.set(SCORE_FIELD[c], points(pct, weights[c]) if pct is not None else 0)
			if c in info["pending"]:
				pending.add(c)
		e.pending_components = join_set(pending)
		e.is_absent = 1 if info["absent"] and "exam" not in overridden else 0
	names = dict(
		frappe.get_all(
			"Student", filters={"name": ["in", roster or [""]]}, fields=["name", "full_name"], as_list=True
		)
	)
	sheet.entries.sort(key=lambda r: ((names.get(r.student) or "").casefold(), r.student))
	for i, e in enumerate(sheet.entries, 1):
		e.idx = i
		e.student_name = names.get(e.student) or e.student_name
	return sheet


def get_or_create_mark_sheet(offering: str, refresh: bool = True):
	name = frappe.db.get_value("Mark Sheet", {"course_offering": offering})
	if name:
		sheet = frappe.get_doc("Mark Sheet", name)
		if refresh and sheet.status in EDITABLE_STATUSES:
			refresh_entries(sheet)
			sheet.save(ignore_permissions=True)
		return sheet
	off = frappe.get_doc("Course Offering", offering)
	weights = weights_from_rows([r.as_dict() for r in off.assessment_weights])
	sheet = frappe.get_doc(
		{
			"doctype": "Mark Sheet",
			"course_offering": offering,
			"grading_scale": off.grading_scale,
			"status": "Draft",
			**{WEIGHT_FIELD[c]: weights[c] for c in COMPONENTS},
		}
	)
	refresh_entries(sheet)
	sheet.insert(ignore_permissions=True)
	return sheet


def sheet_signature(sheet) -> tuple:
	"""Everything a recompute can change, to tell whether the stored sheet is behind live assessment data."""
	return (
		tuple(
			sorted(
				(
					e.student,
					*(round(flt(e.get(SCORE_FIELD[c])), 2) for c in COMPONENTS),
					round(flt(e.total), 2),
					e.grade or None,
					round(flt(e.grade_points), 2),
					e.result_status or None,
					join_set(split_set(e.pending_components)),
					cint(e.is_absent),
				)
				for e in sheet.entries
			)
		),
		cint(sheet.student_count),
		cint(sheet.pass_count),
		round(flt(sheet.average_score), 2),
		round(flt(sheet.highest_score), 2),
	)


def read_mark_sheet(offering: str) -> tuple:
	"""(sheet, created, stale) for display without saving: an editable sheet is recomputed in memory only, so
	concurrent reads never write (and never clash on `modified`). The sheet is persisted on creation and
	through recompute/save/submit; `stale` says whether the stored copy differs from the fresh figures."""
	name = frappe.db.get_value("Mark Sheet", {"course_offering": offering})
	if not name:
		frappe.db.savepoint("create_mark_sheet")
		try:
			return get_or_create_mark_sheet(offering), True, False
		except (frappe.DuplicateEntryError, frappe.UniqueValidationError):
			# another request created it first: read theirs
			frappe.db.rollback(save_point="create_mark_sheet")
			name = frappe.db.get_value("Mark Sheet", {"course_offering": offering}, for_update=True)
			if not name:
				raise
	sheet = frappe.get_doc("Mark Sheet", name)
	if sheet.status not in EDITABLE_STATUSES:
		return sheet, False, False
	stored = sheet_signature(sheet)
	refresh_entries(sheet)
	evaluate_sheet_entries(sheet)
	return sheet, False, sheet_signature(sheet) != stored


def apply_entry_overrides(sheet, rows: list[dict]):
	"""Lecturer edits: rows [{student, cat_score?, assignment_score?, exam_score?, other_score?, remarks?}].

	Values are weighted points (0..weight). A null value clears the override (value recomputed)."""
	if sheet.status not in EDITABLE_STATUSES:
		frappe.throw(
			_("Mark sheet is {0}; it can only be edited in Draft or Returned.").format(_(sheet.status))
		)
	weights = sheet_weights(sheet)
	by_student = {e.student: e for e in sheet.entries}
	for row in rows or []:
		e = by_student.get(row.get("student"))
		if not e:
			frappe.throw(_("Student {0} is not on this mark sheet.").format(row.get("student")))
		overridden = split_set(e.overridden_components)
		for c in COMPONENTS:
			field = SCORE_FIELD[c]
			if field not in row:
				continue
			value = row.get(field)
			if value in (None, ""):
				overridden.discard(c)
				continue
			value = flt(value)
			if value < 0 or value > flt(weights[c]) + _EPS:
				frappe.throw(
					_("{0}: {1} must be between 0 and {2}.").format(
						e.student_name or e.student, _(c.title()), flt(weights[c])
					)
				)
			e.set(field, round(value, 2))
			overridden.add(c)
			pending = split_set(e.pending_components)
			pending.discard(c)
			e.pending_components = join_set(pending)
			if c == "exam":
				e.is_absent = 0
		e.overridden_components = join_set(overridden)
		if "remarks" in row:
			e.remarks = (row.get("remarks") or "")[:140] or None
	refresh_entries(sheet)
	sheet.save(ignore_permissions=True)
	return sheet


def set_weights(sheet, weights: dict):
	if sheet.status not in EDITABLE_STATUSES:
		frappe.throw(_("Weights can only be changed while the mark sheet is Draft or Returned."))
	for c in COMPONENTS:
		key = WEIGHT_FIELD[c]
		if key in weights and weights[key] is not None:
			sheet.set(key, flt(weights[key]))
	refresh_entries(sheet)
	sheet.save(ignore_permissions=True)
	return sheet


def transition(sheet, to_status: str, remarks: str | None = None):
	sheet.status = to_status
	if to_status == "Returned":
		sheet.return_reason = remarks
	sheet.save(ignore_permissions=True)
	return sheet


# ---------------------------------------------------------------------------------- publication
def publish_side_effects(sheet):
	"""Course Results, enrolment grades, student standing and notifications for a Published mark sheet."""
	ctx = sheet_context(sheet)
	off = ctx["offering"]
	students = [e.student for e in sheet.entries]
	if not students:
		return
	existing = {
		r.student: r.name
		for r in frappe.get_all(
			"Course Result",
			filters={"course_offering": off.name, "student": ["in", students]},
			fields=["name", "student"],
		)
	}
	prior = {
		r.student
		for r in frappe.get_all(
			"Course Result",
			filters={"course": off.course, "student": ["in", students], "course_offering": ["!=", off.name]},
			fields=["student"],
		)
	}
	enrolments = {
		r.student: r.name
		for r in frappe.get_all(
			"Course Enrolment",
			filters={"course_offering": off.name, "student": ["in", students]},
			fields=["name", "student"],
		)
	}
	published_on = getdate(sheet.published_on or today())
	for e in sheet.entries:
		values = {
			"total_score": flt(e.total),
			"grade": e.grade,
			"grade_points": flt(e.grade_points),
			"quality_points": round(flt(e.grade_points) * flt(off.credits), 2),
			"result_status": e.result_status,
			"mark_sheet": sheet.name,
			"is_published": 1,
			"published_on": published_on,
		}
		if existing.get(e.student):
			doc = frappe.get_doc("Course Result", existing[e.student])
			doc.update(values)
		else:
			doc = frappe.get_doc(
				{
					"doctype": "Course Result",
					"student": e.student,
					"course_offering": off.name,
					"attempt": "Retake" if e.student in prior else "First",
					**values,
				}
			)
		doc.flags.skip_standing = True  # refreshed once per student below
		doc.save(ignore_permissions=True)
		if enrolments.get(e.student):
			enrol_values = {
				"final_score": flt(e.total),
				"final_grade": e.grade,
				"grade_points": flt(e.grade_points),
			}
			if e.result_status == "Pass":
				enrol_values["status"] = "Completed"
			elif e.result_status in ("Fail", "Absent"):
				enrol_values["status"] = "Failed"
			frappe.db.set_value("Course Enrolment", enrolments[e.student], enrol_values)
	for student in students:
		refresh_student_standing(student)
	_refresh_enrolled_count(off.name)
	label = frappe.db.get_value("Academic Term", off.academic_term, "term_label") or off.academic_term
	notify(
		"Results Published",
		doc=sheet,
		recipients=recipients_for_students(students),
		context={"term": label, "course_title": off.course_title},
		link="/student/results",
		category="Academic",
		fallback={
			"subject": _("Results published: {0}").format(off.course_title),
			"message": _("Your results for {0} ({1}) have been published in the student portal.").format(
				off.course_title, label
			),
		},
	)


def _refresh_enrolled_count(offering: str):
	try:
		from mahanaim.services.students import refresh_enrolled_count

		refresh_enrolled_count(offering)
	except Exception:
		frappe.log_error(title=f"refresh_enrolled_count failed: {offering}")


def bulk_publish(term: str, sheets: list[str] | None = None) -> dict:
	"""Publish the term's Approved sheets, or just `sheets` (already checked by the caller)."""
	if sheets is None:
		offerings = frappe.get_all("Course Offering", filters={"academic_term": term}, pluck="name")
		sheets = frappe.get_all(
			"Mark Sheet",
			filters={"course_offering": ["in", offerings or [""]], "status": "Approved"},
			pluck="name",
		)
	published, failed = [], []
	for name in sheets:
		try:
			sheet = frappe.get_doc("Mark Sheet", name)
			transition(sheet, "Published")
			published.append(name)
			if not frappe.flags.in_test:
				frappe.db.commit()
		except Exception as e:
			if not frappe.flags.in_test:
				frappe.db.rollback()
			frappe.log_error(title=f"Mark sheet publish failed: {name}")
			failed.append({"mark_sheet": name, "error": str(e)})
	return {"published": published, "failed": failed}


# ---------------------------------------------------------------------------------- transcripts
def _student_header(student: str) -> dict:
	s = frappe.db.get_value(
		"Student",
		student,
		[
			"name",
			"student_number",
			"full_name",
			"programme",
			"programme_name",
			"campus",
			"study_mode",
			"intake",
			"admission_year",
			"status",
			"enrollment_date",
			"completion_date",
			"graduation_date",
			"academic_standing",
			"cgpa",
			"credits_earned",
			"photo",
			"date_of_birth",
			"gender",
		],
		as_dict=True,
	)
	if not s:
		frappe.throw(_("Student {0} not found.").format(student), frappe.DoesNotExistError)
	if s.programme:
		p = (
			frappe.db.get_value(
				"Programme",
				s.programme,
				["level", "award_title", "min_credits_to_graduate", "min_cgpa_to_graduate"],
				as_dict=True,
			)
			or {}
		)
		s.update(
			{
				"level": p.get("level"),
				"award_title": p.get("award_title"),
				"min_credits_to_graduate": p.get("min_credits_to_graduate"),
				"min_cgpa_to_graduate": p.get("min_cgpa_to_graduate"),
			}
		)
	return s


def transcript_data(student, as_of_term=None, published_only=True) -> dict:
	header = _student_header(student)
	rows = student_results(student, published_only=published_only)
	starts = term_start_dates([r.academic_term for r in rows] + ([as_of_term] if as_of_term else []))
	if as_of_term:
		limit = str(starts.get(as_of_term) or "")
		if not limit:
			frappe.throw(_("Academic Term {0} not found.").format(as_of_term))
		rows = [r for r in rows if r.academic_term and str(starts.get(r.academic_term) or "") <= limit]
	terms = order_terms([r.academic_term for r in rows], starts)
	labels = {
		t.name: t
		for t in frappe.get_all(
			"Academic Term",
			filters={"name": ["in", terms or [""]]},
			fields=["name", "term_label", "academic_year", "start_date", "end_date"],
		)
	}
	codes = {}
	if rows:
		codes = {
			c.name: c.course_code
			for c in frappe.get_all(
				"Course",
				filters={"name": ["in", list({r.course for r in rows if r.course})] or [""]},
				fields=["name", "course_code"],
			)
		}
	out_terms, running = [], []
	for term in terms:
		term_rows = [r for r in rows if r.academic_term == term]
		running.extend(term_rows)
		summary = gpa_summary(best_attempts(term_rows))
		cumulative = gpa_summary(best_attempts(running))
		info = labels.get(term) or frappe._dict()
		out_terms.append(
			{
				"term": term,
				"label": info.get("term_label") or term,
				"academic_year": info.get("academic_year"),
				"start_date": info.get("start_date"),
				"courses": [
					{
						"code": codes.get(r.course) or r.course,
						"title": r.course_title,
						"credits": flt(r.credits),
						"total": flt(r.total_score),
						"grade": r.grade,
						"grade_points": flt(r.grade_points),
						"status": r.result_status,
						"attempt": r.attempt,
						"course_result": r.name,
						"is_published": cint(r.is_published),
					}
					for r in sorted(term_rows, key=lambda r: codes.get(r.course) or r.course or "")
				],
				"gpa": summary["gpa"],
				"credits": summary["credits"],
				"credits_earned": summary["credits_earned"],
				"quality_points": summary["quality_points"],
				"cgpa": cumulative["gpa"],
			}
		)
	overall = gpa_summary(best_attempts(rows))
	return {
		"student": header,
		"terms": out_terms,
		"cgpa": overall["gpa"],
		"total_credits": overall["credits_earned"],
		"credits_attempted": overall["credits"],
		"quality_points": overall["quality_points"],
		"classification": classification_for(overall["gpa"]) if overall["credits"] else None,
		"as_of_term": as_of_term,
		"published_only": bool(published_only),
		"generated_on": now_datetime(),
	}


# ---------------------------------------------------------------------------------- reporting helpers
def grade_counts(rows, key: str = "grade") -> list[dict]:
	counts = {}
	for r in rows:
		counts[r.get(key) or "-"] = counts.get(r.get(key) or "-", 0) + 1
	order = [b.grade for b in scale_data().get("bands", [])]
	return sorted(
		({"grade": g, "count": c} for g, c in counts.items()),
		key=lambda x: (order.index(x["grade"]) if x["grade"] in order else 99, str(x["grade"])),
	)


def status_counts(rows, key: str = "result_status") -> dict:
	counts = {}
	for r in rows:
		counts[r.get(key) or "-"] = counts.get(r.get(key) or "-", 0) + 1
	return counts


def results_overview(term: str) -> dict:
	offerings = frappe.get_all(
		"Course Offering",
		filters={"academic_term": term, "status": ["!=", "Cancelled"]},
		fields=["name", "course", "course_title", "campus", "results_status"],
	)
	sheets = {
		s.course_offering: s
		for s in frappe.get_all(
			"Mark Sheet",
			filters={"course_offering": ["in", [o.name for o in offerings] or [""]]},
			fields=["name", "course_offering", "status", "student_count", "pass_count", "average_score"],
		)
	}
	programme_rows = frappe.get_all(
		"Programme Course",
		filters={"parenttype": "Programme", "course": ["in", list({o.course for o in offerings}) or [""]]},
		fields=["parent", "course"],
	)
	by_course = {}
	for r in programme_rows:
		by_course.setdefault(r.course, set()).add(r.parent)
	statuses = ("Not Started", "Draft", "Submitted", "Approved", "Published", "Returned")
	programmes, totals = {}, {s: 0 for s in statuses}
	for o in offerings:
		sheet = sheets.get(o.name)
		status = sheet.status if sheet else "Not Started"
		totals[status] = totals.get(status, 0) + 1
		for p in sorted(by_course.get(o.course) or {_("Unassigned")}):
			bucket = programmes.setdefault(p, {"programme": p, "offerings": 0, **{s: 0 for s in statuses}})
			bucket["offerings"] += 1
			bucket[status] = bucket.get(status, 0) + 1
	names = {
		p.name: p.programme_name
		for p in frappe.get_all(
			"Programme", filters={"name": ["in", list(programmes) or [""]]}, fields=["name", "programme_name"]
		)
	}
	for p in programmes.values():
		p["programme_name"] = names.get(p["programme"], p["programme"])
	return {
		"term": term,
		"totals": totals,
		"offerings": len(offerings),
		"programmes": sorted(programmes.values(), key=lambda p: p["programme"]),
		"sheets": [
			{
				"course_offering": o.name,
				"course_title": o.course_title,
				"campus": o.campus,
				"mark_sheet": sheets[o.name].name if o.name in sheets else None,
				"status": sheets[o.name].status if o.name in sheets else "Not Started",
				"student_count": sheets[o.name].student_count if o.name in sheets else 0,
				"pass_count": sheets[o.name].pass_count if o.name in sheets else 0,
				"average_score": sheets[o.name].average_score if o.name in sheets else 0,
			}
			for o in offerings
		],
	}


def grade_distribution(offering: str | None = None, term: str | None = None) -> dict:
	if offering:
		sheet = frappe.db.get_value(
			"Mark Sheet", {"course_offering": offering}, ["name", "status"], as_dict=True
		)
		rows = (
			frappe.get_all(
				"Mark Sheet Entry",
				filters={"parent": sheet.name, "parenttype": "Mark Sheet"},
				fields=["grade", "result_status", "total"],
			)
			if sheet
			else []
		)
		source = {"mark_sheet": sheet.name if sheet else None, "status": sheet.status if sheet else None}
	elif term:
		rows = [
			frappe._dict(grade=r.grade, result_status=r.result_status, total=r.total_score)
			for r in frappe.get_all(
				"Course Result",
				filters={"academic_term": term, "is_published": 1},
				fields=["grade", "result_status", "total_score"],
			)
		]
		source = {"term": term}
	else:
		frappe.throw(_("Provide an offering or a term."))
	totals = [flt(r.total) for r in rows]
	return {
		**source,
		"count": len(rows),
		"grades": grade_counts(rows),
		"statuses": status_counts(rows),
		"average": round(sum(totals) / len(totals), 2) if totals else 0.0,
		"highest": max(totals) if totals else 0.0,
		"lowest": min(totals) if totals else 0.0,
	}


def on_grading_scale_change():
	clear_cache()
