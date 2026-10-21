import json

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_to_date, get_datetime, now_datetime

from mahanaim.api import exams as api
from mahanaim.services import exams as svc
from mahanaim.tests import factories_b2 as fb

OBJECTIVE = {
	"Multiple Choice": 2,
	"Multiple Select": 4,
	"True or False": 1,
	"Short Answer": 2,
	"Fill in the Blank": 1,
	"Matching": 4,
}


def option_ids(question: str, correct=None) -> list[str]:
	filters = {"parent": question, "parenttype": "Question"}
	if correct is not None:
		filters["is_correct"] = 1 if correct else 0
	return frappe.get_all("Question Option", filters=filters, pluck="name", order_by="idx asc")


def pair_map(question: str) -> dict:
	rows = frappe.get_all(
		"Question Match Pair",
		filters={"parent": question, "parenttype": "Question"},
		fields=["name", "match"],
		order_by="idx asc",
	)
	return {r.name: r.match for r in rows}


class TestExams(IntegrationTestCase):
	def setUp(self):
		self.mocks = fb.setup_mocks(self)
		self.w = fb.make_world(students=2)
		self.student = self.w.students[0]
		self.course = self.w.course.name

	def objective_exam(self, **values):
		qs = {t: fb.make_question(self.course, t, marks=m) for t, m in OBJECTIVE.items()}
		exam = fb.make_exam(self.w.offering.name, list(qs.values()), **values)
		return exam, qs

	def as_student(self, student=None):
		fb.as_user(self, (student or self.student).user)

	# ------------------------------------------------------------------ pure marking
	def test_mark_answer_rules(self):
		ms = {"correct": ["a", "b"]}
		self.assertEqual(svc.mark_answer("Multiple Select", ["a", "b"], ms, 4)["marks"], 4)
		self.assertEqual(svc.mark_answer("Multiple Select", ["a", "c"], ms, 4)["marks"], 0)
		self.assertEqual(svc.mark_answer("Multiple Select", ["a", "c", "d"], ms, 4)["marks"], 0)
		self.assertEqual(svc.mark_answer("Multiple Select", ["a"], ms, 4)["marks"], 2)
		text = {"accepted": ["City of David"], "case_sensitive": 0}
		self.assertTrue(svc.mark_answer("Short Answer", "  city   OF david ", text, 1)["is_correct"])
		self.assertFalse(
			svc.mark_answer("Short Answer", "city of david", {**text, "case_sensitive": 1}, 1)["is_correct"]
		)
		pairs = {"pairs": {"p1": "A", "p2": "B"}}
		self.assertEqual(svc.mark_answer("Matching", {"p1": "A", "p2": "A"}, pairs, 4)["marks"], 2)
		self.assertIsNone(svc.mark_answer("Essay", "text", {}, 5))
		self.assertEqual(svc.mark_answer("True or False", "false", {"boolean": "true"}, 1)["marks"], 0)

	# ------------------------------------------------------------------ question validation
	def test_question_validation(self):
		bad = [
			("Multiple Choice", {"options": [{"option_text": "Only", "is_correct": 1}]}),
			(
				"Multiple Choice",
				{"options": [{"option_text": "A", "is_correct": 1}, {"option_text": "B", "is_correct": 1}]},
			),
			(
				"Multiple Select",
				{"options": [{"option_text": "A", "is_correct": 0}, {"option_text": "B", "is_correct": 0}]},
			),
			("True or False", {"correct_boolean": ""}),
			("Short Answer", {"accepted_answers": ""}),
			("Matching", {"matching_pairs": [{"prompt": "A", "match": "B"}]}),
			("Essay", {"marks": 0}),
		]
		for qtype, values in bad:
			with self.subTest(qtype=qtype, values=values), self.assertRaises(frappe.ValidationError):
				fb.make_question(self.course, qtype, **values)
		self.assertTrue(fb.make_question(self.course, "Essay", marks=10).name)

	def test_exam_total_marks_and_random_subset(self):
		qs = [fb.make_question(self.course, "Multiple Choice", marks=m) for m in (1, 2, 3, 4)]
		exam = fb.make_exam(self.w.offering.name, qs, random_question_count=2)
		self.assertEqual(exam.total_marks, 5)
		with self.assertRaises(frappe.ValidationError):
			fb.make_exam(self.w.offering.name, qs, random_question_count=5)
		with self.assertRaises(frappe.ValidationError):
			fb.make_exam(self.w.offering.name, qs, duration=500)
		self.as_student()
		payload = api.start_exam(exam.name)
		self.assertEqual(len(payload["questions"]), 2)

	# ------------------------------------------------------------------ full flow
	def test_full_flow_auto_marks_every_objective_type(self):
		exam, qs = self.objective_exam()
		self.as_student()
		payload = api.start_exam(exam.name)
		self.assertEqual(payload["status"], "In Progress")
		self.assertTrue(0 < payload["time_remaining"] <= 3600)
		self.assertEqual(len(payload["questions"]), len(OBJECTIVE))
		attempt = payload["attempt"]

		mcq, ms, tf = qs["Multiple Choice"].name, qs["Multiple Select"].name, qs["True or False"].name
		sa, fib, match = qs["Short Answer"].name, qs["Fill in the Blank"].name, qs["Matching"].name
		pairs = pair_map(match)
		wrong = dict(zip(pairs, [*list(pairs.values())[1:], next(iter(pairs.values()))], strict=True))
		matching_answer = {pid: pairs[pid] for pid in list(pairs)[:2]}  # 2 of 4 right
		matching_answer[list(pairs)[2]] = wrong[list(pairs)[2]]  # 1 wrong, 1 blank
		answers = {
			mcq: option_ids(mcq, correct=True)[0],
			ms: json.dumps([*option_ids(ms, correct=True), option_ids(ms, correct=False)[0]]),
			tf: "true",
			sa: "  city   OF david ",
			fib: "bethlehem",
			match: json.dumps(matching_answer),
		}
		for question, answer in answers.items():
			self.assertTrue(api.save_answer(attempt, question, answer)["ok"])
		# resuming returns the same attempt with saved answers
		resumed = api.start_exam(exam.name)
		self.assertEqual(resumed["attempt"], attempt)
		self.assertEqual(resumed["answered"], len(OBJECTIVE))

		result = api.submit_attempt(attempt)
		self.assertEqual(result["status"], "Marked")
		self.assertEqual(result["submission_mode"], "Submitted")
		doc = frappe.get_doc("Exam Attempt", attempt)
		marks = {a.question: a.marks_awarded for a in doc.answers}
		self.assertEqual(marks[mcq], 2)
		self.assertEqual(marks[ms], 2)  # (2 correct - 1 wrong) / 2 correct x 4
		self.assertEqual(marks[tf], 1)
		self.assertEqual(marks[sa], 2)
		self.assertEqual(marks[fib], 1)
		self.assertEqual(marks[match], 2)  # 2 of 4 pairs x 4
		self.assertEqual(doc.auto_score, 10)
		self.assertEqual(doc.total_score, 10)
		self.assertEqual(doc.max_score, 14)
		self.assertAlmostEqual(doc.percentage, 71.43, places=2)
		with self.assertRaises(frappe.ValidationError):
			api.save_answer(attempt, mcq, answers[mcq])

	def test_essay_requires_manual_marking_then_release(self):
		mcq = fb.make_question(self.course, "Multiple Choice", marks=2)
		essay = fb.make_question(self.course, "Essay", marks=8)
		exam = fb.make_exam(self.w.offering.name, [mcq, essay], show_answers_after_release=1)
		self.as_student()
		attempt = api.start_exam(exam.name)["attempt"]
		api.save_answer(attempt, mcq.name, option_ids(mcq.name, correct=True)[0])
		api.save_answer(attempt, essay.name, "<p>The covenant with Abraham...</p>")
		self.assertEqual(api.submit_attempt(attempt)["status"], "Marking")
		with self.assertRaises(frappe.ValidationError):
			api.my_exam_result(attempt)

		fb.as_user(self, self.w.lecturer.user)
		queue = api.marking_queue(exam.name)
		self.assertEqual(queue["pending"], 1)
		self.assertEqual(queue["unmarked_answers"], 1)
		review = api.get_attempt_for_marking(attempt)
		essay_item = next(i for i in review["items"] if i["question"] == essay.name)
		self.assertIn("marking_guide", essay_item)
		with self.assertRaises(frappe.ValidationError):
			api.mark_answer(attempt, essay.name, 9)
		api.mark_answer(attempt, essay.name, 6, "Good")
		self.assertEqual(api.finalise_attempt(attempt)["status"], "Marked")
		with self.assertRaises(frappe.ValidationError):
			api.release_results(exam.name)  # still open
		api.close_exam(exam.name)
		self.assertEqual(api.release_results(exam.name)["status"], "Released")
		self.assertIn("Exam Results Released", fb.events(self.mocks))

		self.as_student()
		result = api.my_exam_result(attempt)
		self.assertEqual(result["attempt"]["total_score"], 8)
		self.assertEqual(result["attempt"]["percentage"], 80)
		self.assertEqual(result["attempt"]["grade"], "A")
		self.assertTrue(result["show_answers"])
		mcq_item = next(i for i in result["items"] if i["question"] == mcq.name)
		self.assertEqual(mcq_item["correct_answer"], option_ids(mcq.name, correct=True))

	def test_answers_never_leaked_before_release(self):
		exam, _qs = self.objective_exam(show_answers_after_release=0)
		self.as_student()
		payload = api.start_exam(exam.name)
		blob = json.dumps(payload, default=str)
		for secret in ("is_correct", "correct", "accepted", "City of David", "Bethlehem", "marking_guide"):
			self.assertNotIn(secret, blob)
		for item in payload["questions"]:
			self.assertNotIn("pairs", item)
			for option in item.get("options", []):
				self.assertEqual(set(option), {"id", "text"})
		attempt = payload["attempt"]
		summary = api.submit_attempt(attempt)
		self.assertNotIn("items", summary)
		self.assertNotIn("is_correct", json.dumps(api.get_attempt(attempt), default=str))
		with self.assertRaises(frappe.ValidationError):
			api.my_exam_result(attempt)

		# released without show_answers_after_release: scores but no correct answers
		frappe.set_user("Administrator")
		frappe.db.set_value("Exam", exam.name, "status", "Closed")
		svc.release_results(exam.name)
		self.as_student()
		result = api.my_exam_result(attempt)
		self.assertFalse(result["show_answers"])
		self.assertTrue(all("correct_answer" not in i for i in result["items"]))

	def test_attempt_ownership(self):
		exam, qs = self.objective_exam()
		self.as_student()
		attempt = api.start_exam(exam.name)["attempt"]
		self.as_student(self.w.students[1])
		mcq = qs["Multiple Choice"].name
		with self.assertRaises(frappe.PermissionError):
			api.save_answer(attempt, mcq, option_ids(mcq)[0])
		with self.assertRaises(frappe.PermissionError):
			api.submit_attempt(attempt)
		with self.assertRaises(frappe.PermissionError):
			api.log_exam_event(attempt, "focus_lost")
		with self.assertRaises(frappe.PermissionError):
			api.get_attempt(attempt)

	# ------------------------------------------------------------------ start checks
	def test_start_checks_enrolment_access_code_and_mode(self):
		exam, _qs = self.objective_exam(access_code="ZION42")
		outsider = fb.make_student(campus=self.w.campus)
		self.as_student(outsider)
		with self.assertRaises(frappe.PermissionError):
			api.start_exam(exam.name, "ZION42")
		self.as_student()
		with self.assertRaises(frappe.PermissionError):
			api.start_exam(exam.name, "wrong")
		self.assertEqual(api.start_exam(exam.name, " ZION42 ")["status"], "In Progress")

		frappe.set_user("Administrator")
		later, _qs = self.objective_exam(
			start=add_to_date(now_datetime(), days=1), end=add_to_date(now_datetime(), days=1, hours=2)
		)
		self.as_student()
		with self.assertRaises(frappe.ValidationError):
			api.start_exam(later.name)
		upcoming = [e for e in api.my_exams()["upcoming"] if e["name"] == later.name]
		self.assertFalse(upcoming[0]["can_start"])

	def test_attempts_limit(self):
		exam, _qs = self.objective_exam(max_attempts=2)
		self.as_student()
		first = api.start_exam(exam.name)
		api.submit_attempt(first["attempt"])
		second = api.start_exam(exam.name)
		self.assertEqual(second["attempt_number"], 2)
		api.submit_attempt(second["attempt"])
		with self.assertRaisesRegex(frappe.ValidationError, "attempt"):
			api.start_exam(exam.name)
		mine = next(e for e in api.my_exams()["open"] if e["name"] == exam.name)
		self.assertEqual(mine["attempts_used"], 2)
		self.assertFalse(mine["can_start"])

	def test_fee_clearance_blocks_start(self):
		exam, _qs = self.objective_exam()
		self.mocks.fee.return_value = {
			"cleared": False,
			"balance": 5000,
			"paid_percent": 40,
			"required_percent": 100,
			"message": "Clear KES 5,000 to sit exams.",
		}
		self.as_student()
		with self.assertRaisesRegex(frappe.ValidationError, "KES 5,000"):
			api.start_exam(exam.name)
		self.mocks.fee.assert_called_with(self.student.name, "exam")
		self.assertFalse(frappe.db.exists("Exam Attempt", {"exam": exam.name}))
		mine = next(e for e in api.my_exams()["open"] if e["name"] == exam.name)
		self.assertIn("Clear KES 5,000 to sit exams.", mine["reasons"])
		self.mocks.fee.return_value = dict(fb.CLEARED)
		self.assertEqual(api.start_exam(exam.name)["status"], "In Progress")

	# ------------------------------------------------------------------ deadlines and cron
	def test_deadline_is_capped_by_exam_end_and_enforced(self):
		now = now_datetime()
		exam, qs = self.objective_exam(
			start=add_to_date(now, minutes=-55), end=add_to_date(now, minutes=10), duration=60
		)
		self.as_student()
		attempt = api.start_exam(exam.name)["attempt"]
		deadline = get_datetime(frappe.db.get_value("Exam Attempt", attempt, "deadline"))
		self.assertEqual(deadline, get_datetime(exam.end_datetime))

		frappe.db.set_value("Exam Attempt", attempt, "deadline", add_to_date(now, minutes=-1))
		mcq = qs["Multiple Choice"].name
		with self.assertRaisesRegex(frappe.ValidationError, "Time is up"):
			api.save_answer(attempt, mcq, option_ids(mcq)[0])

		frappe.set_user("Administrator")
		self.assertEqual(svc.auto_submit_expired_attempts(), 1)
		doc = frappe.get_doc("Exam Attempt", attempt)
		self.assertEqual(doc.status, "Marked")
		self.assertEqual(svc.submission_mode(doc), "Auto Submitted")
		self.assertEqual(get_datetime(doc.submitted_on), get_datetime(doc.deadline))

	def test_update_exam_statuses(self):
		now = now_datetime()
		exam, _qs = self.objective_exam()
		self.assertEqual(frappe.db.get_value("Exam", exam.name, "status"), "Scheduled")
		svc.update_exam_statuses()
		self.assertEqual(frappe.db.get_value("Exam", exam.name, "status"), "Open")

		essay = fb.make_question(self.course, "Essay", marks=5)
		written = fb.make_exam(self.w.offering.name, [essay])
		self.as_student()
		attempt = api.start_exam(written.name)["attempt"]
		api.save_answer(attempt, essay.name, "An answer")
		frappe.set_user("Administrator")
		past = {"start_datetime": add_to_date(now, hours=-3), "end_datetime": add_to_date(now, minutes=-1)}
		frappe.db.set_value("Exam", exam.name, past)
		frappe.db.set_value("Exam", written.name, past)
		svc.update_exam_statuses()
		self.assertEqual(frappe.db.get_value("Exam", exam.name, "status"), "Closed")
		self.assertEqual(frappe.db.get_value("Exam", written.name, "status"), "Marking")
		self.assertEqual(frappe.db.get_value("Exam Attempt", attempt, "status"), "Marking")

	def test_focus_events_and_monitor(self):
		exam, _qs = self.objective_exam()
		self.as_student()
		attempt = api.start_exam(exam.name)["attempt"]
		api.log_exam_event(attempt, "focus_lost", {"at": "q3"})
		self.assertEqual(api.log_exam_event(attempt, "focus_lost")["focus_lost_count"], 2)
		with self.assertRaises(frappe.ValidationError):
			api.log_exam_event(attempt, "teleport")
		fb.as_user(self, self.w.lecturer.user)
		monitor = api.exam_monitor(exam.name)
		row = next(r for r in monitor["attempts"] if r["name"] == attempt)
		self.assertEqual(row["focus_lost_count"], 2)

	# ------------------------------------------------------------------ lecturer tools
	def test_lecturer_scoping(self):
		exam, qs = self.objective_exam()
		other = fb.make_lecturer(self.w.campus)
		fb.as_user(self, other.user)
		for call in (
			lambda: api.list_exams(self.w.offering.name),
			lambda: api.get_exam(exam.name),
			lambda: api.exam_monitor(exam.name),
			lambda: api.question_bank(self.course),
			lambda: api.get_question(qs["Multiple Choice"].name),
		):
			with self.assertRaises(frappe.PermissionError):
				call()
		fb.as_user(self, self.w.lecturer.user)
		self.assertEqual(api.list_exams(self.w.offering.name)["total"], 1)
		bank = api.question_bank(self.course, {"question_type": "Matching"})
		self.assertEqual(bank["total"], 1)

	def test_save_exam_and_import_questions(self):
		fb.as_user(self, self.w.lecturer.user)
		result = api.import_questions(
			self.course,
			[
				{
					"question_type": "MCQ",
					"question": "Who led Israel out of Egypt?",
					"option_a": "Moses",
					"option_b": "Joshua",
					"correct": "A",
					"marks": 2,
				},
				{
					"question_type": "True/False",
					"question": "Jesus was born in Bethlehem.",
					"correct": "true",
				},
				{
					"question_type": "Short Answer",
					"question": "Capital of Judah?",
					"correct": "Jerusalem|Zion",
				},
				{"question_type": "Matching", "question": "Match", "pairs": "Genesis=Creation|Exodus=Egypt"},
				{
					"question_type": "Multiple Choice",
					"question": "Broken",
					"option_a": "Only",
					"correct": "A",
				},
			],
		)
		self.assertEqual(result["created"], 4)
		self.assertEqual(result["failed"], 1)
		self.assertEqual(result["errors"][0]["row"], 5)
		exam = api.save_exam(
			{
				"course_offering": self.w.offering.name,
				"title": "CAT 1",
				"exam_type": "CAT",
				"start_datetime": str(add_to_date(now_datetime(), days=2)),
				"end_datetime": str(add_to_date(now_datetime(), days=2, hours=1)),
				"duration_minutes": 45,
				"questions": result["questions"],
			}
		)
		self.assertEqual(exam["status"], "Draft")
		self.assertEqual(exam["total_marks"], 5)
		scheduled = api.schedule_exam(exam["name"])
		self.assertEqual(scheduled["status"], "Scheduled")
		self.assertIn("Exam Scheduled", fb.events(self.mocks))
		with self.assertRaises(frappe.ValidationError):
			api.delete_question(result["questions"][0])
