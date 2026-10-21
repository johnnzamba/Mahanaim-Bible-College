from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from mahanaim.api import learning as api
from mahanaim.services import lms_bridge as bridge
from mahanaim.tests import factories_b2 as fb


class FakeLMS:
	"""In-memory stand-in for the Frappe LMS doctypes (the app is not installed on the dev site)."""

	def __init__(self):
		self.docs = {}
		self.updates = []

	def exists(self, doctype, name_or_filters):
		if isinstance(name_or_filters, str):
			return name_or_filters if (doctype, name_or_filters) in self.docs else None
		for (dt, name), doc in self.docs.items():
			if dt == doctype and all(doc.get(k) == v for k, v in name_or_filters.items()):
				return name
		return None

	def insert(self, payload):
		name = f"{payload['doctype'].replace(' ', '-').lower()}-{len(self.docs) + 1}"
		self.docs[(payload["doctype"], name)] = dict(payload)
		return name

	def update(self, doctype, name, values):
		self.docs[(doctype, name)].update(values)
		self.updates.append(name)
		return name

	def delete(self, doctype, name):
		self.docs.pop((doctype, name), None)

	def count(self, doctype):
		return len([1 for dt, _n in self.docs if dt == doctype])


class TestLMSBridge(IntegrationTestCase):
	def setUp(self):
		self.mocks = fb.setup_mocks(self)
		self.w = fb.make_world(students=2)

	def bridge_settings(self, **values):
		defaults = {
			"enabled": 1,
			"auto_create_courses": 1,
			"auto_enrol_students": 1,
			"publish_on_create": 1,
			"remove_enrolment_on_drop": 1,
		}
		fb.use_single(self, "LMS Bridge Settings", **{**defaults, **values})

	def fake_lms(self) -> FakeLMS:
		lms = FakeLMS()
		for target, fn in (
			("lms_available", lambda: True),
			("_lms_exists", lms.exists),
			("_lms_insert", lms.insert),
			("_lms_update", lms.update),
			("_lms_delete", lms.delete),
		):
			patcher = patch.object(bridge, target, side_effect=fn)
			patcher.start()
			self.addCleanup(patcher.stop)
		return lms

	def enrolment(self, student):
		return frappe.db.get_value(
			"Course Enrolment", {"student": student.name, "course_offering": self.w.offering.name}
		)

	# ------------------------------------------------------------------ pure builders
	def test_payload_builders(self):
		self.assertEqual(
			bridge.course_title_for("OT101", "Old Testament Survey", "2026 Term 1"),
			"OT101 — Old Testament Survey (2026 Term 1)",
		)
		payload = bridge.build_course_payload(
			{"course_title": "Old Testament Survey"},
			{"course_code": "OT101", "course_title": "Old Testament Survey", "description": "<p>Genesis</p>"},
			"2026 Term 1",
			["a@example.com", "a@example.com", None, "b@example.com"],
			True,
		)
		self.assertEqual(payload["doctype"], "LMS Course")
		self.assertEqual(payload["title"], "OT101 — Old Testament Survey (2026 Term 1)")
		self.assertEqual(payload["short_introduction"], "Genesis")
		self.assertEqual(payload["description"], "<p>Genesis</p>")
		self.assertEqual(
			payload["instructors"], [{"instructor": "a@example.com"}, {"instructor": "b@example.com"}]
		)
		self.assertEqual((payload["published"], payload["paid_course"]), (1, 0))
		bare = bridge.build_course_payload(
			{}, {"course_code": "NT1", "course_title": "Gospels"}, None, [], False
		)
		self.assertEqual(bare["published"], 0)
		self.assertIn("Gospels", bare["short_introduction"])
		self.assertEqual(
			bridge.build_enrollment_payload("s@example.com", "lms-course-1"),
			{
				"doctype": "LMS Enrollment",
				"member": "s@example.com",
				"course": "lms-course-1",
				"member_type": "Student",
				"role": "Member",
			},
		)

	# ------------------------------------------------------------------ fallback (no LMS)
	def test_fallback_when_lms_not_installed(self):
		self.bridge_settings()
		offering = self.w.offering.name
		self.assertFalse(bridge.lms_available())
		self.assertIsNone(bridge.sync_offering(offering))
		self.assertEqual(frappe.db.get_value("Course Offering", offering, "lms_sync_status"), "Not Installed")
		ce = self.enrolment(self.w.students[0])
		self.assertIsNone(bridge.enrol(ce))
		self.assertIsNone(bridge.unenrol(ce))
		self.assertIsNone(bridge.lms_course_url(offering))
		status = api.bridge_status()
		self.assertFalse(status["installed"])
		self.assertFalse(status["active"])

		# the native course page still works without LMS
		fb.as_user(self, self.w.lecturer.user)
		module = api.save_module({"course_offering": offering, "module_title": "Week 1", "is_published": 1})
		api.save_resource(
			{
				"course_module": module["name"],
				"title": "Reading",
				"resource_type": "Link",
				"url": "https://example.com/genesis",
				"is_published": 1,
			}
		)
		hidden = api.save_resource(
			{
				"course_module": module["name"],
				"title": "Draft notes",
				"resource_type": "Text",
				"body": "Soon",
				"is_published": 0,
			}
		)
		fb.as_user(self, self.w.students[0].user)
		page = api.my_course(offering)
		self.assertIsNone(page["lms_url"])
		titles = [r["title"] for m in page["modules"] for r in m["resources"]]
		self.assertEqual(titles, ["Reading"])
		with self.assertRaises(frappe.PermissionError):
			api.mark_resource_complete(hidden["name"])
		resource = page["modules"][0]["resources"][0]["name"]
		api.mark_resource_complete(resource)
		self.assertEqual(api.my_course(offering)["progress"]["percentage"], 100)
		outsider = fb.make_student(campus=self.w.campus)
		fb.as_user(self, outsider.user)
		with self.assertRaises(frappe.PermissionError):
			api.my_course(offering)

	# ------------------------------------------------------------------ mocked LMS
	def test_sync_is_idempotent(self):
		lms = self.fake_lms()
		self.bridge_settings()
		offering = self.w.offering.name
		first = bridge.sync_offering(offering)
		self.assertTrue(first)
		course = lms.docs[("LMS Course", first)]
		self.assertTrue(course["title"].startswith(f"{self.w.course.course_code} — "))
		self.assertEqual(course["instructors"], [{"instructor": self.w.lecturer.user}])
		self.assertEqual(course["published"], 1)
		row = frappe.db.get_value(
			"Course Offering", offering, ["lms_course", "lms_sync_status", "lms_last_synced"], as_dict=True
		)
		self.assertEqual((row.lms_course, row.lms_sync_status), (first, "Synced"))
		self.assertTrue(row.lms_last_synced)

		self.assertEqual(bridge.sync_offering(offering), first)
		self.assertEqual(lms.count("LMS Course"), 1)
		self.assertEqual(lms.updates, [first])
		self.assertEqual(bridge.lms_course_url(offering), f"/lms/courses/{first}")

	def test_sync_failure_is_recorded_and_retried(self):
		lms = self.fake_lms()
		self.bridge_settings()
		with patch.object(bridge, "_lms_insert", side_effect=RuntimeError("LMS down")):
			self.assertIsNone(bridge.sync_offering(self.w.offering.name))
		row = frappe.db.get_value(
			"Course Offering", self.w.offering.name, ["lms_sync_status", "lms_sync_error"], as_dict=True
		)
		self.assertEqual(row.lms_sync_status, "Error")
		self.assertIn("LMS down", row.lms_sync_error)
		result = api.retry_failed()
		self.assertGreaterEqual(result["synced"], 1)
		self.assertEqual(lms.count("LMS Course"), 1)

	def test_enrol_and_unenrol(self):
		lms = self.fake_lms()
		self.bridge_settings()
		s1, s2 = self.w.students
		ce = self.enrolment(s1)
		name = bridge.enrol(ce)  # auto-creates the LMS course first
		self.assertTrue(name)
		enrollment = lms.docs[("LMS Enrollment", name)]
		self.assertEqual((enrollment["member"], enrollment["member_type"]), (s1.user, "Student"))
		self.assertEqual(frappe.db.get_value("Course Enrolment", ce, "lms_enrollment"), name)
		self.assertEqual(bridge.enrol(ce), name)  # no duplicate
		self.assertEqual(lms.count("LMS Enrollment"), 1)
		self.mocks.fee.assert_not_called()  # lms_fee_clearance_percent is 0

		self.assertEqual(bridge.unenrol(ce), name)
		self.assertEqual(lms.count("LMS Enrollment"), 0)
		self.assertFalse(frappe.db.get_value("Course Enrolment", ce, "lms_enrollment"))

		fb.use_single(self, "Mahanaim Settings", lms_fee_clearance_percent=50)
		self.mocks.fee.return_value = {"cleared": False, "message": "Pay 50% first"}
		self.assertIsNone(bridge.enrol(self.enrolment(s2)))
		self.mocks.fee.assert_called_with(s2.name, "lms")
		self.assertEqual(lms.count("LMS Enrollment"), 0)

	def test_disabled_bridge_does_nothing(self):
		lms = self.fake_lms()
		self.bridge_settings(enabled=0)
		self.assertIsNone(bridge.sync_offering(self.w.offering.name))
		self.assertIsNone(bridge.enrol(self.enrolment(self.w.students[0])))
		self.assertEqual(lms.docs, {})

	def test_staff_only_bridge_admin(self):
		fb.as_user(self, self.w.lecturer.user)
		for call in (
			api.retry_failed,
			lambda: api.sync_offering_now(self.w.offering.name),
		):
			with self.assertRaises(frappe.PermissionError):
				call()

	def test_lecturer_reads_bridge_status_for_own_offerings(self):
		self.bridge_settings()
		other = fb.make_world(students=0, campus=self.w.campus)
		for name in (self.w.offering.name, other.offering.name):
			frappe.db.set_value("Course Offering", name, "lms_sync_status", bridge.ERROR)
			# the class shares one transaction: don't leave failures behind for retry_failed tests
			self.addCleanup(frappe.db.set_value, "Course Offering", name, "lms_sync_status", None)
		fb.as_user(self, self.w.lecturer.user)
		mine = api.bridge_status()
		self.assertEqual(mine["scope"], "lecturer")
		self.assertEqual([o["name"] for o in mine["offerings"]], [self.w.offering.name])
		self.assertEqual(mine["offerings"][0]["lms_sync_status"], bridge.ERROR)
		self.assertIsNone(mine["offerings"][0]["lms_url"])
		self.assertEqual(mine["failed"], 1)
		self.assertEqual(
			api.bridge_status(self.w.offering.name)["offerings"][0]["name"], self.w.offering.name
		)
		with self.assertRaises(frappe.PermissionError):
			api.bridge_status(other.offering.name)
		fb.as_user(self, self.w.students[0].user)
		with self.assertRaises(frappe.PermissionError):
			api.bridge_status()
		frappe.set_user("Administrator")
		self.assertEqual(api.bridge_status()["scope"], "all")

	def test_file_disposition_rules(self):
		cases = {
			("notes.pdf", 1): ("application/pdf", "inline"),
			("notes.pdf", 0): ("application/pdf", "attachment"),
			("photo.JPG", "1"): ("image/jpeg", "inline"),
			("chart.webp", 1): ("image/webp", "inline"),
			("logo.svg", 1): ("image/svg+xml", "attachment"),
			("page.html", 1): ("text/html", "attachment"),
			("feed.xml", 1): ("application/xml", "attachment"),
			("blob", 1): ("application/octet-stream", "attachment"),
		}
		for (name, inline), expected in cases.items():
			self.assertEqual(api.file_disposition(name, inline), expected, name)

	def test_resource_download_inline_opt_in(self):
		offering = self.w.offering.name
		fb.as_user(self, self.w.lecturer.user)
		module = api.save_module({"course_offering": offering, "module_title": "Week 1", "is_published": 1})
		url = fb.make_file(self, f"guide-{fb.code()}.pdf")
		resource = api.save_resource(
			{
				"course_module": module["name"],
				"title": "Guide",
				"resource_type": "PDF",
				"file": url,
				"is_published": 1,
			}
		)["name"]
		fb.as_user(self, self.w.students[0].user)
		api.download_resource(resource)
		self.assertEqual(
			(fb.served()["type"], fb.served()["disposition"], fb.served()["nosniff"]),
			("download", "attachment", "nosniff"),
		)
		api.download_resource(resource, inline=1)
		self.assertEqual(
			(fb.served()["content_type"], fb.served()["disposition"]), ("application/pdf", "inline")
		)
