"""Printable documents and academic credentials (owned by backend domain B3).

Rendering
	render_html(doctype, name, **opts) -> str        # Student Invoice | Student Payment | Fee Statement | Transcript | Certificate
	render_pdf(doctype, name, **opts) -> (filename, bytes)
	check_access(doctype, name, user=None)           # staff roles per document, or the owning student/applicant/sponsor

Credentials
	transcript_snapshot(student, as_of_term=None) -> dict   # B2 results.transcript_data (fallback: published Course Results)
	prepare_transcript_issue(doc) / prepare_certificate_issue(doc)   # called by the controllers on Draft -> Issued
	certificate_eligibility(student, override_fee_check=False) -> dict
	eligible_graduates(programme, intake=None) -> list[dict]
	issue_certificates(students, graduation_date, override_fee_check=False) -> dict   # enqueued when > 20
	verify_code(code, ...) -> dict                   # public verification (minimal, non-sensitive data)

Invoices, receipts and statements carry a signed code `<name>.<8-char HMAC>` in their QR so a printed document can be
verified at /verify/<code> without exposing a guessable lookup (statements: `<student>.S<yyyymmdd>.<HMAC>`; the
verification confirms authenticity only and never discloses a balance).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import mimetypes
import os
import re
import subprocess

import frappe
from frappe import _
from frappe.utils import cint, flt, formatdate, getdate, money_in_words, now_datetime, today

from mahanaim.services import fees
from mahanaim.utils import currency, user_roles

TEMPLATE_DIR = "mahanaim/templates/print"
TEMPLATES = {
	"Student Invoice": "student_invoice.html",
	"Student Payment": "payment_receipt.html",
	"Fee Statement": "fee_statement.html",
	"Transcript": "transcript.html",
	"Certificate": "certificate.html",
}
ADMIN_ROLES = {"System Manager", "College Administrator"}
STAFF_ACCESS = {
	"Student Invoice": {"Finance Officer", "Auditor"},
	"Student Payment": {"Finance Officer", "Auditor"},
	"Fee Statement": {"Finance Officer", "Auditor", "Registrar"},
	"Transcript": {"Registrar", "Academic Dean", "Auditor"},
	"Certificate": {"Registrar", "Academic Dean", "Auditor"},
}
OVERRIDE_ROLES = {"Registrar", *ADMIN_ROLES}
CREDENTIAL_DOCTYPES = ("Transcript", "Certificate")
BULK_SYNC_LIMIT = 20
CODE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9\-./]{3,63}$")


# ---------------------------------------------------------------------------------- helpers
def _settings():
	return frappe.get_cached_doc("Mahanaim Settings")


def _cache() -> dict:
	if not hasattr(frappe.local, "mbc_doc_images"):
		frappe.local.mbc_doc_images = {}
	return frappe.local.mbc_doc_images


def _safe_join(base: str, rel: str) -> str | None:
	base = os.path.realpath(base)
	path = os.path.realpath(os.path.join(base, rel.lstrip("/")))
	return path if path.startswith(base + os.sep) and os.path.isfile(path) else None


def _resolve_file(url: str) -> str | None:
	url = url.split("?", 1)[0]
	if url.startswith("/private/files/"):
		return _safe_join(frappe.get_site_path("private", "files"), url[len("/private/files/") :])
	if url.startswith("/files/"):
		return _safe_join(frappe.get_site_path("public", "files"), url[len("/files/") :])
	m = re.match(r"^/assets/([a-z_]+)/(.+)$", url)
	if m and m.group(1) in frappe.get_installed_apps():
		return _safe_join(frappe.get_app_path(m.group(1), "public"), m.group(2))
	return None


def image_data_uri(url: str | None) -> str | None:
	"""Embed a site/app image as a data URI (wkhtmltopdf runs with local file access disabled)."""
	if not url:
		return None
	if url.startswith("data:"):
		return url
	cache = _cache()
	if url in cache:
		return cache[url]
	value = None
	if url.startswith("http"):
		value = url
	else:
		path = _resolve_file(url)
		if path:
			mime = mimetypes.guess_type(path)[0] or "image/png"
			if path.endswith(".svg"):
				mime = "image/svg+xml"
			with open(path, "rb") as f:
				value = f"data:{mime};base64," + base64.b64encode(f.read()).decode()
	cache[url] = value
	return value


def _fmt_date(value, fmt="d MMMM yyyy") -> str:
	return formatdate(value, fmt) if value else ""


def brand_context() -> dict:
	s = _settings()
	return {
		"institution": s.institution_name or "Mahanaim Bible College",
		"short_name": s.short_name or "MBC",
		"motto": s.motto,
		"address": s.address,
		"phone": s.phone,
		"email": s.email,
		"website": s.website,
		"country": s.country or "Kenya",
		"logo": image_data_uri(s.logo) or image_data_uri("/assets/mahanaim/images/logo.svg"),
		"seal": image_data_uri(s.college_seal),
		"registrar_name": s.registrar_name,
		"registrar_signature": image_data_uri(s.registrar_signature),
		"principal_name": s.principal_name,
		"principal_signature": image_data_uri(s.principal_signature),
		"currency": currency(),
		"generated_on": now_datetime(),
		"fmt_date": _fmt_date,
		"money": fees_money,
	}


def fees_money(amount, with_currency=True) -> str:
	value = f"{flt(amount, 2):,.2f}"
	return f"{currency()} {value}" if with_currency else value


def _qr(code: str | None) -> tuple[str | None, str | None]:
	if not code:
		return None, None
	from mahanaim.utils.jinja import qr_data_uri, verification_url

	url = verification_url(code)
	return url, qr_data_uri(url, scale=3)


# ---------------------------------------------------------------------------------- signed codes
def _signing_key() -> bytes:
	from frappe.utils.password import get_encryption_key

	return (get_encryption_key() or frappe.local.site).encode()


def _signature(doctype: str, name: str) -> str:
	digest = hmac.new(_signing_key(), f"{doctype}|{name}".encode(), hashlib.sha256).digest()
	return base64.b32encode(digest).decode()[:8]


def signed_code(doctype: str, name: str) -> str:
	return f"{name}.{_signature(doctype, name)}"


def statement_code(student: str, as_at) -> str:
	return signed_code("Fee Statement", f"{student}.S{getdate(as_at).strftime('%Y%m%d')}")


def _resolve_signed(code: str) -> tuple[str, str] | None:
	name, _sep, sig = code.rpartition(".")
	if not name or len(sig) != 8:
		return None
	for doctype in ("Student Payment", "Student Invoice", "Fee Statement"):
		if not hmac.compare_digest(_signature(doctype, name), sig.upper()):
			continue
		target = name.rpartition(".S")[0] if doctype == "Fee Statement" else name
		if target and frappe.db.exists("Student" if doctype == "Fee Statement" else doctype, target):
			return doctype, name
	return None


def mask_student_number(number: str | None) -> str | None:
	if not number:
		return None
	parts = str(number).split("/")
	if len(parts) > 1:
		parts[-1] = "****"
		return "/".join(parts)
	return str(number)[: max(len(number) - 4, 1)] + "****"


# ---------------------------------------------------------------------------------- access control
def _owner_users(doctype: str, name: str) -> set[str]:
	if doctype == "Fee Statement":
		user = frappe.db.get_value("Student", name, "user")
		return {user} if user else set()
	fields = (
		["student", "docstatus"]
		if doctype in ("Student Invoice", "Student Payment")
		else ["student", "status"]
	)
	if doctype == "Student Payment":
		fields += ["programme_application", "sponsor"]
	row = frappe.db.get_value(doctype, name, fields, as_dict=True)
	if not row:
		frappe.throw(_("{0} {1} not found").format(_(doctype), name), frappe.DoesNotExistError)
	if doctype in CREDENTIAL_DOCTYPES and row.status != "Issued":
		return set()
	if doctype in ("Student Invoice", "Student Payment") and row.docstatus != 1:
		return set()
	users = set()
	if row.student:
		users.add(frappe.db.get_value("Student", row.student, "user"))
	if row.get("programme_application"):
		users.add(frappe.db.get_value("Programme Application", row.programme_application, "user"))
	if row.get("sponsor"):
		users.add(frappe.db.get_value("Sponsor", row.sponsor, "user"))
	return {u for u in users if u}


def can_access(doctype: str, name: str, user: str | None = None) -> bool:
	user = user or frappe.session.user
	if doctype not in TEMPLATES or user == "Guest":
		return False
	if user == "Administrator":
		return True
	roles = user_roles(user)
	if roles & (ADMIN_ROLES | STAFF_ACCESS[doctype]):
		if doctype == "Fee Statement" or frappe.db.exists(doctype, name):
			return True
	return user in _owner_users(doctype, name)


def check_access(doctype: str, name: str, user: str | None = None):
	if doctype not in TEMPLATES:
		frappe.throw(_("Printing {0} is not supported").format(doctype))
	if not can_access(doctype, name, user):
		frappe.throw(_("You are not allowed to view this document."), frappe.PermissionError)


# ---------------------------------------------------------------------------------- contexts
def _student_info(student: str) -> dict:
	info = (
		frappe.db.get_value(
			"Student",
			student,
			[
				"name",
				"full_name",
				"student_number",
				"programme",
				"programme_name",
				"campus",
				"study_mode",
				"email",
				"phone",
				"year_of_study",
				"photo",
				"date_of_birth",
				"gender",
				"admission_year",
				"intake",
				"status",
				"completion_date",
				"graduation_date",
			],
			as_dict=True,
		)
		or frappe._dict()
	)
	if info.programme and not info.programme_name:
		info.programme_name = frappe.db.get_value("Programme", info.programme, "programme_name")
	if info.campus:
		info.campus_name = frappe.db.get_value("Campus", info.campus, "campus_name") or info.campus
	return info


def invoice_context(name: str, **_opts) -> dict:
	doc = frappe.get_doc("Student Invoice", name)
	payments = frappe.db.sql(
		"""select p.name, p.posting_date, p.mode_of_payment, p.reference_no, a.allocated_amount
		from `tabPayment Allocation` a join `tabStudent Payment` p on p.name = a.parent
		where a.parenttype = 'Student Payment' and a.invoice = %s and p.docstatus = 1
		order by p.posting_date, p.creation""",
		name,
		as_dict=True,
	)
	code = signed_code("Student Invoice", name) if doc.docstatus == 1 else None
	url, qr = _qr(code)
	term_label = (
		frappe.db.get_value("Academic Term", doc.academic_term, "term_label") if doc.academic_term else None
	)
	return {
		"doc": doc,
		"student": _student_info(doc.student),
		"payments": payments,
		"balance": fees.get_student_balance(doc.student),
		"term_label": term_label or doc.academic_term,
		"verification_code": code,
		"verification_url": url,
		"qr": qr,
		"title": _("Invoice {0}").format(name),
		"watermark": {0: _("DRAFT"), 2: _("CANCELLED")}.get(doc.docstatus),
	}


def receipt_context(name: str, **_opts) -> dict:
	doc = frappe.get_doc("Student Payment", name)
	student = _student_info(doc.student) if doc.student else frappe._dict()
	application = None
	if doc.programme_application:
		application = frappe.db.get_value(
			"Programme Application",
			doc.programme_application,
			["name", "full_name", "programme_name"],
			as_dict=True,
		)
	code = signed_code("Student Payment", name) if doc.docstatus == 1 else None
	url, qr = _qr(code)
	return {
		"doc": doc,
		"student": student,
		"application": application,
		"amount_in_words": money_in_words(doc.amount, currency()),
		"balance": fees.get_student_balance(doc.student)
		if doc.student and doc.payment_for == "Student Fees"
		else None,
		"verification_code": code,
		"verification_url": url,
		"qr": qr,
		"title": _("Receipt {0}").format(name),
		"watermark": {0: _("DRAFT"), 2: _("CANCELLED")}.get(doc.docstatus),
	}


def statement_context(student: str, from_date=None, to_date=None, **_opts) -> dict:
	if not frappe.db.exists("Student", student):
		frappe.throw(_("Student {0} not found").format(student), frappe.DoesNotExistError)
	data = fees.statement(student, from_date, to_date)
	code = statement_code(student, min(getdate(to_date), getdate()) if to_date else getdate())
	url, qr = _qr(code)
	return {
		"doc": frappe._dict(name=student),
		"student": _student_info(student),
		"statement": data,
		"verification_code": code,
		"verification_url": url,
		"qr": qr,
		"title": _("Fee statement — {0}").format(student),
		"watermark": None,
	}


def _snapshot(doc) -> dict:
	value = doc.snapshot
	if isinstance(value, str):
		try:
			value = json.loads(value or "{}")
		except ValueError:
			value = {}
	return value or {}


def _grading_key() -> list:
	try:
		from mahanaim.services.grading import scale_data

		return [
			{
				"grade": b.get("grade"),
				"min": flt(b.get("min_score")),
				"max": flt(b.get("max_score")),
				"points": flt(b.get("grade_points")),
				"description": b.get("description"),
			}
			for b in scale_data().get("bands", [])
		]
	except Exception:
		return []


def transcript_context(name: str, **_opts) -> dict:
	doc = frappe.get_doc("Transcript", name)
	data = _snapshot(doc) if doc.status != "Draft" or doc.snapshot else {}
	if doc.status == "Draft" and not data:
		data = transcript_snapshot(doc.student, doc.as_of_term)
	url, qr = _qr(doc.verification_code if doc.status == "Issued" else None)
	watermark = {"Draft": _("DRAFT"), "Revoked": _("REVOKED")}.get(doc.status)
	if not watermark and doc.transcript_type == "Provisional":
		watermark = _("PROVISIONAL")
	return {
		"doc": doc,
		"student": _student_info(doc.student),
		"data": data,
		"terms": data.get("terms") or [],
		"grading_key": _grading_key(),
		"verification_code": doc.verification_code,
		"verification_url": url,
		"qr": qr,
		"title": _("{0} Transcript — {1}").format(_(doc.transcript_type), doc.student_name),
		"watermark": watermark,
	}


def certificate_context(name: str, **_opts) -> dict:
	doc = frappe.get_doc("Certificate", name)
	url, qr = _qr(doc.verification_code if doc.status == "Issued" else None)
	return {
		"doc": doc,
		"student": _student_info(doc.student),
		"programme_name": frappe.db.get_value("Programme", doc.programme, "programme_name")
		if doc.programme
		else "",
		"verification_code": doc.verification_code,
		"verification_url": url,
		"qr": qr,
		"title": _("Certificate {0}").format(doc.certificate_serial or name),
		"watermark": {"Draft": _("SPECIMEN"), "Revoked": _("REVOKED")}.get(doc.status),
	}


CONTEXTS = {
	"Student Invoice": invoice_context,
	"Student Payment": receipt_context,
	"Fee Statement": statement_context,
	"Transcript": transcript_context,
	"Certificate": certificate_context,
}
PDF_OPTIONS = {
	"Certificate": {
		"page-size": "A4",
		"orientation": "Landscape",
		"margin-top": "0mm",
		"margin-bottom": "0mm",
		"margin-left": "0mm",
		"margin-right": "0mm",
	},
}
# wkhtmltopdf built against unpatched Qt ignores --disable-smart-shrinking and renders everything at ~77% (1/1.3)
# of its CSS size; the templates apply `zoom` to compensate so mm-based layouts (A4 certificate) fill the page.
UNPATCHED_QT_ZOOM = 1.3
DEFAULT_PDF_OPTIONS = {
	"page-size": "A4",
	"orientation": "Portrait",
	"margin-top": "12mm",
	"margin-bottom": "14mm",
	"margin-left": "12mm",
	"margin-right": "12mm",
}


def pdf_zoom() -> float:
	"""CSS zoom for PDF rendering: 1.0 with patched-Qt wkhtmltopdf, 1.3 otherwise (site_config `mahanaim_pdf_zoom`
	overrides)."""
	configured = frappe.conf.get("mahanaim_pdf_zoom")
	if configured:
		return flt(configured) or 1.0
	key = "mahanaim:wkhtmltopdf_zoom"
	zoom = frappe.cache.get_value(key)
	if zoom is None:
		try:
			version = subprocess.run(
				["wkhtmltopdf", "--version"], capture_output=True, text=True, timeout=10, check=False
			).stdout
			zoom = 1.0 if "patched qt" in version.lower() else UNPATCHED_QT_ZOOM
		except (OSError, subprocess.SubprocessError):
			zoom = 1.0
		frappe.cache.set_value(key, zoom, expires_in_sec=86400)
	return flt(zoom) or 1.0


def render_html(doctype: str, name: str, for_pdf: bool = False, **opts) -> str:
	if doctype not in TEMPLATES:
		frappe.throw(_("Printing {0} is not supported").format(doctype))
	ctx = {**brand_context(), **CONTEXTS[doctype](name, **opts), "for_pdf": for_pdf, "doctype": doctype}
	ctx["pdf_zoom"] = pdf_zoom() if for_pdf else 1.0
	return frappe.render_template(f"{TEMPLATE_DIR}/{TEMPLATES[doctype]}", ctx)


def pdf_filename(doctype: str, name: str) -> str:
	label = {"Student Invoice": "Invoice", "Student Payment": "Receipt", "Fee Statement": "Statement"}.get(
		doctype, doctype
	)
	if doctype == "Certificate":
		name = frappe.db.get_value("Certificate", name, "certificate_serial") or name
	return re.sub(r"[^A-Za-z0-9_.-]+", "-", f"{label}-{name}").strip("-") + ".pdf"


def render_pdf(doctype: str, name: str, **opts) -> tuple[str, bytes]:
	from frappe.utils.pdf import get_pdf

	html = render_html(doctype, name, for_pdf=True, **opts)
	options = dict(PDF_OPTIONS.get(doctype, DEFAULT_PDF_OPTIONS))
	# frappe.utils.pdf forces 15 mm top/bottom margins unless the HTML declares them on `.print-format`
	margins = "; ".join(f"{k}: {v}" for k, v in options.items() if k.startswith("margin-"))
	html = html.replace("</head>", f"<style>.print-format {{ {margins}; }}</style></head>", 1)
	return pdf_filename(doctype, name), get_pdf(html, options)


# ---------------------------------------------------------------------------------- transcripts
def _term_order(terms: list[str]) -> dict:
	rows = frappe.get_all(
		"Academic Term", filters={"name": ["in", terms]}, fields=["name", "start_date", "term_label"]
	)
	return {r.name: r for r in rows}


def _gpa(rows) -> tuple[float, float]:
	credits = sum(flt(r.credits) for r in rows)
	points = sum(flt(r.grade_points) * flt(r.credits) for r in rows)
	return (round(points / credits, 2) if credits else 0.0), flt(credits, 2)


def _best_attempts(rows) -> list:
	best = {}
	for r in rows:
		if r.result_status == "Incomplete":
			continue
		cur = best.get(r.course)
		if cur is None or flt(r.grade_points) > flt(cur.grade_points):
			best[r.course] = r
	return list(best.values())


def _published_results(students, as_of_term=None) -> list:
	filters = {"student": ["in", list(students)], "is_published": 1}
	if as_of_term:
		start = frappe.db.get_value("Academic Term", as_of_term, "start_date")
		if start:
			terms = frappe.get_all("Academic Term", filters={"start_date": ["<=", start]}, pluck="name")
			filters["academic_term"] = ["in", terms or [as_of_term]]
	return frappe.get_all(
		"Course Result",
		filters=filters,
		fields=[
			"student",
			"course",
			"course_title",
			"academic_term",
			"credits",
			"total_score",
			"grade",
			"grade_points",
			"result_status",
			"attempt",
		],
		order_by="academic_term asc, course asc",
	)


def _classification(cgpa) -> str | None:
	try:
		from mahanaim.services.grading import classification_for

		return classification_for(cgpa)
	except Exception:
		return None


def fallback_transcript_data(student: str, as_of_term=None) -> dict:
	"""Used only while results.transcript_data (B2) is unavailable: published results grouped per term."""
	rows = _published_results([student], as_of_term)
	terms = _term_order(list({r.academic_term for r in rows if r.academic_term}))
	by_term: dict[str, list] = {}
	for r in rows:
		by_term.setdefault(r.academic_term, []).append(r)
	ordered = sorted(
		by_term,
		key=lambda t: (
			getdate(terms[t].start_date) if t in terms and terms[t].start_date else getdate("1900-01-01"),
			t or "",
		),
	)
	out = []
	for term in ordered:
		courses = by_term[term]
		gpa, credits = _gpa([c for c in courses if c.result_status != "Incomplete"])
		out.append(
			{
				"term": term,
				"label": (terms.get(term) or {}).get("term_label") or term,
				"courses": [
					{
						"code": c.course,
						"title": c.course_title,
						"credits": flt(c.credits),
						"total": flt(c.total_score),
						"grade": c.grade,
						"grade_points": flt(c.grade_points),
						"status": c.result_status,
					}
					for c in courses
				],
				"gpa": gpa,
				"credits": credits,
			}
		)
	cgpa, total_credits = _gpa(_best_attempts(rows))
	earned = sum(flt(r.credits) for r in _best_attempts(rows) if r.result_status == "Pass")
	return {
		"student": _student_info(student),
		"terms": out,
		"cgpa": cgpa,
		"total_credits": flt(earned or total_credits, 2),
		"classification": _classification(cgpa),
		"source": "fallback",
	}


def transcript_snapshot(student: str, as_of_term=None) -> dict:
	try:
		from mahanaim.services.results import transcript_data

		data = transcript_data(student, as_of_term=as_of_term, published_only=True)
	except (ImportError, AttributeError, NotImplementedError):
		data = fallback_transcript_data(student, as_of_term)
	return json.loads(frappe.as_json(data or {}))


def _can_override(user: str | None = None) -> bool:
	user = user or frappe.session.user
	return user == "Administrator" or bool(user_roles(user) & OVERRIDE_ROLES)


def new_document_code() -> str:
	from mahanaim.services.numbering import new_verification_code

	for _attempt in range(10):
		code = new_verification_code(10, "Transcript")
		if not frappe.db.exists("Certificate", {"verification_code": code}):
			return code
	frappe.throw(_("Could not generate a unique verification code"))


def apply_snapshot(doc, data: dict):
	doc.snapshot = frappe.as_json(data)
	doc.cgpa = flt(data.get("cgpa"), 2)
	doc.total_credits = flt(data.get("total_credits"), 2)
	doc.classification = data.get("classification") or _classification(doc.cgpa)


def prepare_transcript_issue(doc):
	"""Draft -> Issued: fee check (unless overridden by the Registrar), snapshot, verification code."""
	if cint(doc.override_fee_check) and not _can_override():
		frappe.throw(_("Only the Registrar can override the fee clearance check"), frappe.PermissionError)
	notes = []
	if not cint(doc.override_fee_check):
		clearance = fees.fee_clearance(doc.student, "transcript")
		if not clearance["cleared"]:
			frappe.throw(
				_("Cannot issue the transcript: {0}").format(clearance["message"]),
				title=_("Fee clearance required"),
			)
		notes.append(clearance["message"])
	else:
		notes.append(_("Fee clearance check overridden by {0}").format(frappe.session.user))
	data = transcript_snapshot(doc.student, doc.as_of_term)
	if not data.get("terms"):
		frappe.throw(
			_("{0} has no published results to put on a transcript").format(doc.student_name or doc.student)
		)
	apply_snapshot(doc, data)
	doc.verification_code = doc.verification_code or new_document_code()
	doc.issue_date = doc.issue_date or today()
	doc.issued_by = frappe.session.user
	doc.eligibility_notes = "\n".join(notes)


def notify_issued(doc):
	from mahanaim.services.communication import notify, recipient_for_student

	event = "Transcript Ready" if doc.doctype == "Transcript" else "Certificate Ready"
	label = _("transcript") if doc.doctype == "Transcript" else _("certificate")
	notify(
		event,
		doc=doc,
		recipients=[recipient_for_student(doc.student)],
		context={"verification_code": doc.verification_code},
		link="/student/documents",
		category="Academic",
		fallback={
			"subject": _("Your {0} is ready").format(label),
			"message": _("Dear {0}, your {1} ({2}) has been issued. Verification code: {3}.").format(
				doc.student_name, label, doc.name, doc.verification_code
			),
		},
	)


# ---------------------------------------------------------------------------------- certificates
def _curriculum(programme: str) -> list:
	return frappe.get_all(
		"Programme Course",
		filters={"parent": programme, "parenttype": "Programme"},
		fields=["course", "credits", "course_type"],
	)


def _full_sponsorships(students) -> set:
	try:
		return set(
			frappe.get_all(
				"Sponsorship",
				filters={"student": ["in", list(students)], "status": "Active", "coverage": "Full Fees"},
				pluck="student",
			)
		)
	except Exception:
		return set()


def _eligibility_batch(
	students: list[str], override_fee_check=False, use_contract_gpa=False, exclude=None
) -> list:
	if not students:
		return []
	info = {
		s.name: s
		for s in frappe.get_all(
			"Student",
			filters={"name": ["in", students]},
			fields=[
				"name",
				"full_name",
				"student_number",
				"programme",
				"programme_name",
				"status",
				"intake",
				"completion_date",
				"graduation_date",
				"cgpa",
				"credits_earned",
			],
		)
	}
	programmes = {p for p in (s.programme for s in info.values()) if p}
	prog = {
		p.name: p
		for p in frappe.get_all(
			"Programme",
			filters={"name": ["in", list(programmes) or [""]]},
			fields=[
				"name",
				"programme_name",
				"code",
				"award_title",
				"min_cgpa_to_graduate",
				"min_credits_to_graduate",
				"total_credits",
			],
		)
	}
	curricula = {p: _curriculum(p) for p in programmes}
	results: dict[str, list] = {}
	for r in _published_results(students):
		results.setdefault(r.student, []).append(r)
	balances = fees.get_balances(students)
	sponsored = _full_sponsorships(students)
	issued_filters = {"student": ["in", students], "status": "Issued"}
	if exclude:
		issued_filters["name"] = ["!=", exclude]
	issued = {
		(c.student, c.programme)
		for c in frappe.get_all("Certificate", filters=issued_filters, fields=["student", "programme"])
	}
	out = []
	for name in students:
		st = info.get(name)
		if not st:
			out.append({"student": name, "eligible": False, "reasons": [_("Student not found")]})
			continue
		p = prog.get(st.programme) or frappe._dict()
		rows = results.get(name, [])
		best = _best_attempts(rows)
		cgpa, _credits = _gpa(best)
		if use_contract_gpa:
			try:
				from mahanaim.services.grading import compute_gpa

				cgpa = flt(compute_gpa(name).get("gpa"), 2)
			except Exception:
				pass
		passed = {r.course for r in best if r.result_status == "Pass"}
		earned = flt(sum(flt(r.credits) for r in best if r.result_status == "Pass"), 2)
		attempted = {r.course for r in rows}
		curriculum = curricula.get(st.programme, [])
		failed_core = sorted(
			c.course
			for c in curriculum
			if c.course_type == "Core" and c.course in attempted and c.course not in passed
		)
		reasons = []
		if not st.programme:
			reasons.append(_("No programme on the student record"))
		completed = st.status in ("Completed", "Alumni")
		if not completed:
			if st.status in ("Withdrawn", "Suspended", "Applicant"):
				reasons.append(_("Student status is {0}").format(_(st.status)))
			missing = [c.course for c in curriculum if c.course not in passed]
			required_credits = flt(p.min_credits_to_graduate) or flt(p.total_credits)
			if curriculum and missing:
				reasons.append(
					_("{0} curriculum course(s) not yet passed: {1}").format(
						len(missing), ", ".join(missing[:8]) + ("…" if len(missing) > 8 else "")
					)
				)
			elif not curriculum and (not required_credits or earned < required_credits):
				reasons.append(
					_("Credits earned {0} of {1} required").format(earned, required_credits or "?")
				)
			if cgpa + 1e-9 < flt(p.min_cgpa_to_graduate):
				reasons.append(
					_("CGPA {0} is below the minimum {1}").format(cgpa, flt(p.min_cgpa_to_graduate))
				)
		if failed_core:
			reasons.append(_("Failed core course(s): {0}").format(", ".join(failed_core)))
		balance = fees.money(balances.get(name, 0))
		fee_cleared = balance <= 0 or name in sponsored
		if not fee_cleared and not cint(override_fee_check):
			reasons.append(_("Outstanding fee balance of {0}").format(fees_money(balance)))
		if (name, st.programme) in issued:
			reasons.append(_("A certificate has already been issued"))
		out.append(
			{
				"student": name,
				"student_name": st.full_name,
				"student_number": st.student_number,
				"status": st.status,
				"intake": st.intake,
				"programme": st.programme,
				"programme_name": st.programme_name or p.programme_name,
				"award_title": p.award_title or p.programme_name,
				"cgpa": cgpa,
				"credits_earned": earned,
				"classification": _classification(cgpa) if best or cgpa else None,
				"balance": balance,
				"fee_cleared": fee_cleared,
				"failed_core": failed_core,
				"eligible": not reasons,
				"reasons": reasons,
			}
		)
	return out


def certificate_eligibility(
	student: str, override_fee_check=False, exclude=None, use_contract_gpa=True
) -> dict:
	result = _eligibility_batch(
		[student], override_fee_check, use_contract_gpa=use_contract_gpa, exclude=exclude
	)[0]
	if result.get("student_name") and not cint(override_fee_check) and not result["fee_cleared"]:
		result["fee_message"] = fees.fee_clearance(student, "certificate")["message"]
	return result


def eligible_graduates(programme: str, intake: str | None = None, include_ineligible: bool = False) -> list:
	filters = {
		"programme": programme,
		"status": ["in", ["Active", "Registered", "Completed", "Alumni", "Deferred"]],
	}
	if intake:
		filters["intake"] = intake
	students = frappe.get_all("Student", filters=filters, pluck="name", order_by="student_number asc")
	rows = _eligibility_batch(students)
	return rows if include_ineligible else [r for r in rows if r["eligible"]]


def prepare_certificate_issue(doc):
	if cint(doc.override_fee_check) and not _can_override():
		frappe.throw(_("Only the Registrar can override the fee clearance check"), frappe.PermissionError)
	result = certificate_eligibility(doc.student, doc.override_fee_check, exclude=doc.name)
	if not result["eligible"]:
		frappe.throw(
			_("{0} is not eligible for a certificate:<br>{1}").format(
				result.get("student_name") or doc.student, "<br>".join(result["reasons"])
			),
			title=_("Not eligible"),
		)
	st = frappe.db.get_value(
		"Student", doc.student, ["programme", "completion_date", "graduation_date"], as_dict=True
	)
	doc.programme = st.programme
	prog = frappe.db.get_value(
		"Programme", st.programme, ["code", "award_title", "programme_name"], as_dict=True
	)
	doc.award_title = doc.award_title or prog.award_title or prog.programme_name
	doc.cgpa = result["cgpa"]
	doc.classification = doc.classification or result["classification"]
	doc.completion_date = doc.completion_date or st.completion_date or today()
	doc.graduation_date = doc.graduation_date or st.graduation_date
	doc.issue_date = doc.issue_date or today()
	if not doc.certificate_serial:
		from mahanaim.services.numbering import next_serial

		year = getdate(doc.graduation_date or doc.issue_date).year
		short = re.sub(r"[^A-Z0-9]", "", (_settings().short_name or "MBC").upper()) or "MBC"
		code = re.sub(r"[^A-Z0-9]", "", (prog.code or st.programme).upper())
		doc.certificate_serial = next_serial(f"{short}/{code}/{year}/", 4)
	doc.verification_code = doc.verification_code or new_document_code()
	doc.issued_by = frappe.session.user
	notes = [_("CGPA {0}; {1} credits earned").format(result["cgpa"], result["credits_earned"])]
	if cint(doc.override_fee_check) and not result["fee_cleared"]:
		notes.append(
			_("Fee clearance overridden by {0} (balance {1})").format(
				frappe.session.user, fees_money(result["balance"])
			)
		)
	doc.eligibility_notes = "\n".join(notes)


def issue_certificates(students, graduation_date=None, override_fee_check=False) -> dict:
	students = [s for s in dict.fromkeys(students or []) if s]
	if not students:
		frappe.throw(_("Select at least one student"))
	if cint(override_fee_check) and not _can_override():
		frappe.throw(_("Only the Registrar can override the fee clearance check"), frappe.PermissionError)
	if len(students) > BULK_SYNC_LIMIT:
		job = frappe.enqueue(
			"mahanaim.services.documents.issue_certificates_job",
			queue="long",
			timeout=3600,
			enqueue_after_commit=True,
			students=students,
			graduation_date=graduation_date,
			override_fee_check=cint(override_fee_check),
			user=frappe.session.user,
			commit=True,
		)
		return {"queued": True, "count": len(students), "job": getattr(job, "id", None)}
	return {"queued": False, **issue_certificates_job(students, graduation_date, override_fee_check)}


def issue_certificates_job(
	students, graduation_date=None, override_fee_check=False, user=None, commit=False
) -> dict:
	if user and user != frappe.session.user:
		frappe.set_user(user)
	issued, skipped = [], []
	for student in students:
		frappe.db.savepoint("mbc_certificate")
		try:
			doc = frappe.get_doc(
				{
					"doctype": "Certificate",
					"student": student,
					"status": "Issued",
					"graduation_date": graduation_date,
					"override_fee_check": cint(override_fee_check),
				}
			).insert()
			issued.append({"student": student, "certificate": doc.name, "serial": doc.certificate_serial})
		except Exception as e:
			frappe.db.rollback(save_point="mbc_certificate")
			frappe.clear_messages()
			skipped.append({"student": student, "reason": re.sub(r"<br>", "; ", str(e))[:500]})
		if commit:
			frappe.db.commit()
	summary = {
		"issued": issued,
		"skipped": skipped,
		"issued_count": len(issued),
		"skipped_count": len(skipped),
	}
	if commit and user:
		frappe.publish_realtime("mbc_certificates_issued", summary, user=user)
	return summary


# ---------------------------------------------------------------------------------- verification
def _increment(doctype: str, name: str):
	table = frappe.qb.DocType(doctype)
	(
		frappe.qb.update(table)
		.set(
			table.verification_count, frappe.query_builder.functions.Coalesce(table.verification_count, 0) + 1
		)
		.where(table.name == name)
	).run()


def _credential_lookup(code: str):
	for doctype in CREDENTIAL_DOCTYPES:
		row = frappe.db.get_value(
			doctype,
			{"verification_code": code, "status": ["in", ["Issued", "Revoked"]]},
			["name", "status"],
			as_dict=True,
		)
		if row:
			return doctype, row
	return None, None


def verify_code(code, ip=None, user_agent=None, requester_name=None, requester_organisation=None) -> dict:
	raw = str(code or "").strip()
	brand = _settings()
	institution = brand.institution_name or "Mahanaim Bible College"
	response = {"valid": False, "status": "not_found", "institution": institution}
	log = {"document_type": "Unknown", "document_name": None, "result": "Not Found"}

	if CODE_RE.match(raw):
		if "." in raw:
			resolved = _resolve_signed(raw)
			if resolved:
				response, log = _verify_finance(*resolved, institution=institution)
		else:
			doctype, row = _credential_lookup(raw.upper())
			if doctype:
				response, log = _verify_credential(doctype, row.name, institution)
				_increment(doctype, row.name)

	frappe.get_doc(
		{
			"doctype": "Verification Log",
			"verification_code": raw[:64],
			"verified_on": now_datetime(),
			"ip_address": (ip or "")[:140] or None,
			"user_agent": (user_agent or "")[:500] or None,
			"requester_name": (requester_name or "")[:140] or None,
			"requester_organisation": (requester_organisation or "")[:140] or None,
			**log,
		}
	).insert(ignore_permissions=True)
	return response


def _verify_credential(doctype: str, name: str, institution: str):
	doc = frappe.db.get_value(
		doctype,
		name,
		[
			"name",
			"status",
			"student",
			"student_name",
			"student_number",
			"programme",
			"classification",
			"issue_date",
			*(
				["transcript_type", "as_of_term"]
				if doctype == "Transcript"
				else ["award_title", "graduation_date", "certificate_serial"]
			),
		],
		as_dict=True,
	)
	revoked = doc.status == "Revoked"
	response = {
		"valid": not revoked,
		"status": "revoked" if revoked else "valid",
		"document_type": doctype,
		"student_name": doc.student_name,
		"student_number": mask_student_number(doc.student_number),
		"programme": frappe.db.get_value("Programme", doc.programme, "programme_name")
		if doc.programme
		else None,
		"classification": doc.classification,
		"issue_date": str(doc.issue_date) if doc.issue_date else None,
		"institution": institution,
	}
	if doctype == "Transcript":
		response["transcript_type"] = doc.transcript_type
		response["award"] = None
	else:
		response["award"] = doc.award_title
		response["certificate_serial"] = doc.certificate_serial
		response["graduation_date"] = str(doc.graduation_date) if doc.graduation_date else None
	if revoked:
		response["message"] = _("This document has been revoked by the institution and is no longer valid.")
	return response, {
		"document_type": doctype,
		"document_name": name,
		"result": "Revoked" if revoked else "Valid",
	}


def _verify_statement(name: str, institution: str):
	student, _sep, stamp = name.rpartition(".S")
	info = frappe.db.get_value("Student", student, ["full_name", "student_number"], as_dict=True)
	response = {
		"valid": True,
		"status": "valid",
		"document_type": "Statement",
		"student_name": info.full_name,
		"student_number": mask_student_number(info.student_number),
		"date": str(getdate(stamp)) if stamp else None,
		"institution": institution,
		"message": _(
			"This fee statement was generated by the institution. Contact the Finance Office for current balances."
		),
	}
	return response, {"document_type": "Student", "document_name": student, "result": "Valid"}


def _verify_finance(doctype: str, name: str, institution: str):
	if doctype == "Fee Statement":
		return _verify_statement(name, institution)
	fields = ["name", "docstatus", "student", "posting_date"]
	fields += (
		["amount", "payment_for", "programme_application", "payer_name"]
		if doctype == "Student Payment"
		else ["student_name", "total_amount", "academic_term"]
	)
	doc = frappe.db.get_value(doctype, name, fields, as_dict=True)
	valid = doc.docstatus == 1
	label = "Receipt" if doctype == "Student Payment" else "Invoice"
	number = frappe.db.get_value("Student", doc.student, "student_number") if doc.student else None
	response = {
		"valid": valid,
		"status": "valid" if valid else "cancelled",
		"document_type": label,
		"document_number": name,
		"student_name": doc.get("student_name") or doc.get("payer_name"),
		"student_number": mask_student_number(number),
		"date": str(doc.posting_date) if doc.posting_date else None,
		"amount": flt(doc.get("amount") if doctype == "Student Payment" else doc.get("total_amount"), 2),
		"currency": currency(),
		"institution": institution,
	}
	return response, {
		"document_type": label,
		"document_name": name,
		"result": "Valid" if valid else "Revoked",
	}


# ---------------------------------------------------------------------------------- controller helpers
CREDENTIAL_TRANSITIONS = {"Draft": ("Issued",), "Issued": ("Revoked",), "Revoked": ()}
MUTABLE_AFTER_ISSUE = {"status", "revoked_reason", "verification_count"}


def _norm_value(df, value):
	if value in (None, ""):
		return None
	if df.fieldtype in ("Int", "Check"):
		return cint(value)
	if df.fieldtype in ("Float", "Currency", "Percent"):
		return flt(value, 6)
	if df.fieldtype == "Date":
		return str(getdate(value))
	if df.fieldtype == "JSON":
		try:
			return json.dumps(
				json.loads(value) if isinstance(value, str) else value, sort_keys=True, default=str
			)
		except ValueError:
			return str(value)
	return str(value)


def guard_issued(doc, before):
	"""Issued/Revoked credentials are immutable except for revocation."""
	from frappe.model import no_value_fields, table_fields

	changed = [
		df.label or df.fieldname
		for df in doc.meta.fields
		if df.fieldtype not in no_value_fields
		and df.fieldtype not in table_fields
		and df.fieldname not in MUTABLE_AFTER_ISSUE
		and _norm_value(df, doc.get(df.fieldname)) != _norm_value(df, before.get(df.fieldname))
	]
	if changed:
		frappe.throw(
			_(
				"{0} {1} has been issued and cannot be changed ({2}). Revoke it and issue a new one instead."
			).format(_(doc.doctype), doc.name, ", ".join(changed)),
			title=_("Document is locked"),
		)
	if before.status == "Revoked" and (doc.revoked_reason or "") != (before.revoked_reason or ""):
		frappe.throw(_("The revocation reason cannot be changed"))


def validate_credential(doc, issue_fn):
	"""Shared Transcript/Certificate validation: transitions, immutability, issue and revoke rules."""
	from mahanaim.utils import validate_transition

	doc.status = doc.status or "Draft"
	before = doc.get_doc_before_save()
	old = before.status if before else None
	if not before and doc.status == "Revoked":
		frappe.throw(_("A new document cannot be created as revoked"))
	validate_transition(doc, CREDENTIAL_TRANSITIONS)
	if old in ("Issued", "Revoked"):
		guard_issued(doc, before)
	else:
		st = frappe.db.get_value(
			"Student", doc.student, ["full_name", "student_number", "programme"], as_dict=True
		)
		if not st:
			frappe.throw(_("Student {0} not found").format(doc.student), frappe.DoesNotExistError)
		doc.student_name, doc.student_number = st.full_name, st.student_number
		doc.programme = st.programme
		if doc.status == "Draft":
			doc.verification_code = doc.issue_date = doc.issued_by = None
	if doc.status == "Issued" and old != "Issued":
		issue_fn(doc)
		doc.flags.just_issued = True
	if doc.status == "Revoked" and old != "Revoked":
		doc.revoked_reason = (doc.revoked_reason or "").strip()
		if not doc.revoked_reason:
			frappe.throw(_("Give a reason for revoking this document"))
		doc.flags.just_revoked = True


def after_credential_update(doc):
	if doc.flags.just_issued:
		doc.flags.just_issued = False
		notify_issued(doc)
	if doc.flags.just_revoked:
		doc.flags.just_revoked = False
		doc.add_comment("Info", _("Revoked by {0}: {1}").format(frappe.session.user, doc.revoked_reason))


def revoke_document(doctype: str, name: str, reason: str):
	if doctype not in CREDENTIAL_DOCTYPES:
		frappe.throw(_("Only transcripts and certificates can be revoked"))
	doc = frappe.get_doc(doctype, name)
	if doc.status != "Issued":
		frappe.throw(_("Only issued documents can be revoked"))
	doc.status = "Revoked"
	doc.revoked_reason = reason
	doc.save()
	return doc
