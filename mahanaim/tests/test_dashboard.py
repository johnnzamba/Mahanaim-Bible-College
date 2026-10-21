import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, now_datetime, nowdate, random_string

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

	def test_new_reports_role_gating(self):
		registrar = f.make_user("dash.registrar.b4@example.com", roles=("Registrar",)).name
		auditor = f.make_user("dash.auditor.b4@example.com", roles=("Auditor",)).name
		expected = {
			self.finance_user: {"payment_reconciliation"},
			registrar: {"lecturer_workload", "credentials_issued"},
			auditor: {"payment_reconciliation", "credentials_issued"},
			self.comms_user: set(),
		}
		for user, allowed in expected.items():
			frappe.set_user(user)
			catalog = {r["key"] for r in dashboard.reports_catalog()}
			for report in ("payment_reconciliation", "lecturer_workload", "credentials_issued"):
				self.assertEqual(report in catalog, report in allowed, (user, report))
				if report in allowed:
					self.assertIn("rows", dashboard.run_report(report, {}))
				else:
					with self.assertRaises(frappe.PermissionError):
						dashboard.run_report(report, {})

	def test_payment_reconciliation_report(self):
		trans = frappe.get_doc(
			{
				"doctype": "M-Pesa Transaction",
				"trans_id": f"TST{random_string(7).upper()}",
				"source": "C2B",
				"trans_time": now_datetime(),
				"amount": 750,
				"msisdn": "254712345678",
				"bill_ref_number": "UNKNOWN-REF",
				"student": self.student.name,
				"status": "Unmatched",
			}
		).insert(ignore_permissions=True)
		orphan = frappe.get_doc(
			{
				"doctype": "Student Payment",
				"payment_for": "Student Fees",
				"student": self.student.name,
				"mode_of_payment": "M-Pesa",
				"reference_no": f"NOTX{random_string(6).upper()}",
				"amount": 1200,
			}
		)
		orphan.flags.mute_notification = True
		orphan.insert(ignore_permissions=True)
		orphan.submit()
		frappe.set_user(self.finance_user)
		res = dashboard.run_report("payment_reconciliation", {"campus": self.campus})
		rows = {r["receipt"]: r for r in res["rows"]}
		row = rows[trans.name]
		self.assertEqual((row["status"], row["amount"], row["campus"]), ("Unmatched", 750, self.campus))
		self.assertEqual((row["matched_doctype"], row["matched_name"]), ("Student", self.student.name))
		self.assertTrue(row["phone"].endswith("678") and "*" in row["phone"])
		flagged = rows[orphan.reference_no]
		self.assertEqual((flagged["status"], flagged["payment"]), (svc.NO_TRANSACTION, orphan.name))
		summary = res["summary"]
		self.assertGreaterEqual(summary["unmatched"], 1)
		self.assertGreaterEqual(summary["payments_without_transaction"], 1)
		self.assertGreaterEqual(summary["by_status"]["Unmatched"], 1)
		only_orphans = dashboard.run_report("payment_reconciliation", {"status": svc.NO_TRANSACTION})
		self.assertEqual({r["status"] for r in only_orphans["rows"]}, {svc.NO_TRANSACTION})
		# once the transaction backs the payment, the payment is no longer flagged
		frappe.set_user("Administrator")
		frappe.db.set_value("M-Pesa Transaction", trans.name, {"payment": orphan.name, "status": "Allocated"})
		frappe.set_user(self.finance_user)
		rows = {r["receipt"]: r for r in dashboard.run_report("payment_reconciliation", {})["rows"]}
		self.assertEqual(rows[trans.name]["matched_route"], f"/admin/finance/payments/{orphan.name}")
		self.assertNotIn(orphan.reference_no, rows)
		self.assertIn(trans.name, dashboard.export_report("payment_reconciliation", {})["content"])

	def test_lecturer_workload_report(self):
		offering = f.make_offering("TDS101", term=self.term, campus=self.campus, lecturer=self.staff)
		f.make_enrolment(self.student.name, offering.name)
		assignment = frappe.get_doc(
			{
				"doctype": "Assignment",
				"title": "Workload essay _T",
				"course_offering": offering.name,
				"status": "Published",
				"max_score": 100,
				"due_date": add_days(now_datetime(), 7),
			}
		).insert(ignore_permissions=True)
		frappe.get_doc(
			{
				"doctype": "Assignment Submission",
				"assignment": assignment.name,
				"student": self.student.name,
				"status": "Submitted",
				"submitted_on": now_datetime(),
			}
		).insert(ignore_permissions=True)
		frappe.get_doc(
			{
				"doctype": "Class Session",
				"course_offering": offering.name,
				"session_date": add_days(nowdate(), -2),
				"start_time": "06:00:00",
				"end_time": "07:00:00",
				"lecturer": self.staff,
				"status": "Held",
				"attendance": [{"student": self.student.name, "status": "Present"}],
			}
		).insert(ignore_permissions=True)
		res = dashboard.run_report("lecturer_workload", {"academic_term": self.term, "campus": self.campus})
		row = next(r for r in res["rows"] if r["staff_member"] == self.staff)
		credits = frappe.db.get_value("Course Offering", offering.name, "credits")
		self.assertEqual(
			{k: row[k] for k in ("offerings", "students", "assignments_published", "submissions_to_grade")},
			{"offerings": 1, "students": 1, "assignments_published": 1, "submissions_to_grade": 1},
		)
		self.assertEqual((row["mark_sheets_pending"], row["sessions_recorded"]), (1, 1))
		self.assertEqual(row["credit_hours"], credits)
		self.assertIn("TDS101", row["courses"])
		self.assertEqual(res["summary"]["term"], self.term)
		other_dept = f.make_department("Workload Dept _T").name
		res = dashboard.run_report(
			"lecturer_workload", {"academic_term": self.term, "department": other_dept}
		)
		self.assertNotIn(self.staff, [r["staff_member"] for r in res["rows"]])

	def test_credentials_issued_report(self):
		def credential(doctype, **values):
			doc = frappe.get_doc({"doctype": doctype, "student": self.student.name, **values})
			doc.insert(ignore_permissions=True)
			return doc

		old = credential("Transcript", transcript_type="Official")
		frappe.db.set_value(
			"Transcript",
			old.name,
			{"status": "Revoked", "issue_date": add_days(nowdate(), -10), "revoked_reason": "Typo _T"},
		)
		new = credential("Transcript", transcript_type="Official")
		frappe.db.set_value("Transcript", new.name, {"status": "Issued", "issue_date": nowdate()})
		pending = credential("Certificate")
		frappe.get_doc(
			{
				"doctype": "Verification Log",
				"verification_code": "TESTCODE",
				"document_type": "Transcript",
				"document_name": new.name,
				"result": "Valid",
				"verified_on": now_datetime(),
			}
		).insert(ignore_permissions=True)
		res = dashboard.run_report("credentials_issued", {"programme": self.programme})
		rows = {r["name"]: r for r in res["rows"]}
		self.assertEqual(rows[old.name]["status"], "Revoked")
		self.assertEqual(rows[new.name]["status"], "Reissued")
		self.assertEqual(rows[new.name]["verification_count"], 1)
		self.assertIsNotNone(rows[new.name]["last_verified"])
		self.assertEqual(
			(rows[pending.name]["status"], rows[pending.name]["credential_type"]), ("Pending", "Certificate")
		)
		self.assertEqual(res["summary"]["by_type"], {"Transcript": 2, "Certificate": 1})
		self.assertEqual(res["summary"]["reissued"], 1)
		filtered = dashboard.run_report(
			"credentials_issued",
			{"programme": self.programme, "credential_type": "Transcript", "status": "Reissued"},
		)
		self.assertEqual([r["name"] for r in filtered["rows"]], [new.name])
		recent = dashboard.run_report(
			"credentials_issued", {"programme": self.programme, "from_date": add_days(nowdate(), -5)}
		)
		self.assertNotIn(old.name, [r["name"] for r in recent["rows"]])
