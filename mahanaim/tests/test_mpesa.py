import base64
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_to_date, now_datetime, random_string

from mahanaim.api import mpesa as api
from mahanaim.services import mpesa
from mahanaim.tests import factories as f
from mahanaim.tests import factories_b3 as fb


def callback(fn, payload, token=fb.CALLBACK_TOKEN):
	"""Invoke a guest callback endpoint the way Frappe would (payload + ?token= in form_dict)."""
	frappe.local.form_dict = frappe._dict({**payload, "token": token} if token is not None else payload)
	frappe.local.response = frappe._dict()
	try:
		fn()
		return dict(frappe.local.response)
	finally:
		frappe.local.form_dict = frappe._dict()
		frappe.local.response = frappe._dict(docs=[])


class TestMpesa(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.term = f.make_term().name
		cls.campus = f.make_campus().name
		cls.programme = f.make_programme("TMPS", "Certificate in M-Pesa _T").name
		cls.saved_term = frappe.db.get_single_value("Mahanaim Settings", "current_academic_term")
		fb.set_settings(current_academic_term=cls.term)
		fb.make_component("Tuition _T")

	@classmethod
	def tearDownClass(cls):
		fb.set_settings(current_academic_term=cls.saved_term)
		super().tearDownClass()

	def setUp(self):
		frappe.set_user("Administrator")
		fb.setup_mpesa(enabled=1, auto_allocate=1)
		frappe.cache.delete_keys("mahanaim:mpesa:")
		patch("mahanaim.services.communication.notify").start()
		self.get = patch("mahanaim.services.mpesa.requests.get", side_effect=fb.token_response).start()
		self.post = patch("mahanaim.services.mpesa.requests.post").start()
		self.addCleanup(patch.stopall)

	def student(self):
		s = f.make_student(programme=self.programme, campus=self.campus)
		number = f"MBC/TMPS/2090/{random_string(5).upper()}"
		frappe.db.set_value("Student", s.name, "student_number", number)
		s.student_number = number
		return s

	def stk(
		self,
		student,
		amount=2000,
		invoice=None,
		purpose="Student Fees",
		application=None,
		phone="0712 345 678",
	):
		checkout = f"ws_CO_{random_string(12)}"
		self.post.return_value = fb.stk_accept_response(checkout)
		frappe.cache.delete_keys("mahanaim:mpesa:stk:")
		out = mpesa.initiate_payment(
			phone, amount, purpose, student=student, invoice=invoice, application=application
		)
		return out, checkout

	# ------------------------------------------------------------------ STK push
	def test_initiate_stk_push(self):
		s = self.student()
		inv = fb.make_invoice(s.name, 2000, term=self.term)
		out, checkout = self.stk(s.name, 1999.4, invoice=inv.name)
		self.assertEqual(out["checkout_request_id"], checkout)
		self.assertTrue(out["customer_message"])
		req = frappe.get_doc("M-Pesa Request", out["request"])
		self.assertEqual(
			(req.status, req.amount, req.phone_number, req.account_reference),
			("Pending", 2000, "254712345678", s.student_number),
		)
		self.assertEqual((req.reference_doctype, req.reference_name), ("Student Invoice", inv.name))

		sent = self.post.call_args.kwargs
		body = sent["json"]
		self.assertEqual(sent["headers"]["Authorization"], "Bearer acc_test")
		self.assertTrue(sent["timeout"])
		self.assertEqual(base64.b64decode(body["Password"]).decode(), f"174379pk_test{body['Timestamp']}")
		self.assertIn(f"token={fb.CALLBACK_TOKEN}", body["CallBackURL"])
		self.assertEqual(body["Amount"], 2000)
		stored = req.request_payload + (req.response_payload or "")
		for secret in ("pk_test", fb.CALLBACK_TOKEN, "acc_test", body["Password"], "cs_test"):
			self.assertNotIn(secret, stored)

		# token is cached: the second push does not request a new one
		self.stk(s.name, 10)
		self.assertEqual(self.get.call_count, 1)

	def test_initiate_validation_and_rate_limit(self):
		s = self.student()
		self.post.return_value = fb.stk_accept_response("ws_CO_RL")
		for phone, amount in (("12345", 100), ("0712345678", 0), ("0712345678", 300000)):
			with self.assertRaises(frappe.ValidationError):
				mpesa.initiate_payment(phone, amount, "Student Fees", student=s.name)
		mpesa.initiate_payment("0712345678", 100, "Student Fees", student=s.name)
		with self.assertRaises(frappe.RateLimitExceededError):
			mpesa.initiate_payment("+254 712 345 678", 100, "Student Fees", student=s.name)

	def test_stk_rejected_by_daraja(self):
		s = self.student()
		self.post.return_value = fb.FakeResponse(
			400, {"errorCode": "400.002.02", "errorMessage": "Invalid Amount"}
		)
		with self.assertRaises(frappe.ValidationError):
			mpesa.initiate_payment("0712345678", 100, "Student Fees", student=s.name)
		self.assertEqual(
			frappe.db.get_value("M-Pesa Request", {"student": s.name}, ["status", "result_code"]),
			("Failed", "400.002.02"),
		)
		# a failed push does not hold the phone's rate-limit slot
		self.post.return_value = fb.stk_accept_response("ws_CO_OK")
		mpesa.initiate_payment("0712345678", 100, "Student Fees", student=s.name)

	# ------------------------------------------------------------------ callbacks
	def test_success_callback_creates_exactly_one_payment(self):
		s = self.student()
		inv1 = fb.make_invoice(s.name, 1000, term=self.term)
		inv2 = fb.make_invoice(s.name, 2000, term=self.term)
		out, checkout = self.stk(s.name, 1500, invoice=inv2.name)
		receipt = f"TST{random_string(7).upper()}"
		payload = fb.stk_callback_payload(checkout, 0, 1500, receipt)

		first = callback(api.stk_callback, payload)
		second = callback(api.stk_callback, payload)
		for resp in (first, second):
			self.assertEqual((resp["ResultCode"], resp["ResultDesc"]), (0, "Accepted"))
			self.assertNotEqual(resp.get("http_status_code"), 500)

		payments = frappe.get_all(
			"Student Payment",
			filters={"reference_no": receipt, "docstatus": 1},
			fields=["name", "amount", "payment_for", "mode_of_payment", "student"],
		)
		self.assertEqual(len(payments), 1)
		self.assertEqual(
			(payments[0].amount, payments[0].payment_for, payments[0].mode_of_payment, payments[0].student),
			(1500, "Student Fees", "M-Pesa", s.name),
		)
		req = frappe.get_doc("M-Pesa Request", out["request"])
		self.assertEqual(
			(req.status, req.mpesa_receipt_number, req.payment, req.transaction),
			("Completed", receipt, payments[0].name, receipt),
		)
		self.assertEqual(
			frappe.db.get_value("M-Pesa Transaction", receipt, ["status", "payment"]),
			("Allocated", payments[0].name),
		)
		# the invoice the student chose is paid first, not the oldest one
		self.assertEqual(frappe.db.get_value("Student Invoice", inv2.name, "outstanding_amount"), 500)
		self.assertEqual(frappe.db.get_value("Student Invoice", inv1.name, "outstanding_amount"), 1000)

	def test_callback_amount_mismatch_records_actual_amount(self):
		s = self.student()
		out, checkout = self.stk(s.name, 2000)
		receipt = f"TST{random_string(7).upper()}"
		callback(api.stk_callback, fb.stk_callback_payload(checkout, 0, 1200, receipt))
		self.assertEqual(frappe.db.get_value("Student Payment", {"reference_no": receipt}, "amount"), 1200)
		self.assertIn("mismatch", frappe.db.get_value("M-Pesa Request", out["request"], "remarks").lower())

	def test_callback_with_bad_token_rejected(self):
		s = self.student()
		out, checkout = self.stk(s.name, 100)
		receipt = f"TST{random_string(7).upper()}"
		payload = fb.stk_callback_payload(checkout, 0, 100, receipt)
		for token in ("wrong-token", "", None):
			resp = callback(api.stk_callback, payload, token=token)
			self.assertEqual((resp["ResultCode"], resp["http_status_code"]), (1, 403))
		self.assertEqual(frappe.db.get_value("M-Pesa Request", out["request"], "status"), "Pending")
		self.assertFalse(frappe.db.exists("M-Pesa Transaction", receipt))
		self.assertFalse(mpesa.verify_token(fb.CALLBACK_TOKEN[:-1]))

	def test_failure_callbacks(self):
		s = self.student()
		for code, expected in (("1032", "Cancelled"), ("1037", "Timeout"), ("2001", "Failed")):
			out, checkout = self.stk(s.name, 100)
			resp = callback(api.stk_callback, fb.stk_callback_payload(checkout, int(code)))
			self.assertEqual(resp["ResultCode"], 0)
			req = frappe.get_doc("M-Pesa Request", out["request"])
			self.assertEqual((req.status, req.result_code), (expected, code))
			self.assertFalse(req.payment)
		self.assertFalse(
			frappe.db.exists("Student Payment", {"student": s.name, "mode_of_payment": "M-Pesa"})
		)

	def test_callback_processing_error_still_accepted(self):
		s = self.student()
		_out, checkout = self.stk(s.name, 100)
		with patch("mahanaim.services.mpesa.handle_stk_callback", side_effect=RuntimeError("boom")):
			resp = callback(api.stk_callback, fb.stk_callback_payload(checkout, 0, 100, "TSTBOOM001"))
		self.assertEqual((resp["ResultCode"], resp.get("http_status_code", 200)), (0, 200))

	def test_application_fee_payment(self):
		app = fb.make_application(programme=self.programme, campus=self.campus)
		out, checkout = self.stk(None, 1000, purpose="Application Fee", application=app.name)
		self.assertEqual(frappe.db.get_value("M-Pesa Request", out["request"], "account_reference"), app.name)
		receipt = f"TST{random_string(7).upper()}"
		with patch("mahanaim.services.admissions.mark_application_fee_paid", create=True) as mark:
			callback(api.stk_callback, fb.stk_callback_payload(checkout, 0, 1000, receipt))
		pay = frappe.db.get_value(
			"Student Payment",
			{"reference_no": receipt},
			["name", "payment_for", "programme_application"],
			as_dict=True,
		)
		self.assertEqual((pay.payment_for, pay.programme_application), ("Application Fee", app.name))
		mark.assert_called_once_with(app.name, pay.name)

	def test_giving_and_event_fee_are_recorded_by_owner_services(self):
		church_hook = "mahanaim.services.church.on_mpesa_success"
		for purpose, target in (
			("Giving", church_hook),
			("Event Fee", "mahanaim.services.website.mark_event_registration_paid"),
		):
			out, checkout = self.stk(None, 500, purpose=purpose)
			receipt = f"TST{random_string(7).upper()}"
			payload = fb.stk_callback_payload(checkout, 0, 500, receipt)
			with patch(target, return_value="REC-T-1") as hook:
				callback(api.stk_callback, payload)
				callback(api.stk_callback, payload)
			hook.assert_called_once()
			passed = [*hook.call_args.args, *hook.call_args.kwargs.values()]
			self.assertIn(out["request"], passed)
			self.assertIn(receipt, passed)
			self.assertFalse(frappe.db.exists("Student Payment", {"reference_no": receipt}))
			self.assertEqual(
				frappe.db.get_value("M-Pesa Request", out["request"], ["status", "payment"]),
				("Completed", None),
			)
			trans = frappe.db.get_value("M-Pesa Transaction", receipt, ["status", "remarks"], as_dict=True)
			self.assertEqual(trans.status, "Allocated")
			self.assertIn("REC-T-1", trans.remarks)

		# the owner service failing leaves the transaction Matched; staff reconcile retries it
		_out, checkout = self.stk(None, 500, purpose="Giving")
		receipt = f"TST{random_string(7).upper()}"
		with patch(church_hook, side_effect=RuntimeError("boom")):
			resp = callback(api.stk_callback, fb.stk_callback_payload(checkout, 0, 500, receipt))
		self.assertEqual(resp["ResultCode"], 0)
		self.assertEqual(frappe.db.get_value("M-Pesa Transaction", receipt, "status"), "Matched")
		with patch(church_hook, return_value="REC-T-2"):
			res = mpesa.reconcile_transaction(receipt)
		self.assertEqual((res["record"], res["payment"]), ("REC-T-2", None))
		self.assertEqual(frappe.db.get_value("M-Pesa Transaction", receipt, "status"), "Allocated")
		self.assertFalse(frappe.db.exists("Student Payment", {"reference_no": receipt}))
		with self.assertRaises(frappe.ValidationError):
			mpesa.reconcile_transaction(receipt)

	# ------------------------------------------------------------------ C2B
	def test_c2b_matched_unmatched_and_reconcile(self):
		s = self.student()
		inv = fb.make_invoice(s.name, 3000, term=self.term)
		matched_id = f"C2B{random_string(7).upper()}"
		bill_ref = s.student_number.replace("/", "").lower()
		resp = callback(api.c2b_confirmation, fb.c2b_payload(matched_id, bill_ref, 1000))
		self.assertEqual(resp["ResultCode"], 0)
		trans = frappe.get_doc("M-Pesa Transaction", matched_id)
		self.assertEqual((trans.status, trans.student, trans.source), ("Allocated", s.name, "C2B"))
		self.assertEqual(
			frappe.db.get_value("Student Payment", trans.payment, ["amount", "docstatus"]), (1000, 1)
		)
		self.assertEqual(frappe.db.get_value("Student Invoice", inv.name, "outstanding_amount"), 2000)
		# replayed confirmation is ignored
		callback(api.c2b_confirmation, fb.c2b_payload(matched_id, bill_ref, 1000))
		self.assertEqual(frappe.db.count("Student Payment", {"reference_no": matched_id}), 1)

		unmatched_id = f"C2B{random_string(7).upper()}"
		callback(api.c2b_confirmation, fb.c2b_payload(unmatched_id, "NOBODY-123", 750))
		trans = frappe.get_doc("M-Pesa Transaction", unmatched_id)
		self.assertEqual(trans.status, "Unmatched")
		self.assertFalse(trans.student or trans.payment)

		result = mpesa.reconcile_transaction(unmatched_id, student=s.name)
		self.assertEqual(result["status"], "Allocated")
		self.assertEqual(
			frappe.db.get_value("M-Pesa Transaction", unmatched_id, ["status", "student"]),
			("Allocated", s.name),
		)
		self.assertEqual(frappe.db.get_value("Student Invoice", inv.name, "outstanding_amount"), 1250)
		with self.assertRaises(frappe.ValidationError):
			mpesa.reconcile_transaction(unmatched_id, student=s.name)

	def test_c2b_without_auto_allocate_stays_matched(self):
		fb.setup_mpesa(enabled=1, auto_allocate=0)
		s = self.student()
		trans_id = f"C2B{random_string(7).upper()}"
		callback(api.c2b_confirmation, fb.c2b_payload(trans_id, s.student_number, 500))
		self.assertEqual(
			frappe.db.get_value("M-Pesa Transaction", trans_id, ["status", "student", "payment"]),
			("Matched", s.name, None),
		)

	def test_c2b_validation_and_bad_token(self):
		resp = callback(api.c2b_validation, fb.c2b_payload("C2BVAL0001", "ANY", 10))
		self.assertEqual(str(resp["ResultCode"]), "0")
		resp = callback(api.c2b_confirmation, fb.c2b_payload("C2BBAD0001", "ANY", 10), token="nope")
		self.assertEqual(resp["http_status_code"], 403)
		self.assertFalse(frappe.db.exists("M-Pesa Transaction", "C2BBAD0001"))

	# ------------------------------------------------------------------ expiry / simulation / settings
	def _stale(self, student, checkout, minutes=10):
		req = frappe.get_doc(
			{
				"doctype": "M-Pesa Request",
				"phone_number": "254712345678",
				"amount": 100,
				"status": "Pending",
				"purpose": "Student Fees",
				"student": student,
				"checkout_request_id": checkout,
			}
		).insert(ignore_permissions=True)
		frappe.db.set_value(
			"M-Pesa Request",
			req.name,
			"creation",
			add_to_date(now_datetime(), minutes=-minutes),
			update_modified=False,
		)
		return req.name

	def test_expire_stale_requests(self):
		s = self.student()
		cancelled = self._stale(s.name, f"ws_CO_{random_string(10)}")
		processing = self._stale(s.name, f"ws_CO_{random_string(10)}")
		fresh = self._stale(s.name, f"ws_CO_{random_string(10)}", minutes=1)

		def query(url, json=None, **_k):
			if json["CheckoutRequestID"] == frappe.db.get_value(
				"M-Pesa Request", cancelled, "checkout_request_id"
			):
				return fb.FakeResponse(
					200, {"ResponseCode": "0", "ResultCode": "1032", "ResultDesc": "Cancelled by user"}
				)
			return fb.FakeResponse(
				500, {"errorCode": "500.001.1001", "errorMessage": "The transaction is being processed"}
			)

		self.post.side_effect = query
		self.assertGreaterEqual(mpesa.expire_stale_requests(limit=50), 2)
		self.assertEqual(frappe.db.get_value("M-Pesa Request", cancelled, "status"), "Cancelled")
		self.assertEqual(frappe.db.get_value("M-Pesa Request", processing, "status"), "Timeout")
		self.assertEqual(frappe.db.get_value("M-Pesa Request", fresh, "status"), "Pending")

		# with M-Pesa disabled nothing is queried; stale requests simply time out
		fb.setup_mpesa(enabled=0)
		self.post.reset_mock()
		stale = self._stale(s.name, f"ws_CO_{random_string(10)}")
		mpesa.expire_stale_requests(limit=50)
		self.assertEqual(frappe.db.get_value("M-Pesa Request", stale, "status"), "Timeout")
		self.post.assert_not_called()

	def test_late_success_after_timeout_is_recorded(self):
		s = self.student()
		out, checkout = self.stk(s.name, 100)
		frappe.db.set_value("M-Pesa Request", out["request"], "status", "Timeout")
		receipt = f"TST{random_string(7).upper()}"
		callback(api.stk_callback, fb.stk_callback_payload(checkout, 0, 100, receipt))
		self.assertEqual(frappe.db.get_value("M-Pesa Request", out["request"], "status"), "Completed")
		self.assertTrue(frappe.db.exists("Student Payment", {"reference_no": receipt, "docstatus": 1}))

	def test_simulation_mode(self):
		if not frappe.conf.get("developer_mode"):
			self.skipTest("simulation requires developer_mode")
		fb.setup_mpesa(enabled=0)
		s = self.student()
		out = mpesa.initiate_payment("0712345678", 250, "Student Fees", student=s.name)
		self.assertTrue(out["simulation"] and out["checkout_request_id"].startswith("SIM-"))
		self.post.assert_not_called()
		result = mpesa.simulate_callback(out["request"], success=True)
		self.assertEqual(result["status"], "Completed")
		self.assertEqual(
			frappe.db.get_value("Student Payment", result["payment"], ["amount", "docstatus"]), (250, 1)
		)

	def test_settings_status_masks_secrets(self):
		status = mpesa.settings_status()
		self.assertTrue(status["configured"] and status["has_passkey"])
		dump = frappe.as_json(status)
		for secret in ("pk_test", "ck_test", "cs_test", fb.CALLBACK_TOKEN):
			self.assertNotIn(secret, dump)
		self.assertIn("paybill_confirmation", status["c2b_confirmation_url"])
