import re
from io import BytesIO
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import random_string, today

from mahanaim.api import credentials as api
from mahanaim.services import documents
from mahanaim.tests import factories as f
from mahanaim.tests import factories_b3 as fb
from mahanaim.utils import ROLE_REGISTRAR

PASSED = (("TCR101", 80, "A", 4.0, "Pass"), ("TCR102", 65, "B", 3.0, "Pass"))
SENSITIVE_KEYS = {
	"student",
	"cgpa",
	"total_credits",
	"snapshot",
	"email",
	"phone",
	"date_of_birth",
	"balance",
	"fee_balance",
	"verification_code",
}


class TestCredentials(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.term = f.make_term().name
		cls.campus = f.make_campus().name
		cls.programme = f.make_programme(
			"TCRD", "Diploma in Credential Studies _T", courses=("TCR101", "TCR102")
		).name
		frappe.db.set_value(
			"Programme",
			cls.programme,
			{"award_title": "Diploma in Credential Studies", "min_cgpa_to_graduate": 2.0},
		)
		cls.saved = frappe.db.get_value(
			"Mahanaim Settings",
			"Mahanaim Settings",
			["current_academic_term", "transcript_requires_fee_clearance"],
			as_dict=True,
		)
		fb.set_settings(current_academic_term=cls.term, transcript_requires_fee_clearance=1)
		fb.make_component("Tuition _T")
		cls.registrar = f.make_user(roles=(ROLE_REGISTRAR,)).name

	@classmethod
	def tearDownClass(cls):
		fb.set_settings(**cls.saved)
		super().tearDownClass()

	def setUp(self):
		frappe.set_user("Administrator")
		self.notify = patch("mahanaim.services.communication.notify").start()
		self.addCleanup(patch.stopall)
		self.addCleanup(frappe.set_user, "Administrator")

	def graduate(self, status="Completed", results=PASSED, balance=0):
		s = f.make_student(programme=self.programme, campus=self.campus)
		number = f"MBC/TCRD/2090/{random_string(5).upper()}"
		frappe.db.set_value("Student", s.name, {"student_number": number, "status": status})
		for course, score, grade, points, result in results:
			fb.make_result(
				s.name,
				course,
				self.term,
				score=score,
				grade=grade,
				points=points,
				status=result,
				campus=self.campus,
			)
		if balance:
			fb.make_invoice(s.name, balance, term=self.term)
		return frappe.get_doc("Student", s.name)

	def issued_transcript(self, student, **kw):
		doc = frappe.get_doc(
			{
				"doctype": "Transcript",
				"student": student,
				"transcript_type": "Official",
				"status": "Issued",
				**kw,
			}
		).insert()
		return doc

	def notified(self, event):
		return [c for c in self.notify.call_args_list if c.args and c.args[0] == event]

	# ------------------------------------------------------------------ transcripts
	def test_transcript_issue_blocked_by_fee_check_and_allowed_with_override(self):
		s = self.graduate(balance=5000)
		frappe.set_user(self.registrar)
		draft = api.generate_transcript(s.name, "Official")
		self.assertEqual((draft["status"], draft["verification_code"]), ("Draft", None))
		self.assertEqual(len(draft["snapshot"]["terms"]), 1)  # preview of current results

		with self.assertRaises(frappe.ValidationError):
			api.issue_transcript(draft["name"])
		self.assertEqual(frappe.db.get_value("Transcript", draft["name"], "status"), "Draft")

		out = api.issue_transcript(draft["name"], override_fee_check=1)
		self.assertEqual(out["status"], "Issued")
		self.assertTrue(re.fullmatch(r"[A-Z0-9]{10}", out["verification_code"]))
		self.assertEqual(
			(out["cgpa"], out["total_credits"], out["issued_by"], str(out["issue_date"])),
			(3.5, 6, self.registrar, today()),
		)
		from mahanaim.services.grading import classification_for

		self.assertEqual(out["classification"], classification_for(3.5))
		self.assertEqual([c["code"] for c in out["snapshot"]["terms"][0]["courses"]], ["TCR101", "TCR102"])
		self.assertIn("overridden", out["eligibility_notes"])
		self.assertEqual(len(self.notified("Transcript Ready")), 1)

		# a fee-cleared student needs no override
		cleared = self.graduate()
		frappe.set_user(self.registrar)
		ok = api.issue_transcript(api.generate_transcript(cleared.name, "Provisional")["name"])
		self.assertEqual(ok["status"], "Issued")
		self.assertFalse(ok["override_fee_check"])

	def test_only_registrar_can_override_fee_check(self):
		s = self.graduate(balance=1000)
		finance_user = f.make_user(roles=("Finance Officer",)).name
		frappe.set_user(finance_user)
		with self.assertRaises(frappe.PermissionError):
			api.generate_transcript(s.name)
		doc = frappe.get_doc(
			{
				"doctype": "Transcript",
				"student": s.name,
				"transcript_type": "Official",
				"status": "Issued",
				"override_fee_check": 1,
			}
		)
		with self.assertRaises(frappe.PermissionError):
			doc.insert(ignore_permissions=True)

	def test_transcript_requires_published_results(self):
		s = self.graduate(results=())
		with self.assertRaises(frappe.ValidationError):
			self.issued_transcript(s.name)

	def test_issued_transcript_is_immutable_and_revocable(self):
		s = self.graduate()
		t = self.issued_transcript(s.name)
		for field, value in (
			("transcript_type", "Provisional"),
			("cgpa", 1.0),
			("verification_code", "HACKED1234"),
		):
			doc = frappe.get_doc("Transcript", t.name)
			doc.set(field, value)
			with self.assertRaises(frappe.ValidationError):
				doc.save()
		with self.assertRaises(frappe.ValidationError):
			api.revoke_document("Transcript", t.name, "  ")
		res = api.revoke_document("Transcript", t.name, "Issued in error")
		self.assertEqual(res["status"], "Revoked")
		doc = frappe.get_doc("Transcript", t.name)
		doc.status = "Issued"
		with self.assertRaises(frappe.ValidationError):
			doc.save()
		verdict = api.verify(t.verification_code)
		self.assertEqual((verdict["valid"], verdict["status"]), (False, "revoked"))

	# ------------------------------------------------------------------ public verification
	def test_verify_returns_minimal_data_and_logs(self):
		s = self.graduate()
		t = self.issued_transcript(s.name)
		frappe.set_user("Guest")
		res = api.verify(f"  {t.verification_code.lower()} ")
		self.assertTrue(res["valid"])
		self.assertEqual(
			(
				res["status"],
				res["document_type"],
				res["student_name"],
				res["programme"],
				res["transcript_type"],
			),
			("valid", "Transcript", s.full_name, "Diploma in Credential Studies _T", "Official"),
		)
		self.assertEqual(res["student_number"], "MBC/TCRD/2090/****")
		self.assertTrue(res["institution"] and res["issue_date"])
		self.assertFalse(SENSITIVE_KEYS & set(res))
		dump = frappe.as_json(res)
		for secret in (s.student_number, s.name, s.email):
			self.assertNotIn(secret, dump)
		api.verify(t.verification_code)
		frappe.set_user("Administrator")
		self.assertEqual(frappe.db.get_value("Transcript", t.name, "verification_count"), 2)
		logs = frappe.get_all(
			"Verification Log",
			filters={"document_name": t.name},
			fields=["document_type", "result", "verified_on"],
		)
		self.assertEqual(len(logs), 2)
		self.assertEqual({(l.document_type, l.result) for l in logs}, {("Transcript", "Valid")})

		frappe.set_user("Guest")
		for bad in ("NOPE000000", "<script>", ""):
			self.assertEqual(api.verify(bad)["valid"], False)
		frappe.set_user("Administrator")
		self.assertTrue(
			frappe.db.exists(
				"Verification Log",
				{"verification_code": "NOPE000000", "result": "Not Found", "document_type": "Unknown"},
			)
		)

	def test_verify_signed_receipt_code(self):
		s = self.graduate()
		pay = fb.make_payment(s.name, 750)
		code = documents.signed_code("Student Payment", pay.name)
		res = api.verify(code)
		self.assertEqual((res["valid"], res["document_type"], res["amount"]), (True, "Receipt", 750))
		self.assertEqual(api.verify(code[:-1] + ("A" if code[-1] != "A" else "B"))["valid"], False)

	# ------------------------------------------------------------------ certificates
	def test_certificate_eligibility(self):
		ok = self.graduate()
		in_progress = self.graduate(status="Active")
		failed = self.graduate(status="Active", results=(PASSED[0], ("TCR102", 20, "E", 0.0, "Fail")))
		failed_completed = self.graduate(results=(PASSED[0], ("TCR102", 20, "E", 0.0, "Fail")))
		weak = self.graduate(
			status="Active", results=(("TCR101", 45, "D", 1.0, "Pass"), ("TCR102", 45, "D", 1.0, "Pass"))
		)
		owing = self.graduate(balance=3000)

		check = documents.certificate_eligibility
		self.assertTrue(check(ok.name)["eligible"])
		self.assertTrue(check(in_progress.name)["eligible"])  # all curriculum passed with CGPA >= minimum
		self.assertIn("Failed core", " ".join(check(failed.name)["reasons"]))
		self.assertIn("Failed core", " ".join(check(failed_completed.name)["reasons"]))
		self.assertIn("CGPA", " ".join(check(weak.name)["reasons"]))
		result = check(owing.name)
		self.assertFalse(result["eligible"])
		self.assertIn("Outstanding fee balance", " ".join(result["reasons"]))
		self.assertTrue(check(owing.name, override_fee_check=1)["eligible"])

		listed = {r["student"] for r in api.eligible_graduates(self.programme)["data"]}
		self.assertTrue({ok.name, in_progress.name} <= listed)
		self.assertFalse({failed.name, failed_completed.name, weak.name, owing.name} & listed)

	def test_issue_certificates(self):
		ok, failed, owing = (
			self.graduate(),
			self.graduate(results=(PASSED[0], ("TCR102", 20, "E", 0.0, "Fail"))),
			self.graduate(balance=3000),
		)
		frappe.set_user(self.registrar)
		out = api.issue_certificates(
			frappe.as_json([ok.name, failed.name, owing.name]), graduation_date=today()
		)
		self.assertFalse(out["queued"])
		self.assertEqual((out["issued_count"], out["skipped_count"]), (1, 2))
		self.assertEqual(out["issued"][0]["student"], ok.name)

		cert = frappe.get_doc("Certificate", out["issued"][0]["certificate"])
		self.assertEqual(
			(cert.status, cert.award_title, cert.programme, cert.cgpa),
			("Issued", "Diploma in Credential Studies", self.programme, 3.5),
		)
		from mahanaim.services.grading import classification_for

		self.assertEqual(cert.classification, classification_for(3.5))
		year = frappe.utils.getdate(today()).year
		self.assertTrue(
			re.fullmatch(rf"[A-Z0-9]+/TCRD/{year}/\d{{4,5}}", cert.certificate_serial),
			cert.certificate_serial,
		)
		self.assertTrue(re.fullmatch(r"[A-Z0-9]{10}", cert.verification_code))
		self.assertEqual(len(self.notified("Certificate Ready")), 1)

		again = api.issue_certificates([ok.name])
		self.assertEqual(again["issued_count"], 0)
		self.assertIn("already been issued", again["skipped"][0]["reason"])

		forced = api.issue_certificates([owing.name], override_fee_check=1)
		self.assertEqual(forced["issued_count"], 1)
		second = frappe.get_doc("Certificate", forced["issued"][0]["certificate"])
		self.assertNotEqual(second.certificate_serial, cert.certificate_serial)
		self.assertNotEqual(second.verification_code, cert.verification_code)
		self.assertIn("overridden", second.eligibility_notes)

		res = api.verify(cert.verification_code)
		self.assertEqual(
			(res["document_type"], res["award"], res["certificate_serial"]),
			("Certificate", "Diploma in Credential Studies", cert.certificate_serial),
		)
		revoked = api.revoke_document("Certificate", cert.name, "Award rescinded")
		self.assertEqual(revoked["status"], "Revoked")
		self.assertEqual(api.verify(cert.verification_code)["status"], "revoked")

	# ------------------------------------------------------------------ printing & access
	def test_render_html_and_pdf(self):
		from pypdf import PdfReader

		s = self.graduate()
		inv = fb.make_invoice(s.name, 2000, term=self.term)
		pay = fb.make_payment(s.name, 500)
		t = self.issued_transcript(s.name, override_fee_check=1)
		cert = frappe.get_doc(
			{
				"doctype": "Certificate",
				"student": s.name,
				"status": "Issued",
				"graduation_date": today(),
				"override_fee_check": 1,
			}
		).insert()
		docs = {
			"Student Invoice": (inv.name, (inv.name, "2,000.00")),
			"Student Payment": (pay.name, (pay.name, "500.00")),
			"Fee Statement": (s.name, ("1,500.00",)),
			"Transcript": (t.name, (t.verification_code, "TCR101", "Official")),
			"Certificate": (
				cert.name,
				(cert.certificate_serial, cert.verification_code, "Diploma in Credential Studies"),
			),
		}
		for doctype, (name, expected) in docs.items():
			html = documents.render_html(doctype, name)
			for text in (s.full_name, "data:image/png;base64", *expected):
				self.assertIn(text, html, f"{doctype}: {text!r} missing")
			filename, pdf = documents.render_pdf(doctype, name)
			self.assertTrue(pdf.startswith(b"%PDF"), doctype)
			self.assertTrue(filename.endswith(".pdf"))
			pages = len(PdfReader(BytesIO(pdf)).pages)
			if doctype == "Certificate":
				self.assertEqual(pages, 1, "certificate must fit one A4 landscape page")
				self.assertIn(cert.certificate_serial.replace("/", "-"), filename)
			else:
				self.assertGreaterEqual(pages, 1)

		draft = frappe.get_doc(
			{"doctype": "Transcript", "student": s.name, "transcript_type": "Official"}
		).insert()
		self.assertIn("DRAFT", documents.render_html("Transcript", draft.name))

	def test_print_permissions(self):
		a, b = self.graduate(), self.graduate()
		t = self.issued_transcript(a.name)
		draft = frappe.get_doc(
			{"doctype": "Transcript", "student": a.name, "transcript_type": "Official"}
		).insert()
		try:
			frappe.set_user(b.user)
			for call in (
				lambda: api.print_view("Transcript", t.name),
				lambda: api.download_pdf("Transcript", t.name),
			):
				with self.assertRaises(frappe.PermissionError):
					call()
			with self.assertRaises(frappe.PermissionError):
				api.list_transcripts()

			frappe.set_user(a.user)
			api.print_view("Transcript", t.name)
			self.assertEqual(frappe.local.response["type"], "download")
			self.assertIn(t.verification_code, frappe.local.response["filecontent"])
			with self.assertRaises(frappe.PermissionError):
				api.print_view("Transcript", draft.name)  # drafts are staff-only

			frappe.set_user(self.registrar)
			api.print_view("Transcript", draft.name)
			self.assertIn("DRAFT", frappe.local.response["filecontent"])
		finally:
			frappe.local.response = frappe._dict(docs=[])

	def test_student_documents_and_transcript_request(self):
		s = self.graduate()
		t = self.issued_transcript(s.name)
		frappe.get_doc({"doctype": "Transcript", "student": s.name, "transcript_type": "Final"}).insert()
		frappe.set_user(s.user)
		mine = api.my_documents()
		self.assertEqual([r.name for r in mine["transcripts"]], [t.name])
		self.assertIn(t.verification_code, mine["transcripts"][0]["verification_url"])

		req = api.request_transcript("Official", 2, "Email")
		row = frappe.db.get_value(
			"Student Request",
			req["name"],
			["student", "request_type", "document_type", "copies", "delivery_method", "status"],
		)
		self.assertEqual(row, (s.name, "Transcript Request", "Official", 2, "Email", "Pending"))
		with self.assertRaises(frappe.ValidationError):
			api.request_transcript("Official", 1, "Collect")  # one open request per type
		for bad in (("Unofficial", 1, "Collect"), ("Final", 0 + 11, "Collect"), ("Final", 1, "Pigeon")):
			with self.assertRaises(frappe.ValidationError):
				api.request_transcript(*bad)
		self.assertEqual(len(api.my_documents()["requests"]), 1)
