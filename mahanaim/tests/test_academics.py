import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, nowdate

from mahanaim.academics.doctype.course.course import find_prerequisite_cycle
from mahanaim.api import academics as api
from mahanaim.api import lecturer as lecturer_api
from mahanaim.mahanaim_setup.doctype.grading_scale.grading_scale import band_errors, classification_errors
from mahanaim.services.grading import grade_for
from mahanaim.tests import factories as f
from mahanaim.tests import factories_b2 as fb


def band(grade, lo, hi, points):
	return {"grade": grade, "min_score": lo, "max_score": hi, "grade_points": points}


class TestAcademics(IntegrationTestCase):
	def setUp(self):
		self.mocks = fb.setup_mocks(self)

	# ------------------------------------------------------------------ courses
	def test_prerequisite_cycles(self):
		self.assertEqual(find_prerequisite_cycle("A", ["C"], {"B": ["A"], "C": ["B"]}), ["A", "C", "B", "A"])
		self.assertIsNone(find_prerequisite_cycle("A", ["B"], {"B": ["C"], "C": []}))

		a, b, c = (f.make_course(fb.code("PRE"), "Prereq _T") for _ in range(3))
		b.append("prerequisites", {"prerequisite": a.name})
		b.save()
		c.append("prerequisites", {"prerequisite": b.name})
		c.save()
		a.append("prerequisites", {"prerequisite": c.name})
		with self.assertRaisesRegex(frappe.ValidationError, "Circular prerequisite"):
			a.save()
		a.reload()
		a.append("prerequisites", {"prerequisite": a.name})
		with self.assertRaisesRegex(frappe.ValidationError, "own prerequisite"):
			a.save()

	def test_course_rules(self):
		saved = api.save_course(
			{
				"course_code": " hb" + fb.code("", 4).lower(),
				"course_title": "Hebrew I _T",
				"credits": 3,
				"assessment_weights": [
					{"component": "CAT", "weight": 30},
					{"component": "Exam", "weight": 70},
				],
			}
		)
		self.assertTrue(saved["course_code"].startswith("HB"))
		self.assertEqual(saved["course_code"], saved["name"])
		with self.assertRaisesRegex(frappe.ValidationError, "total 100"):
			api.save_course(
				{
					"assessment_weights": [
						{"component": "CAT", "weight": 30},
						{"component": "Exam", "weight": 60},
					]
				},
				saved["name"],
			)
		with self.assertRaises(frappe.ValidationError):
			api.save_course({"credits": 0}, saved["name"])

	def test_programme_curriculum_rules(self):
		c1, c2 = (f.make_course(fb.code("PC"), "Curriculum _T", credits=4) for _ in range(2))
		code = fb.code("P", 4)
		saved = api.save_programme(
			{
				"code": code.lower(),
				"programme_name": f"Programme {code} _T",
				"level": "Diploma",
				"duration_years": 2,
				"curriculum": [
					{"course": c2.name, "year_of_study": 2, "term_number": 1},
					{"course": c1.name, "year_of_study": 1, "term_number": 2},
				],
			}
		)
		self.assertEqual(saved["code"], code)
		self.assertEqual(saved["total_credits"], 8)
		programme = api.get_programme(saved["name"])
		self.assertEqual([y["year"] for y in programme["curriculum_by_year"]], [1, 2])
		self.assertEqual(programme["curriculum"][0]["course_title"], "Curriculum _T")

		for rows in (
			[{"course": c1.name, "year_of_study": 1, "term_number": 1}] * 2,
			[{"course": c1.name, "year_of_study": 3, "term_number": 1}],
			[{"course": c1.name, "year_of_study": 1, "term_number": 0}],
		):
			with self.subTest(rows=rows), self.assertRaises(frappe.ValidationError):
				api.save_programme({"curriculum": rows}, saved["name"])

	def test_generate_offerings_is_idempotent(self):
		courses = [f.make_course(fb.code("GEN"), "Generated _T") for _ in range(3)]
		code = fb.code("G", 4)
		frappe.get_doc(
			{
				"doctype": "Programme",
				"programme_name": f"Generated {code} _T",
				"code": code,
				"level": "Certificate",
				"duration_years": 1,
				"curriculum": [
					{"course": courses[0].name, "year_of_study": 1, "term_number": 1},
					{"course": courses[1].name, "year_of_study": 1, "term_number": 1},
					{"course": courses[2].name, "year_of_study": 1, "term_number": 2},
				],
			}
		).insert()
		term, campus = f.make_term().name, f.make_campus().name
		dry = api.generate_offerings(term, campus, programme=code, preview=1)
		self.assertEqual((dry["preview"], dry["created"], dry["offerings"]), (True, 2, []))
		self.assertEqual([r["state"] for r in dry["rows"]], ["new", "new"])
		self.assertEqual(
			{(r["course"], r["programme"], r["academic_term"]) for r in dry["rows"]},
			{(courses[0].name, code, term), (courses[1].name, code, term)},
		)
		self.assertFalse(
			frappe.db.exists("Course Offering", {"course": courses[0].name, "academic_term": term})
		)
		first = api.generate_offerings(term, campus, programme=code)
		self.assertEqual((first["created"], first["skipped"]), (2, 0))
		second = api.generate_offerings(term, campus, programme=code)
		self.assertEqual((second["created"], second["skipped"]), (0, 2))
		again = api.generate_offerings(term, campus, programme=code, preview=1)
		self.assertEqual({r["state"] for r in again["rows"]}, {"existing"})
		self.assertEqual({r["offering"] for r in again["rows"]}, set(first["offerings"]))
		offering = frappe.get_doc("Course Offering", first["offerings"][0])
		self.assertEqual(offering.status, "Planned")
		self.assertEqual(offering.course_title, "Generated _T")
		with self.assertRaises(frappe.DuplicateEntryError):
			frappe.get_doc(
				{
					"doctype": "Course Offering",
					"course": offering.course,
					"academic_term": term,
					"campus": campus,
					"section": offering.section,
					"study_mode": offering.study_mode,
				}
			).insert()

	# ------------------------------------------------------------------ grading scale
	def test_grading_bands(self):
		good = [band("F", 0, 39.99, 0), band("P", 40, 69.99, 2), band("A", 70, 100, 4)]
		self.assertEqual(band_errors(good), [])
		self.assertEqual(band_errors([band("F", 0, 39, 0), band("A", 40, 100, 4)]), [])
		self.assertTrue(band_errors([band("F", 0, 45, 0), band("A", 40, 100, 4)]))  # overlap
		self.assertTrue(band_errors([band("F", 0, 30, 0), band("A", 40, 100, 4)]))  # gap
		self.assertTrue(band_errors([band("F", 5, 39.99, 0), band("A", 40, 100, 4)]))  # not from 0
		self.assertTrue(band_errors([band("F", 0, 39.99, 0), band("A", 40, 95, 4)]))  # not to 100
		self.assertTrue(
			classification_errors(
				[
					{"classification": "Pass", "min_cgpa": 2, "max_cgpa": 3.2},
					{"classification": "Credit", "min_cgpa": 3, "max_cgpa": 4},
				]
			)
		)

		self.assertEqual(grade_for(39.99)["grade"], "F")
		self.assertEqual(grade_for(40)["grade"], "D")
		self.assertEqual(grade_for(79.99)["grade"], "A-")
		self.assertEqual(grade_for(80)["grade"], "A")
		self.assertEqual(grade_for(80)["grade_points"], 4)

		scale = frappe.get_doc(
			{
				"doctype": "Grading Scale",
				"scale_name": "Second Default " + fb.code(),
				"pass_mark": 50,
				"is_default": 1,
				"bands": good,
			}
		)
		with self.assertRaisesRegex(frappe.ValidationError, "already the default"):
			scale.insert()
		scale.is_default = 0
		scale.insert()
		self.assertEqual(frappe.db.get_value("Grading Scale", "MBC Standard", "is_default"), 1)
		self.assertEqual(grade_for(55, scale.name)["grade"], "P")
		scale.append("bands", band("X", 60, 65, 3))
		with self.assertRaises(frappe.ValidationError):
			scale.save()

	# ------------------------------------------------------------------ access & attendance
	def test_lecturer_scoping(self):
		w = fb.make_world(students=1)
		other = fb.make_lecturer(w.campus)
		fb.as_user(self, other.user)
		for call in (
			lambda: api.get_offering(w.offering.name),
			lambda: api.create_session(w.offering.name, nowdate(), "08:00", "10:00"),
			lambda: api.attendance_report(w.offering.name),
			lambda: lecturer_api.offering_overview(w.offering.name),
			lambda: lecturer_api.roster_csv(w.offering.name),
		):
			with self.assertRaises(frappe.PermissionError):
				call()
		self.assertNotIn(w.offering.name, [o["name"] for o in lecturer_api.my_offerings(w.term)["data"]])
		with self.assertRaises(frappe.PermissionError):
			api.generate_offerings(w.term, w.campus)

		fb.as_user(self, w.lecturer.user)
		self.assertEqual(api.get_offering(w.offering.name)["name"], w.offering.name)
		self.assertIn(w.offering.name, [o["name"] for o in lecturer_api.my_offerings(w.term)["data"]])

	def test_sessions_and_attendance(self):
		w = fb.make_world(students=3)
		s1, s2, s3 = w.students
		fb.as_user(self, w.lecturer.user)
		# The dev site has seeded sessions in real rooms, so use a unique venue.
		venue = f"B2 Test Room {frappe.generate_hash(length=6)}"
		first = api.create_session(w.offering.name, nowdate(), "08:00", "10:00", venue, "Torah")
		second = api.create_session(w.offering.name, nowdate(), "14:00", "16:00", topic="Prophets")
		with self.assertRaises(frappe.ValidationError):
			api.create_session(w.offering.name, nowdate(), "08:30", "09:30")  # clashes with the first
		with self.assertRaises(frappe.ValidationError):
			api.create_session(w.offering.name, nowdate(), "11:00", "12:00", mode="Online")  # no link

		roster = api.session_roster(first["name"])["rows"]
		self.assertEqual({r["student"] for r in roster}, {s1.name, s2.name, s3.name})
		self.assertTrue(all(r["status"] == "Present" and not r["marked"] for r in roster))
		api.take_attendance(first["name"], [{"student": s1.name, "status": "Absent"}])
		api.take_attendance(
			second["name"],
			[{"student": s1.name, "status": "Late"}, {"student": s2.name, "status": "Excused"}],
		)
		outsider = fb.make_student(campus=w.campus)
		with self.assertRaises(frappe.ValidationError):
			api.take_attendance(first["name"], [{"student": outsider.name, "status": "Present"}])

		report = {r["student"]: r for r in api.attendance_report(w.offering.name)["students"]}
		self.assertEqual(report[s1.name]["percentage"], 50)
		self.assertEqual(report[s2.name]["percentage"], 100)  # excused sessions are not counted
		self.assertEqual(report[s3.name]["held"], 2)

		fb.as_user(self, s1.user)
		mine = api.my_attendance(w.offering.name)
		self.assertEqual(mine["data"][0]["percentage"], 50)
		self.assertEqual(len(mine["sessions"]), 2)
		timetable = api.my_timetable(nowdate(), nowdate())
		self.assertEqual([s["topic"] for s in timetable["sessions"]], ["Torah", "Prophets"])
		with self.assertRaises(frappe.PermissionError):
			api.take_attendance(first["name"], [])

	def test_session_edit_reschedules_only_on_real_moves(self):
		w = fb.make_world(students=0)
		fb.as_user(self, w.lecturer.user)
		day = add_days(nowdate(), 3)
		session = api.create_session(w.offering.name, day, "09:00", "10:00", topic="Ruth")["name"]
		same = {"session_date": str(day), "start_time": "9:00", "end_time": "10:00:00", "topic": "Esther"}
		self.assertEqual(api.update_session(session, same)["status"], "Scheduled")
		self.assertEqual(frappe.db.get_value("Class Session", session, "topic"), "Esther")
		self.assertEqual(api.update_session(session, {"start_time": "09:30"})["status"], "Rescheduled")
		doc = frappe.get_doc("Class Session", session)
		self.assertFalse(api.session_moved(doc, {"start_time": "9:30:00", "session_date": day}))
		self.assertTrue(api.session_moved(doc, {"session_date": add_days(day, 1)}))

	def test_timetable_is_role_aware(self):
		w = fb.make_world(students=1)
		fb.as_user(self, w.lecturer.user)
		day = add_days(nowdate(), 2)
		api.create_session(w.offering.name, day, "07:00", "08:00", topic="Psalms", notes="Bring hymnals")
		fb.as_user(self, w.students[0].user)
		mine = api.my_timetable(day, day)
		self.assertEqual(mine["role"], "student")
		self.assertTrue(mine["server_time"])
		self.assertEqual([s["topic"] for s in mine["sessions"]], ["Psalms"])
		self.assertNotIn("notes", mine["sessions"][0])

		fb.as_user(self, w.lecturer.user)
		taught = api.my_timetable(day, day)
		self.assertEqual(taught["role"], "lecturer")
		self.assertTrue(taught["server_time"])
		self.assertEqual(
			[(s["topic"], s["notes"]) for s in taught["sessions"]], [("Psalms", "Bring hymnals")]
		)
		self.assertLessEqual(set(mine["sessions"][0]), set(taught["sessions"][0]))
		fb.as_user(self, fb.make_lecturer(w.campus).user)
		self.assertEqual(api.my_timetable(day, day)["sessions"], [])

	def test_attendance_defaults_to_current_term_and_ignores_excused(self):
		tag = fb.code("T", 5)
		now_term = f.make_term(f"B2 Now {tag}").name
		past_term = f.make_term(
			f"B2 Past {tag}", start=add_days(nowdate(), -200), end=add_days(nowdate(), -100)
		).name
		fb.use_single(self, "Mahanaim Settings", current_academic_term=now_term)
		w = fb.make_world(students=1, term=now_term)
		student = w.students[0]
		past = {}
		for key in ("held", "quiet"):
			course = f.make_course(fb.code("P"), f"Past {key} _T")
			past[key] = f.make_offering(course.name, past_term, w.campus, w.lecturer.name).name
			f.make_enrolment(student.name, past[key], "Completed")
		fb.as_user(self, w.lecturer.user)
		held = api.create_session(past["held"], add_days(nowdate(), -150), "07:00", "08:00")["name"]
		api.take_attendance(held, [{"student": student.name, "status": "Excused"}])

		fb.as_user(self, student.user)
		mine = api.my_attendance()
		self.assertEqual(mine["current_term"], now_term)
		self.assertEqual([r["course_offering"] for r in mine["data"]], [w.offering.name, past["held"]])
		self.assertEqual(mine["data"][0]["academic_term"], now_term)
		excused = mine["data"][1]
		self.assertEqual((excused["held"], excused["excused"], excused["percentage"]), (1, 1, None))
		self.assertIsNone(mine["data"][0]["percentage"])  # no sessions yet
		by_term = api.my_attendance(academic_term=past_term)
		self.assertEqual({r["course_offering"] for r in by_term["data"]}, set(past.values()))
		self.assertEqual(by_term["academic_term"], past_term)

		fb.as_user(self, w.lecturer.user)
		report = api.attendance_report(past["held"])
		row = next(r for r in report["students"] if r["student"] == student.name)
		self.assertIsNone(row["percentage"])
		self.assertIsNone(api.attendance_percent(0, 0, 2, 2))
		self.assertEqual(
			api.attendance_percent(1, 1, 3, 1), 100
		)  # late counts, excused leaves the denominator
