"""B2 test helpers (academics, learning, assessments, exams, results). Builds on `mahanaim.tests.factories`."""

from __future__ import annotations

import random
from unittest.mock import patch

import frappe
from frappe.utils import add_to_date, now_datetime, random_string

from mahanaim.tests import factories as f

NOTIFY_TARGETS = (
	"mahanaim.services.communication.notify",
	"mahanaim.services.assessments.notify",
	"mahanaim.services.exams.notify",
	"mahanaim.services.results.notify",
)
CLEARED = {"cleared": True, "balance": 0, "paid_percent": 100, "required_percent": 100, "message": ""}


def code(prefix="T", length=5) -> str:
	return (prefix + random_string(length)).upper()


def unique_phone() -> str:
	return "07" + "".join(str(random.randint(0, 9)) for _ in range(8))


def no_commit(test):
	"""Block implicit commits so the class-level rollback stays effective."""
	patcher = patch.object(frappe.local.db, "commit", lambda *a, **k: None)
	patcher.start()
	test.addCleanup(patcher.stop)


def as_user(test, user: str):
	frappe.set_user(user)
	test.addCleanup(frappe.set_user, "Administrator")


def setup_mocks(test) -> frappe._dict:
	"""Patch notifications, LMS enqueueing and the B3 fee contract (cleared by default)."""
	mocks = frappe._dict(notify=[])
	for target in NOTIFY_TARGETS:
		patcher = patch(target)
		mocks.notify.append(patcher.start())
		test.addCleanup(patcher.stop)
	patcher = patch("mahanaim.services.fees.fee_clearance", return_value=dict(CLEARED))
	mocks.fee = patcher.start()
	test.addCleanup(patcher.stop)
	patcher = patch("mahanaim.services.students.enqueue_lms")
	mocks.enqueue_lms = patcher.start()
	test.addCleanup(patcher.stop)
	# a test class creates many users inside one (rolled back) transaction; Frappe's 60/hour cap trips
	patcher = patch("frappe.core.doctype.user.user.throttle_user_creation")
	patcher.start()
	test.addCleanup(patcher.stop)
	no_commit(test)
	return mocks


def use_single(test, doctype: str, **values):
	"""Set Single doctype values for the rest of a test method (restored afterwards)."""
	previous = {k: frappe.db.get_single_value(doctype, k, cache=False) for k in values}

	def apply(vals):
		for key, value in vals.items():
			frappe.db.set_single_value(doctype, key, value)
		frappe.db.value_cache.clear()
		frappe.clear_document_cache(doctype, doctype)

	apply(values)
	test.addCleanup(apply, previous)


def events(mocks) -> list[str]:
	return [c.args[0] for m in mocks.notify for c in m.call_args_list]


def make_lecturer(campus=None):
	return f.make_staff(
		first_name="Lect",
		last_name=code("L") + " _T",
		email=f"lect.{random_string(8).lower()}@example.com",
		campus=campus,
	)


def make_student(programme=None, campus=None):
	return f.make_student(
		first_name="Stu",
		last_name=code("S") + " _T",
		email=f"stu.{random_string(8).lower()}@example.com",
		programme=programme,
		campus=campus,
		phone=unique_phone(),
	)


def make_world(students=2, credits=3, pass_mark=40, course_code=None, term=None, campus=None, lecturer=None):
	"""Offering taught by a fresh lecturer with `students` enrolled students."""
	campus = campus or f.make_campus().name
	term = term or f.make_term().name
	course_code = course_code or code("C")
	course = f.make_course(course_code, f"Course {course_code} _T", credits, pass_mark)
	lecturer = lecturer or make_lecturer(campus)
	offering = f.make_offering(course.name, term, campus, lecturer.name)
	programme = f.make_programme().name
	studs = []
	for _i in range(students):
		s = make_student(programme, campus)
		f.make_enrolment(s.name, offering.name)
		studs.append(s)
	return frappe._dict(
		campus=campus, term=term, course=course, lecturer=lecturer, offering=offering, students=studs
	)


def question_payload(course: str, qtype: str, marks=1, **values) -> dict:
	payload = {
		"doctype": "Question",
		"course": course,
		"question_type": qtype,
		"question": f"<p>{qtype} question {code()}</p>",
		"marks": marks,
		"topic": values.pop("topic", "General"),
	}
	if qtype == "Multiple Choice":
		payload["options"] = [
			{"option_text": "Moses", "is_correct": 1},
			{"option_text": "Aaron", "is_correct": 0},
			{"option_text": "Miriam", "is_correct": 0},
		]
	elif qtype == "Multiple Select":
		payload["options"] = [
			{"option_text": "Matthew", "is_correct": 1},
			{"option_text": "Mark", "is_correct": 1},
			{"option_text": "Moses", "is_correct": 0},
			{"option_text": "David", "is_correct": 0},
		]
	elif qtype == "True or False":
		payload["correct_boolean"] = "True"
	elif qtype == "Short Answer":
		payload["accepted_answers"] = "Jerusalem\nCity of David"
	elif qtype == "Fill in the Blank":
		payload["accepted_answers"] = "Bethlehem"
	elif qtype == "Matching":
		payload["matching_pairs"] = [
			{"prompt": "Genesis", "match": "Creation"},
			{"prompt": "Exodus", "match": "Deliverance"},
			{"prompt": "Acts", "match": "Early church"},
			{"prompt": "Revelation", "match": "Apocalypse"},
		]
	elif qtype == "Essay":
		payload["marking_guide"] = "<p>Discuss covenant themes.</p>"
	payload.update(values)
	return payload


def make_question(course: str, qtype: str, marks=1, **values):
	doc = frappe.get_doc(question_payload(course, qtype, marks, **values))
	doc.insert(ignore_permissions=True)
	return doc


def make_exam(offering: str, questions, status="Scheduled", start=None, end=None, duration=60, **values):
	now = now_datetime()
	doc = frappe.get_doc(
		{
			"doctype": "Exam",
			"title": f"Exam {code()}",
			"exam_type": values.pop("exam_type", "CAT"),
			"course_offering": offering,
			"delivery_mode": "Online",
			"status": status,
			"start_datetime": start or add_to_date(now, minutes=-5),
			"end_datetime": end or add_to_date(now, hours=2),
			"duration_minutes": duration,
			"shuffle_questions": 1,
			"shuffle_options": 1,
			"questions": [{"question": q if isinstance(q, str) else q.name} for q in questions],
			**values,
		}
	)
	doc.insert(ignore_permissions=True)
	return doc


def make_assignment(offering: str, status="Published", due=None, **values):
	now = now_datetime()
	doc = frappe.get_doc(
		{
			"doctype": "Assignment",
			"title": f"Assignment {code()}",
			"course_offering": offering,
			"assessment_component": values.pop("assessment_component", "Assignment"),
			"status": status,
			"open_date": values.pop("open_date", add_to_date(now, days=-10)),
			"due_date": due or add_to_date(now, days=7),
			"max_score": values.pop("max_score", 100),
			"submission_type": values.pop("submission_type", "Text"),
			**values,
		}
	)
	doc.insert(ignore_permissions=True)
	return doc
