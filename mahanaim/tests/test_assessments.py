import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_to_date, now_datetime

from mahanaim.api import assessments as api
from mahanaim.services import assessments as svc
from mahanaim.tests import factories_b2 as fb


class TestAssessments(IntegrationTestCase):
	def setUp(self):
		self.mocks = fb.setup_mocks(self)
		self.w = fb.make_world(students=3)
		self.student = self.w.students[0]

	def as_student(self, student=None):
		fb.as_user(self, (student or self.student).user)

	def as_lecturer(self):
		fb.as_user(self, self.w.lecturer.user)

	# ------------------------------------------------------------------ pure maths
	def test_late_penalty_maths(self):
		due = now_datetime()
		self.assertEqual(svc.days_late_for(due, due), 0)
		self.assertEqual(svc.days_late_for(add_to_date(due, minutes=1), due), 1)
		self.assertEqual(svc.days_late_for(add_to_date(due, days=1), due), 1)
		self.assertEqual(svc.days_late_for(add_to_date(due, days=1, seconds=1), due), 2)
		self.assertEqual(svc.days_late_for(add_to_date(due, days=-3), due), 0)
		self.assertEqual(svc.penalty_for(80, 2, 10, 50), 16)  # 20% of 80
		self.assertEqual(svc.penalty_for(80, 9, 10, 50), 40)  # capped at 50%
		self.assertEqual(svc.penalty_for(80, 0, 10, 50), 0)
		self.assertEqual(svc.final_score_for(10, 16), 0)  # floored at zero
		self.assertEqual(svc.final_score_for(80, 16), 64)

	# ------------------------------------------------------------------ assignment rules
	def test_assignment_date_validation_and_publish_notification(self):
		now = now_datetime()
		with self.assertRaises(frappe.ValidationError):
			fb.make_assignment(self.w.offering.name, open_date=add_to_date(now, days=8))
		with self.assertRaises(frappe.ValidationError):
			fb.make_assignment(self.w.offering.name, allow_late=1, late_cutoff=add_to_date(now, days=6))
		with self.assertRaises(frappe.ValidationError):
			fb.make_assignment(self.w.offering.name, max_score=0)

		self.as_lecturer()
		draft = api.save_assignment(
			{
				"course_offering": self.w.offering.name,
				"title": "Exegesis paper",
				"due_date": str(add_to_date(now, days=5)),
				"max_score": 50,
				"submission_type": "Text",
			}
		)
		self.assertEqual(draft["status"], "Draft")
		self.assertNotIn("Assignment Published", fb.events(self.mocks))
		published = api.publish_assignment(draft["name"])
		self.assertEqual(published["status"], "Published")
		call = next(
			c for m in self.mocks.notify for c in m.call_args_list if c.args[0] == "Assignment Published"
		)
		self.assertEqual(call.kwargs["link"], f"/student/courses/{self.w.offering.name}")
		self.assertEqual(len(call.kwargs["recipients"]), 3)

	def test_late_submission_penalty(self):
		now = now_datetime()
		a = fb.make_assignment(
			self.w.offering.name,
			due=add_to_date(now, days=-2, hours=-12),
			allow_late=1,
			late_cutoff=add_to_date(now, days=1),
			late_penalty_percent_per_day=10,
			max_late_penalty_percent=25,
			max_score=40,
		)
		self.as_student()
		result = api.submit_assignment(a.name, "In the beginning was the Word...")
		self.assertEqual(result["submission"]["status"], "Late")
		self.assertEqual(result["submission"]["days_late"], 3)
		self.assertTrue(result["submission"]["is_late"])
		with self.assertRaisesRegex(frappe.ValidationError, "no longer be changed"):
			api.submit_assignment(a.name, "Edited after the due date")

		self.as_lecturer()
		sub = frappe.db.get_value(
			"Assignment Submission", {"assignment": a.name, "student": self.student.name}
		)
		with self.assertRaises(frappe.ValidationError):
			api.grade_submission(sub, 41)
		graded = api.grade_submission(sub, 32, "Well argued")
		self.assertEqual(graded["penalty"], 8)  # min(3 x 10, 25)% of 32
		self.assertEqual(graded["final_score"], 24)

	def test_cutoff_and_no_late_rules(self):
		now = now_datetime()
		closed = fb.make_assignment(
			self.w.offering.name,
			due=add_to_date(now, days=-2),
			allow_late=1,
			late_cutoff=add_to_date(now, days=-1),
		)
		strict = fb.make_assignment(self.w.offering.name, due=add_to_date(now, hours=-1), allow_late=0)
		draft = fb.make_assignment(self.w.offering.name, status="Draft")
		self.as_student()
		with self.assertRaisesRegex(frappe.ValidationError, "late submission window closed"):
			api.submit_assignment(closed.name, "Too late")
		with self.assertRaisesRegex(frappe.ValidationError, "not accepted"):
			api.submit_assignment(strict.name, "Too late")
		with self.assertRaises(frappe.DoesNotExistError):
			api.get_my_assignment(draft.name)
		mine = {r["name"]: r for r in api.my_assignments()["data"]}
		self.assertEqual(mine[strict.name]["state"], "overdue")
		self.assertNotIn(draft.name, mine)
		self.assertEqual(
			{r["name"] for r in api.my_assignments("overdue")["data"]}, {closed.name, strict.name}
		)

	def test_late_open_state(self):
		now = now_datetime()
		late = fb.make_assignment(
			self.w.offering.name,
			due=add_to_date(now, hours=-3),
			allow_late=1,
			late_cutoff=add_to_date(now, days=2),
		)
		ontime = fb.make_assignment(self.w.offering.name)
		self.as_student()
		mine = {r["name"]: r for r in api.my_assignments()["data"]}
		self.assertEqual((mine[late.name]["state"], mine[late.name]["is_late"]), ("late_open", True))
		self.assertEqual((mine[ontime.name]["state"], mine[ontime.name]["is_late"]), ("pending", False))
		self.assertEqual([r["name"] for r in api.my_assignments("late_open")["data"]], [late.name])
		self.assertNotIn(late.name, {r["name"] for r in api.my_assignments("overdue")["data"]})
		view = api.get_my_assignment(late.name)
		self.assertEqual((view["state"], view["assignment"]["is_late"]), ("late_open", True))
		self.assertTrue(api.submit_assignment(late.name, "Late but done")["submission"]["is_late"])

	def test_resubmit_until_graded_and_unique_submission(self):
		a = fb.make_assignment(self.w.offering.name)
		self.as_student()
		first = api.submit_assignment(a.name, "Draft answer")["submission"]
		second = api.submit_assignment(a.name, "Final answer")["submission"]
		self.assertEqual(first["name"], second["name"])
		self.assertEqual(second["answer_text"], "Final answer")
		with self.assertRaises(frappe.ValidationError):
			api.submit_assignment(a.name, "   ")

		frappe.set_user("Administrator")
		with self.assertRaises(frappe.DuplicateEntryError):
			frappe.get_doc(
				{
					"doctype": "Assignment Submission",
					"assignment": a.name,
					"student": self.student.name,
					"status": "Submitted",
				}
			).insert(ignore_permissions=True)

		self.as_lecturer()
		api.grade_submission(second["name"], 70, "Good")
		self.as_student()
		with self.assertRaisesRegex(frappe.ValidationError, "already been graded"):
			api.submit_assignment(a.name, "Sneaky edit")

		outsider = fb.make_student(campus=self.w.campus)
		self.as_student(outsider)
		with self.assertRaises(frappe.PermissionError):
			api.submit_assignment(a.name, "Not my class")

	def test_grading_release_and_student_visibility(self):
		a = fb.make_assignment(self.w.offering.name, max_score=20)
		s1, s2, s3 = self.w.students
		self.as_student(s1)
		api.submit_assignment(a.name, "Answer one")
		self.as_student(s2)
		api.submit_assignment(a.name, "Answer two")

		self.as_lecturer()
		listing = api.list_submissions(a.name)
		self.assertEqual(listing["total"], 3)
		self.assertEqual(next(r.student for r in listing["data"] if r.status == "Not Submitted"), s3.name)
		result = api.bulk_grade(
			a.name,
			[
				{"student": s1.name, "raw_score": 18, "feedback": "Excellent"},
				{"student": s2.name, "raw_score": 10},
				{"student": s3.name, "raw_score": 12, "feedback": "Paper copy"},
			],
		)
		self.assertEqual(result["graded"], 3)
		stats = api.assignment_stats(a.name)
		self.assertEqual((stats["graded"], stats["released"], stats["to_grade"]), (3, 0, 0))
		self.assertEqual(frappe.db.get_value("Assignment", a.name, "average_score"), 13.33)

		self.as_student(s1)
		view = api.get_my_assignment(a.name)
		self.assertEqual(view["submission"]["status"], "Submitted")
		self.assertNotIn("final_score", view["submission"])
		self.assertNotIn("feedback", view["submission"])
		self.assertNotIn("Assignment Graded", fb.events(self.mocks))

		self.as_lecturer()
		api.close_assignment(a.name)
		self.assertEqual(api.release_grades(a.name)["released"], 3)
		self.assertEqual(fb.events(self.mocks).count("Assignment Graded"), 3)
		self.assertEqual(frappe.db.get_value("Assignment", a.name, "status"), "Graded")

		self.as_student(s1)
		view = api.get_my_assignment(a.name)
		self.assertEqual(view["state"], "graded")
		self.assertEqual(view["submission"]["final_score"], 18)
		self.assertEqual(view["submission"]["feedback"], "Excellent")
		self.assertEqual([r["name"] for r in api.my_assignments("graded")["data"]], [a.name])

	def test_lecturer_scoping(self):
		a = fb.make_assignment(self.w.offering.name)
		fb.as_user(self, fb.make_lecturer(self.w.campus).user)
		for call in (
			lambda: api.list_assignments(self.w.offering.name),
			lambda: api.list_submissions(a.name),
			lambda: api.publish_assignment(a.name),
			lambda: api.assignment_stats(a.name),
		):
			with self.assertRaises(frappe.PermissionError):
				call()

	def test_due_reminders_sent_once(self):
		now = now_datetime()
		soon = fb.make_assignment(self.w.offering.name, due=add_to_date(now, hours=20))
		later = fb.make_assignment(self.w.offering.name, due=add_to_date(now, days=5))
		self.as_student()
		api.submit_assignment(soon.name, "Done early")
		frappe.set_user("Administrator")

		def reminders():
			# scoped to this test's assignments: the dev site may hold other published work due soon
			return [
				c
				for m in self.mocks.notify
				for c in m.call_args_list
				if c.args[0] == "Assignment Due Reminder" and c.kwargs["doc"].name in (soon.name, later.name)
			]

		svc.send_due_reminders()
		calls = reminders()
		self.assertEqual([c.kwargs["doc"].name for c in calls], [soon.name])
		self.assertEqual(len(calls[0].kwargs["recipients"]), 2)  # the submitter is skipped
		self.assertTrue(frappe.db.get_value("Assignment", soon.name, "reminder_sent_on"))

		svc.send_due_reminders()
		self.assertEqual(len(reminders()), 1)

	def test_submission_attachment_download(self):
		a = fb.make_assignment(self.w.offering.name)
		self.as_student()
		sub = api.submit_assignment(a.name, "See file")["submission"]["name"]
		frappe.set_user("Administrator")
		url = fb.make_file(self, f"essay-{fb.code()}.pdf")
		frappe.db.set_value("Assignment Submission", sub, "attachment", url)

		self.as_student()
		api.download_assignment_file(sub, kind="submission")
		got = fb.served()
		self.assertEqual((got["type"], got["disposition"]), ("download", "attachment"))
		self.assertEqual((got["content_type"], got["nosniff"]), ("application/pdf", "nosniff"))
		api.download_assignment_file(sub, kind="submission", inline=1)
		self.assertEqual(fb.served()["disposition"], "inline")
		self.as_lecturer()
		api.download_assignment_file(sub, kind="submission", inline="1")
		self.assertEqual(fb.served()["disposition"], "inline")
		for user in (self.w.students[1].user, fb.make_lecturer(self.w.campus).user):
			fb.as_user(self, user)
			with self.assertRaises(frappe.PermissionError):
				api.download_assignment_file(sub, kind="submission")

		frappe.set_user("Administrator")
		for ext, mime in (("svg", "image/svg+xml"), ("html", "text/html")):
			risky = fb.make_file(self, f"page-{fb.code()}.{ext}", b"<svg onload=alert(1)>")
			frappe.db.set_value("Assignment Submission", sub, "attachment", risky)
			self.as_student()
			api.download_assignment_file(sub, kind="submission", inline=1)
			self.assertEqual((fb.served()["content_type"], fb.served()["disposition"]), (mime, "attachment"))
