"""Assignments and continuous assessment (owned by backend domain B2).

Also hosts the roster helpers shared by the B2 modules (academics, learning, exams, results):
`enrolled_students`, `is_enrolled`, `student_offerings`, `recipients_for_students`, `enrolment_counts`.

Late-penalty maths (pure, unit-tested):
	days_late = ceil((submitted_on - due_date) / 1 day)            (0 when on time)
	penalty   = raw_score * min(days_late * rate_per_day, max_late_penalty) / 100
	final     = max(raw_score - penalty, 0)
"""

from __future__ import annotations

import math
import os

import frappe
from frappe import _
from frappe.utils import add_to_date, cint, flt, format_datetime, get_datetime, now_datetime

from mahanaim.services.communication import notify

ENROLLED = ("Enrolled",)
ACTIVE_ROSTER = ("Enrolled", "Completed", "Failed")
SUBMITTED_STATUSES = ("Submitted", "Late", "Graded", "Returned")
GRADED_STATUSES = ("Graded", "Returned")
REMINDER_WINDOW_HOURS = 48


# ---------------------------------------------------------------------------------- roster helpers
def enrolled_students(offering: str, statuses=ACTIVE_ROSTER) -> list[str]:
	return frappe.get_all(
		"Course Enrolment",
		filters={"course_offering": offering, "status": ["in", list(statuses)]},
		pluck="student",
		order_by="student_name asc",
		distinct=True,
	)


def is_enrolled(student: str, offering: str, statuses=ACTIVE_ROSTER) -> bool:
	if not student or not offering:
		return False
	return bool(
		frappe.db.exists(
			"Course Enrolment",
			{"student": student, "course_offering": offering, "status": ["in", list(statuses)]},
		)
	)


def student_offerings(student: str, statuses=ACTIVE_ROSTER, term: str | None = None) -> list[str]:
	filters = {"student": student, "status": ["in", list(statuses)]}
	if term:
		filters["academic_term"] = term
	return frappe.get_all("Course Enrolment", filters=filters, pluck="course_offering", distinct=True)


def enrolment_counts(offerings, statuses=ENROLLED) -> dict:
	offerings = list(offerings or [])
	if not offerings:
		return {}
	rows = frappe.get_all(
		"Course Enrolment",
		filters={"course_offering": ["in", offerings], "status": ["in", list(statuses)]},
		fields=["course_offering", {"COUNT": "*", "as": "n"}],
		group_by="course_offering",
	)
	return {r.course_offering: cint(r.n) for r in rows}


def recipients_for_students(students) -> list[dict]:
	students = [s for s in set(students or []) if s]
	if not students:
		return []
	rows = frappe.get_all(
		"Student", filters={"name": ["in", students]}, fields=["name", "user", "email", "phone", "full_name"]
	)
	return [{"user": r.user, "email": r.email, "phone": r.phone, "name": r.full_name} for r in rows]


# ---------------------------------------------------------------------------------- pure maths
def days_late_for(submitted_on, due_date) -> int:
	if not submitted_on or not due_date:
		return 0
	seconds = (get_datetime(submitted_on) - get_datetime(due_date)).total_seconds()
	return math.ceil(seconds / 86400.0) if seconds > 0 else 0


def penalty_for(raw_score, days_late, rate_per_day, max_penalty_percent) -> float:
	if cint(days_late) <= 0 or flt(raw_score) <= 0:
		return 0.0
	percent = min(cint(days_late) * flt(rate_per_day), flt(max_penalty_percent))
	return round(flt(raw_score) * max(percent, 0.0) / 100.0, 2)


def final_score_for(raw_score, penalty) -> float:
	return round(max(flt(raw_score) - flt(penalty), 0.0), 2)


# ---------------------------------------------------------------------------------- submissions
def _allowed_extension(filename: str, allowed: str | None) -> bool:
	if not allowed:
		return True
	exts = {e.strip().lower().lstrip(".") for e in allowed.split(",") if e.strip()}
	ext = os.path.splitext(filename or "")[1].lower().lstrip(".")
	return not exts or ext in exts


def _validate_attachment(file_url: str, allowed_types: str | None, owner: str | None = None) -> str | None:
	"""Return the File name for an uploaded `file_url` (owned by `owner`) or throw."""
	if not file_url:
		return None
	filters = {"file_url": file_url}
	if owner and owner != "Administrator":
		filters["owner"] = owner
	file_name = frappe.db.get_value("File", filters, "name", order_by="creation desc")
	if not file_name:
		frappe.throw(_("The uploaded file could not be found. Please upload it again."))
	if not _allowed_extension(file_url, allowed_types):
		frappe.throw(_("This file type is not accepted. Allowed types: {0}").format(allowed_types))
	return file_name


def attach_file(file_name: str | None, doctype: str, name: str, field: str):
	if file_name:
		frappe.db.set_value(
			"File",
			file_name,
			{"attached_to_doctype": doctype, "attached_to_name": name, "attached_to_field": field},
			update_modified=False,
		)


def submission_window(assignment, existing=None, now=None) -> dict:
	"""Non-throwing evaluation of whether `existing` (or a new submission) may be (re)submitted now."""
	now = get_datetime(now or now_datetime())
	due = get_datetime(assignment.due_date)
	cutoff = get_datetime(assignment.late_cutoff) if assignment.late_cutoff else None
	state = {"can_submit": False, "is_late": now > due, "reason": None}
	if assignment.status != "Published":
		state["reason"] = _("This assignment is not open for submissions.")
	elif assignment.open_date and now < get_datetime(assignment.open_date):
		state["reason"] = _("This assignment opens on {0}.").format(format_datetime(assignment.open_date))
	elif existing and (existing.get("status") in GRADED_STATUSES or existing.get("graded_on")):
		state["reason"] = _("This submission has already been graded.")
	elif now <= due:
		state["can_submit"] = True
	elif existing and existing.get("status") in SUBMITTED_STATUSES:
		state["reason"] = _("The due date has passed, so your submission can no longer be changed.")
	elif not cint(assignment.allow_late):
		state["reason"] = _("The due date has passed and late submissions are not accepted.")
	elif cutoff and now > cutoff:
		state["reason"] = _("The late submission window closed on {0}.").format(format_datetime(cutoff))
	else:
		state["can_submit"] = True
	return state


def submit(assignment: str, student: str, answer_text: str | None = None, attachment: str | None = None):
	"""Create or update the student's submission, enforcing the deadline and late rules."""
	a = frappe.get_doc("Assignment", assignment)
	if not is_enrolled(student, a.course_offering):
		frappe.throw(_("You are not enrolled in this course."), frappe.PermissionError)
	frappe.db.get_value("Student", student, "name", for_update=True)  # serialise double-clicks
	existing_name = frappe.db.get_value("Assignment Submission", {"assignment": a.name, "student": student})
	existing = frappe.get_doc("Assignment Submission", existing_name) if existing_name else None
	now = now_datetime()
	state = submission_window(a, existing, now)
	if not state["can_submit"]:
		frappe.throw(state["reason"])

	answer_text = (answer_text or "").strip() or None
	if a.submission_type == "Text" and not answer_text:
		frappe.throw(_("Please type your answer before submitting."))
	if a.submission_type == "File Upload" and not attachment:
		frappe.throw(_("Please attach your work before submitting."))
	if a.submission_type == "File and Text" and not (attachment or answer_text):
		frappe.throw(_("Please attach a file or type your answer before submitting."))
	file_name = (
		_validate_attachment(attachment, a.allowed_file_types, frappe.session.user) if attachment else None
	)

	doc = existing or frappe.new_doc("Assignment Submission")
	doc.update(
		{
			"assignment": a.name,
			"student": student,
			"answer_text": answer_text if a.submission_type != "File Upload" else None,
			"attachment": attachment if a.submission_type != "Text" else None,
			"submitted_on": now,
			"status": "Late" if state["is_late"] else "Submitted",
		}
	)
	doc.save(ignore_permissions=True)
	attach_file(file_name, "Assignment Submission", doc.name, "attachment")
	return doc


def grade(name: str, raw_score, feedback=None, feedback_attachment=None, released=None):
	doc = frappe.get_doc("Assignment Submission", name)
	max_score = flt(frappe.db.get_value("Assignment", doc.assignment, "max_score"))
	if raw_score in (None, ""):
		frappe.throw(_("Enter a score."))
	if flt(raw_score) < 0 or flt(raw_score) > max_score:
		frappe.throw(_("Score must be between 0 and {0}.").format(max_score))
	file_name = None
	if feedback_attachment and feedback_attachment != doc.feedback_attachment:
		file_name = _validate_attachment(feedback_attachment, None, frappe.session.user)
	doc.raw_score = flt(raw_score)
	if feedback is not None:
		doc.feedback = feedback
	if feedback_attachment is not None:
		doc.feedback_attachment = feedback_attachment or None
	doc.status = "Graded"
	doc.graded_by = frappe.session.user
	doc.graded_on = now_datetime()
	if released is not None:
		doc.released = cint(released)
	doc.save(ignore_permissions=True)
	attach_file(file_name, "Assignment Submission", doc.name, "feedback_attachment")
	return doc


def grade_offline(assignment: str, student: str, raw_score, feedback=None):
	"""Grade a student who handed in on paper (creates the submission record)."""
	a = frappe.db.get_value("Assignment", assignment, ["course_offering"], as_dict=True)
	if not a or not is_enrolled(student, a.course_offering):
		frappe.throw(_("Student {0} is not enrolled in this course.").format(student))
	name = frappe.db.get_value("Assignment Submission", {"assignment": assignment, "student": student})
	if not name:
		doc = frappe.get_doc(
			{
				"doctype": "Assignment Submission",
				"assignment": assignment,
				"student": student,
				"status": "Submitted",
			}
		)
		doc.insert(ignore_permissions=True)
		name = doc.name
	return grade(name, raw_score, feedback)


def release_grades(assignment: str) -> int:
	names = frappe.get_all(
		"Assignment Submission",
		filters={"assignment": assignment, "status": ["in", list(GRADED_STATUSES)], "released": 0},
		pluck="name",
	)
	for name in names:
		doc = frappe.get_doc("Assignment Submission", name)
		doc.released = 1
		doc.flags.skip_counters = True
		doc.save(ignore_permissions=True)
	refresh_assignment_counters(assignment)
	a = frappe.get_doc("Assignment", assignment)
	if a.status == "Closed":
		a.status = "Graded"
		a.save(ignore_permissions=True)
	return len(names)


def refresh_assignment_counters(assignment: str):
	rows = frappe.get_all(
		"Assignment Submission",
		filters={"assignment": assignment, "status": ["in", list(SUBMITTED_STATUSES)]},
		fields=["status", "final_score"],
	)
	graded = [flt(r.final_score) for r in rows if r.status in GRADED_STATUSES]
	frappe.db.set_value(
		"Assignment",
		assignment,
		{
			"submission_count": len(rows),
			"graded_count": len(graded),
			"average_score": round(sum(graded) / len(graded), 2) if graded else 0,
		},
		update_modified=False,
	)


# ---------------------------------------------------------------------------------- notifications
def notify_published(doc):
	students = enrolled_students(doc.course_offering, ENROLLED)
	notify(
		"Assignment Published",
		doc=doc,
		recipients=recipients_for_students(students),
		link=f"/student/courses/{doc.course_offering}",
		category="Academic",
		fallback={
			"subject": _("New assignment: {0}").format(doc.title),
			"message": _("A new assignment <b>{0}</b> has been posted for {1}. Due {2}.").format(
				doc.title, doc.course_title, format_datetime(doc.due_date)
			),
		},
	)


def notify_graded(submission):
	notify(
		"Assignment Graded",
		doc=submission,
		recipients=recipients_for_students([submission.student]),
		link=f"/student/assignments/{submission.assignment}",
		category="Academic",
		fallback={
			"subject": _("Feedback ready: {0}").format(submission.assignment_title),
			"message": _("Your submission for {0} has been graded.").format(submission.assignment_title),
		},
	)


def send_due_reminders():
	"""Daily: remind enrolled students without a submission about assignments due within 48 hours.

	Each assignment is reminded once (Assignment.reminder_sent_on); moving the due date resets it."""
	now = now_datetime()
	due = frappe.get_all(
		"Assignment",
		filters={
			"status": "Published",
			"due_date": ["between", [now, add_to_date(now, hours=REMINDER_WINDOW_HOURS)]],
			"reminder_sent_on": ["is", "not set"],
		},
		pluck="name",
	)
	sent = 0
	for name in due:
		try:
			doc = frappe.get_doc("Assignment", name)
			submitted = set(
				frappe.get_all(
					"Assignment Submission",
					filters={"assignment": name, "status": ["in", list(SUBMITTED_STATUSES)]},
					pluck="student",
				)
			)
			pending = [s for s in enrolled_students(doc.course_offering, ENROLLED) if s not in submitted]
			if pending:
				notify(
					"Assignment Due Reminder",
					doc=doc,
					recipients=recipients_for_students(pending),
					link=f"/student/courses/{doc.course_offering}",
					category="Academic",
					fallback={
						"subject": _("Reminder: {0} is due soon").format(doc.title),
						"message": _("{0} ({1}) is due {2}.").format(
							doc.title, doc.course_title, format_datetime(doc.due_date)
						),
					},
				)
				sent += len(pending)
			frappe.db.set_value("Assignment", name, "reminder_sent_on", now, update_modified=False)
			if not frappe.flags.in_test:
				frappe.db.commit()
		except Exception:
			if not frappe.flags.in_test:
				frappe.db.rollback()
			frappe.log_error(title=f"Assignment reminder failed: {name}")
	return sent
