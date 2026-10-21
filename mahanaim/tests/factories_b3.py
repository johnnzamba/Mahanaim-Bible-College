"""Finance / M-Pesa / credentials test factories (domain B3). Built on tests/factories.py."""

from __future__ import annotations

import json

import frappe
from frappe.utils import add_days, random_string, today

from mahanaim.tests import factories as f

CALLBACK_TOKEN = "tok_test_callback_123456"


def set_settings(**values):
	"""Update Mahanaim Settings and drop the per-request single-value cache."""
	frappe.db.set_single_value("Mahanaim Settings", values)
	frappe.db.value_cache.pop("Mahanaim Settings", None)
	frappe.clear_document_cache("Mahanaim Settings", "Mahanaim Settings")


def make_component(name="Tuition _T", amount=0, component_type="Tuition"):
	if frappe.db.exists("Fee Component", name):
		return frappe.get_doc("Fee Component", name)
	doc = frappe.get_doc(
		{
			"doctype": "Fee Component",
			"component_name": name,
			"component_type": component_type,
			"default_amount": amount,
			"is_active": 1,
		}
	)
	doc.insert(ignore_permissions=True)
	return doc


def make_structure(programme, items=(("Tuition _T", 10000),), name=None, installments=None, **applicability):
	doc = frappe.get_doc(
		{
			"doctype": "Fee Structure",
			"structure_name": name or f"FS {random_string(6)} _T",
			"programme": programme,
			"is_active": 1,
			"items": [{"fee_component": make_component(c).name, "amount": amt} for c, amt in items],
			**applicability,
		}
	)
	if installments:
		doc.allow_installments = 1
		doc.set("installments", installments)
	doc.insert(ignore_permissions=True)
	return doc


def make_invoice(
	student,
	amount=10000,
	term=None,
	posting_date=None,
	due_date=None,
	submit=True,
	component="Tuition _T",
	fee_structure=None,
):
	doc = frappe.get_doc(
		{
			"doctype": "Student Invoice",
			"student": student,
			"academic_term": term,
			"fee_structure": fee_structure,
			"posting_date": posting_date or today(),
			"due_date": due_date or add_days(posting_date or today(), 30),
			"items": []
			if fee_structure
			else [{"fee_component": make_component(component).name, "amount": amount}],
		}
	)
	doc.insert(ignore_permissions=True)
	if submit:
		doc.submit()
	return doc


def make_payment(
	student=None,
	amount=1000,
	mode="Cash",
	reference_no=None,
	allocations=None,
	submit=True,
	payment_for="Student Fees",
	application=None,
	posting_date=None,
):
	doc = frappe.get_doc(
		{
			"doctype": "Student Payment",
			"payment_for": payment_for,
			"student": student,
			"programme_application": application,
			"mode_of_payment": mode,
			"amount": amount,
			"reference_no": reference_no,
			"posting_date": posting_date or today(),
			"allocations": allocations or [],
		}
	)
	doc.flags.mute_notification = True
	doc.insert(ignore_permissions=True)
	if submit:
		doc.submit()
	return doc


def make_adjustment(student, adjustment_type="Scholarship", amount=1000, invoice=None, submit=True):
	doc = frappe.get_doc(
		{
			"doctype": "Fee Adjustment",
			"student": student,
			"adjustment_type": adjustment_type,
			"amount": amount,
			"invoice": invoice,
			"posting_date": today(),
			"reason": "Test adjustment _T",
		}
	)
	doc.insert(ignore_permissions=True)
	if submit:
		doc.submit()
	return doc


def make_registration(student, term, status="Approved"):
	"""Semester Registration inserted without B1's workflow side effects."""
	s = frappe.db.get_value(
		"Student", student, ["programme", "campus", "study_mode", "year_of_study"], as_dict=True
	)
	doc = frappe.get_doc(
		{
			"doctype": "Semester Registration",
			"student": student,
			"academic_term": term,
			"programme": s.programme,
			"campus": s.campus,
			"study_mode": s.study_mode,
			"year_of_study": s.year_of_study,
			"status": status,
		}
	)
	doc.set_new_name()
	doc.db_insert()  # raw insert: no B1 controller hooks, we only need a row to invoice against
	return doc


def make_application(programme=None, campus=None, email=None, user=None):
	programme = programme or f.make_programme().name
	campus = campus or f.make_campus().name
	doc = frappe.get_doc(
		{
			"doctype": "Programme Application",
			"first_name": "Ann",
			"last_name": "Applicant _T",
			"full_name": "Ann Applicant _T",
			"email": email or f"app.{random_string(6).lower()}@example.com",
			"phone": "0711000111",
			"programme": programme,
			"campus": campus,
			"study_mode": frappe.db.get_value("Study Mode", {}, "name") or "Full Time",
			"user": user,
			"status": "Submitted",
			"fee_status": "Unpaid",
		}
	)
	doc.set_new_name()
	doc.db_insert()
	return doc


def setup_mpesa(enabled=1, auto_allocate=1, shortcode="174379", timeout=120):
	s = frappe.get_single("M-Pesa Settings")
	s.update(
		{
			"enabled": enabled,
			"environment": "Sandbox",
			"transaction_type": "CustomerPayBillOnline",
			"business_shortcode": shortcode,
			"account_reference_prefix": "MBC",
			"consumer_key": "ck_test",
			"consumer_secret": "cs_test",
			"passkey": "pk_test",
			"callback_base_url": "https://portal.example.com",
			"callback_token": CALLBACK_TOKEN,
			"stk_timeout_seconds": timeout,
			"auto_allocate": auto_allocate,
			"sms_receipt": 0,
			"email_receipt": 0,
		}
	)
	s.save(ignore_permissions=True)
	frappe.cache.delete_keys("mahanaim:mpesa:")
	return s


class FakeResponse:
	def __init__(self, status_code=200, data=None):
		self.status_code = status_code
		self._data = data or {}
		self.text = json.dumps(self._data)

	def json(self):
		return self._data


def token_response(*_a, **_k):
	return FakeResponse(200, {"access_token": "acc_test", "expires_in": "3599"})


def stk_accept_response(checkout_id="ws_CO_TEST_1", merchant_id="MR-TEST-1"):
	return FakeResponse(
		200,
		{
			"MerchantRequestID": merchant_id,
			"CheckoutRequestID": checkout_id,
			"ResponseCode": "0",
			"ResponseDescription": "Success. Request accepted for processing",
			"CustomerMessage": "Success. Request accepted",
		},
	)


def stk_callback_payload(
	checkout_id,
	result_code=0,
	amount=1000,
	receipt="TST0000001",
	phone=254712345678,
	merchant_id="MR-TEST-1",
	desc=None,
):
	callback = {
		"MerchantRequestID": merchant_id,
		"CheckoutRequestID": checkout_id,
		"ResultCode": result_code,
		"ResultDesc": desc
		or ("The service request is processed successfully." if result_code == 0 else "Failed"),
	}
	if result_code == 0:
		callback["CallbackMetadata"] = {
			"Item": [
				{"Name": "Amount", "Value": amount},
				{"Name": "MpesaReceiptNumber", "Value": receipt},
				{"Name": "TransactionDate", "Value": 20900101120000},
				{"Name": "PhoneNumber", "Value": phone},
			]
		}
	return {"Body": {"stkCallback": callback}}


def c2b_payload(trans_id, bill_ref, amount=500, msisdn="254712345678", shortcode="174379"):
	return {
		"TransactionType": "Pay Bill",
		"TransID": trans_id,
		"TransTime": "20900101120000",
		"TransAmount": str(amount),
		"BusinessShortCode": shortcode,
		"BillRefNumber": bill_ref,
		"MSISDN": msisdn,
		"FirstName": "JOHN",
		"MiddleName": "",
		"LastName": "DOE",
	}


def make_result(
	student, course, term, score=70, grade="A", points=4.0, status="Pass", credits=3, campus=None
):
	"""Published Course Result inserted directly (bypasses B2's mark-sheet workflow)."""
	offering = f.make_offering(course, term=term, campus=campus)
	doc = frappe.get_doc(
		{
			"doctype": "Course Result",
			"student": student,
			"programme": frappe.db.get_value("Student", student, "programme"),
			"course_offering": offering.name,
			"course": course,
			"course_title": frappe.db.get_value("Course", course, "course_title"),
			"academic_term": term,
			"academic_year": frappe.db.get_value("Academic Term", term, "academic_year"),
			"credits": credits,
			"attempt": "First",
			"total_score": score,
			"grade": grade,
			"grade_points": points,
			"quality_points": points * credits,
			"result_status": status,
			"is_published": 1,
			"published_on": frappe.utils.now_datetime(),
		}
	)
	doc.set_new_name()
	doc.db_insert()
	return doc
