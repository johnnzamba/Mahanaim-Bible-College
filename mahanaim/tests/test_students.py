from unittest.mock import call, patch

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, add_to_date, flt, now_datetime, nowdate, random_string

from mahanaim.api import students as st
from mahanaim.services import students as svc
from mahanaim.tests import factories as f
from mahanaim.tests import factories_b1 as fb


class TestStudents(IntegrationTestCase):
	def setUp(self):
		fb.no_commit(self)
		fb.use_settings(self, max_credits_per_term=24, auto_invoice_on_registration=0)
		patches = {
			"notify": patch("mahanaim.services.communication.notify"),
			"enqueue_lms": patch("mahanaim.services.students.enqueue_lms"),
			"fee_clearance": patch(
				"mahanaim.services.fees.fee_clearance",
				return_value={"cleared": True, "balance": 0, "message": ""},
			),
		}
		for key, patcher in patches.items():
			setattr(self, key, patcher.start())
			self.addCleanup(patcher.stop)

	def events(self):
		return [c.args[0] for c in self.notify.call_args_list]

	def world(self, status="Admitted"):
		campus = f.make_campus().name
		programme = fb.make_programme()
		term = fb.make_term()
		offerings = [f.make_offering(r.course, term.name, campus).name for r in programme.curriculum]
		student = f.make_student(
			programme=programme.name, campus=campus, status=status, phone=fb.unique_phone()
		)
		return frappe._dict(
			campus=campus, programme=programme, term=term, offerings=offerings, student=student
		)

	def registration(self, w, offerings=None, status="Draft", term=None):
		return frappe.get_doc(
			{
				"doctype": "Semester Registration",
				"student": w.student.name,
				"academic_term": term or w.term.name,
				"status": status,
				"courses": [{"course_offering": o} for o in (offerings or w.offerings)],
			}
		)

	def approved(self, w, offerings=None):
		doc = self.registration(w, offerings, status="Submitted").insert(ignore_permissions=True)
		doc.status = "Approved"
		doc.save(ignore_permissions=True)
		return doc

	def user_with(self, *roles):
		return f.make_user(f"staff.{random_string(6).lower()}@example.com", roles=roles).name

	# ------------------------------------------------------------------ registration validations
	def test_registration_window(self):
		w = self.world()
		course = w.programme.curriculum[0].course
		today = nowdate()
		closed = fb.make_term(registration_start=add_days(today, -30), registration_end=add_days(today, -10))
		late = fb.make_term(
			registration_start=add_days(today, -30),
			registration_end=add_days(today, -10),
			late_registration_end=add_days(today, 5),
		)
		upcoming = fb.make_term(registration_start=add_days(today, 5), registration_end=add_days(today, 20))
		off = {t.name: f.make_offering(course, t.name, w.campus).name for t in (closed, late, upcoming)}

		fb.as_user(self, w.student.user)
		reg = st.submit_registration(w.term.name, w.offerings)
		self.assertEqual(reg["status"], "Submitted")
		self.assertEqual(flt(reg["total_credits"]), 6)
		with self.assertRaisesRegex(frappe.ValidationError, "closed"):
			st.submit_registration(closed.name, [off[closed.name]])
		with self.assertRaisesRegex(frappe.ValidationError, "opens on"):
			st.submit_registration(upcoming.name, [off[upcoming.name]])
		self.assertEqual(st.submit_registration(late.name, [off[late.name]])["status"], "Submitted")
		options = st.registration_options(closed.name)
		self.assertEqual(options["window"]["state"], "closed")
		self.assertFalse(options["can_register"])

		frappe.set_user("Administrator")  # the registrar may register a student after the window closes
		doc = self.registration(w, [off[closed.name]], status="Submitted", term=closed.name)
		doc.insert(ignore_permissions=True)
		self.assertEqual(doc.status, "Submitted")

	def test_credit_limit_and_offering_rules(self):
		fb.use_settings(self, max_credits_per_term=4)
		w = self.world()
		other_campus = frappe.get_doc(
			{
				"doctype": "Campus",
				"campus_name": f"Other Campus {random_string(4)} _T",
				"code": fb.code("O", 4),
			}
		).insert(ignore_permissions=True)
		elsewhere = f.make_offering(w.programme.curriculum[0].course, w.term.name, other_campus.name).name
		f.make_course(f"{w.programme.code}999", "Outside course _T")
		outside = f.make_offering(f"{w.programme.code}999", w.term.name, w.campus).name

		fb.as_user(self, w.student.user)
		with self.assertRaisesRegex(frappe.ValidationError, "maximum per term"):
			st.submit_registration(w.term.name, w.offerings)
		with self.assertRaisesRegex(frappe.ValidationError, "not your campus"):
			st.submit_registration(w.term.name, [elsewhere])
		with self.assertRaisesRegex(frappe.ValidationError, "curriculum"):
			st.submit_registration(w.term.name, [outside])
		frappe.db.set_value("Course Offering", w.offerings[1], "status", "Cancelled")
		with self.assertRaisesRegex(frappe.ValidationError, "cancelled"):
			st.submit_registration(w.term.name, [w.offerings[1]])
		self.assertEqual(flt(st.submit_registration(w.term.name, w.offerings[:1])["total_credits"]), 3)

	def test_prerequisites(self):
		w = self.world()
		first, second = (r.course for r in w.programme.curriculum)
		course = frappe.get_doc("Course", second)
		course.append("prerequisites", {"prerequisite": first})
		course.save(ignore_permissions=True)
		fb.make_course_result(w.student.name, first, published=0)  # unpublished results do not count

		def option():
			rows = st.registration_options(w.term.name)["offerings"]
			return next(r for r in rows if r["course"] == second)

		fb.as_user(self, w.student.user)
		self.assertFalse(option()["prerequisites_met"])
		with self.assertRaisesRegex(frappe.ValidationError, "requires"):
			st.submit_registration(w.term.name, [w.offerings[1]])

		frappe.set_user("Administrator")
		fb.make_course_result(w.student.name, first)
		frappe.set_user(w.student.user)
		self.assertTrue(option()["prerequisites_met"])
		self.assertEqual(st.submit_registration(w.term.name, [w.offerings[1]])["status"], "Submitted")

	def test_duplicate_registrations(self):
		w = self.world()
		with self.assertRaisesRegex(frappe.ValidationError, "more than once"):
			self.registration(w, [w.offerings[0], w.offerings[0]]).insert(ignore_permissions=True)
		first = self.registration(w, w.offerings[:1]).insert(ignore_permissions=True)
		with self.assertRaises(frappe.DuplicateEntryError):
			self.registration(w, w.offerings[1:]).insert(ignore_permissions=True)
		first.status = "Cancelled"
		first.save(ignore_permissions=True)
		self.assertTrue(self.registration(w, w.offerings[1:]).insert(ignore_permissions=True).name)

	def test_fee_clearance_blocks_self_registration(self):
		w = self.world()
		self.fee_clearance.return_value = {
			"cleared": False,
			"message": "Clear your arrears of KES 5,000 first.",
		}
		fb.as_user(self, w.student.user)
		with self.assertRaisesRegex(frappe.ValidationError, "arrears"):
			st.submit_registration(w.term.name, w.offerings)
		self.assertEqual(st.submit_registration(w.term.name, w.offerings, submit=0)["status"], "Draft")

	# ------------------------------------------------------------------ approval
	def test_approval_side_effects(self):
		fb.use_settings(self, auto_invoice_on_registration=1)
		w = self.world()
		fb.as_user(self, w.student.user)
		reg = st.submit_registration(w.term.name, w.offerings)

		frappe.set_user("Administrator")
		with patch(
			"mahanaim.services.fees.create_invoice_for_registration", return_value="SINV-T-0001"
		) as invoice:
			data = st.approve_registration(reg["name"])
			svc.on_registration_approved(frappe.get_doc("Semester Registration", reg["name"]))  # idempotent
		self.assertEqual(data["status"], "Approved")
		invoice.assert_called_once_with(reg["name"])
		self.assertEqual(
			frappe.db.get_value("Semester Registration", reg["name"], "fee_invoice"), "SINV-T-0001"
		)

		enrolments = frappe.get_all(
			"Course Enrolment",
			filters={"student": w.student.name},
			fields=["name", "course_offering", "status", "semester_registration", "academic_term"],
		)
		self.assertEqual(sorted(e.course_offering for e in enrolments), sorted(w.offerings))
		for e in enrolments:
			self.assertEqual(
				(e.status, e.semester_registration, e.academic_term), ("Enrolled", reg["name"], w.term.name)
			)
			self.assertEqual(frappe.db.get_value("Course Offering", e.course_offering, "enrolled_count"), 1)
		self.assertCountEqual(self.enqueue_lms.call_args_list, [call(e.name, "enrol") for e in enrolments])

		student = frappe.get_doc("Student", w.student.name)
		self.assertEqual((student.status, student.current_term), ("Active", w.term.name))
		self.assertIn("Registration Approved", self.events())

		frappe.set_user(w.student.user)
		with self.assertRaisesRegex(frappe.ValidationError, "already been approved"):
			st.submit_registration(w.term.name, w.offerings[:1])
		with self.assertRaises(frappe.ValidationError):
			st.cancel_registration(reg["name"])
		self.assertEqual(len(st.my_courses(w.term.name)["data"]), 2)

	def test_reject_registration(self):
		w = self.world()
		reg = self.registration(w, status="Submitted").insert(ignore_permissions=True)
		fb.as_user(self, self.user_with("Registrar"))
		with self.assertRaises(frappe.ValidationError):
			st.reject_registration(reg.name, "")
		self.assertEqual(st.reject_registration(reg.name, "Wrong year courses")["status"], "Rejected")
		self.assertEqual(frappe.db.count("Course Enrolment", {"student": w.student.name}), 0)
		frappe.set_user(w.student.user)
		self.assertEqual(st.submit_registration(w.term.name, w.offerings[:1])["status"], "Submitted")

	# ------------------------------------------------------------------ student lifecycle
	def test_student_status_machine(self):
		student = f.make_student(status="Active", phone=fb.unique_phone())
		student.status = "Alumni"
		with self.assertRaisesRegex(frappe.ValidationError, "cannot move"):
			student.save()

		st.change_student_status(student.name, "Withdrawn", note="Relocated")
		self.assertEqual(frappe.db.get_value("User", student.user, "enabled"), 0)
		with self.assertRaises(frappe.ValidationError):
			st.change_student_status(student.name, "Active")

		fb.as_user(self, self.user_with("Registrar"))
		with self.assertRaises(frappe.PermissionError):
			st.change_student_status(student.name, "Active", force=1)

		frappe.set_user("Administrator")
		data = st.change_student_status(student.name, "Active", note="Readmitted by senate", force=1)
		self.assertEqual(data["status"], "Active")
		self.assertIn("Forced", data["status_log"][-1]["note"])
		self.assertEqual(frappe.db.get_value("User", student.user, "enabled"), 1)

		st.change_student_status(student.name, "Completed")
		st.change_student_status(student.name, "Alumni")
		self.assertIn("Alumni", frappe.get_roles(student.user))
		self.assertEqual(frappe.db.get_value("User", student.user, "enabled"), 1)
		statuses = [r.to_status for r in frappe.get_doc("Student", student.name).status_log]
		self.assertEqual(statuses, ["Active", "Withdrawn", "Active", "Completed", "Alumni"])

	def test_user_link_hook(self):
		email = f"late.{random_string(6).lower()}@example.com"
		student = f.make_student(email=email, create_user=False, phone=fb.unique_phone())
		self.assertFalse(student.user)
		f.make_user(email)
		self.assertEqual(frappe.db.get_value("Student", student.name, "user"), email)

	# ------------------------------------------------------------------ requests
	def test_request_effects(self):
		w = self.world()
		self.approved(w)
		enrolment = frappe.db.get_value(
			"Course Enrolment", {"student": w.student.name, "course_offering": w.offerings[0]}
		)
		target = fb.make_programme()

		fb.as_user(self, w.student.user)
		drop = st.create_request(
			{"request_type": "Course Drop", "course_enrolment": enrolment, "reason": "Clash"}
		)
		with self.assertRaises(frappe.ValidationError):
			st.create_request(
				{"request_type": "Course Drop", "course_enrolment": enrolment, "reason": "Again"}
			)
		transfer = st.create_request(
			{"request_type": "Programme Transfer", "new_programme": target.name, "reason": "New calling"}
		)
		deferment = st.create_request(
			{
				"request_type": "Deferment",
				"reason": "Family",
				"from_date": nowdate(),
				"to_date": add_days(nowdate(), 90),
			}
		)
		transcript = st.create_request({"request_type": "Transcript Request", "reason": "Job application"})

		frappe.set_user("Administrator")
		self.enqueue_lms.reset_mock()
		st.decide_request(drop["name"], "Approved", "Approved by registrar")
		self.assertEqual(frappe.db.get_value("Course Enrolment", enrolment, "status"), "Dropped")
		self.assertEqual(frappe.db.get_value("Course Offering", w.offerings[0], "enrolled_count"), 0)
		self.enqueue_lms.assert_called_once_with(enrolment, "unenrol")

		st.decide_request(transfer["name"], "Approved")
		student = frappe.get_doc("Student", w.student.name)
		self.assertEqual((student.programme, student.programme_name), (target.name, target.programme_name))

		st.decide_request(deferment["name"], "Approved")
		self.assertEqual(frappe.db.get_value("Student", w.student.name, "status"), "Deferred")
		self.assertEqual(
			frappe.db.get_value(
				"Course Enrolment", {"student": w.student.name, "course_offering": w.offerings[1]}, "status"
			),
			"Withdrawn",
		)

		st.decide_request(transcript["name"], "Approved")
		self.assertTrue(
			frappe.db.exists("Transcript", {"request": transcript["name"], "student": w.student.name})
		)
		self.assertIn("Student Request Update", self.events())

		frappe.set_user(w.student.user)
		resume = st.create_request({"request_type": "Resumption", "reason": "Back"})
		frappe.set_user("Administrator")
		st.decide_request(resume["name"], "Approved")
		self.assertEqual(frappe.db.get_value("Student", w.student.name, "status"), "Active")

	def test_rejected_request_has_no_effect(self):
		w = self.world(status="Active")
		fb.as_user(self, w.student.user)
		req = st.create_request({"request_type": "Withdrawal", "reason": "Unsure"})
		self.assertTrue(st.cancel_request(req["name"])["status"] == "Cancelled")
		req = st.create_request({"request_type": "Withdrawal", "reason": "Unsure"})
		frappe.set_user("Administrator")
		st.decide_request(req["name"], "Rejected", "Talk to the dean first")
		self.assertEqual(frappe.db.get_value("Student", w.student.name, "status"), "Active")
		with self.assertRaises(frappe.ValidationError):
			st.decide_request(req["name"], "Approved")

	def test_clearance_request(self):
		student = f.make_student(phone=fb.unique_phone())
		fb.as_user(self, student.user)
		with patch("mahanaim.services.fees.get_student_balance", return_value=0):
			req = st.create_request({"request_type": "Clearance", "reason": "Completing studies"})
		items = {r["department"]: r["status"] for r in req["clearance"]}
		self.assertEqual(
			items,
			{
				"Finance": "Cleared",
				"Library": "Pending",
				"Academics": "Pending",
				"Dean of Students": "Pending",
			},
		)
		with self.assertRaises(frappe.PermissionError):
			st.update_clearance_item(req["name"], "Library", "Cleared")

		frappe.set_user(self.user_with("Library Officer"))
		st.update_clearance_item(req["name"], "Library", "Cleared", "No books out")
		with self.assertRaises(frappe.PermissionError):
			st.update_clearance_item(req["name"], "Academics", "Cleared")

		frappe.set_user("Administrator")
		with self.assertRaisesRegex(frappe.ValidationError, "pending"):
			st.decide_request(req["name"], "Approved")
		for dept in ("Academics", "Dean of Students"):
			st.update_clearance_item(req["name"], dept, "Cleared")
		self.assertEqual(st.decide_request(req["name"], "Approved")["status"], "Approved")

		owing = f.make_student(phone=fb.unique_phone())
		with patch("mahanaim.services.fees.get_student_balance", return_value=2500):
			doc = frappe.get_doc(
				{
					"doctype": "Student Request",
					"student": owing.name,
					"request_type": "Clearance",
					"reason": "Leaving",
				}
			).insert(ignore_permissions=True)
		finance = next(r for r in doc.clearance if r.department == "Finance")
		self.assertEqual(finance.status, "Not Cleared")

	# ------------------------------------------------------------------ portal + staff views
	def test_portal_and_staff_views(self):
		w = self.world()
		self.approved(w)
		fb.as_user(self, w.student.user)
		profile = st.update_my_profile(
			{"home_church": "New Life _T", "status": "Alumni", "programme": "HACK"}
		)
		self.assertEqual(profile["home_church"], "New Life _T")
		self.assertEqual((profile["status"], profile["programme"]), ("Active", w.programme.name))
		dashboard = st.my_dashboard()
		self.assertEqual(dashboard["student"]["name"], w.student.name)
		self.assertEqual(len(dashboard["courses"]), 2)
		self.assertEqual(st.my_registrations()["total"], 1)

		frappe.set_user("Administrator")
		view = st.student_360(w.student.name)
		self.assertEqual(len(view["enrolments"]), 2)
		self.assertEqual(len(view["registrations"]), 1)
		listing = st.list_students(search=w.student.student_number)
		self.assertEqual([r["name"] for r in listing["data"]], [w.student.name])
		self.assertGreaterEqual(st.student_stats()["total"], 1)
		self.assertEqual(st.list_registrations(term=w.term.name)["total"], 1)

	def test_my_requests_status_log(self):
		student = f.make_student(phone=fb.unique_phone())
		fb.as_user(self, student.user)
		req = st.create_request({"request_type": "Withdrawal", "reason": "Considering"})
		frappe.set_user("Administrator")
		st.decide_request(req["name"], "Under Review", "Checking with the dean")

		frappe.set_user(student.user)
		row = next(r for r in st.my_requests()["data"] if r["name"] == req["name"])
		self.assertEqual([r["to_status"] for r in row["status_log"]], ["Pending", "Under Review"])
		self.assertEqual(row["status_log"][-1]["from_status"], "Pending")
		self.assertNotIn("note", row["status_log"][-1])

	def test_dashboard_blocks(self):
		w = self.world()
		self.approved(w)
		offering, day = w.offerings[0], nowdate()

		def session(on, **values):
			return frappe.get_doc(
				{
					"doctype": "Class Session",
					"course_offering": offering,
					"session_date": on,
					"start_time": "06:00:00",
					"end_time": "07:00:00",
					**values,
				}
			).insert(ignore_permissions=True)

		today_session = session(day, mode="Online", meeting_link="https://meet.example.com/t")
		session(add_days(day, 1), mode="In Person", venue=f"Hall {random_string(5)}")
		for i, status in enumerate(("Present", "Late", "Absent", "Excused"), start=1):
			session(
				add_days(day, -i), status="Held", attendance=[{"student": w.student.name, "status": status}]
			)

		now = now_datetime()

		def announce(title, minutes, **values):
			return (
				frappe.get_doc(
					{
						"doctype": "Announcement",
						"title": title,
						"body": "<p>Hello</p>",
						"status": "Sent",
						"show_in_portal": 1,
						"sent_on": add_to_date(now, minutes=minutes),
						**values,
					}
				)
				.insert(ignore_permissions=True)
				.name
			)

		pinned = announce("Pinned _T", 0, audience="Programme", programme=w.programme.name, is_pinned=1)
		hidden = announce(
			"Other programme _T", 5, audience="Programme", programme=fb.make_programme().name, is_pinned=1
		)
		latest = [announce(f"News {i} _T", 525600 + i, audience="All Students") for i in range(5)]

		fb.as_user(self, w.student.user)
		dash = st.my_dashboard()

		self.assertEqual(
			[(c["name"], c["offering"], c["mode"], c["meeting_link"]) for c in dash["today_classes"]],
			[(today_session.name, offering, "Online", "https://meet.example.com/t")],
		)
		attendance = dash["attendance_summary"]
		self.assertEqual(
			(attendance["sessions"], attendance["present"], attendance["late"], attendance["excused"]),
			(4, 1, 1, 1),
		)
		self.assertAlmostEqual(attendance["percent"], 66.67, places=2)
		self.assertEqual(
			{k: (v["cleared"], v["message"]) for k, v in dash["clearance"].items()},
			{"exam": (True, ""), "transcript": (True, "")},
		)
		self.fee_clearance.assert_has_calls(
			[call(w.student.name, "exam"), call(w.student.name, "transcript")], any_order=True
		)

		names = [a["name"] for a in dash["announcements"]]
		flags = [a["is_pinned"] for a in dash["announcements"]]
		self.assertEqual(len(names), 5)
		self.assertIn(pinned, names)
		self.assertNotIn(hidden, names)
		self.assertEqual(flags, sorted(flags, reverse=True))
		unpinned = [a["name"] for a in dash["announcements"] if not a["is_pinned"]]
		self.assertTrue(unpinned)
		self.assertEqual(unpinned, latest[::-1][: len(unpinned)])

		with (
			patch("mahanaim.api.academics.my_timetable", side_effect=frappe.ValidationError("x")),
			patch("mahanaim.api.academics.attendance_summary", side_effect=RuntimeError("down")),
			patch(
				"mahanaim.services.fees.fee_clearance",
				side_effect=lambda *a: frappe.throw("Fees offline _T"),
			),
		):
			dash = st.my_dashboard()
		self.assertEqual(
			(dash["today_classes"], dash["attendance_summary"], dash["clearance"]), (None, None, None)
		)
		self.assertEqual(dash["student"]["name"], w.student.name)
		self.assertFalse([m for m in frappe.local.message_log if "Fees offline _T" in str(m)])

	def test_permission_denials(self):
		w = self.world()
		other = f.make_student(
			programme=w.programme.name, campus=w.campus, status="Admitted", phone=fb.unique_phone()
		)
		fb.as_user(self, w.student.user)
		reg = st.submit_registration(w.term.name, w.offerings[:1])
		req = st.create_request({"request_type": "Withdrawal", "reason": "Considering"})

		frappe.set_user(other.user)
		for fn in (
			lambda: st.cancel_registration(reg["name"]),
			lambda: st.cancel_request(req["name"]),
			lambda: st.get_registration(reg["name"]),
			lambda: st.approve_registration(reg["name"]),
			lambda: st.student_360(w.student.name),
			lambda: st.list_students(),
			lambda: st.decide_request(req["name"], "Approved"),
		):
			with self.assertRaises(frappe.PermissionError):
				fn()
		self.assertEqual(st.my_registrations()["total"], 0)
		self.assertEqual(st.my_requests()["total"], 0)

		frappe.set_user(fb.make_applicant().name)
		with self.assertRaises(frappe.PermissionError):
			st.my_profile()
		frappe.set_user("Guest")
		with self.assertRaises(frappe.AuthenticationError):
			st.my_dashboard()
