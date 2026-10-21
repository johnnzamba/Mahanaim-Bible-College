from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, getdate, random_string, today

from mahanaim.services import fees
from mahanaim.tests import factories as f
from mahanaim.tests import factories_b3 as fb

SETTINGS_KEYS = (
	"current_academic_term",
	"exam_fee_clearance_percent",
	"lms_fee_clearance_percent",
	"transcript_requires_fee_clearance",
	"payment_terms_days",
	"post_to_erpnext",
)


def ledger(voucher_type, voucher_no):
	return frappe.get_all(
		"Student Ledger Entry",
		filters={"voucher_type": voucher_type, "voucher_no": voucher_no},
		fields=["debit", "credit", "is_cancelled"],
	)


class TestFees(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.term = f.make_term().name
		cls.term2 = f.make_term("Term 2", start=add_days(today(), 120)).name
		cls.campus = f.make_campus().name
		cls.campus2 = f.make_campus("Second Campus _T", "SCT").name
		cls.programme = f.make_programme("TFEE", "Diploma in Fees _T").name
		cls.saved = {k: frappe.db.get_single_value("Mahanaim Settings", k) for k in SETTINGS_KEYS}
		fb.set_settings(current_academic_term=cls.term, post_to_erpnext=0, payment_terms_days=30)
		fb.make_component("Tuition _T")
		fb.make_component("Library _T", component_type="Library")

	@classmethod
	def tearDownClass(cls):
		fb.set_settings(**{k: v for k, v in cls.saved.items()})
		super().tearDownClass()

	def setUp(self):
		frappe.set_user("Administrator")
		self.notify = patch("mahanaim.services.communication.notify").start()
		self.addCleanup(patch.stopall)

	def student(self, **kw):
		return f.make_student(
			programme=kw.pop("programme", self.programme), campus=kw.pop("campus", self.campus), **kw
		)

	# ------------------------------------------------------------------ fee structures
	def test_fee_structure_match_specificity(self):
		generic = fb.make_structure(self.programme, (("Tuition _T", 1000),))
		by_campus = fb.make_structure(self.programme, (("Tuition _T", 2000),), campus=self.campus)
		by_term = fb.make_structure(
			self.programme,
			(("Tuition _T", 3000),),
			campus=self.campus,
			study_mode="Full Time",
			academic_term=self.term,
		)
		inactive = fb.make_structure(
			self.programme,
			(("Tuition _T", 4000),),
			campus=self.campus,
			study_mode="Full Time",
			academic_term=self.term,
			year_of_study=1,
		)
		frappe.db.set_value("Fee Structure", inactive.name, "is_active", 0)

		student = self.student()
		self.assertEqual(fees.find_fee_structure(student.name, self.term), by_term.name)
		self.assertEqual(fees.find_fee_structure(student.name, self.term2), by_campus.name)
		other = self.student(campus=self.campus2)
		self.assertEqual(fees.find_fee_structure(other.name, self.term), generic.name)
		self.assertEqual(
			by_term.academic_year, frappe.db.get_value("Academic Term", self.term, "academic_year")
		)

	def test_fee_structure_validation(self):
		with self.assertRaises(frappe.ValidationError):
			fb.make_structure(self.programme, (("Tuition _T", 1000), ("Tuition _T", 500)))
		with self.assertRaises(frappe.ValidationError):
			fb.make_structure(
				self.programme,
				(("Tuition _T", 1000),),
				installments=[{"label": "1", "amount": 400}, {"label": "2", "amount": 500}],
			)
		fs = fb.make_structure(
			self.programme,
			(("Tuition _T", 1000), ("Library _T", 0.1)),
			installments=[
				{"label": "1", "percent": 60, "due_days": 0},
				{"label": "2", "percent": 40, "due_days": 30},
			],
		)
		self.assertEqual(fs.total_amount, 1000.1)
		self.assertEqual([r.amount for r in fs.installments], [600.06, 400.04])

	# ------------------------------------------------------------------ invoices
	def test_invoice_submit_and_cancel_ledger(self):
		student = self.student()
		fs = fb.make_structure(
			self.programme, (("Tuition _T", 7000.55), ("Library _T", 2999.45)), academic_term=self.term2
		)
		inv = fb.make_invoice(student.name, term=self.term2, fee_structure=fs.name)
		self.assertEqual(inv.total_amount, 10000)
		self.assertEqual(len(inv.items), 2)
		self.assertEqual((inv.status, inv.outstanding_amount), ("Unpaid", 10000))
		self.assertEqual(
			ledger("Student Invoice", inv.name), [{"debit": 10000, "credit": 0, "is_cancelled": 0}]
		)
		self.assertEqual(fees.get_student_balance(student.name), 10000)
		self.assertEqual(frappe.db.get_value("Student", student.name, "fee_balance"), 10000)
		self.assertTrue(any(c.args[0] == "Invoice Issued" for c in self.notify.call_args_list))

		with self.assertRaises(frappe.DuplicateEntryError):
			fb.make_invoice(student.name, term=self.term2, fee_structure=fs.name)

		inv.reload()
		inv.cancel()
		self.assertEqual(ledger("Student Invoice", inv.name)[0].is_cancelled, 1)
		self.assertEqual(frappe.db.get_value("Student Invoice", inv.name, "status"), "Cancelled")
		self.assertEqual(fees.get_student_balance(student.name), 0)
		self.assertEqual(frappe.db.get_value("Student", student.name, "fee_balance"), 0)

	def test_invoice_cancel_blocked_by_allocation(self):
		student = self.student()
		inv = fb.make_invoice(student.name, 5000, term=self.term)
		pay = fb.make_payment(student.name, 2000)
		inv.reload()
		with self.assertRaises(frappe.LinkExistsError):
			inv.cancel()
		pay.reload()
		pay.cancel()
		inv.reload()
		inv.cancel()
		self.assertEqual(fees.get_student_balance(student.name), 0)

	def test_overdue_marking(self):
		student = self.student()
		inv = fb.make_invoice(
			student.name,
			3000,
			term=self.term,
			posting_date=add_days(today(), -40),
			due_date=add_days(today(), -10),
		)
		self.assertEqual(inv.status, "Overdue")
		frappe.db.set_value("Student Invoice", inv.name, "status", "Unpaid")
		self.assertGreaterEqual(fees.mark_overdue_invoices(), 1)
		self.assertEqual(frappe.db.get_value("Student Invoice", inv.name, "status"), "Overdue")

	# ------------------------------------------------------------------ payments
	def test_fifo_allocation_and_overpayment_credit(self):
		student = self.student()
		older = fb.make_invoice(student.name, 6000, term=self.term, posting_date=add_days(today(), -20))
		newer = fb.make_invoice(student.name, 4000.5, term=self.term2)
		pay = fb.make_payment(
			student.name, 12000.75, mode="Bank Transfer", reference_no=f"BNK{random_string(6)}"
		)
		self.assertEqual(
			[(a.invoice, a.allocated_amount) for a in pay.allocations],
			[(older.name, 6000), (newer.name, 4000.5)],
		)
		self.assertEqual((pay.allocated_amount, pay.unallocated_amount), (10000.5, 2000.25))
		self.assertEqual(pay.status, "Confirmed")
		for name in (older.name, newer.name):
			self.assertEqual(
				frappe.db.get_value("Student Invoice", name, ["status", "outstanding_amount"]), ("Paid", 0)
			)
		self.assertEqual(fees.get_student_balance(student.name), -2000.25)

		# existing credit is applied to the next invoice automatically
		third = fb.make_invoice(student.name, 5000, term=self.term2, component="Library _T")
		self.assertEqual(
			(third.credit_applied, third.outstanding_amount, third.status), (2000.25, 2999.75, "Partly Paid")
		)
		self.assertEqual(fees.get_student_balance(student.name), 2999.75)

	def test_allocation_validation(self):
		student = self.student()
		inv = fb.make_invoice(student.name, 1000, term=self.term)
		with self.assertRaises(frappe.ValidationError):
			fb.make_payment(student.name, 2000, allocations=[{"invoice": inv.name, "allocated_amount": 1500}])
		with self.assertRaises(frappe.ValidationError):
			fb.make_payment(student.name, 500, allocations=[{"invoice": inv.name, "allocated_amount": 800}])
		other = self.student()
		with self.assertRaises(frappe.ValidationError):
			fb.make_payment(other.name, 500, allocations=[{"invoice": inv.name, "allocated_amount": 500}])
		with self.assertRaises(frappe.ValidationError):
			fb.make_payment(student.name, 0)

	def test_payment_cancel_reverses_everything(self):
		student = self.student()
		inv = fb.make_invoice(student.name, 10000, term=self.term)
		pay = fb.make_payment(student.name, 3000.3)
		self.assertEqual(
			frappe.db.get_value("Student Invoice", inv.name, ["paid_amount", "outstanding_amount", "status"]),
			(3000.3, 6999.7, "Partly Paid"),
		)
		self.assertEqual(
			ledger("Student Payment", pay.name), [{"debit": 0, "credit": 3000.3, "is_cancelled": 0}]
		)
		pay.reload()
		pay.cancel()
		self.assertEqual(ledger("Student Payment", pay.name)[0].is_cancelled, 1)
		self.assertEqual(
			frappe.db.get_value("Student Invoice", inv.name, ["paid_amount", "outstanding_amount", "status"]),
			(0, 10000, "Unpaid"),
		)
		self.assertEqual(frappe.db.get_value("Student Payment", pay.name, "status"), "Cancelled")
		self.assertEqual(frappe.db.get_value("Student", student.name, "fee_balance"), 10000)

	def test_duplicate_reference_rejected(self):
		student = self.student()
		ref = f"QX{random_string(8).upper()}"
		fb.make_payment(student.name, 100, mode="M-Pesa", reference_no=ref)
		with self.assertRaises(frappe.DuplicateEntryError):
			fb.make_payment(student.name, 100, mode="M-Pesa", reference_no=ref.lower())
		# same reference on a different mode is a different instrument
		fb.make_payment(student.name, 100, mode="Cheque", reference_no=ref)

	def test_application_fee_payment_calls_admissions(self):
		app = fb.make_application(programme=self.programme, campus=self.campus)
		with patch("mahanaim.services.admissions.mark_application_fee_paid", create=True) as mark:
			pay = fb.make_payment(payment_for="Application Fee", application=app.name, amount=1000)
		mark.assert_called_once_with(app.name, pay.name)
		self.assertFalse(ledger("Student Payment", pay.name))

	# ------------------------------------------------------------------ adjustments / refunds
	def test_adjustment_credit_and_debit(self):
		student = self.student()
		inv = fb.make_invoice(student.name, 10000, term=self.term)
		credit = fb.make_adjustment(student.name, "Scholarship", 2500.5, invoice=inv.name)
		self.assertEqual(ledger("Fee Adjustment", credit.name)[0].credit, 2500.5)
		self.assertEqual(
			frappe.db.get_value("Student Invoice", inv.name, ["credit_applied", "outstanding_amount"]),
			(2500.5, 7499.5),
		)
		debit = fb.make_adjustment(student.name, "Penalty", 500)
		self.assertEqual(ledger("Fee Adjustment", debit.name)[0].debit, 500)
		self.assertEqual(fees.get_student_balance(student.name), 7999.5)
		with self.assertRaises(frappe.ValidationError):
			fb.make_adjustment(student.name, "Waiver", 9000, invoice=inv.name)
		credit.reload()
		credit.cancel()
		self.assertEqual(frappe.db.get_value("Student Invoice", inv.name, "outstanding_amount"), 10000)
		self.assertEqual(fees.get_student_balance(student.name), 10500)

	def test_refund_flow(self):
		student = self.student()
		fb.make_invoice(student.name, 1000, term=self.term)
		fb.make_payment(student.name, 3000)
		self.assertEqual(fees.get_student_balance(student.name), -2000)
		with self.assertRaises(frappe.ValidationError):
			frappe.get_doc(
				{
					"doctype": "Refund Request",
					"student": student.name,
					"amount": 2500,
					"reason": "Overpaid",
					"refund_mode": "M-Pesa",
				}
			).insert()
		rr = frappe.get_doc(
			{
				"doctype": "Refund Request",
				"student": student.name,
				"amount": 1500,
				"reason": "Overpaid",
				"refund_mode": "M-Pesa",
			}
		).insert()
		self.assertEqual(rr.status, "Pending")
		rr.status = "Paid"
		with self.assertRaises(frappe.ValidationError):
			rr.save()  # must be approved first
		rr.reload()
		rr.status = "Approved"
		rr.save()
		rr.status, rr.reference_no = "Paid", "RFX123"
		rr.save()
		self.assertEqual(ledger("Refund Request", rr.name)[0].debit, 1500)
		self.assertEqual(fees.get_student_balance(student.name), -500)

	def test_student_refund_requests(self):
		from mahanaim.api import finance

		student, other = self.student(), self.student()
		fb.make_invoice(student.name, 1000, term=self.term)
		fb.make_payment(student.name, 3000)  # 2000 in credit
		fb.make_payment(other.name, 500)
		try:
			frappe.set_user(other.user)
			other_request = finance.request_refund(200, "Overpaid")["name"]
			frappe.set_user(student.user)
			for amount in (0, -5, "abc", 2000.01):
				with self.assertRaises(frappe.ValidationError):
					finance.request_refund(amount, "Overpaid")
			first = finance.request_refund(1200, "Overpaid", account_details="0712345678")
			self.assertEqual((first["amount"], first["status"]), (1200, "Pending"))
			with self.assertRaises(frappe.ValidationError):
				finance.request_refund(100, "Again")  # one open request at a time
			summary = finance.my_fees()
			self.assertEqual(summary["refund_available"], 800)
			self.assertEqual([r["name"] for r in summary["refunds"]], [first["name"]])

			frappe.set_user("Administrator")
			finance.decide_refund(first["name"], "Rejected", remarks="Carry forward")
			frappe.set_user(student.user)
			second = finance.request_refund(2000, "Overpaid")
			rows = finance.my_refunds()
			self.assertEqual([r["name"] for r in rows], [second["name"], first["name"]])
			self.assertNotIn(other_request, [r["name"] for r in rows])
			self.assertEqual(rows[1]["status"], "Rejected")
			self.assertTrue(rows[1]["decided_on"])
			self.assertNotIn("remarks", rows[1])

			frappe.set_user("Administrator")
			finance.decide_refund(second["name"], "Approved")
			finance.decide_refund(second["name"], "Paid", reference_no="RFX9")
			frappe.set_user(student.user)
			row = finance.my_refunds()[0]
			self.assertEqual((row["status"], row["reference_no"], row["amount"]), ("Paid", "RFX9", 2000))
			self.assertEqual(finance.my_fees()["refund_available"], 0)
			with self.assertRaises(frappe.ValidationError):
				finance.request_refund(1, "More")  # no credit left
		finally:
			frappe.set_user("Administrator")

	# ------------------------------------------------------------------ balance / clearance
	def test_balance_and_fee_clearance(self):
		fb.set_settings(
			exam_fee_clearance_percent=60, lms_fee_clearance_percent=30, transcript_requires_fee_clearance=1
		)
		student = self.student()
		self.assertEqual(fees.fee_clearance(student.name, "exam")["paid_percent"], 100)
		self.assertTrue(fees.fee_clearance(student.name, "exam")["cleared"])

		fb.make_invoice(student.name, 10000, term=self.term)
		fb.make_payment(student.name, 5000)
		exam, lms = fees.fee_clearance(student.name, "exam"), fees.fee_clearance(student.name, "lms")
		self.assertEqual((exam["paid_percent"], exam["required_percent"], exam["cleared"]), (50, 60, False))
		self.assertTrue(lms["cleared"])
		self.assertEqual(exam["balance"], 5000)
		self.assertIn("60", exam["message"])

		fb.make_payment(student.name, 1000)
		self.assertTrue(fees.fee_clearance(student.name, "exam")["cleared"])
		transcript = fees.fee_clearance(student.name, "transcript")
		self.assertEqual((transcript["required_percent"], transcript["cleared"]), (100, False))
		# only current-term debt: registration is not blocked
		self.assertTrue(fees.fee_clearance(student.name, "registration")["cleared"])

		fb.set_settings(transcript_requires_fee_clearance=0)
		self.assertTrue(fees.fee_clearance(student.name, "transcript")["cleared"])
		fb.set_settings(transcript_requires_fee_clearance=1)

	def test_registration_blocked_by_previous_term_arrears(self):
		student = self.student()
		fb.make_invoice(student.name, 4000, term=self.term2)
		reg = fees.fee_clearance(student.name, "registration")
		self.assertEqual((reg["required_percent"], reg["cleared"]), (100, False))

	def test_full_sponsorship_clears(self):
		if not frappe.db.table_exists("Sponsorship"):
			self.skipTest("Sponsorship doctype not installed")
		student = self.student()
		fb.make_invoice(student.name, 10000, term=self.term)
		self.assertFalse(fees.fee_clearance(student.name, "exam")["cleared"])
		sp = frappe.get_doc(
			{
				"doctype": "Sponsorship",
				"sponsor": "Sponsor _T",
				"student": student.name,
				"status": "Active",
				"coverage": "Full Fees",
			}
		)
		sp.set_new_name()
		sp.db_insert()
		result = fees.fee_clearance(student.name, "exam")
		self.assertTrue(result["cleared"] and result["sponsored"])

	# ------------------------------------------------------------------ registration invoicing
	def test_create_invoice_for_registration_idempotent(self):
		student = self.student()
		fs = fb.make_structure(
			self.programme, (("Tuition _T", 15000),), academic_term=self.term, campus=self.campus
		)
		reg = fb.make_registration(student.name, self.term)
		name = fees.create_invoice_for_registration(reg.name)
		self.assertTrue(name)
		inv = frappe.get_doc("Student Invoice", name)
		self.assertEqual(
			(inv.docstatus, inv.fee_structure, inv.total_amount, inv.semester_registration),
			(1, fs.name, 15000, reg.name),
		)
		self.assertEqual(getdate(inv.due_date), getdate(add_days(inv.posting_date, 30)))
		self.assertEqual(frappe.db.get_value("Semester Registration", reg.name, "fee_invoice"), name)
		self.assertEqual(fees.create_invoice_for_registration(reg.name), name)
		self.assertEqual(
			fees.create_invoice_for_registration(frappe.get_doc("Semester Registration", reg.name)), name
		)
		self.assertEqual(frappe.db.count("Student Invoice", {"student": student.name, "docstatus": 1}), 1)

	def test_create_invoice_for_registration_without_structure(self):
		programme = f.make_programme("TNOS", "No Structure Programme _T").name
		student = f.make_student(programme=programme, campus=self.campus)
		reg = fb.make_registration(student.name, self.term)
		self.assertIsNone(fees.create_invoice_for_registration(reg.name))

	def test_bulk_invoice_idempotent(self):
		programme = f.make_programme("TBLK", "Bulk Programme _T").name
		fb.make_structure(programme, (("Tuition _T", 800),), academic_term=self.term)
		students = [f.make_student(programme=programme, campus=self.campus).name for _i in range(3)]
		first = fees.bulk_invoice(self.term, programme=programme)
		self.assertEqual(first["created_count"], 3)
		second = fees.bulk_invoice(self.term, programme=programme)
		self.assertEqual(second["created_count"], 0)
		self.assertEqual(frappe.db.count("Student Invoice", {"student": ["in", students], "docstatus": 1}), 3)

	# ------------------------------------------------------------------ reminders / statement
	def test_fee_reminders_rate_limited(self):
		student = self.student()
		fb.make_invoice(
			student.name,
			3000,
			term=self.term,
			posting_date=add_days(today(), -40),
			due_date=add_days(today(), -10),
		)
		frappe.cache.delete_value(fees._reminder_cache_key(student.name))
		self.notify.reset_mock()
		self.assertEqual(fees.send_fee_reminders([student.name]), 1)
		self.assertEqual(self.notify.call_args.args[0], "Fee Reminder")
		self.assertEqual(self.notify.call_args.kwargs["context"]["balance"], 3000)
		self.assertEqual(fees.send_fee_reminders([student.name]), 0)
		self.assertEqual(fees.send_fee_reminders([student.name], force=True), 1)
		frappe.cache.delete_value(fees._reminder_cache_key(student.name))

	def test_statement_running_balance(self):
		student = self.student()
		fb.make_invoice(student.name, 5000, term=self.term, posting_date=add_days(today(), -5))
		fb.make_payment(student.name, 2000)
		fb.make_adjustment(student.name, "Penalty", 250)
		st = fees.statement(student.name)
		self.assertEqual([line["balance"] for line in st["lines"]], [5000, 3000, 3250])
		self.assertEqual((st["total_debit"], st["total_credit"], st["closing_balance"]), (5250, 2000, 3250))
		windowed = fees.statement(student.name, from_date=today())
		self.assertEqual(windowed["opening_balance"], 5000)

	# ------------------------------------------------------------------ API access
	def test_student_cannot_download_another_students_invoice(self):
		from mahanaim.api import finance

		owner, intruder = self.student(), self.student()
		inv = fb.make_invoice(owner.name, 1000, term=self.term)
		frappe.set_user(intruder.user)
		try:
			with self.assertRaises(frappe.PermissionError):
				finance.download("invoice", inv.name, "html")
			frappe.set_user(owner.user)
			finance.download("invoice", inv.name, "html")
			self.assertIn(inv.name, frappe.local.response["filecontent"])
			summary = finance.my_fees()
			self.assertEqual(summary["balance"], 1000)
			self.assertEqual([i["name"] for i in summary["invoices"]], [inv.name])
		finally:
			frappe.set_user("Administrator")
			frappe.local.response.pop("filecontent", None)
			frappe.local.response.pop("type", None)

	def test_sponsor_downloads_sponsored_students_documents(self):
		from mahanaim.api import finance
		from mahanaim.tests import factories_b4 as f4

		sponsored, other = self.student(), self.student()
		inv = fb.make_invoice(sponsored.name, 1000, term=self.term)
		draft = fb.make_invoice(sponsored.name, 500, term=self.term, submit=False)
		receipt = fb.make_payment(sponsored.name, 400)
		other_inv = fb.make_invoice(other.name, 1000, term=self.term)
		sponsor, user = f4.make_sponsor_with_user()
		f4.make_sponsorship(sponsor.name, sponsored.name)
		f4.make_sponsorship(sponsor.name, other.name, status="Cancelled")
		frappe.set_user(user)
		try:
			for kind, name in (("invoice", inv.name), ("receipt", receipt.name)):
				finance.download(kind, name, "html")
				self.assertIn(name, frappe.local.response["filecontent"])
			for kind, name in (
				("invoice", draft.name),
				("invoice", other_inv.name),
				("statement", other.name),
			):
				with self.assertRaises(frappe.PermissionError, msg=f"{kind} {name}"):
					finance.download(kind, name, "html")
		finally:
			frappe.set_user("Administrator")
			frappe.local.response.pop("filecontent", None)
			frappe.local.response.pop("type", None)

	def test_giving_receipt_access_and_verification(self):
		from mahanaim.api import finance
		from mahanaim.services import documents
		from mahanaim.tests import factories_b4 as f4

		giving_type = f4.make_giving_type().name
		giver, intruder = f.make_user(roles=("Sponsor",)), f.make_user(roles=("Student",))
		chaplain = f.make_user(roles=("Chaplain",))
		sponsor, sponsor_user = f4.make_sponsor_with_user()

		def gift(**kw):
			doc = frappe.get_doc(
				{
					"doctype": "Giving Record",
					"giving_type": giving_type,
					"posting_date": today(),
					"amount": 1500,
					"mode_of_payment": "Cash",
					**kw,
				}
			)
			doc.insert(ignore_permissions=True)
			doc.submit()
			return doc.name

		by_email = gift(giver_type="Other", giver_name="<b>Jane</b> Giver", giver_email=giver.name.upper())
		by_sponsor = gift(giver_type="Sponsor", sponsor=sponsor.name)
		checks = (
			(giver.name, by_email, True),
			(intruder.name, by_email, False),
			(chaplain.name, by_email, True),
			(sponsor_user, by_sponsor, True),
			(giver.name, by_sponsor, False),
		)
		try:
			for user, name, allowed in checks:
				frappe.set_user(user)
				if allowed:
					finance.download("giving", name, "html")
					html = frappe.local.response["filecontent"]
					self.assertIn(name, html)
					self.assertNotIn("<b>Jane</b>", html)
				else:
					with self.assertRaises(frappe.PermissionError, msg=f"{user} {name}"):
						finance.download("giving", name, "html")
		finally:
			frappe.set_user("Administrator")
			frappe.local.response.pop("filecontent", None)
			frappe.local.response.pop("type", None)
		result = documents.verify_code(documents.signed_code("Giving Record", by_sponsor))
		self.assertEqual(
			(result["valid"], result["document_type"], result["amount"]), (True, "Giving Receipt", 1500)
		)

	def test_print_documents_are_self_contained(self):
		"""wkhtmltopdf must never go online (it stalls the PDF on slow networks): no remote fonts, CSS or images."""
		import requests

		from mahanaim.services import documents

		student = self.student()
		inv = fb.make_invoice(student.name, 1000, term=self.term)
		receipt = fb.make_payment(student.name, 400)
		remote = (
			f"https://cdn.example.invalid/{random_string(8)}.png",
			f"https://cdn.example.invalid/{random_string(8)}.png",
		)
		self.addCleanup(lambda: [frappe.cache.delete_value(documents._remote_cache_key(u)) for u in remote])
		frappe.local.mbc_doc_images = {}
		with patch.object(documents.requests, "get", side_effect=requests.ConnectionError) as get:
			self.assertIsNone(documents.image_data_uri(remote[0]))
			frappe.local.mbc_doc_images = {}
			self.assertIsNone(documents.image_data_uri(remote[0]))
			self.assertEqual(get.call_count, 1, "a failed fetch is cached, not retried per document")
		ok = patch.object(documents.requests, "get").start()
		resp = ok.return_value.__enter__.return_value
		resp.ok, resp.headers = True, {"Content-Type": "image/png"}
		resp.iter_content.return_value = [b"\x89PNG"]
		self.assertEqual(documents.image_data_uri(remote[1]), "data:image/png;base64,iVBORw==")
		own = documents.image_data_uri(frappe.utils.get_url("/assets/mahanaim/images/logo.svg"))
		self.assertTrue(own.startswith("data:image/svg+xml;base64,"))
		external = (
			r"(?i)\b(?:src|href)\s*=\s*[\"']?(?:https?:)?//|@import|url\(\s*[\"']?(?:https?:)?//|<link\b"
		)
		for doctype, name in (
			("Student Invoice", inv.name),
			("Student Payment", receipt.name),
			("Fee Statement", student.name),
		):
			self.assertNotRegex(documents.render_html(doctype, name, for_pdf=True), external)

	def test_staff_endpoints(self):
		from mahanaim.api import finance

		student = self.student()
		inv = fb.make_invoice(student.name, 2000, term=self.term)
		receipt = finance.record_payment({"student": student.name, "amount": 500, "mode_of_payment": "Cash"})
		self.assertEqual(receipt["status"], "Confirmed")
		self.assertEqual(frappe.db.get_value("Student Invoice", inv.name, "outstanding_amount"), 1500)
		dash = finance.finance_dashboard()
		self.assertIn("aging", dash)
		self.assertGreaterEqual(dash["collected"]["today"], 500)
		rows = finance.defaulters(threshold=0, programme=self.programme)
		self.assertIn(student.name, [r["student"] for r in rows["data"]])
		report = finance.collections_report(today(), today(), "mode")
		self.assertTrue(any(r["key"] == "Cash" for r in report["data"]))
		finance.cancel_payment(receipt["name"], "Entered in error")
		self.assertEqual(frappe.db.get_value("Student Invoice", inv.name, "outstanding_amount"), 2000)
