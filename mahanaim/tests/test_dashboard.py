import frappe
from frappe.tests import IntegrationTestCase

from mahanaim.api import dashboard
from mahanaim.services import dashboard as svc
from mahanaim.tests import factories as f
from mahanaim.tests import factories_b4 as fb


class TestDashboard(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		cls.campus = f.make_campus().name
		cls.term = f.make_term().name
		cls.programme = f.make_programme("TDSH", "Diploma Dashboard _T", courses=("TDS101",)).name
		cls.student = f.make_student("Zebedee", "Quokkason _T", programme=cls.programme, campus=cls.campus)
		cls.sponsor = fb.make_sponsor("Quokkason Trust _T").name
		cls.staff = f.make_staff("Quokka", "Staffer _T", campus=cls.campus, create_user=False).name
		cls.comms_user = f.make_user(roles=("Communications Officer",)).name
		cls.finance_user = f.make_user(roles=("Finance Officer",)).name

	def tearDown(self):
		frappe.set_user("Administrator")

	def test_admin_overview_keys(self):
		data = dashboard.admin_overview(refresh=1)
		for key in ("sections", "kpis", "charts", "activity", "generated_on"):
			self.assertIn(key, data)
		self.assertEqual(set(data["sections"]), set(svc.SECTION_BUILDERS))
		for section in data["sections"]:
			self.assertIsNotNone(data[section], f"section {section} failed")
		self.assertTrue(all({"key", "label", "value"} <= set(card) for card in data["kpis"]))

	def test_activity_feed_lists_payments(self):
		payment = frappe.get_doc(
			{
				"doctype": "Student Payment",
				"payment_for": "Student Fees",
				"student": self.student.name,
				"mode_of_payment": "Cash",
				"amount": 1500,
				"remarks": "Dashboard feed _T",
			}
		)
		payment.flags.mute_notification = True
		payment.insert(ignore_permissions=True)
		payment.submit()
		feed = svc.activity_feed(["finance"], limit=50)
		row = next(r for r in feed if r["name"] == payment.name)
		self.assertIn("1,500", row["title"])
		self.assertEqual(row["route"], f"/admin/finance/payments/{payment.name}")

	def test_overview_sections_follow_roles(self):
		frappe.set_user(self.finance_user)
		data = dashboard.admin_overview(refresh=1)
		self.assertIn("finance", data["sections"])
		self.assertNotIn("academics", data["sections"])
		frappe.set_user(f.make_user(roles=("Student",)).name)
		with self.assertRaises(frappe.PermissionError):
			dashboard.admin_overview()

	def test_every_report_runs_for_admin(self):
		for key in svc.REPORTS:
			res = dashboard.run_report(key, {})
			self.assertIn("columns", res, key)
			self.assertIsInstance(res["rows"], list, key)
			self.assertTrue(all({"key", "label", "type"} <= set(c) for c in res["columns"]), key)
		export = dashboard.export_report("student_list", {"programme": self.programme})
		self.assertTrue(export["filename"].endswith(".csv"))
		self.assertIn("Quokkason", export["content"])

	def test_report_role_gating(self):
		frappe.set_user(self.comms_user)
		self.assertEqual(dashboard.run_report("message_delivery")["columns"][0]["key"], "event")
		for report in ("fee_collections", "outstanding_balances", "results_summary", "student_list"):
			with self.assertRaises(frappe.PermissionError):
				dashboard.run_report(report)
		catalog = {r["key"] for r in dashboard.reports_catalog()}
		self.assertIn("message_delivery", catalog)
		self.assertNotIn("fee_collections", catalog)
		frappe.set_user(self.finance_user)
		self.assertIn("rows", dashboard.run_report("fee_collections"))
		with self.assertRaises(frappe.PermissionError):
			dashboard.run_report("pass_rates_by_course")
		with self.assertRaises(frappe.PermissionError):
			dashboard.export_report("results_summary")
		with self.assertRaises(frappe.ValidationError):
			frappe.set_user("Administrator")
			dashboard.run_report("no_such_report")

	def test_global_search_route_shapes(self):
		results = dashboard.global_search("Quokkason")
		by_type = {r["type"]: r for r in results}
		self.assertEqual(by_type["Student"]["route"], f"/admin/students/{self.student.name}")
		self.assertEqual(by_type["Sponsor"]["route"], f"/admin/church/sponsors/{self.sponsor}")
		for r in results:
			self.assertEqual(set(r) >= {"type", "title", "subtitle", "route"}, True)
			self.assertTrue(r["route"].startswith("/admin/"))
		course = dashboard.global_search("TDS101")
		self.assertIn("/admin/academics/courses/TDS101", [r["route"] for r in course])
		staff = dashboard.global_search("Staffer _T")
		self.assertIn(f"/admin/staff/{self.staff}", [r["route"] for r in staff])
		self.assertEqual(dashboard.global_search("a"), [])
		frappe.set_user(f.make_user(roles=("Student",)).name)
		with self.assertRaises(frappe.PermissionError):
			dashboard.global_search("Quokkason")

	def test_campus_comparison(self):
		data = dashboard.campus_comparison()
		self.assertIn(self.campus, [c["campus"] for c in data["campuses"]])
		frappe.set_user(self.comms_user)
		limited = dashboard.campus_comparison()
		self.assertTrue(all(c["billed"] is None for c in limited["campuses"]))
