"""Credentials API (B3): transcripts, certificates, document printing and public verification."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.rate_limiter import rate_limit
from frappe.utils import cint, getdate

from mahanaim.api.finance import _list, send_document
from mahanaim.api.utils import parse_json, require_login, require_roles, require_student
from mahanaim.services import documents
from mahanaim.utils import ROLE_AUDITOR, ROLE_DEAN, ROLE_REGISTRAR

READ_ROLES = (ROLE_REGISTRAR, ROLE_DEAN, ROLE_AUDITOR)
TRANSCRIPT_TYPES = ("Provisional", "Official", "Final")
DELIVERY_METHODS = ("Collect", "Email", "Courier")
TRANSCRIPT_FIELDS = [
	"name",
	"student",
	"student_name",
	"student_number",
	"programme",
	"transcript_type",
	"status",
	"issue_date",
	"as_of_term",
	"cgpa",
	"total_credits",
	"classification",
	"verification_code",
	"issued_by",
	"request",
	"verification_count",
	"override_fee_check",
	"creation",
]
CERTIFICATE_FIELDS = [
	"name",
	"student",
	"student_name",
	"student_number",
	"programme",
	"award_title",
	"status",
	"certificate_serial",
	"verification_code",
	"classification",
	"completion_date",
	"graduation_date",
	"cgpa",
	"issue_date",
	"issued_by",
	"verification_count",
	"override_fee_check",
	"creation",
]


def require_registrar() -> str:
	return require_roles(ROLE_REGISTRAR)


def require_registry_read() -> str:
	return require_roles(*READ_ROLES)


CREDENTIAL_STATUSES = ("Draft", "Issued", "Revoked")


def _with_status_counts(doctype: str, filters: dict, or_filters, result: dict) -> dict:
	"""Add `counts_by_status` ({status: n}, every status present) for the same filters minus the status filter."""
	rows = frappe.get_list(
		doctype,
		filters={k: v for k, v in filters.items() if k != "status"},
		or_filters=or_filters,
		fields=["status", {"COUNT": "*", "as": "n"}],
		group_by="status",
		order_by="status asc",
	)
	counts = dict.fromkeys(CREDENTIAL_STATUSES, 0)
	counts.update({r.status: cint(r.n) for r in rows if r.status})
	result["counts_by_status"] = counts
	return result


# ---------------------------------------------------------------------------------- public verification
@frappe.whitelist(allow_guest=True, methods=["GET", "POST"])
@rate_limit(limit=10, seconds=60)
def verify(code, requester_name=None, requester_organisation=None):
	"""Public: verify a transcript/certificate code (or a signed receipt/invoice code). Minimal data only."""
	request = getattr(frappe.local, "request", None)
	user_agent = request.headers.get("User-Agent") if request is not None else None
	result = documents.verify_code(
		code,
		ip=getattr(frappe.local, "request_ip", None),
		user_agent=user_agent,
		requester_name=requester_name,
		requester_organisation=requester_organisation,
	)
	frappe.local.flags.commit = True  # persist the Verification Log on GET requests too
	return result


@frappe.whitelist()
def verification_logs(code=None, document_type=None, result=None, start=0, page_length=50):
	require_registry_read()
	f = {}
	code = (code or "").strip()
	if code:
		# partial and case-insensitive (the column uses a case-insensitive collation)
		f["verification_code"] = ["like", f"%{code}%"]
	if document_type:
		f["document_type"] = document_type
	if result:
		f["result"] = result
	return _list(
		"Verification Log",
		f,
		[
			"name",
			"verification_code",
			"document_type",
			"document_name",
			"result",
			"verified_on",
			"ip_address",
			"requester_name",
			"requester_organisation",
		],
		start,
		page_length,
		"verified_on desc",
	)


# ---------------------------------------------------------------------------------- student portal
@frappe.whitelist()
def my_documents():
	student = require_student()
	transcripts = frappe.get_all(
		"Transcript",
		filters={"student": student.name, "status": "Issued"},
		fields=[
			"name",
			"transcript_type",
			"issue_date",
			"as_of_term",
			"cgpa",
			"total_credits",
			"classification",
			"verification_code",
		],
		order_by="issue_date desc",
	)
	certificates = frappe.get_all(
		"Certificate",
		filters={"student": student.name, "status": "Issued"},
		fields=[
			"name",
			"award_title",
			"certificate_serial",
			"classification",
			"graduation_date",
			"issue_date",
			"verification_code",
		],
		order_by="issue_date desc",
	)
	from mahanaim.utils.jinja import verification_url

	for row in transcripts + certificates:
		row["verification_url"] = verification_url(row.verification_code)
	requests = frappe.get_all(
		"Student Request",
		filters={"student": student.name, "request_type": "Transcript Request"},
		fields=["name", "status", "document_type", "copies", "delivery_method", "creation", "review_notes"],
		order_by="creation desc",
		limit=20,
	)
	return {"transcripts": transcripts, "certificates": certificates, "requests": requests}


@frappe.whitelist(methods=["POST"])
def request_transcript(type="Official", copies=1, delivery_method="Collect", reason=None):
	student = require_student()
	if type not in TRANSCRIPT_TYPES:
		frappe.throw(_("Transcript type must be one of {0}").format(", ".join(TRANSCRIPT_TYPES)))
	if delivery_method not in DELIVERY_METHODS:
		frappe.throw(_("Delivery method must be one of {0}").format(", ".join(DELIVERY_METHODS)))
	copies = cint(copies) or 1
	if not 1 <= copies <= 10:
		frappe.throw(_("You can request between 1 and 10 copies"))
	open_request = frappe.db.get_value(
		"Student Request",
		{
			"student": student.name,
			"request_type": "Transcript Request",
			"document_type": type,
			"status": ["in", ["Pending", "Under Review"]],
		},
		"name",
	)
	if open_request:
		frappe.throw(_("You already have an open {0} transcript request ({1})").format(type, open_request))
	doc = frappe.get_doc(
		{
			"doctype": "Student Request",
			"student": student.name,
			"request_type": "Transcript Request",
			"document_type": type,
			"copies": copies,
			"delivery_method": delivery_method,
			"reason": reason or _("{0} transcript request").format(type),
			"status": "Pending",
		}
	)
	doc.insert(ignore_permissions=True)
	return {
		"name": doc.name,
		"status": doc.status,
		"document_type": type,
		"copies": copies,
		"delivery_method": delivery_method,
	}


# ---------------------------------------------------------------------------------- registrar: transcripts
@frappe.whitelist()
def list_transcripts(
	status=None, student=None, transcript_type=None, search=None, start=0, page_length=20, request=None
):
	require_registry_read()
	f = {}
	for key, value in (
		("status", status),
		("student", student),
		("transcript_type", transcript_type),
		("request", request),
	):
		if value:
			f[key] = value
	or_filters = None
	if search:
		like = f"%{search.strip()}%"
		or_filters = [
			["name", "like", like],
			["student_name", "like", like],
			["student_number", "like", like],
		]
	result = _list("Transcript", f, TRANSCRIPT_FIELDS, start, page_length, "creation desc", or_filters)
	return _with_status_counts("Transcript", f, or_filters, result)


def _transcript_detail(name: str) -> dict:
	doc = frappe.get_doc("Transcript", name)
	data = doc.as_dict()
	data["snapshot"] = documents._snapshot(doc)
	return data


@frappe.whitelist()
def get_transcript(name):
	require_registry_read()
	frappe.has_permission("Transcript", "read", name, throw=True)
	return _transcript_detail(name)


@frappe.whitelist(methods=["POST"])
def generate_transcript(student, type="Official", as_of_term=None, request=None):
	require_registrar()
	if type not in TRANSCRIPT_TYPES:
		frappe.throw(_("Transcript type must be one of {0}").format(", ".join(TRANSCRIPT_TYPES)))
	doc = frappe.get_doc(
		{
			"doctype": "Transcript",
			"student": student,
			"transcript_type": type,
			"as_of_term": as_of_term or None,
			"request": request or None,
			"status": "Draft",
		}
	).insert()
	return _transcript_detail(doc.name)


@frappe.whitelist(methods=["POST"])
def refresh_transcript(name):
	"""Re-snapshot a Draft transcript from current published results."""
	require_registrar()
	doc = frappe.get_doc("Transcript", name)
	if doc.status != "Draft":
		frappe.throw(_("Only draft transcripts can be refreshed"))
	documents.apply_snapshot(doc, documents.transcript_snapshot(doc.student, doc.as_of_term))
	doc.save()
	return _transcript_detail(name)


@frappe.whitelist(methods=["POST"])
def issue_transcript(name, override_fee_check=False):
	require_registrar()
	doc = frappe.get_doc("Transcript", name)
	if doc.status != "Draft":
		frappe.throw(_("Transcript {0} is already {1}").format(name, _(doc.status)))
	doc.override_fee_check = cint(override_fee_check)
	doc.status = "Issued"
	doc.save()
	return _transcript_detail(name)


@frappe.whitelist(methods=["POST"])
def revoke_document(doctype, name, reason):
	require_registrar()
	doc = documents.revoke_document(doctype, name, reason)
	return {"ok": True, "doctype": doctype, "name": doc.name, "status": doc.status}


# ---------------------------------------------------------------------------------- registrar: certificates
@frappe.whitelist()
def eligible_graduates(programme, intake=None, include_ineligible=0):
	require_registry_read()
	frappe.has_permission("Programme", "read", programme, throw=True)
	rows = documents.eligible_graduates(programme, intake, include_ineligible=bool(cint(include_ineligible)))
	return {"data": rows, "total": len(rows), "eligible": sum(1 for r in rows if r["eligible"])}


@frappe.whitelist()
def certificate_eligibility(student):
	require_registry_read()
	frappe.has_permission("Student", "read", student, throw=True)
	return documents.certificate_eligibility(student)


@frappe.whitelist(methods=["POST"])
def issue_certificates(students, graduation_date=None, override_fee_check=0):
	require_registrar()
	students = parse_json(students, [])
	if isinstance(students, str):
		students = [students]
	return documents.issue_certificates(
		students,
		getdate(graduation_date) if graduation_date else None,
		override_fee_check=cint(override_fee_check),
	)


@frappe.whitelist()
def list_certificates(status=None, programme=None, student=None, search=None, start=0, page_length=20):
	require_registry_read()
	f = {}
	for key, value in (("status", status), ("programme", programme), ("student", student)):
		if value:
			f[key] = value
	or_filters = None
	if search:
		like = f"%{search.strip()}%"
		or_filters = [
			["name", "like", like],
			["student_name", "like", like],
			["certificate_serial", "like", like],
			["student_number", "like", like],
		]
	result = _list("Certificate", f, CERTIFICATE_FIELDS, start, page_length, "creation desc", or_filters)
	return _with_status_counts("Certificate", f, or_filters, result)


@frappe.whitelist()
def get_certificate(name):
	require_registry_read()
	frappe.has_permission("Certificate", "read", name, throw=True)
	return frappe.get_doc("Certificate", name).as_dict()


# ---------------------------------------------------------------------------------- printing
@frappe.whitelist()
def print_view(doctype, name):
	"""HTML print view (staff roles or the owning student). Works for credentials and finance documents."""
	require_login()
	documents.check_access(doctype, name)
	send_document(doctype, name, "html")


@frappe.whitelist()
def download_pdf(doctype, name):
	require_login()
	documents.check_access(doctype, name)
	send_document(doctype, name, "pdf")
