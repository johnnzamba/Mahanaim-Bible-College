import random
from unittest.mock import MagicMock, patch

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_to_date, now_datetime

from mahanaim.api import website
from mahanaim.services import website as web
from mahanaim.tests import factories_b4 as fb


class TestWebsite(IntegrationTestCase):
	def tearDown(self):
		frappe.set_user("Administrator")

	def test_news_slug_is_unique(self):
		first = fb.make_news("Graduation 2026 Highlights _T")
		second = fb.make_news("Graduation 2026 Highlights _T")
		self.assertTrue(first.route.startswith("graduation-2026-highlights"))
		self.assertNotEqual(first.route, second.route)
		second.title = "Something else _T"
		second.route = first.route
		with self.assertRaises(frappe.DuplicateEntryError):
			second.save()

	def test_publish_filtering(self):
		live = fb.make_news("Live Post _T")
		draft = fb.make_news("Draft Post _T", published=0)
		future = fb.make_news("Future Post _T", published_on=frappe.utils.add_days(frappe.utils.nowdate(), 5))
		frappe.set_user("Guest")
		names = [p["route"] for p in website.news(page_length=50)["data"]]
		self.assertIn(live.route, names)
		self.assertNotIn(draft.route, names)
		self.assertNotIn(future.route, names)
		self.assertEqual(website.news_post(live.route)["title"], live.title)
		for route in (draft.route, future.route):
			with self.assertRaises(frappe.DoesNotExistError):
				website.news_post(route)

	def test_event_capacity_duplicate_and_waitlist(self):
		ev = fb.make_event("Leadership Summit _T", capacity=3)
		frappe.set_user("Guest")
		first = website.register_for_event(
			ev.route, full_name="Peter Otieno", email="peter@example.com", phone="0711111111", attendees=2
		)
		self.assertEqual(first["status"], "Registered")
		with self.assertRaises(frappe.DuplicateEntryError):
			website.register_for_event(ev.route, full_name="Peter Otieno", email="PETER@example.com")
		second = website.register_for_event(
			ev.route, full_name="Ann Muthoni", email="ann@example.com", attendees=2
		)
		self.assertTrue(second["waitlisted"])
		third = website.register_for_event(ev.route, full_name="Joy Akinyi", email="joy@example.com")
		self.assertEqual(third["status"], "Registered")
		frappe.set_user("Administrator")
		self.assertEqual(frappe.db.get_value("Campus Event", ev.name, "registered_count"), 3)
		detail = website.event(ev.route)
		self.assertEqual(detail["registration"]["seats_left"], 0)
		# Staff cannot push a waitlisted registration over capacity.
		reg = frappe.get_doc("Event Registration", second["reference"])
		reg.status = "Registered"
		with self.assertRaises(frappe.ValidationError):
			reg.save()

	def test_paid_event_returns_payment_step(self):
		ev = fb.make_event("Worship Night _T", fee=500)
		with patch(
			"mahanaim.services.mpesa.initiate_payment",
			return_value={"request": "STK-TEST-1", "customer_message": "Check your phone"},
		) as pay:
			res = website.register_for_event(
				ev.route, full_name="Mark Kibet", email="mark@example.com", phone="0712345678", attendees=2
			)
		self.assertTrue(res["payment"]["required"])
		self.assertEqual(res["payment"]["amount"], 1000)
		self.assertEqual(pay.call_args.args[2], "Event Fee")
		self.assertEqual(
			frappe.db.get_value("Event Registration", res["reference"], "payment_status"), "Pending"
		)

	def test_registration_closed_for_past_event(self):
		ev = fb.make_event("Old Retreat _T", days_ahead=-5, status="Completed")
		with self.assertRaises(frappe.ValidationError):
			website.register_for_event(ev.route, full_name="Late Comer", email="late@example.com")

	def test_enquiry_honeypot_and_validation(self):
		before = frappe.db.count("Contact Enquiry")
		frappe.set_user("Guest")
		self.assertEqual(
			website.submit_enquiry("Bot", "bot@example.com", message="spam", website="http://spam"),
			{"ok": True},
		)
		self.assertEqual(frappe.db.count("Contact Enquiry"), before)
		with self.assertRaises(frappe.ValidationError):
			website.submit_enquiry("Real Person", "real@example.com", message="  ")
		res = website.submit_enquiry(
			"Real Person",
			"real@example.com",
			phone="0712345678",
			message="When does the May intake start?",
			enquiry_type="Admissions",
		)
		self.assertTrue(res["reference"])
		doc = frappe.get_doc("Contact Enquiry", res["reference"])
		self.assertEqual((doc.subject, doc.status), ("Admissions", "New"))

	def test_enquiry_rate_limited(self):
		ip = f"10.66.{random.randint(1, 250)}.{random.randint(1, 250)}"
		request = MagicMock(method="POST")
		with (
			patch.object(frappe.local, "request", request, create=True),
			patch.object(frappe.local, "request_ip", ip, create=True),
			patch.dict(frappe.local.form_dict, {"cmd": "mahanaim.api.website.submit_enquiry.test"}),
		):
			for _i in range(5):
				website.submit_enquiry("Bot", "bot@example.com", message="x", website="trap")
			with self.assertRaises(frappe.RateLimitExceededError):
				website.submit_enquiry("Bot", "bot@example.com", message="x", website="trap")

	def test_route_meta_never_raises(self):
		news = fb.make_news("Meta Post _T")
		paths = [
			None,
			"",
			"/",
			"/about",
			"/admissions",
			"/programmes",
			"/programmes/NOPE",
			f"/news/{news.route}",
			"/news/missing",
			"/events/missing",
			"/events/../../etc",
			"/%00",
			"///",
			123,
			"/library",
			"/x" * 300,
		]
		for path in paths:
			meta = web.route_meta(path)
			self.assertTrue(meta.get("title"), path)
			self.assertIn("description", meta)
			self.assertIn("image", meta)
		self.assertTrue(web.route_meta(f"/news/{news.route}")["title"].startswith("Meta Post _T"))

	def test_site_settings_contract(self):
		frappe.set_user("Guest")
		data = website.site_settings()
		for key in ("institution", "contact", "social", "nav", "footer_links", "announcement_bar"):
			self.assertIn(key, data)
		self.assertEqual(set(data["contact"]) >= {"phone", "email", "address", "map_url"}, True)
		self.assertEqual(set(data["social"]) >= {"facebook", "youtube", "instagram", "x", "whatsapp"}, True)

	def test_event_status_cron(self):
		ev = fb.make_event("Ongoing Seminar _T", days_ahead=0)
		frappe.db.set_value(
			"Campus Event",
			ev.name,
			{
				"start_datetime": add_to_date(now_datetime(), hours=-1),
				"end_datetime": add_to_date(now_datetime(), hours=2),
				"status": "Upcoming",
			},
		)
		web.update_event_statuses()
		self.assertEqual(frappe.db.get_value("Campus Event", ev.name, "status"), "Ongoing")
