import json

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, nowdate

from mahanaim.api import exams as exams_api
from mahanaim.api import results as api
from mahanaim.services import assessments as assessments_svc
from mahanaim.services import exams as exams_svc
from mahanaim.services import grading
from mahanaim.services import results as svc
from mahanaim.tests import factories as f
from mahanaim.tests import factories_b2 as fb


def result_row(course, points, credits=3, total=0, status="Pass", term="T1"):
	return {
		"course": course,
		"grade_points": points,
		"credits": credits,
		"total_score": total,
		"result_status": status,
		"academic_term": term,
	}


class TestResults(IntegrationTestCase):
	def setUp(self):
		self.mocks = fb.setup_mocks(self)

	# ------------------------------------------------------------------ pure maths
	def test_gpa_maths_and_standing(self):
		rows = [
			result_row("OT", 0.0, 3, 30, "Fail"),
			result_row("OT", 4.0, 3, 85),  # retake: best attempt counts
			result_row("NT", 3.0, 2, 65),
			result_row("HB", 0.0, 4, 0, "Incomplete"),  # not counted
		]
		best = grading.best_attempts(rows)
		self.assertEqual(len(best), 3)
		summary = grading.gpa_summary(best)
		self.assertEqual(summary["gpa"], 3.6)  # (4x3 + 3x2) / 5
		self.assertEqual(summary["credits"], 5)
		self.assertEqual(summary["credits_earned"], 5)
		self.assertEqual(summary["quality_points"], 18)
		self.assertEqual(
			grading.gpa_summary([]),
			{"gpa": 0.0, "credits": 0.0, "quality_points": 0.0, "credits_earned": 0.0},
		)

		self.assertEqual(grading.standing_for(3.6, 3.0), "Dean's List")
		self.assertEqual(grading.standing_for(3.59, 3.0), "Good Standing")
		self.assertEqual(grading.standing_for(2.5, 1.99), "Probation")
		self.assertEqual(grading.standing_for(1.99, 2.4), "Academic Warning")
		self.assertEqual(grading.standing_for(2.0, 2.0), "Good Standing")
		self.assertEqual(grading.classification_for(3.6), "Distinction")
		self.assertEqual(grading.classification_for(3.59), "Credit")
		self.assertEqual(grading.classification_for(1.5), "Fail")

	def test_entry_evaluation(self):
		weights = dict(svc.DEFAULT_WEIGHTS)
		scores = {"cat": 16, "assignment": 8, "exam": 56, "other": 0}
		self.assertEqual(svc.evaluate_entry(scores, weights)["grade"], "A")
		self.assertEqual(
			svc.evaluate_entry({"cat": 10, "assignment": 5, "exam": 24.99}, weights)["result_status"], "Fail"
		)
		self.assertEqual(
			svc.evaluate_entry({"cat": 10, "assignment": 5, "exam": 25}, weights)["result_status"], "Pass"
		)
		absent = svc.evaluate_entry(scores, weights, absent=True)
		self.assertEqual((absent["grade"], absent["result_status"]), ("ABS", "Absent"))
		self.assertEqual(
			svc.evaluate_entry(scores, weights, pending={"assignment"})["result_status"], "Incomplete"
		)
		self.assertEqual(
			svc.evaluate_entry(scores, weights, pending={"exam"}, overridden={"exam"})["result_status"],
			"Pass",
		)

	def test_gpa_from_course_results_with_retake(self):
		w = fb.make_world(students=1, credits=3)
		student = w.students[0].name
		later = f.make_term(f"Term {fb.code()}", start=add_days(nowdate(), 130)).name
		retake = f.make_offering(w.course.name, later, w.campus, w.lecturer.name)
		other_course = f.make_course(fb.code("NT"), "New Testament _T", credits=2)
		other = f.make_offering(other_course.name, w.term, w.campus, w.lecturer.name)
		for offering, total, attempt in (
			(w.offering.name, 30, "First"),
			(other.name, 65, "First"),
			(retake.name, 85, "Retake"),
		):
			frappe.get_doc(
				{
					"doctype": "Course Result",
					"student": student,
					"course_offering": offering,
					"attempt": attempt,
					"total_score": total,
					"result_status": "Pass" if total >= 40 else "Fail",
					"is_published": 1,
				}
			).insert(ignore_permissions=True)
		self.assertEqual(grading.compute_gpa(student)["gpa"], 3.6)
		grading.refresh_student_standing(student)
		self.assertEqual(grading.compute_gpa(student, w.term)["gpa"], 1.2)  # (0x3 + 3x2) / 5
		standing = frappe.db.get_value(
			"Student", student, ["cgpa", "credits_earned", "academic_standing"], as_dict=True
		)
		self.assertEqual(
			(standing.cgpa, standing.credits_earned, standing.academic_standing), (3.6, 5, "Dean's List")
		)

		transcript = svc.transcript_data(student)
		self.assertEqual([t["term"] for t in transcript["terms"]], [w.term, later])
		self.assertEqual([t["gpa"] for t in transcript["terms"]], [1.2, 4.0])
		self.assertEqual([t["cgpa"] for t in transcript["terms"]], [1.2, 3.6])
		self.assertEqual(transcript["classification"], "Distinction")
		self.assertEqual(transcript["total_credits"], 5)
		self.assertLessEqual({"name", "student_number", "cgpa"}, set(transcript["student"]))
		as_of = svc.transcript_data(student, as_of_term=w.term)
		self.assertEqual(as_of["cgpa"], 1.2)

	# ------------------------------------------------------------------ mark sheet workflow
	def build_assessed_offering(self):
		"""3 students: s1 strong, s2 average, s3 skipped everything (absent from the final exam)."""
		w = fb.make_world(students=3, credits=3)
		s1, s2 = w.students[:2]
		course = w.course.name
		cat_q = fb.make_question(course, "Multiple Choice", marks=2)
		final_q = fb.make_question(course, "True or False", marks=1)
		cat = fb.make_exam(w.offering.name, [cat_q], exam_type="CAT")
		final = fb.make_exam(w.offering.name, [final_q], exam_type="Main Exam")
		assignment = fb.make_assignment(w.offering.name, max_score=20)
		correct = frappe.get_all(
			"Question Option", filters={"parent": cat_q.name, "is_correct": 1}, pluck="name"
		)[0]
		wrong = frappe.get_all(
			"Question Option", filters={"parent": cat_q.name, "is_correct": 0}, pluck="name"
		)[0]
		for student, cat_answer, essay in ((s1, correct, "Thorough"), (s2, wrong, "Brief")):
			fb.as_user(self, student.user)
			attempt = exams_api.start_exam(cat.name)["attempt"]
			exams_api.save_answer(attempt, cat_q.name, cat_answer)
			exams_api.submit_attempt(attempt)
			attempt = exams_api.start_exam(final.name)["attempt"]
			exams_api.save_answer(attempt, final_q.name, "true")
			exams_api.submit_attempt(attempt)
			assessments_svc.submit(assignment.name, student.name, essay)
		frappe.set_user("Administrator")
		assignment.reload()
		assignment.status = "Closed"
		assignment.save(ignore_permissions=True)
		for exam in (cat, final):
			exams_svc.close_exam(exam.name)
		subs = dict(
			frappe.get_all(
				"Assignment Submission",
				filters={"assignment": assignment.name},
				fields=["student", "name"],
				as_list=True,
			)
		)
		assessments_svc.grade(subs[s1.name], 18)
		assessments_svc.grade(subs[s2.name], 10)
		assessments_svc.release_grades(assignment.name)
		return w

	def test_mark_sheet_compute_submit_approve_publish(self):
		w = self.build_assessed_offering()
		s1, s2, s3 = w.students
		fb.as_user(self, w.lecturer.user)
		sheet = api.get_mark_sheet(w.offering.name)
		self.assertEqual(sheet["status"], "Draft")
		self.assertEqual(
			(sheet["cat_weight"], sheet["assignment_weight"], sheet["exam_weight"]), (20, 10, 70)
		)
		rows = {e["student"]: e for e in sheet["entries"]}
		self.assertEqual(
			(rows[s1.name]["cat_score"], rows[s1.name]["assignment_score"], rows[s1.name]["exam_score"]),
			(20, 9, 70),
		)
		self.assertEqual((rows[s1.name]["total"], rows[s1.name]["grade"]), (99, "A"))
		self.assertEqual(
			(rows[s2.name]["total"], rows[s2.name]["grade"], rows[s2.name]["result_status"]),
			(75, "A-", "Pass"),
		)
		self.assertEqual((rows[s3.name]["result_status"], rows[s3.name]["grade"]), ("Absent", "ABS"))

		with self.assertRaises(frappe.ValidationError):
			api.save_mark_sheet_entries(sheet["name"], [{"student": s3.name, "exam_score": 71}])
		sheet = api.save_mark_sheet_entries(
			sheet["name"], [{"student": s3.name, "exam_score": 30.5, "remarks": "Paper"}]
		)
		row = next(e for e in sheet["entries"] if e["student"] == s3.name)
		self.assertEqual((row["total"], row["grade"], row["result_status"]), (30.5, "F", "Fail"))
		self.assertIn("exam", row["overridden_components"])
		sheet = api.recompute_mark_sheet(sheet["name"])  # overrides survive a recompute
		self.assertEqual(next(e for e in sheet["entries"] if e["student"] == s3.name)["exam_score"], 30.5)

		submitted = api.submit_mark_sheet(sheet["name"])
		self.assertEqual(submitted["status"], "Submitted")
		lecturer_name = frappe.db.get_value("User", w.lecturer.user, "full_name")
		self.assertEqual(
			(submitted["submitted_by"], submitted["submitted_by_name"]), (w.lecturer.user, lecturer_name)
		)
		with self.assertRaises(frappe.ValidationError):
			api.save_mark_sheet_entries(sheet["name"], [{"student": s3.name, "exam_score": 40}])
		with self.assertRaises(frappe.PermissionError):
			api.approve_mark_sheet(sheet["name"])

		dean = f.make_user(roles=("Academic Dean",), first_name="Dean")
		registrar = f.make_user(roles=("Registrar",), first_name="Registrar")
		auditor = f.make_user(roles=("Auditor",))
		fb.as_user(self, auditor.name)
		pending = {d.name: d for d in api.pending_mark_sheets(w.term)["data"]}
		self.assertEqual(pending[sheet["name"]]["submitted_by_name"], lecturer_name)
		self.assertIn(w.offering.name, json.dumps(api.results_overview(w.term), default=str))
		self.assertEqual(api.grade_distribution(term=w.term)["term"], w.term)
		self.assertEqual(api.get_mark_sheet_by_name(sheet["name"])["submitted_by_name"], lecturer_name)
		for call in (
			lambda: api.approve_mark_sheet(sheet["name"]),
			lambda: api.return_mark_sheet(sheet["name"], "No"),
			lambda: api.publish_mark_sheet(sheet["name"]),
			lambda: api.bulk_publish(w.term),
		):
			with self.assertRaises(frappe.PermissionError):
				call()
		fb.as_user(self, registrar.name)
		with self.assertRaises(frappe.PermissionError):
			api.approve_mark_sheet(sheet["name"])
		fb.as_user(self, dean.name)
		self.assertIn(sheet["name"], [s.name for s in api.pending_mark_sheets()["data"]])
		returned = api.return_mark_sheet(sheet["name"], "Check the CAT for s2")
		self.assertEqual(returned["status"], "Returned")
		self.assertEqual((returned["returned_by"], returned["returned_by_name"]), (dean.name, dean.full_name))
		fb.as_user(self, w.lecturer.user)
		api.submit_mark_sheet(sheet["name"])
		fb.as_user(self, dean.name)
		self.assertEqual(api.approve_mark_sheet(sheet["name"])["status"], "Approved")
		with self.assertRaises(frappe.PermissionError):
			api.publish_mark_sheet(sheet["name"])
		self.assertFalse(frappe.db.exists("Course Result", {"course_offering": w.offering.name}))

		fb.as_user(self, registrar.name)
		published = api.publish_mark_sheet(sheet["name"])
		self.assertEqual(published["status"], "Published")
		self.assertEqual(
			(published["published_by_name"], published["approved_by_name"]),
			(registrar.full_name, dean.full_name),
		)
		results = {
			r.student: r
			for r in frappe.get_all(
				"Course Result",
				filters={"course_offering": w.offering.name},
				fields=[
					"student",
					"grade",
					"grade_points",
					"quality_points",
					"is_published",
					"published_on",
					"result_status",
				],
			)
		}
		self.assertEqual(len(results), 3)
		self.assertEqual((results[s1.name].grade, results[s1.name].quality_points), ("A", 12))
		self.assertEqual(results[s2.name].quality_points, 11.1)
		self.assertTrue(all(r.is_published and r.published_on for r in results.values()))
		enrolments = dict(
			frappe.get_all(
				"Course Enrolment",
				filters={"course_offering": w.offering.name},
				fields=["student", "status"],
				as_list=True,
			)
		)
		self.assertEqual((enrolments[s1.name], enrolments[s3.name]), ("Completed", "Failed"))
		self.assertEqual(
			frappe.db.get_value(
				"Course Enrolment", {"student": s1.name, "course_offering": w.offering.name}, "final_grade"
			),
			"A",
		)
		standing = frappe.db.get_value("Student", s1.name, ["cgpa", "academic_standing"], as_dict=True)
		self.assertEqual((standing.cgpa, standing.academic_standing), (4.0, "Dean's List"))
		self.assertEqual(frappe.db.get_value("Student", s3.name, "academic_standing"), "Probation")
		self.assertEqual(
			frappe.db.get_value("Course Offering", w.offering.name, "results_status"), "Published"
		)
		call = next(
			c for m in self.mocks.notify for c in m.call_args_list if c.args[0] == "Results Published"
		)
		self.assertIn("term", call.kwargs["context"])
		self.assertEqual(len(call.kwargs["recipients"]), 3)

		fb.as_user(self, s2.user)
		mine = api.my_results()
		self.assertEqual(mine["cgpa"], 3.7)
		self.assertEqual(mine["terms"][0]["courses"][0]["grade"], "A-")
		self.assertEqual(api.my_transcript_preview()["cgpa"], 3.7)

	def test_incomplete_when_component_pending_and_unpublished_hidden(self):
		w = fb.make_world(students=1)
		student = w.students[0]
		essay = fb.make_question(w.course.name, "Essay", marks=10)
		exam = fb.make_exam(w.offering.name, [essay], exam_type="Main Exam")
		fb.as_user(self, student.user)
		attempt = exams_api.start_exam(exam.name)["attempt"]
		exams_api.save_answer(attempt, essay.name, "My essay")
		exams_api.submit_attempt(attempt)
		frappe.set_user("Administrator")
		exams_svc.close_exam(exam.name)
		sheet = svc.get_or_create_mark_sheet(w.offering.name)
		entry = sheet.entries[0]
		self.assertEqual(entry.result_status, "Incomplete")
		self.assertIn("exam", entry.pending_components)  # essay not yet marked
		self.assertIn("assignment", entry.pending_components)  # no assignment set yet

		fb.as_user(self, student.user)
		self.assertEqual(api.my_results()["terms"], [])

	def test_lecturer_cannot_reach_other_mark_sheets(self):
		w = fb.make_world(students=1)
		fb.as_user(self, fb.make_lecturer(w.campus).user)
		with self.assertRaises(frappe.PermissionError):
			api.get_mark_sheet(w.offering.name)
		frappe.set_user("Administrator")
		sheet = svc.get_or_create_mark_sheet(w.offering.name)
		fb.as_user(self, fb.make_lecturer(w.campus).user)
		for call in (
			lambda: api.save_mark_sheet_entries(sheet.name, []),
			lambda: api.submit_mark_sheet(sheet.name),
			lambda: api.get_mark_sheet_by_name(sheet.name),
			lambda: api.results_overview(w.term),
		):
			with self.assertRaises(frappe.PermissionError):
				call()

	def test_mark_sheet_reads_are_side_effect_free(self):
		w = fb.make_world(students=1)
		student = w.students[0]
		assignment = fb.make_assignment(w.offering.name, max_score=10)
		fb.as_user(self, w.lecturer.user)
		first = api.get_mark_sheet(w.offering.name)
		name = first["name"]
		modified = frappe.db.get_value("Mark Sheet", name, "modified")
		again = api.get_mark_sheet(w.offering.name)
		self.assertFalse(again["stale"])
		self.assertEqual(frappe.db.get_value("Mark Sheet", name, "modified"), modified)

		frappe.set_user("Administrator")
		assessments_svc.submit(assignment.name, student.name, "Answer")
		frappe.db.set_value("Assignment", assignment.name, "status", "Closed")
		sub = frappe.db.get_value("Assignment Submission", {"assignment": assignment.name}, "name")
		assessments_svc.grade(sub, 8)
		assessments_svc.release_grades(assignment.name)
		fb.as_user(self, w.lecturer.user)
		fresh = api.get_mark_sheet(w.offering.name)
		self.assertTrue(fresh["stale"])
		self.assertEqual(fresh["entries"][0]["assignment_score"], 8)
		self.assertEqual(frappe.db.get_value("Mark Sheet", name, "modified"), modified)
		stored = frappe.db.get_value("Mark Sheet Entry", {"parent": name}, "assignment_score")
		self.assertFalse(stored)
		self.assertEqual(api.recompute_mark_sheet(name)["entries"][0]["assignment_score"], 8)
		self.assertEqual(frappe.db.get_value("Mark Sheet Entry", {"parent": name}, "assignment_score"), 8)
		self.assertFalse(api.get_mark_sheet(w.offering.name)["stale"])

	def approved_sheet(self, term):
		w = fb.make_world(students=1, term=term)
		frappe.set_user("Administrator")
		sheet = svc.get_or_create_mark_sheet(w.offering.name)
		svc.transition(sheet, "Submitted")
		svc.transition(sheet, "Approved")
		return sheet.name

	def test_bulk_publish_selected_sheets(self):
		term = f.make_term(f"B2 Pub {fb.code()}").name
		chosen, left = self.approved_sheet(term), self.approved_sheet(term)
		draft = svc.get_or_create_mark_sheet(fb.make_world(students=1, term=term).offering.name).name
		elsewhere = self.approved_sheet(f.make_term(f"B2 Other {fb.code()}").name)
		fb.as_user(self, f.make_user(roles=("Registrar",)).name)
		for bad in ([draft], [elsewhere], ["MS-NOPE"], []):
			with self.assertRaises((frappe.ValidationError, frappe.DoesNotExistError)):
				api.bulk_publish(term, json.dumps(bad))
		result = api.bulk_publish(term, json.dumps([chosen]))
		self.assertEqual((result["published"], result["failed"]), ([chosen], []))
		self.assertEqual(frappe.db.get_value("Mark Sheet", chosen, "status"), "Published")
		self.assertEqual(frappe.db.get_value("Mark Sheet", left, "status"), "Approved")
		self.assertEqual(api.bulk_publish(term)["published"], [left])

	def test_grading_scale_api(self):
		bands = [
			{"grade": "A", "min_score": 70, "max_score": 100, "grade_points": 4, "is_pass": 1},
			{"grade": "B", "min_score": 50, "max_score": 69.99, "grade_points": 3, "is_pass": 1},
			{"grade": "F", "min_score": 0, "max_score": 49.99, "grade_points": 0},
		]
		name = f"B2 Scale {fb.code()}"
		fb.as_user(self, fb.make_lecturer(f.make_campus().name).user)
		with self.assertRaises(frappe.PermissionError):
			api.save_grading_scale({"scale_name": name, "bands": bands})
		fb.as_user(self, f.make_user(roles=("Academic Dean",)).name)
		saved = api.save_grading_scale(json.dumps({"scale_name": name, "pass_mark": 50, "bands": bands}))
		self.assertEqual([b["grade"] for b in saved["bands"]], ["A", "B", "F"])
		self.assertEqual((saved["name"], saved["pass_mark"], saved["is_default"]), (name, 50, 0))
		stale = {**saved, "modified": "2000-01-01 00:00:00", "creation": "2000-01-01 00:00:00"}
		stale["bands"] = [{**b, "grade_points": 3.5} if b["grade"] == "B" else b for b in saved["bands"]]
		updated = api.save_grading_scale(stale)  # old client timestamps are ignored, not compared
		self.assertEqual(next(b for b in updated["bands"] if b["grade"] == "B")["grade_points"], 3.5)
		invalid = (
			[{**bands[0], "min_score": 60}, bands[1], bands[2]],  # overlap
			[bands[0], bands[2]],  # gap 50-69.99
			[{**bands[0], "grade_points": 6}, bands[1], bands[2]],  # grade points out of range
			[{**b, "max_score": 90} if b["grade"] == "A" else b for b in bands],  # doesn't reach 100
		)
		for rows in invalid:
			with self.assertRaises(frappe.ValidationError):
				api.save_grading_scale({"name": name, "bands": rows})
		with self.assertRaises(frappe.ValidationError):
			api.save_grading_scale({"name": name, "scale_name": "Renamed"})
		fb.as_user(self, f.make_user(roles=("Auditor",)).name)
		scales = {s["name"]: s for s in api.get_grading_scales()["data"]}
		self.assertEqual(len(scales[name]["bands"]), 3)
		with self.assertRaises(frappe.PermissionError):
			api.save_grading_scale({"name": name, "bands": bands})
