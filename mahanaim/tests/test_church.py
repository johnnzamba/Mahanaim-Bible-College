from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import random_string

from mahanaim.api import church, sponsor
from mahanaim.services import church as svc
from mahanaim.tests import factories as f
from mahanaim.tests import factories_b4 as fb


def fake_initiate(phone, amount, purpose, sponsor=None, **kwargs):
	req = frappe.get_doc(
		{
			"doctype": "M-Pesa Request",
			"phone_number": phone,
			"amount": amount,
			"purpose": purpose,
			"sponsor": sponsor,
			"status": "Pending",
			"checkout_request_id": f"ws_CO_{random_string(12)}",
		}
	).insert(ignore_permissions=True)
	return {
		"request": req.name,
		"checkout_request_id": req.checkout_request_id,
		"customer_message": "Enter PIN",
	}


class TestChurch(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		cls.campus = f.make_campus().name
		cls.programme = f.make_programme("TCHU", "Diploma Church _T", courses=("TCH101",)).name
		cls.student = f.make_student(
			"Esther", "Sponsored _T", programme=cls.programme, campus=cls.campus
		).name
		cls.other_student = f.make_student(
			"Paul", "Unsponsored _T", programme=cls.programme, campus=cls.campus
		).name
		cls.giving_type = fb.make_giving_type().name

	def tearDown(self):
		frappe.set_user("Administrator")

	def test_sponsorship_coverage_validation(self):
		sp = fb.make_sponsor("Validation Sponsor _T").name
		for kwargs in (
			{"coverage": "Percentage", "percentage": 0, "amount": None},
			{"coverage": "Percentage", "percentage": 120, "amount": None},
			{"coverage": "Fixed Amount", "amount": 0},
		):
			with self.assertRaises(frappe.ValidationError):
				fb.make_sponsorship(sp, self.other_student, **kwargs)

	def test_sponsorship_links_student_and_blocks_duplicates(self):
		sp = fb.make_sponsor("Linking Sponsor _T")
		name = f.make_student("Lydia", "Linked _T", programme=self.programme, campus=self.campus).name
		s1 = fb.make_sponsorship(sp.name, name, coverage="Percentage", percentage=50, amount=None)
		student = frappe.db.get_value("Student", name, ["primary_sponsor", "fee_category"], as_dict=True)
		self.assertEqual((student.primary_sponsor, student.fee_category), (sp.name, "Sponsored"))
		self.assertEqual(frappe.db.get_value("Sponsor", sp.name, "active_sponsorships"), 1)
		with self.assertRaises(frappe.DuplicateEntryError):
			fb.make_sponsorship(sp.name, name)
		# Two active percentage sponsorships may not exceed 100 %.
		sp2 = fb.make_sponsor("Second Sponsor _T")
		with self.assertRaises(frappe.ValidationError):
			fb.make_sponsorship(sp2.name, name, coverage="Percentage", percentage=60, amount=None)
		church.set_sponsorship_status(s1.name, "Completed", "Graduated")
		student = frappe.db.get_value("Student", name, ["primary_sponsor", "fee_category"], as_dict=True)
		self.assertFalse(student.primary_sponsor)
		self.assertEqual(student.fee_category, "Standard")
		with self.assertRaises(frappe.ValidationError):
			church.set_sponsorship_status(s1.name, "Proposed")

	def test_sponsor_payment_updates_rollups(self):
		from mahanaim.tests import factories_b3 as fb3

		sp = fb.make_sponsor("Remitting Sponsor _T")
		name = f.make_student("Ruth", "Remitted _T", programme=self.programme, campus=self.campus).name
		ship = fb.make_sponsorship(sp.name, name, amount=30000)
		pay = fb3.make_payment(name, amount=12000, mode="Sponsor Remittance", submit=False)
		pay.sponsor = sp.name
		pay.submit()
		self.assertEqual(frappe.db.get_value("Sponsorship", ship.name, "amount_disbursed"), 12000)
		self.assertEqual(frappe.db.get_value("Sponsor", sp.name, "total_disbursed"), 12000)
		pay.cancel()
		self.assertEqual(frappe.db.get_value("Sponsorship", ship.name, "amount_disbursed"), 0)
		self.assertEqual(frappe.db.get_value("Sponsor", sp.name, "total_disbursed"), 0)

	def test_sponsor_sees_only_sponsored_students(self):
		sp, user = fb.make_sponsor_with_user("Portal Sponsor _T")
		fb.make_sponsorship(sp.name, self.student, amount=15000)
		frappe.set_user(user)
		with patch("mahanaim.services.fees.get_balances", return_value={self.student: 4500.0}, create=True):
			students = sponsor.my_students()["data"]
		self.assertEqual([s["student"] for s in students], [self.student])
		progress = sponsor.student_progress(self.student)
		self.assertEqual(progress["student"]["name"], self.student)
		with self.assertRaises(frappe.PermissionError):
			sponsor.student_progress(self.other_student)
		frappe.set_user("Administrator")
		someone_else = fb.make_sponsor("Someone Else _T").name
		frappe.set_user(user)
		# A sponsor cannot "preview" another sponsor's portal: `sponsor=` is ignored for non-staff.
		self.assertEqual(sponsor.my_sponsor_profile(sponsor=someone_else)["profile"]["name"], sp.name)

	def test_non_sponsor_cannot_use_portal(self):
		frappe.set_user(f.make_user(roles=("Student",)).name)
		with self.assertRaises(frappe.PermissionError):
			sponsor.my_students()

	def test_giving_record_validation(self):
		base = {
			"doctype": "Giving Record",
			"giving_type": self.giving_type,
			"posting_date": frappe.utils.nowdate(),
		}
		with self.assertRaises(frappe.ValidationError):
			frappe.get_doc(
				{**base, "giver_type": "Other", "giver_name": "X", "amount": 0, "mode_of_payment": "Cash"}
			).insert(ignore_permissions=True)
		with self.assertRaises(frappe.ValidationError):
			frappe.get_doc(
				{**base, "giver_type": "Sponsor", "amount": 100, "mode_of_payment": "Cash"}
			).insert(ignore_permissions=True)
		doc = frappe.get_doc(
			{
				**base,
				"giver_type": "Other",
				"giver_name": "Jane Doe",
				"amount": 1000,
				"mode_of_payment": "M-Pesa",
				"reference_no": "qwe123rty",
			}
		).insert(ignore_permissions=True)
		doc.submit()
		self.assertEqual(doc.reference_no, "QWE123RTY")
		with self.assertRaises(frappe.DuplicateEntryError):
			frappe.get_doc(
				{
					**base,
					"giver_type": "Anonymous",
					"amount": 50,
					"mode_of_payment": "M-Pesa",
					"reference_no": "QWE123RTY",
				}
			).insert(ignore_permissions=True)

	def test_public_giving_flow(self):
		options = church.giving_options()
		self.assertIn(self.giving_type, [t["name"] for t in options["types"]])
		self.assertEqual(options["currency"], "KES")
		frappe.set_user("Guest")
		with patch("mahanaim.services.mpesa.initiate_payment", side_effect=fake_initiate) as pay:
			with self.assertRaises(frappe.ValidationError):
				church.give(self.giving_type, 500, "0800 000 000", full_name="Bad Phone")
			with self.assertRaises(frappe.ValidationError):
				church.give(self.giving_type, 0, "0712345678", full_name="Zero")
			with self.assertRaises(frappe.ValidationError):
				church.give(self.giving_type, 100, "0712345678")  # name required unless anonymous
			self.assertIsNone(church.give(self.giving_type, 100, "0712345678", website="bot")["request"])
			other_sponsor = fb.make_sponsor("Not Yours _T").name
			res = church.give(
				self.giving_type,
				1500,
				"+254 712 345 678",
				full_name="Mary Wanjiku",
				email="Mary@Example.com",
				note="For the library",
				sponsor=other_sponsor,
			)
		self.assertEqual(pay.call_count, 1)
		self.assertEqual(pay.call_args.args[2], "Giving")
		self.assertIsNone(pay.call_args.kwargs.get("sponsor"))  # guests cannot attribute gifts to a sponsor
		self.assertEqual(set(res) >= {"request", "checkout_request_id", "message"}, True)
		state = church.giving_status(res["request"])
		self.assertEqual((state["status"], state["done"]), ("Pending", False))

		frappe.db.set_value(
			"M-Pesa Request", res["request"], {"status": "Completed", "mpesa_receipt_number": "TGV12345XY"}
		)
		self.assertIsNone(church.giving_status(res["request"])["receipt"])
		state = church.giving_status(res["request"], checkout_request_id=res["checkout_request_id"])
		self.assertEqual((state["status"], state["receipt"]), ("Completed", "TGV12345XY"))
		frappe.set_user("Administrator")
		records = frappe.get_all(
			"Giving Record",
			filters={"mpesa_request": res["request"], "docstatus": 1},
			fields=[
				"name",
				"amount",
				"giver_type",
				"giver_name",
				"giver_email",
				"reference_no",
				"giving_type",
				"purpose",
			],
		)
		self.assertEqual(len(records), 1)
		rec = records[0]
		self.assertEqual(
			(
				rec.amount,
				rec.giver_type,
				rec.giver_name,
				rec.giver_email,
				rec.reference_no,
				rec.giving_type,
				rec.purpose,
			),
			(
				1500,
				"Other",
				"Mary Wanjiku",
				"mary@example.com",
				"TGV12345XY",
				self.giving_type,
				"For the library",
			),
		)
		# Callback hook, cron and later polls are idempotent.
		self.assertEqual(svc.on_mpesa_success(res["request"]), rec.name)
		self.assertEqual(svc.reconcile_online_giving(), 0)
		self.assertEqual(frappe.db.count("Giving Record", {"mpesa_request": res["request"]}), 1)

	def test_giving_status_hides_other_purposes(self):
		req = fake_initiate("254712345678", 100, "Student Fees")["request"]
		frappe.set_user("Guest")
		with self.assertRaises(frappe.DoesNotExistError):
			church.giving_status(req)

	def test_church_tree_and_dashboard(self):
		group = frappe.get_doc(
			{
				"doctype": "Partner Church",
				"church_name": "Denomination HQ _T",
				"is_group": 1,
				"church_type": "Headquarters",
			}
		).insert(ignore_permissions=True)
		frappe.get_doc(
			{"doctype": "Partner Church", "church_name": "Branch One _T", "parent_partner_church": group.name}
		).insert(ignore_permissions=True)
		leaf = frappe.get_doc({"doctype": "Partner Church", "church_name": "Leaf _T"}).insert(
			ignore_permissions=True
		)
		with self.assertRaises(frappe.ValidationError):
			frappe.get_doc(
				{
					"doctype": "Partner Church",
					"church_name": "Under leaf _T",
					"parent_partner_church": leaf.name,
				}
			).insert(ignore_permissions=True)
		tree = church.list_churches(tree=1)["data"]
		hq = next(c for c in tree if c["name"] == group.name)
		self.assertEqual([c["name"] for c in hq["children"]], ["Branch One _T"])
		dash = church.church_dashboard()
		self.assertIn("kpis", dash)

	def test_send_sponsor_reports(self):
		user = f.make_user("report.sponsor.b4@example.com", roles=("Sponsor",), first_name="Sponsor").name
		sp = fb.make_sponsor("Report Sponsor _T", email=user, user=user).name
		fb.make_sponsorship(sp, self.other_student)
		idle = fb.make_sponsor("Idle Report Sponsor _T").name
		with (
			patch.object(svc, "student_balances", return_value={self.other_student: 12500.0}),
			patch("mahanaim.services.communication.notify") as notify,
		):
			self.assertEqual(svc.send_sponsor_reports(sp), {"sent": 1, "skipped": 0, "sponsors": [sp]})
		kwargs = notify.call_args.kwargs
		self.assertEqual(notify.call_args.args[0], "Sponsor Report")
		self.assertEqual((kwargs["doc"].name, kwargs["link"]), (sp, "/sponsor"))
		self.assertEqual(kwargs["context"], {"students": 1, "outstanding": "KES 12,500.00"})
		self.assertEqual(kwargs["recipients"][0]["user"], user)
		self.assertIn("KES 12,500.00", kwargs["fallback"]["message"])
		self.assertEqual(svc.send_sponsor_reports(idle), {"sent": 0, "skipped": 1, "sponsors": []})

		svc.send_sponsor_reports(sp)
		self.assertTrue(frappe.db.exists("Message Log", {"event": "Sponsor Report", "recipient": user}))
		self.assertTrue(frappe.db.exists("Portal Notification", {"user": user, "link": "/sponsor"}))

		frappe.set_user(f.make_user("church.finance.b4@example.com", roles=("Finance Officer",)).name)
		self.assertEqual(church.send_sponsor_reports(sponsor=sp)["sent"], 1)
		self.assertTrue(church.send_sponsor_reports()["queued"])
		with self.assertRaises(frappe.DoesNotExistError):
			church.send_sponsor_reports(sponsor="No Such Sponsor _T")
		frappe.set_user(f.make_user("church.student.b4@example.com", roles=("Student",)).name)
		with self.assertRaises(frappe.PermissionError):
			church.send_sponsor_reports(sponsor=sp)

	def test_my_chapel_is_scoped_to_the_student(self):
		from frappe.utils import add_days, getdate, nowdate

		elsewhere = f.make_campus("Chapel Campus _T", "CCT").name
		student_user = frappe.db.get_value("Student", self.student, "user")
		today = getdate(nowdate())

		def service(days, campus=None, status="Held", rows=(), **extra):
			return (
				frappe.get_doc(
					{
						"doctype": "Chapel Service",
						"service_date": add_days(today, days),
						"service_type": "Chapel",
						"campus": campus or self.campus,
						"status": status,
						"attendance": [{"student": s, "status": st} for s, st in rows],
						**extra,
					}
				)
				.insert(ignore_permissions=True)
				.name
			)

		def mine():
			frappe.set_user(student_user)
			try:
				return church.my_chapel()
			finally:
				frappe.set_user("Administrator")

		with patch("mahanaim.utils.current_term", return_value=None):
			base = mine()["attendance"]
			upcoming = service(
				2,
				status="Scheduled",
				theme="Faith That Works _T",
				start_time="10:00:00",
				venue="Main Chapel _T",
				preacher="Rev. Amos _T",
			)
			hidden = [
				service(20, status="Scheduled"),
				service(3, status="Cancelled"),
				service(2, campus=elsewhere, status="Scheduled"),
			]
			s = {
				"present": service(-1, rows=[(self.student, "Present"), (self.other_student, "Present")]),
				"absent": service(-2, rows=[(self.other_student, "Present")]),
				"excused": service(-3, rows=[(self.student, "Excused")]),
				"no_roll": service(-4),
				"away": service(-5, campus=elsewhere, rows=[(self.student, "Present")]),
				"not_mine": service(-6, campus=elsewhere, rows=[(self.other_student, "Present")]),
			}
			group = frappe.get_doc(
				{
					"doctype": "Ministry Group",
					"group_name": f"Chapel Choir {random_string(4)} _T",
					"group_type": "Choir",
					"is_active": 1,
					"members": [{"student": self.student, "role": "Secretary"}],
				}
			).insert(ignore_permissions=True)
			data = mine()

		cards = {r["name"]: r for r in data["upcoming"]}
		self.assertIn(upcoming, cards)
		self.assertFalse(set(hidden) & set(cards))
		card = cards[upcoming]
		self.assertEqual(
			(card["title"], card["venue"], card["speaker"], str(card["start_time"])),
			("Faith That Works _T", "Main Chapel _T", "Rev. Amos _T", "10:00:00"),
		)
		att = data["attendance"]
		records = {r["name"]: r["attendance"] for r in att["records"]}
		self.assertEqual(
			{k: records.get(v) for k, v in s.items()},
			{
				"present": "Present",
				"absent": "Absent",
				"excused": "Excused",
				"no_roll": None,
				"away": "Present",
				"not_mine": None,
			},
		)
		delta = {k: att[k] - base[k] for k in ("attended", "excused", "absent", "held")}
		self.assertEqual(delta, {"attended": 2, "excused": 1, "absent": 1, "held": 4})
		counted = att["held"] - att["excused"]
		self.assertEqual(att["percent"], round(att["attended"] * 100.0 / counted, 1))
		self.assertEqual(
			[(m["group"], m["role"]) for m in data["ministries"] if m["group"] == group.name],
			[(group.name, "Secretary")],
		)
		self.assertNotIn(self.other_student, frappe.as_json(data))
		frappe.set_user(f.make_user("church.student.b4@example.com", roles=("Student",)).name)
		with self.assertRaises(frappe.PermissionError):
			church.my_chapel()

	def test_sponsor_fee_totals_and_invoice_limit(self):
		from mahanaim.tests import factories_b3 as fin

		st = f.make_student(
			"Faith", "Fees _T", programme=self.programme, campus=self.campus, create_user=False
		).name
		for amount in (8000, 7000, 9000):
			fin.make_invoice(st, amount=amount)
		fin.make_payment(st, amount=5000)
		fin.make_adjustment(st, amount=1000)
		sp, user = fb.make_sponsor_with_user("Fees Sponsor _T")
		fb.make_sponsorship(sp.name, st, amount=10000)
		frappe.set_user(user)
		data = sponsor.my_students()
		row = next(r for r in data["data"] if r["student"] == st)
		expected = {"invoiced": 24000, "paid": 5000, "adjustments": 1000, "balance": 18000}
		self.assertEqual({k: row["fees"][k] for k in expected}, expected)
		self.assertEqual(row["fee_balance"], 18000)
		self.assertEqual(row["fees"]["currency"], "KES")
		self.assertEqual({k: data["totals"][k] for k in expected}, expected)

		def invoices(**kwargs):
			fees = sponsor.student_progress(st, **kwargs)["fees"]
			return len(fees["invoices"]), fees["invoice_total_count"], fees["invoiced"]

		self.assertEqual(invoices(), (3, 3, 24000))
		self.assertEqual(invoices(invoice_limit=2), (2, 3, 24000))
		self.assertEqual(invoices(invoice_limit="500"), (3, 3, 24000))

	def test_public_partner_churches(self):
		def church_doc(name, **extra):
			return frappe.get_doc(
				{
					"doctype": "Partner Church",
					"church_name": name,
					"denomination": "Pentecostal",
					"town": "Kasarani",
					"county": "Nairobi",
					"partnership_status": "Active",
					"phone": "0700111222",
					"email": "pastor.private@example.com",
					**extra,
				}
			).insert(ignore_permissions=True)

		active = church_doc("Zion Kasarani Fellowship _T").name
		church_doc("Zion Prospect Chapel _T", partnership_status="Prospect")
		church_doc("Zion Region _T", is_group=1)
		frappe.set_user("Guest")
		rows = church.partner_churches(search="zion")
		self.assertEqual([r["name"] for r in rows], [active])
		self.assertEqual(set(rows[0]), {"name", "church_name", "denomination", "town", "county"})
		self.assertIn(active, [r["name"] for r in church.partner_churches(search="Kasarani", limit=500)])
		self.assertLessEqual(len(church.partner_churches(limit=500)), church.PUBLIC_CHURCH_MAX)
		self.assertEqual(len(church.partner_churches(limit=1)), 1)

	def test_read_gates_match_doctype_permissions(self):
		from mahanaim.api import library

		gates = {
			church.CHAPEL_READ_ROLES: ("Chapel Service", "Ministry Group"),
			church.READ_ROLES: ("Giving Record", "Giving Type", "Sponsorship"),
			(*church.READ_ROLES, church.ROLE_ADMISSIONS): ("Sponsor",),
			(*church.CHURCH_EDIT_ROLES, *church.READ_ROLES): ("Partner Church",),
			library.READ_ROLES: ("Library Item", "Library Loan"),
		}
		self.assertNotIn(church.ROLE_FINANCE, church.CHAPEL_READ_ROLES)
		for roles, doctypes in gates.items():
			for dt in doctypes:
				readers = {p.role for p in frappe.get_meta(dt).permissions if p.read and not p.permlevel}
				self.assertFalse(
					set(roles) - readers, f"{dt} lacks a read DocPerm for {set(roles) - readers}"
				)

	def test_registrar_and_auditor_read_chapel_loans_and_giving(self):
		from frappe.utils import nowdate

		from mahanaim.api import library

		service = frappe.get_doc(
			{
				"doctype": "Chapel Service",
				"service_date": nowdate(),
				"service_type": "Chapel",
				"campus": self.campus,
				"status": "Scheduled",
			}
		).insert(ignore_permissions=True)
		group = frappe.get_doc(
			{"doctype": "Ministry Group", "group_name": f"Worship Team {random_string(4)} _T"}
		).insert(ignore_permissions=True)
		item = fb.make_library_item(f"Gate Check {random_string(4)} _T", copies=2).name
		loan = fb.make_loan(item, self.student).name
		for email, role in (
			("church.registrar.b4@example.com", "Registrar"),
			("church.auditor.b4@example.com", "Auditor"),
		):
			frappe.set_user(f.make_user(email, roles=(role,)).name)
			listed = church.list_chapel_services(from_date=nowdate(), to_date=nowdate(), page_length=500)
			self.assertIn(service.name, [r.name for r in listed["data"]])
			self.assertEqual(church.get_chapel_service(service.name)["name"], service.name)
			groups = church.list_ministry_groups(search=group.group_name)["data"]
			self.assertEqual([r.name for r in groups], [group.name])
			self.assertEqual(church.get_ministry_group(group.name)["name"], group.name)
			loans = library.list_loans(library_item=item)
			self.assertEqual([r.name for r in loans["data"]], [loan])
			self.assertEqual(library.get_loan(loan)["item"]["name"], item)
			self.assertIn("totals", church.list_giving())
			frappe.set_user("Administrator")

		frappe.set_user(f.make_user("church.finance.b4@example.com", roles=("Finance Officer",)).name)
		for call in (
			church.list_chapel_services,
			church.list_ministry_groups,
			lambda: church.get_chapel_service(service.name),
			lambda: church.get_ministry_group(group.name),
		):
			with self.assertRaises(frappe.PermissionError):
				call()
		self.assertIn(
			item, [r.name for r in library.list_items(search="Gate Check", page_length=100)["data"]]
		)
		self.assertEqual(library.get_item(item)["name"], item)

	def test_record_giving_accepts_giver_email(self):
		frappe.set_user(f.make_user("church.finance.b4@example.com", roles=("Finance Officer",)).name)
		doc = church.record_giving(
			frappe.as_json(
				{
					"giving_type": self.giving_type,
					"giver_type": "Other",
					"giver_name": "Walk-in Giver _T",
					"giver_email": "  Walk.In.Giver@Example.COM ",
					"amount": 750,
					"mode_of_payment": "Cash",
				}
			)
		)
		self.assertEqual(doc["docstatus"], 1)
		self.assertEqual(doc["giver_email"], "walk.in.giver@example.com")
		receipt_to = frappe.get_doc("Giving Record", doc["name"]).receipt_recipient()
		self.assertEqual(receipt_to["email"], "walk.in.giver@example.com")
		rows = church.list_giving(search="walk.in.giver@")["data"]
		self.assertEqual(
			[(r.name, r.giver_email) for r in rows], [(doc["name"], "walk.in.giver@example.com")]
		)
		with self.assertRaises(frappe.ValidationError):
			church.record_giving(
				{
					"giving_type": self.giving_type,
					"giver_type": "Other",
					"giver_name": "Bad Email _T",
					"giver_email": "not-an-email",
					"amount": 100,
					"mode_of_payment": "Cash",
				}
			)
