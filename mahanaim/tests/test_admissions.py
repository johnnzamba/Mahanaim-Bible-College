import random
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, flt, getdate, nowdate, random_string

from mahanaim.api import admissions as adm
from mahanaim.services.admissions import mark_application_fee_paid
from mahanaim.services.students import create_student_from_application
from mahanaim.tests import factories as f
from mahanaim.tests import factories_b1 as fb


class TestAdmissions(IntegrationTestCase):
	def setUp(self):
		fb.no_commit(self)
		fb.use_settings(
			self,
			application_fee_required=0,
			auto_create_student_on_acceptance=0,
			offer_expiry_days=30,
			student_number_format="MBC/{programme_code}/{year}/{####}",
		)
		patcher = patch("mahanaim.services.communication.notify")
		self.notify = patcher.start()
		self.addCleanup(patcher.stop)

	def events(self):
		return [c.args[0] for c in self.notify.call_args_list]

	def officer(self):
		return f.make_user(
			f"officer.{random_string(6).lower()}@example.com", roles=("Admissions Officer",)
		).name

	# ------------------------------------------------------------------ controller
	def test_status_machine(self):
		app = fb.make_application()
		self.assertEqual(app.full_name, "Ann Applicant _T")
		self.assertTrue(app.programme_name)
		self.assertEqual(flt(app.application_fee), 0)

		app.status = "Admitted"
		with self.assertRaisesRegex(frappe.ValidationError, "cannot move"):
			app.save()
		app.reload()

		fb.advance(app, "Under Review")
		app.status = "Interview"
		with self.assertRaisesRegex(frappe.ValidationError, "interview date"):
			app.save()
		app.reload()
		app.interview_date = add_days(nowdate(), 2)
		app.status = "Interview"
		app.save()
		app.status = "Admitted"
		app.save()
		self.assertEqual(getdate(app.decision_date), getdate(nowdate()))
		self.assertEqual(getdate(app.offer_expiry), getdate(add_days(nowdate(), 30)))
		self.assertTrue(app.admission_letter_issued)
		app.status = "Accepted"
		app.save()
		self.assertTrue(app.accepted_on)
		self.assertTrue(app.submitted_on)

		self.assertEqual(
			[r.to_status for r in app.status_log],
			["Draft", "Submitted", "Under Review", "Interview", "Admitted", "Accepted"],
		)
		for event in (
			"Application Submitted",
			"Application Under Review",
			"Interview Scheduled",
			"Application Approved",
			"Offer Accepted",
		):
			self.assertIn(event, self.events())
		app.status = "Rejected"
		with self.assertRaises(frappe.ValidationError):
			app.save()

	def test_duplicate_active_application(self):
		user, programme, intake = fb.make_applicant().name, fb.make_programme().name, fb.make_intake().name
		first = fb.make_application(user, programme, intake)
		with self.assertRaises(frappe.DuplicateEntryError):
			fb.make_application(user, programme, intake)
		fb.make_application(user, programme, fb.make_intake().name)  # another intake is fine
		first.status = "Withdrawn"
		first.save()
		self.assertTrue(fb.make_application(user, programme, intake).name)

	def test_submission_requires_complete_application(self):
		app = fb.make_application(declaration_accepted=0, home_church=None, documents=[])
		app.status = "Submitted"
		with self.assertRaises(frappe.ValidationError) as ctx:
			app.save()
		for missing in ("Declaration", "National ID", "Passport Photo", "Home Church"):
			self.assertIn(missing, str(ctx.exception))

		closed = fb.make_application(intake=fb.make_intake(applications_open=0).name)
		closed.status = "Submitted"
		with self.assertRaisesRegex(frappe.ValidationError, "closed"):
			closed.save()

	# ------------------------------------------------------------------ fees
	def test_awaiting_fee_and_fee_paid_hook(self):
		fb.use_settings(self, application_fee_required=1, application_fee=1500)
		user = fb.make_applicant().name
		app = fb.make_application(user)
		self.assertEqual(flt(app.application_fee), 1500)

		fb.as_user(self, user)
		data = adm.submit_application(app.name)
		self.assertEqual(data["status"], "Submitted")
		self.assertTrue(data["awaiting_fee"])
		self.assertEqual(data["next_action"], "pay_fee")
		frappe.set_user("Administrator")

		with self.assertRaisesRegex(frappe.ValidationError, "fee"):
			adm.start_review(app.name)

		self.notify.reset_mock()
		mark_application_fee_paid(app.name)
		mark_application_fee_paid(app.name)  # idempotent (e.g. a repeated M-Pesa callback)
		self.assertEqual(self.events().count("Application Fee Paid"), 1)
		app.reload()
		self.assertEqual(app.fee_status, "Paid")
		self.assertEqual(adm.start_review(app.name)["status"], "Under Review")

		# A complete draft is submitted automatically when the fee arrives.
		draft = fb.make_application()
		mark_application_fee_paid(draft.name)
		self.assertEqual(frappe.db.get_value("Programme Application", draft.name, "status"), "Submitted")

	def test_waive_fee(self):
		fb.use_settings(self, application_fee_required=1, application_fee=1000)
		app = fb.make_application(status="Submitted")
		fb.as_user(self, self.officer())
		with self.assertRaises(frappe.ValidationError):
			adm.waive_application_fee(app.name, " ")
		data = adm.waive_application_fee(app.name, "Pastor's family")
		self.assertEqual(data["fee_status"], "Waived")
		self.assertFalse(data["awaiting_fee"])

	# ------------------------------------------------------------------ student creation
	def test_create_student_from_application(self):
		code = fb.code("C")
		programme = fb.make_programme(code)
		user = fb.make_applicant().name
		app = fb.make_application(user, programme.name, fb.make_intake().name)
		with self.assertRaises(frappe.ValidationError):
			create_student_from_application(app.name)  # still a draft
		fb.advance(app, "Accepted")
		self.assertFalse(app.student)

		name = create_student_from_application(app.name)
		self.assertEqual(create_student_from_application(app.name), name)
		self.assertEqual(frappe.db.count("Student", {"programme_application": app.name}), 1)

		student = frappe.get_doc("Student", name)
		self.assertEqual(student.student_number, f"MBC/{code}/{getdate(nowdate()).year}/0001")
		self.assertEqual(student.status, "Admitted")
		self.assertEqual(student.user, user)
		for field in (
			"intake",
			"study_mode",
			"programme",
			"campus",
			"home_church",
			"pastor_name",
			"national_id",
			"nok_name",
			"gender",
		):
			self.assertEqual(student.get(field), app.get(field), field)
		self.assertTrue({"Student", "Applicant"} <= set(frappe.get_roles(user)))
		self.assertEqual(frappe.db.get_value("Programme Application", app.name, "student"), name)
		self.assertEqual(self.events().count("Student Created"), 1)

	def test_accepting_offer_creates_student(self):
		fb.use_settings(self, auto_create_student_on_acceptance=1)
		user = fb.make_applicant().name
		app = fb.make_application(user, status="Admitted")
		fb.as_user(self, user)
		data = adm.accept_offer(app.name)
		self.assertEqual(data["status"], "Accepted")
		self.assertTrue(data["student"])
		self.assertTrue(data["student_number"])
		self.assertEqual(data["next_action"], "go_to_student_portal")

	# ------------------------------------------------------------------ applicant API
	def test_applicant_endpoints(self):
		user = fb.make_applicant(phone=fb.unique_phone()).name
		programme = fb.make_programme().name
		fb.as_user(self, user)
		data = adm.save_application(
			{
				"last_name": "Wanjiru",
				"programme": programme,
				"campus": f.make_campus().name,
				"study_mode": "Full Time",
				"intake": fb.make_intake().name,
				"status": "Admitted",
				"fee_status": "Waived",
				"academic_records": [
					{"institution": "Moi High", "qualification": "KCSE", "year_completed": 2012}
				],
			}
		)
		self.assertEqual(data["status"], "Draft")
		self.assertEqual(data["fee_status"], "Unpaid")
		self.assertEqual(data["email"], user)
		self.assertEqual(len(data["academic_records"]), 1)
		self.assertIn("Declaration", data["missing"])

		data = adm.save_application({"first_name": "Annie", "student": "STU-HACK"}, name=data["name"])
		self.assertEqual(data["first_name"], "Annie")
		self.assertFalse(data["student"])
		self.assertEqual(adm.my_applications()["total"], 1)
		with self.assertRaisesRegex(frappe.ValidationError, "complete"):
			adm.submit_application(data["name"])
		self.assertEqual(adm.withdraw_application(data["name"])["status"], "Withdrawn")

	def test_application_attach_validation(self):
		user, other = fb.make_applicant().name, fb.make_applicant().name
		mine, theirs = _upload(user, "mine.png"), _upload(other, "theirs.png")
		name = fb.make_application(user).name
		fb.as_user(self, user)

		for bad in (
			"https://evil.example/x.png",
			"//evil.example/x.png",
			"javascript:alert(1)",
			"data:image/png;base64,iVBORw0KGgo=",
			"/files/../private/files/x.png",
			"/api/method/frappe.client.get",
		):
			with self.assertRaisesRegex(frappe.ValidationError, "uploaded through the portal"):
				adm.save_application({"photo": bad}, name=name)
			with self.assertRaisesRegex(frappe.ValidationError, "uploaded through the portal"):
				adm.save_application(
					{"documents": [{"document_type": "National ID", "file": bad}]}, name=name
				)
			with self.assertRaisesRegex(frappe.ValidationError, "uploaded through the portal"):
				adm.upload_application_document(name, "National ID", bad)
			with self.assertRaisesRegex(frappe.ValidationError, "uploaded through the portal"):
				adm.save_application({"photo": bad})
		with self.assertRaises(frappe.PermissionError):
			adm.save_application({"photo": theirs.file_url}, name=name)
		with self.assertRaises(frappe.PermissionError):
			adm.upload_application_document(name, "National ID", theirs.file_url)

		data = adm.save_application({"photo": f" {mine.file_url} "}, name=name)
		self.assertEqual(data["photo"], mine.file_url)
		self.assertEqual(
			frappe.db.get_value("File", mine.name, ["attached_to_name", "attached_to_field"]),
			(name, "photo"),
		)
		# unchanged value re-saves fine; empty clears it
		adm.save_application({"photo": mine.file_url, "first_name": "Annie"}, name=name)
		self.assertIsNone(adm.save_application({"photo": ""}, name=name)["photo"])
		self.assertEqual(frappe.db.get_value("File", theirs.name, "attached_to_name"), None)

	def test_permission_denials(self):
		owner, other = fb.make_applicant().name, fb.make_applicant().name
		app = fb.make_application(owner, status="Admitted")

		fb.as_user(self, other)
		for call in (
			lambda: adm.get_my_application(app.name),
			lambda: adm.accept_offer(app.name),
			lambda: adm.withdraw_application(app.name),
			lambda: adm.admission_letter(app.name),
			lambda: adm.list_applications(),
			lambda: adm.get_application(app.name),
			lambda: adm.decide(app.name, "Rejected"),
		):
			with self.assertRaises(frappe.PermissionError):
				call()
		self.assertEqual(adm.my_applications()["total"], 0)

		frappe.set_user("Guest")
		with self.assertRaises(frappe.AuthenticationError):
			adm.my_applications()
		with self.assertRaises(frappe.AuthenticationError):
			adm.get_my_application(app.name)

	# ------------------------------------------------------------------ staff API
	def test_document_verification(self):
		user = fb.make_applicant().name
		app = fb.make_application(user, status="Submitted")
		national_id, photo = (r.name for r in app.documents[:2])
		officer = self.officer()
		fb.as_user(self, officer)

		data = adm.verify_application_document(app.name, national_id, 1)
		row = next(d for d in data["documents"] if d["name"] == national_id)
		self.assertEqual((row["verified"], row["needs_reupload"]), (1, False))
		self.assertEqual((data["documents_total"], data["documents_verified"]), (3, 1))
		self.assertIn("duplicates", data)  # full staff dict
		self.assertIn("National ID verified", data["status_log"][-1]["note"])
		logged = len(data["status_log"])
		self.assertEqual(
			len(adm.verify_application_document(app.name, national_id, "true")["status_log"]), logged
		)

		data = adm.verify_application_document(app.name, photo, 0, remarks=" Blurry scan ")
		self.assertEqual(data["documents_flagged"], 1)
		self.assertTrue(next(d for d in data["documents"] if d["name"] == photo)["needs_reupload"])
		flagged = [c for c in self.notify.call_args_list if c.args[0] == "Application Document Flagged"]
		self.assertEqual(len(flagged), 1)
		self.assertEqual(flagged[0].kwargs["context"]["remarks"], "Blurry scan")
		self.assertIn(
			"Please re-upload your Passport Photo: Blurry scan", flagged[0].kwargs["fallback"]["in_app"]
		)
		self.assertEqual(flagged[0].kwargs["recipients"][0]["user"], user)

		data = adm.verify_application_document(app.name, national_id, "0")
		self.assertEqual((data["documents_verified"], data["documents_flagged"]), (0, 1))
		self.assertEqual(self.events().count("Application Document Flagged"), 1)
		listed = next(r for r in adm.list_applications(search=app.name)["data"] if r["name"] == app.name)
		self.assertEqual(
			(listed["documents_total"], listed["documents_verified"], listed["documents_flagged"]), (3, 0, 1)
		)
		for bad in (
			lambda: adm.verify_application_document(app.name, photo, "maybe"),
			lambda: adm.verify_application_document(app.name, photo, 0, "x" * 141),
		):
			with self.assertRaises(frappe.ValidationError):
				bad()
		with self.assertRaises(frappe.DoesNotExistError):
			adm.verify_application_document(app.name, "no-such-row", 1)

		# the applicant re-uploads the flagged document: remark cleared, staff see a note, the applicant does not
		fb.as_user(self, user)
		with self.assertRaises(frappe.PermissionError):
			adm.verify_application_document(app.name, photo, 1)
		mine = adm.upload_application_document(
			app.name, "Passport Photo", _upload(user, "again.png").file_url
		)
		self.assertEqual(mine["documents_flagged"], 0)
		self.assertIsNone(next(d for d in mine["documents"] if d["name"] == photo)["remarks"])
		self.assertTrue(all(r["from_status"] != r["to_status"] for r in mine["status_log"]))
		cert = adm.upload_application_document(
			app.name, "Academic Certificate", _upload(user, "c.png").file_url
		)
		cert_row = next(d["name"] for d in cert["documents"] if d["document_type"] == "Academic Certificate")

		fb.as_user(self, officer)
		self.assertIn("re-uploaded", adm.get_application(app.name)["status_log"][-1]["note"])
		adm.verify_application_document(app.name, cert_row, 0, "Wrong certificate")
		fb.as_user(self, user)
		mine = adm.upload_application_document(
			app.name, "Academic Certificate", _upload(user, "c2.png").file_url, row=cert_row
		)
		self.assertEqual((mine["documents_total"], mine["documents_flagged"]), (4, 0))

		for role in ("Academic Dean", "Finance Officer"):
			fb.as_user(self, f.make_user(f"{random_string(8).lower()}@example.com", roles=(role,)).name)
			with self.assertRaises(frappe.PermissionError):
				adm.verify_application_document(app.name, photo, 1)
		frappe.set_user("Administrator")
		fb.advance(app.reload(), "Admitted")
		with self.assertRaisesRegex(frappe.ValidationError, "only be verified"):
			adm.verify_application_document(app.name, photo, 1)

	def test_staff_review_and_bulk_decisions(self):
		intake = fb.make_intake().name
		a1 = fb.make_application(intake=intake, status="Submitted")
		a2 = fb.make_application(intake=intake, status="Under Review")
		a3 = fb.make_application(intake=intake)
		fb.as_user(self, self.officer())

		listing = adm.list_applications(intake=intake)
		self.assertEqual(listing["total"], 3)
		self.assertEqual(listing["counts_by_status"], {"Submitted": 1, "Under Review": 1, "Draft": 1})
		self.assertEqual(adm.list_applications(intake=intake, status="Draft")["total"], 1)

		self.assertEqual(adm.start_review(a1.name)["status"], "Under Review")
		with self.assertRaises(frappe.ValidationError):
			adm.schedule_interview(a1.name, str(add_days(nowdate(), -1)))
		self.assertEqual(
			adm.schedule_interview(a1.name, f"{add_days(nowdate(), 3)} 10:00:00")["status"], "Interview"
		)
		with self.assertRaises(frappe.ValidationError):
			adm.decide(a1.name, "Accepted")
		admitted = adm.decide(a1.name, "Admitted", notes="Strong testimony")
		self.assertEqual(admitted["status"], "Admitted")
		self.assertTrue(admitted["offer_expiry"])

		result = adm.bulk_decide([a2.name, a3.name], "Rejected", rejection_reason="Programme full")
		self.assertFalse(result["ok"])
		self.assertEqual(result["updated"], [a2.name])
		self.assertEqual([r["name"] for r in result["failed"]], [a3.name])
		self.assertEqual(
			frappe.db.get_value("Programme Application", a2.name, "rejection_reason"), "Programme full"
		)

		detail = adm.get_application(a1.name)
		self.assertIn("duplicates", detail)
		self.assertTrue(detail["status_log"][-1]["user"])
		stats = adm.admissions_stats(intake=intake)
		self.assertEqual(stats["total"], 3)

		converted = adm.convert_to_student(a1.name)
		self.assertTrue(converted["student_number"])
		self.assertEqual(adm.convert_to_student(a1.name)["student"], converted["student"])

	def test_admission_letter(self):
		user = fb.make_applicant().name
		draft = fb.make_application(user)
		app = fb.make_application(user, programme=fb.make_programme().name, status="Admitted")
		fb.as_user(self, user)
		with self.assertRaises(frappe.ValidationError):
			adm.admission_letter(draft.name)
		html = adm.admission_letter(app.name)["html"]
		self.assertIn(app.full_name, html)
		self.assertIn(app.programme_name, html)
		adm.admission_letter(app.name, format="pdf")
		self.assertEqual(frappe.local.response.type, "pdf")
		self.assertTrue(frappe.local.response.filecontent.startswith(b"%PDF"))


def _upload(user: str, file_name: str):
	"""A private File uploaded by `user` (what /api/method/upload_file creates)."""
	import io

	from PIL import Image

	buf = io.BytesIO()
	Image.new("RGB", (2, 2), tuple(random.randrange(256) for _ in range(3))).save(buf, "PNG")
	saved = frappe.session.user
	frappe.set_user(user)
	try:
		return frappe.get_doc(
			{"doctype": "File", "file_name": file_name, "content": buf.getvalue(), "is_private": 1}
		).insert(ignore_permissions=True)
	finally:
		frappe.set_user(saved)
