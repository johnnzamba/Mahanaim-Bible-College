import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, nowdate

from mahanaim.api import library
from mahanaim.services import library as lib
from mahanaim.tests import factories as f
from mahanaim.tests import factories_b4 as fb


class TestLibrary(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		cls.campus = f.make_campus().name
		cls.programme = f.make_programme("TLIB", "Diploma Library _T", courses=("TLB101",)).name
		cls.student = f.make_student("Naomi", "Reader _T", programme=cls.programme, campus=cls.campus)
		cls.student2 = f.make_student("Boaz", "Reader _T", programme=cls.programme, campus=cls.campus)

	def tearDown(self):
		frappe.set_user("Administrator")

	def copies(self, item):
		return frappe.db.get_value("Library Item", item, ["total_copies", "available_copies"])

	def test_issue_return_and_copies(self):
		item = fb.make_library_item("Hermeneutics Handbook _T", copies=1).name
		self.assertEqual(self.copies(item), (1, 1))
		loan = library.issue_loan(item=item, student=self.student.name)
		self.assertEqual(loan["status"], "Issued")
		self.assertEqual(str(loan["due_date"]), str(add_days(nowdate(), lib.loan_days())))
		self.assertEqual(self.copies(item), (1, 0))
		with self.assertRaises(frappe.ValidationError):
			library.issue_loan(item=item, student=self.student2.name)  # no copies left
		library.return_loan(loan["name"], condition_notes="Good condition")
		self.assertEqual(self.copies(item), (1, 1))
		self.assertEqual(frappe.db.get_value("Library Loan", loan["name"], "status"), "Returned")
		with self.assertRaises(frappe.ValidationError):
			library.return_loan(loan["name"])

	def test_cannot_reduce_copies_below_loans(self):
		item = fb.make_library_item("Church History Vol 1 _T", copies=2)
		fb.make_loan(item.name, self.student.name)
		item.reload()
		item.total_copies = 0
		with self.assertRaises(frappe.ValidationError):
			item.save()

	def test_lost_and_found(self):
		item = fb.make_library_item("Greek Grammar _T", copies=2).name
		loan = fb.make_loan(item, self.student.name).name
		library.mark_lost(loan, notes="Left on matatu", replacement_fee=1500)
		self.assertEqual(self.copies(item), (1, 1))
		self.assertEqual(frappe.db.get_value("Library Loan", loan, "fine_amount"), 1500)
		library.return_loan(loan, condition_notes="Found")
		self.assertEqual(self.copies(item), (2, 2))

	def test_overdue_marking_and_fines(self):
		item = fb.make_library_item("Pastoral Care _T", copies=3).name
		loan = fb.make_loan(item, self.student.name).name
		frappe.db.set_value(
			"Library Loan",
			loan,
			{"issue_date": add_days(nowdate(), -20), "due_date": add_days(nowdate(), -6)},
		)
		current = fb.make_loan(item, self.student2.name).name
		self.assertGreaterEqual(lib.mark_overdue_loans(), 1)
		row = frappe.db.get_value("Library Loan", loan, ["status", "fine_amount"], as_dict=True)
		self.assertEqual(row.status, "Overdue")
		self.assertEqual(row.fine_amount, 6 * lib.fine_per_day())
		self.assertEqual(frappe.db.get_value("Library Loan", current, "status"), "Issued")
		# A day later the fine grows without re-notifying.
		frappe.db.set_value("Library Loan", loan, "due_date", add_days(nowdate(), -7))
		lib.mark_overdue_loans()
		self.assertEqual(frappe.db.get_value("Library Loan", loan, "fine_amount"), 7 * lib.fine_per_day())

	def test_request_loan_flow(self):
		item = fb.make_library_item("Missions Today _T", copies=1).name
		frappe.set_user(self.student.user)
		req = library.request_loan(item)
		self.assertEqual(req["status"], "Requested")
		with self.assertRaises(frappe.DuplicateEntryError):
			library.request_loan(item)
		self.assertIn(req["name"], [r["name"] for r in library.my_loans()["active"]])
		frappe.set_user("Administrator")
		issued = library.issue_loan(loan=req["name"])
		self.assertEqual((issued["status"], str(issued["issue_date"])), ("Issued", nowdate()))
		self.assertEqual(self.copies(item), (1, 0))

	def test_request_loan_rejects_open_request_or_unreturned_copy(self):
		item = fb.make_library_item("Pastoral Epistles _T", copies=3).name
		user = self.student2.user

		def request():
			frappe.set_user(user)
			try:
				return library.request_loan(item)
			finally:
				frappe.set_user("Administrator")

		first = request()
		with self.assertRaisesRegex(frappe.DuplicateEntryError, "pending request"):
			request()
		library.issue_loan(loan=first["name"])
		with self.assertRaisesRegex(frappe.DuplicateEntryError, "on loan"):
			request()
		library.mark_lost(first["name"], replacement_fee=1500)
		with self.assertRaisesRegex(frappe.DuplicateEntryError, "lost"):
			request()
		library.record_fine_payment(first["name"])
		self.assertEqual(request()["status"], "Requested")
		self.assertEqual(
			frappe.db.count(
				"Library Loan", {"library_item": item, "student": self.student2.name, "status": "Requested"}
			),
			1,
		)

	def test_catalogue_access_levels(self):
		public = fb.make_library_item("Public Devotional _T", access_level="Public").name
		students = fb.make_library_item("Students Commentary _T", access_level="Students").name
		staff = fb.make_library_item("Staff Manual _T", access_level="Staff").name

		def names(user):
			frappe.set_user(user)
			return {r["name"] for r in library.catalogue(search="_T", page_length=100)["data"]}

		self.assertEqual(names("Guest") & {public, students, staff}, {public})
		self.assertEqual(names(self.student.user) & {public, students, staff}, {public, students})
		self.assertEqual(names("Administrator") & {public, students, staff}, {public, students, staff})
		frappe.set_user("Guest")
		with self.assertRaises(frappe.AuthenticationError):
			library.item(students)  # guests are asked to sign in
		frappe.set_user(self.student.user)
		with self.assertRaises(frappe.PermissionError):
			library.item(staff)

	def test_digital_item_requires_source(self):
		with self.assertRaises(frappe.ValidationError):
			fb.make_library_item("Empty E-Book _T", item_type="E-Book", copies=0)
		ebook = fb.make_library_item(
			"Online Bible Atlas _T",
			item_type="E-Book",
			copies=0,
			access_level="Public",
			external_url="https://example.org/atlas.pdf",
		).name
		frappe.set_user("Guest")
		res = library.access_digital(ebook)
		self.assertEqual(res["url"], "https://example.org/atlas.pdf")
		self.assertEqual(frappe.db.get_value("Library Item", ebook, "downloads"), 1)

	def test_get_loan_detail(self):
		item = fb.make_library_item("Loan Detail Copy _T", copies=1).name
		loan = fb.make_loan(item, self.student2.name).name
		frappe.db.set_value("Library Loan", loan, "due_date", add_days(nowdate(), -3))
		frappe.set_user(f.make_user("library.officer.b4@example.com", roles=("Library Officer",)).name)
		detail = library.get_loan(loan)
		self.assertEqual((detail["name"], detail["status"]), (loan, "Issued"))
		self.assertEqual(detail["days_overdue"], 3)
		self.assertEqual(detail["fine_amount"], 3 * lib.fine_per_day())
		self.assertEqual((detail["item"]["name"], detail["item"]["available_copies"]), (item, 0))
		self.assertEqual(
			(detail["borrower"]["type"], detail["borrower"]["id"]), ("Student", self.student2.name)
		)
		self.assertGreaterEqual(detail["borrower"]["active_loans"], 1)
		frappe.set_user(self.student2.user)
		with self.assertRaises(frappe.PermissionError):
			library.get_loan(loan)
