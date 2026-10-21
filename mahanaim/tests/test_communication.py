import json

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_to_date, now_datetime

from mahanaim.api import communication
from mahanaim.tests import factories as f
from mahanaim.tests import factories_b4 as fb


class TestCommunication(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		cls.campus = f.make_campus().name
		cls.term = f.make_term().name
		cls.programme = f.make_programme("TCOM", "Diploma in Communication _T", courses=("TCM101",)).name
		cls.other_programme = f.make_programme("TOTH", "Certificate Other _T", courses=("TCM201",)).name
		cls.lecturer = f.make_staff("Ruth", "Announcer _T", campus=cls.campus)
		cls.lecturer_user = cls.lecturer.user or frappe.db.get_value(
			"Staff Member", cls.lecturer.name, "user"
		)
		cls.offering = f.make_offering(
			"TCM101", term=cls.term, campus=cls.campus, lecturer=cls.lecturer.name
		).name
		cls.other_offering = f.make_offering("TCM201", term=cls.term, campus=cls.campus).name
		cls.student = f.make_student("Silas", "Reader _T", programme=cls.programme, campus=cls.campus)
		cls.student_user = cls.student.user or frappe.db.get_value("Student", cls.student.name, "user")
		f.make_enrolment(cls.student.name, cls.offering)
		cls.applicant_user = f.make_user(roles=("Applicant",)).name
		cls.sponsor_user = f.make_user(roles=("Sponsor",)).name
		mk = fb.make_announcement
		cls.ann = {
			"everyone": mk("Everyone _T", "Everyone").name,
			"students": mk("All students _T", "All Students").name,
			"programme": mk("My programme _T", "Programme", programme=cls.programme).name,
			"other_programme": mk("Other programme _T", "Programme", programme=cls.other_programme).name,
			"campus": mk("Campus _T", "Campus", campus=cls.campus).name,
			"offering": mk("My offering _T", "Course Offering", course_offering=cls.offering).name,
			"other_offering": mk(
				"Other offering _T", "Course Offering", course_offering=cls.other_offering
			).name,
			"lecturers": mk("Lecturers _T", "Lecturers").name,
			"applicants": mk("Applicants _T", "Applicants").name,
			"sponsors": mk("Sponsors _T", "Sponsors").name,
			"alumni": mk("Alumni _T", "Alumni").name,
			"draft": mk("Draft _T", "All Students", status="Draft").name,
			"expired": mk(
				"Expired _T",
				"All Students",
				publish_on=add_to_date(now_datetime(), days=-3),
				expires_on=add_to_date(now_datetime(), days=-1),
			).name,
			"hidden": mk("Not in portal _T", "All Students", show_in_portal=0).name,
			"pinned": mk("Pinned _T", "Everyone", is_pinned=1).name,
		}

	def tearDown(self):
		frappe.set_user("Administrator")

	def visible_keys(self, user):
		frappe.set_user(user)
		rows = communication.my_announcements(limit=100)["data"]
		names = [r["name"] for r in rows]
		keys = {k for k, v in self.ann.items() if v in names}
		return keys, names

	def test_student_visibility(self):
		self.assertTrue(self.student_user)
		keys, names = self.visible_keys(self.student_user)
		self.assertEqual(keys, {"everyone", "students", "programme", "campus", "offering", "pinned"})
		self.assertEqual(names[0], self.ann["pinned"])

	def test_lecturer_visibility(self):
		self.assertTrue(self.lecturer_user)
		keys, _names = self.visible_keys(self.lecturer_user)
		self.assertEqual(keys, {"everyone", "offering", "lecturers", "pinned"})

	def test_applicant_and_sponsor_visibility(self):
		self.assertEqual(self.visible_keys(self.applicant_user)[0], {"everyone", "applicants", "pinned"})
		self.assertEqual(self.visible_keys(self.sponsor_user)[0], {"everyone", "sponsors", "pinned"})

	def test_notifications_and_mark_read(self):
		user = self.student_user
		other = self.applicant_user
		mine = []
		for i in range(3):
			doc = frappe.get_doc(
				{
					"doctype": "Portal Notification",
					"user": user,
					"title": f"Note {i} _T",
					"message": "Hello",
					"category": "Info",
				}
			).insert(ignore_permissions=True)
			mine.append(doc.name)
		theirs = (
			frappe.get_doc({"doctype": "Portal Notification", "user": other, "title": "Theirs _T"})
			.insert(ignore_permissions=True)
			.name
		)
		frappe.set_user(user)
		data = communication.my_notifications(limit=50)
		start_unread = data["unread"]
		self.assertGreaterEqual(start_unread, 3)
		self.assertEqual(
			set(data["items"][0]) >= {"name", "title", "message", "link", "category", "is_read", "creation"},
			True,
		)
		res = communication.mark_notifications_read(names=json.dumps([mine[0], theirs]))
		self.assertEqual(res["unread"], start_unread - 1)
		self.assertEqual(frappe.db.get_value("Portal Notification", theirs, "is_read"), 0)
		self.assertTrue(frappe.db.get_value("Portal Notification", mine[0], "read_on"))
		self.assertEqual(communication.mark_read(all=1)["unread"], 0)
		self.assertEqual(communication.unread_count()["unread"], 0)
		self.assertEqual(frappe.db.get_value("Portal Notification", theirs, "is_read"), 0)

	def test_lecturer_announcement_restriction(self):
		frappe.set_user(self.lecturer_user)
		base = {"doctype": "Announcement", "body": "<p>Class moved</p>", "status": "Draft"}
		with self.assertRaises(frappe.PermissionError):
			frappe.get_doc({**base, "title": "To everyone _T", "audience": "All Students"}).insert(
				ignore_permissions=True
			)
		with self.assertRaises(frappe.PermissionError):
			frappe.get_doc(
				{
					**base,
					"title": "Not mine _T",
					"audience": "Course Offering",
					"course_offering": self.other_offering,
				}
			).insert(ignore_permissions=True)
		doc = frappe.get_doc(
			{**base, "title": "Mine _T", "audience": "Course Offering", "course_offering": self.offering}
		).insert(ignore_permissions=True)
		self.assertEqual(doc.posted_by, self.lecturer_user)

	def test_audience_required_fields_and_status_flow(self):
		with self.assertRaises(frappe.ValidationError):
			fb.make_announcement("No programme _T", "Programme", status="Draft")
		doc = fb.make_announcement("Flow _T", "Everyone", status="Draft")
		doc.status = "Scheduled"
		with self.assertRaises(frappe.ValidationError):
			doc.save()  # needs publish_on
		sent = frappe.get_doc("Announcement", self.ann["everyone"])
		sent.status = "Draft"
		with self.assertRaises(frappe.ValidationError):
			sent.save()

	def test_preview_audience(self):
		res = communication.preview_audience("Programme", programme=self.programme)
		self.assertGreaterEqual(res["count"], 1)
		self.assertIn("sample", res)

	def test_template_jinja_validation(self):
		with self.assertRaises(frappe.ValidationError):
			frappe.get_doc(
				{
					"doctype": "Message Template",
					"template_name": "Broken _T",
					"event": "Custom",
					"subject": "Hi {{ name",
					"email_body": "x",
				}
			).insert(ignore_permissions=True)

	def test_fallback_text_is_never_rendered_as_jinja(self):
		from mahanaim.services.communication import notify

		probe = "{{ 7 * 7 }}{% if 1 %}!{% endif %}"
		email = f"probe.{frappe.generate_hash(length=8)}@example.com"
		notify(
			"Unmatched Event _T",
			recipients=[{"email": email, "name": probe}],
			fallback={"subject": f"Hello {probe}", "message": f"<p>{probe}</p>"},
		)
		log = frappe.get_last_doc("Message Log", filters={"recipient": email})
		self.assertEqual(log.subject, f"Hello {probe}")
		self.assertIn(probe, log.message)

	def test_templates_cannot_reach_unsafe_objects(self):
		from mahanaim.services.communication import _context, _render

		student = frappe.get_doc("Student", self.student.name)
		ctx = _context(student, {"student": student}, {"name": "Silas"})
		self.assertNotIn("sms_api_key", ctx["settings"])
		for source in (
			"{{ frappe.utils.execute_in_shell('true') }}",
			"{{ settings.get_password('sms_api_key') }}",
			"{{ doc.db_set('first_name', 'Hacked') }}",
			"{{ student.save() }}",
		):
			with self.assertRaises(Exception, msg=source):
				_render(source, ctx)
		self.assertNotEqual(frappe.db.get_value("Student", student.name, "first_name"), "Hacked")
		self.assertIn("5.00", _render("{{ frappe.utils.fmt_money(5) }} {{ doc.first_name }}", ctx))
