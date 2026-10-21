import json

import frappe
from frappe.core.doctype.activity_log.activity_log import add_authentication_log
from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, random_string, today

from mahanaim.api import audit as api
from mahanaim.services import audit as svc
from mahanaim.tests import factories as f
from mahanaim.tests import factories_b3 as fb


def make_version(ref_doctype, docname, data, creation=None):
	v = frappe.get_doc(
		{"doctype": "Version", "ref_doctype": ref_doctype, "docname": docname, "data": json.dumps(data)}
	).insert(ignore_permissions=True)
	if creation:
		frappe.db.set_value("Version", v.name, "creation", creation, update_modified=False)
	return v.name


class TestAudit(IntegrationTestCase):
	def setUp(self):
		frappe.set_user("Administrator")

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.local.response = frappe._dict(docs=[])

	def test_role_gate(self):
		frappe.set_user(f.make_user(roles=("Student",)).name)
		for fn in (api.document_changes, api.access_log, api.audit_summary, api.audit_doctypes):
			self.assertRaises(frappe.PermissionError, fn)
		self.assertRaises(frappe.PermissionError, api.export_audit, "access_log")
		frappe.set_user(f.make_user(roles=("Auditor",)).name)
		self.assertEqual(set(api.document_changes(page_length=1)), {"rows", "total"})
		options = {d["value"] for d in api.audit_doctypes()}
		self.assertIn("Student Invoice", options)
		self.assertNotIn("User", options)

	def test_changed_document_is_parsed(self):
		comp = fb.make_component(f"Audit Fee {random_string(5)} _T", amount=100)
		comp.default_amount = 150
		comp.description = "x" * 500
		comp.save(ignore_permissions=True, ignore_version=False)  # tests skip Version by default
		out = api.document_changes(doctype="Fee Component", docname=comp.name)
		self.assertEqual(out["total"], 1)
		row = out["rows"][0]
		self.assertEqual((row["owner"], row["is_new"]), ("Administrator", False))
		self.assertTrue(row["owner_name"])
		changes = {c["field"]: c for c in row["changed"]}
		self.assertEqual(
			(changes["default_amount"]["old"], changes["default_amount"]["new"]), ("100.00", "150.00")
		)
		self.assertEqual(changes["default_amount"]["label"], "Default Amount")
		self.assertEqual(len(changes["description"]["new"]), svc.VALUE_LIMIT)
		self.assertEqual(api.document_changes(search=comp.name)["total"], 1)
		self.assertRaises(frappe.ValidationError, api.document_changes, doctype="User")
		parsed = svc.parse_version_data(
			"Fee Structure",
			{"row_changed": [["items", 1, "row1", [["amount", "10.00", "12.00"]]]], "added": [["items", {}]]},
		)
		self.assertEqual(parsed["changed"][0]["field"], "items[2].amount")
		self.assertEqual(parsed["changed"][0]["label"], "Items (row 2): Amount")
		self.assertEqual((parsed["added"], parsed["row_changed"]), (1, 1))

	def test_password_values_are_masked(self):
		fb.setup_mpesa(enabled=0)
		settings = frappe.get_single("M-Pesa Settings")
		settings.passkey = "pk_secret_rotated_value"
		settings.save(ignore_permissions=True, ignore_version=False)
		make_version(
			"M-Pesa Settings", "M-Pesa Settings", {"changed": [["consumer_secret", "plain1", "plain2"]]}
		)
		out = api.document_changes(doctype="M-Pesa Settings", page_length=5)
		changes = [
			c for r in out["rows"] for c in r["changed"] if c["field"] in ("passkey", "consumer_secret")
		]
		self.assertEqual({c["field"] for c in changes}, {"passkey", "consumer_secret"})
		for c in changes:
			self.assertEqual((c["old"], c["new"]), (svc.MASK, svc.MASK))
		dump = frappe.as_json(out)
		self.assertNotIn("pk_secret", dump)
		self.assertNotIn("plain1", dump)

	def test_date_filtering_and_summary(self):
		docname = f"PAY-AUDIT-{random_string(6)}"
		name = make_version(
			"Student Payment", docname, {"changed": [["docstatus", 1, 2]]}, "2020-03-15 10:00:00"
		)

		def found(**kwargs):
			return [r["name"] for r in api.document_changes(docname=docname, **kwargs)["rows"]]

		self.assertEqual(found(from_date="2020-03-15", to_date="2020-03-15"), [name])
		self.assertEqual(found(from_date="2020-03-16"), [])
		self.assertEqual(found(to_date="2020-03-14"), [])
		self.assertEqual(api.document_changes(docname=docname)["rows"][0]["changed"][0]["new"], "Cancelled")

		summary = api.audit_summary(from_date="2020-03-01", to_date="2020-03-31")
		self.assertEqual(len(summary["daily"]), 31)
		self.assertGreaterEqual(summary["daily"][14]["changes"], 1)
		self.assertIn("Student Payment", [r["doctype"] for r in summary["changes_by_doctype"]])
		event = next(e for e in summary["sensitive_events"] if e["name"] == name)
		self.assertEqual(event["kind"], "cancellation")
		self.assertRaises(frappe.ValidationError, api.audit_summary, "2020-03-31", "2020-03-01")

	def test_access_log_and_export(self):
		user = f.make_user(roles=("Student",), first_name="Auditee")
		add_authentication_log("Incorrect password", user.name, status="Failed")
		add_authentication_log("Auditee logged in", user.name)
		self.assertEqual(api.access_log(user=user.name)["total"], 2)
		failed = api.access_log(user=user.name, status="Failed")
		self.assertEqual(failed["total"], 1)
		self.assertEqual(
			(failed["rows"][0]["full_name"], failed["rows"][0]["operation"]), ("Auditee", "Login")
		)
		self.assertEqual(api.access_log(user=user.name, from_date=add_days(today(), 1))["total"], 0)
		totals = api.audit_summary()["totals"]
		self.assertGreaterEqual(totals["failed_logins"], 1)
		self.assertGreaterEqual(totals["logins"], 1)

		add_authentication_log('=HYPERLINK("http://x")', user.name, status="Failed")
		api.export_audit("access_log", json.dumps({"user": user.name}))
		self.assertEqual(frappe.response["type"], "download")
		content = frappe.response["filecontent"]
		self.assertIn("'=HYPERLINK", content)
		self.assertEqual(len(content.strip().splitlines()), 4)
		self.assertRaises(frappe.ValidationError, api.export_audit, "everything")
