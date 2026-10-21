"""Finance API: student fees portal, applicant fee status, finance office (B3).

Guards: students -> require_student (own records only); applicants -> require_applicant (+ ownership via
Programme Application.user); staff -> Finance Officer / College Administrator (Auditor read-only).
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.query_builder import DocType
from frappe.query_builder.functions import Coalesce, Sum
from frappe.utils import add_days, add_months, cint, flt, get_first_day, getdate, today

from mahanaim.api.utils import (
	clean_payload,
	page_args,
	parse_json,
	require_applicant,
	require_login,
	require_roles,
	require_student,
)
from mahanaim.services import documents, fees
from mahanaim.utils import ROLE_AUDITOR, ROLE_FINANCE, current_term, fmt_money, is_staff, setting

READ_ROLES = (ROLE_FINANCE, ROLE_AUDITOR)
FINANCE_DOCS = {
	"invoice": "Student Invoice",
	"receipt": "Student Payment",
	"statement": "Fee Statement",
	"giving": "Giving Record",
	"Student Invoice": "Student Invoice",
	"Student Payment": "Student Payment",
	"Fee Statement": "Fee Statement",
	"Giving Record": "Giving Record",
}
INVOICE_LIST_FIELDS = [
	"name",
	"student",
	"student_name",
	"programme",
	"campus",
	"academic_term",
	"posting_date",
	"due_date",
	"status",
	"total_amount",
	"paid_amount",
	"credit_applied",
	"outstanding_amount",
	"fee_structure",
	"docstatus",
]
PAYMENT_LIST_FIELDS = [
	"name",
	"student",
	"payer_name",
	"programme_application",
	"sponsor",
	"payment_for",
	"posting_date",
	"mode_of_payment",
	"amount",
	"allocated_amount",
	"unallocated_amount",
	"reference_no",
	"status",
	"docstatus",
	"mpesa_transaction",
]
ADJUSTMENT_FIELDS = (
	"student",
	"adjustment_type",
	"amount",
	"posting_date",
	"invoice",
	"academic_term",
	"scholarship",
	"sponsor",
	"reason",
)
PAYMENT_FIELDS = (
	"payment_for",
	"student",
	"programme_application",
	"sponsor",
	"payer_name",
	"posting_date",
	"mode_of_payment",
	"amount",
	"reference_no",
	"reference_date",
	"msisdn",
	"remarks",
)
STRUCTURE_FIELDS = (
	"structure_name",
	"programme",
	"campus",
	"study_mode",
	"academic_year",
	"academic_term",
	"year_of_study",
	"fee_category",
	"is_active",
	"allow_installments",
)
COMPONENT_FIELDS = (
	"component_name",
	"code",
	"component_type",
	"default_amount",
	"is_refundable",
	"is_active",
	"description",
	"income_account",
)
SCHOLARSHIP_FIELDS = (
	"scholarship_name",
	"scholarship_type",
	"sponsor",
	"academic_year",
	"amount_type",
	"amount",
	"percentage",
	"applies_to_component",
	"total_budget",
	"is_active",
	"description",
	"eligibility",
)


def require_finance() -> str:
	return require_roles(ROLE_FINANCE)


def require_finance_read() -> str:
	return require_roles(*READ_ROLES)


def _list(
	doctype, filters, fields, start=0, page_length=20, order_by="creation desc", or_filters=None
) -> dict:
	args = page_args(start, page_length)
	data = frappe.get_list(
		doctype,
		filters=filters,
		or_filters=or_filters,
		fields=fields,
		order_by=order_by,
		offset=args["start"],
		limit=args["page_length"],
	)
	total = frappe.get_list(
		doctype, filters=filters, or_filters=or_filters, fields=[{"COUNT": "*", "as": "total"}]
	)
	return {"data": data, "total": cint(total[0].total) if total else 0}


def _date_filters(filters: dict, field: str, from_date=None, to_date=None):
	if from_date and to_date:
		filters[field] = ["between", [getdate(from_date), getdate(to_date)]]
	elif from_date:
		filters[field] = [">=", getdate(from_date)]
	elif to_date:
		filters[field] = ["<=", getdate(to_date)]


def _children(child: str, parenttype: str, parents: list[str], fields: list[str]) -> dict[str, list]:
	out: dict[str, list] = {}
	if not parents:
		return out
	for row in frappe.get_all(
		child,
		filters={"parenttype": parenttype, "parent": ["in", parents]},
		fields=["parent", *fields],
		order_by="idx asc",
	):
		out.setdefault(row.pop("parent"), []).append(row)
	return out


# ---------------------------------------------------------------------------------- student account payload
def account_summary(student: str) -> dict:
	"""Balance, clearance, invoices (+items, installments), payments (+allocations), pending STK requests,
	latest refund requests and the credit still available for a refund."""
	info = frappe.db.get_value(
		"Student",
		student,
		["name", "full_name", "student_number", "programme", "programme_name", "phone"],
		as_dict=True,
	)
	invoices = frappe.get_all(
		"Student Invoice",
		filters={"student": student, "docstatus": 1},
		fields=INVOICE_LIST_FIELDS,
		order_by="posting_date desc, creation desc",
	)
	names = [i.name for i in invoices]
	items = _children(
		"Student Invoice Item", "Student Invoice", names, ["fee_component", "description", "amount"]
	)
	installments = _children(
		"Fee Installment", "Student Invoice", names, ["label", "due_date", "amount", "paid_amount", "status"]
	)
	for inv in invoices:
		inv["items"] = items.get(inv.name, [])
		inv["installments"] = installments.get(inv.name, [])
	payments = frappe.get_all(
		"Student Payment",
		filters={"student": student, "docstatus": 1},
		fields=PAYMENT_LIST_FIELDS,
		order_by="posting_date desc, creation desc",
		limit=100,
	)
	allocations = _children(
		"Payment Allocation",
		"Student Payment",
		[p.name for p in payments],
		["invoice", "academic_term", "allocated_amount"],
	)
	for p in payments:
		p["allocations"] = allocations.get(p.name, [])
	pending = frappe.get_all(
		"M-Pesa Request",
		filters={
			"student": student,
			"status": ["in", ["Initiated", "Pending"]],
			"creation": [">=", add_days(today(), -1)],
		},
		fields=["name", "amount", "phone_number", "status", "creation", "checkout_request_id"],
		order_by="creation desc",
	)
	upcoming = sorted(
		(
			{**row, "invoice": inv.name}
			for inv in invoices
			for row in inv["installments"]
			if row.status != "Paid"
		),
		key=lambda r: str(r.get("due_date") or "9999"),
	)
	totals = fees.ledger_totals(student)
	ms = frappe.get_cached_doc("M-Pesa Settings")
	return {
		"student": info,
		"balance": totals["balance"],
		"total_billed": totals["debit"],
		"total_paid": totals["credit"],
		"currency": setting("currency", "KES"),
		"clearance": {p: fees.fee_clearance(student, p) for p in ("exam", "lms")},
		"invoices": invoices,
		"payments": payments,
		"installments": upcoming,
		"pending_requests": pending,
		"refunds": fees.student_refunds(student, limit=10),
		"refund_available": fees.money(max(-totals["balance"] - fees.reserved_refunds(student), 0)),
		"mpesa": {
			"enabled": bool(cint(ms.enabled)),
			"simulation": not cint(ms.enabled) and bool(cint(frappe.conf.get("developer_mode"))),
			"paybill": ms.business_shortcode if ms.transaction_type != "CustomerBuyGoodsOnline" else None,
			"till": ms.till_number if ms.transaction_type == "CustomerBuyGoodsOnline" else None,
			"account": info.student_number if info else None,
		},
	}


# ---------------------------------------------------------------------------------- student portal
@frappe.whitelist()
def my_fees():
	student = require_student()
	return account_summary(student.name)


@frappe.whitelist()
def my_statement(from_date=None, to_date=None):
	student = require_student()
	return fees.statement(student.name, from_date, to_date)


@frappe.whitelist(methods=["POST"])
def pay_fees(amount, phone=None, invoice=None):
	student = require_student()
	if invoice and frappe.db.get_value("Student Invoice", invoice, "student") != student.name:
		frappe.throw(_("Invoice {0} is not yours").format(invoice), frappe.PermissionError)
	from mahanaim.services.mpesa import initiate_payment

	return initiate_payment(
		phone or student.phone,
		amount,
		"Student Fees",
		student=student.name,
		invoice=invoice,
		initiated_by=frappe.session.user,
	)


def _request_owner_ok(req) -> bool:
	user = frappe.session.user
	if is_staff(user) or req.initiated_by == user:
		return True
	if req.student and frappe.db.get_value("Student", req.student, "user") == user:
		return True
	if (
		req.programme_application
		and frappe.db.get_value("Programme Application", req.programme_application, "user") == user
	):
		return True
	return bool(req.sponsor and frappe.db.get_value("Sponsor", req.sponsor, "user") == user)


@frappe.whitelist()
def payment_request_status(request):
	require_login()
	req = frappe.db.get_value(
		"M-Pesa Request",
		request,
		[
			"name",
			"status",
			"amount",
			"phone_number",
			"purpose",
			"student",
			"programme_application",
			"sponsor",
			"initiated_by",
			"result_code",
			"result_desc",
			"mpesa_receipt_number",
			"payment",
			"creation",
			"remarks",
		],
		as_dict=True,
	)
	if not req or not _request_owner_ok(req):
		frappe.throw(_("Payment request not found"), frappe.DoesNotExistError)
	for key in ("initiated_by", "sponsor"):
		req.pop(key, None)
	req["done"] = req.status not in ("Initiated", "Pending")
	return req


@frappe.whitelist()
def download(doctype, name=None, format="pdf", from_date=None, to_date=None):
	"""Invoice / receipt / statement / giving receipt as PDF (default) or HTML.

	Allowed: finance staff (plus chaplaincy for gifts), the owning student/applicant, the sponsor of the student
	(submitted invoices and receipts) and the giver of a gift."""
	require_login()
	doctype = FINANCE_DOCS.get(doctype)
	if not doctype:
		frappe.throw(_("Unsupported document type"))
	if doctype == "Fee Statement" and not name:
		name = require_student().name
	if not name:
		frappe.throw(_("Document name is required"))
	documents.check_access(doctype, name)
	send_document(doctype, name, format, from_date=from_date, to_date=to_date)


def send_document(doctype, name, format="pdf", **opts):
	if (format or "pdf").lower() == "html":
		html = documents.render_html(doctype, name, **opts)
		frappe.local.response.update(
			{
				"type": "download",
				"filename": f"{name}.html".replace("/", "-"),
				"filecontent": html,
				"content_type": "text/html; charset=utf-8",
				"display_content_as": "inline",
			}
		)
		return
	filename, content = documents.render_pdf(doctype, name, **opts)
	frappe.local.response.update({"type": "pdf", "filename": filename, "filecontent": content})


@frappe.whitelist(methods=["POST"])
def request_refund(amount, reason, refund_mode="M-Pesa", account_details=None):
	"""Ask for a refund of credit. One open (Pending / Approved) request per student at a time."""
	student = require_student()
	# Lock the student row so two simultaneous requests cannot both pass the credit check.
	frappe.db.get_value("Student", student.name, "name", for_update=True)
	amount = fees.money(amount)
	if amount <= 0:
		frappe.throw(_("Enter a refund amount greater than zero"))
	open_request = frappe.db.get_value(
		"Refund Request", {"student": student.name, "status": ["in", fees.OPEN_REFUND_STATUSES]}, "name"
	)
	if open_request:
		frappe.throw(
			_("Refund request {0} is still being processed. You can ask again once it is decided.").format(
				open_request
			),
			title=_("Refund already requested"),
		)
	available = fees.refundable_credit(student.name)
	if amount > available:
		frappe.throw(
			_("You can request at most {0}, your available credit balance.").format(fmt_money(available))
			if available > 0
			else _("You have no credit balance to refund."),
			title=_("Insufficient credit"),
		)
	doc = frappe.get_doc(
		{
			"doctype": "Refund Request",
			"student": student.name,
			"amount": amount,
			"reason": reason,
			"refund_mode": refund_mode,
			"account_details": account_details or student.phone,
			"status": "Pending",
		}
	).insert(ignore_permissions=True)
	return doc.as_dict()


@frappe.whitelist()
def my_refunds():
	"""The signed-in student's refund requests, newest first."""
	student = require_student()
	return fees.student_refunds(student.name)


# ---------------------------------------------------------------------------------- applicant
@frappe.whitelist()
def application_fee_status(application):
	user = require_applicant()
	app = frappe.db.get_value(
		"Programme Application",
		application,
		[
			"name",
			"user",
			"full_name",
			"programme",
			"programme_name",
			"application_fee",
			"fee_status",
			"fee_payment",
			"status",
			"phone",
		],
		as_dict=True,
	)
	if not app or (app.user != user and not is_staff(user)):
		frappe.throw(_("Application not found"), frappe.DoesNotExistError)
	fee = (
		flt(app.application_fee)
		or flt(frappe.db.get_value("Programme", app.programme, "application_fee"))
		or flt(setting("application_fee"))
	)
	payment = None
	if app.fee_payment:
		payment = frappe.db.get_value(
			"Student Payment",
			app.fee_payment,
			["name", "amount", "posting_date", "mode_of_payment", "reference_no", "status", "docstatus"],
			as_dict=True,
		)
	pending = frappe.get_all(
		"M-Pesa Request",
		filters={
			"programme_application": application,
			"status": ["in", ["Initiated", "Pending"]],
			"creation": [">=", add_days(today(), -1)],
		},
		fields=["name", "amount", "status", "creation"],
		order_by="creation desc",
	)
	ms = frappe.get_cached_doc("M-Pesa Settings")
	return {
		"application": app.name,
		"programme_name": app.programme_name,
		"application_fee": flt(fee, 2),
		"required": bool(cint(setting("application_fee_required", 1))),
		"fee_status": app.fee_status or "Unpaid",
		"paid": app.fee_status in ("Paid", "Waived"),
		"payment": payment,
		"pending_requests": pending,
		"phone": app.phone,
		"mpesa": {
			"enabled": bool(cint(ms.enabled)),
			"simulation": not cint(ms.enabled) and bool(cint(frappe.conf.get("developer_mode"))),
			"paybill": ms.business_shortcode,
			"account": app.name,
		},
	}


# ---------------------------------------------------------------------------------- dashboard
@frappe.whitelist()
def finance_dashboard():
	require_finance_read()
	t = getdate(today())
	week_start = add_days(t, -t.weekday())
	month_start = get_first_day(t)
	trend_start = get_first_day(add_months(t, -11))
	collected = frappe.db.sql(
		"""select
			coalesce(sum(case when posting_date = %(t)s then amount end), 0) as today,
			coalesce(sum(case when posting_date >= %(w)s then amount end), 0) as week,
			coalesce(sum(case when posting_date >= %(m)s then amount end), 0) as month
		from `tabStudent Payment` where docstatus = 1 and posting_date >= %(min)s and posting_date <= %(t)s""",
		{"t": t, "w": week_start, "m": month_start, "min": min(week_start, month_start)},
		as_dict=True,
	)[0]
	term = current_term()
	si = DocType("Student Invoice")
	term_row = (
		frappe.qb.from_(si)
		.select(Coalesce(Sum(si.total_amount), 0), Coalesce(Sum(si.outstanding_amount), 0))
		.where(si.docstatus == 1)
		.where(si.academic_term == (term or ""))
	).run()[0]
	billed, term_outstanding = fees.money(term_row[0]), fees.money(term_row[1])
	balances = frappe.db.sql(
		"""select coalesce(sum(case when bal > 0 then bal end), 0), coalesce(sum(case when bal < 0 then -bal end), 0),
			coalesce(sum(case when bal > 0 then 1 end), 0)
		from (select student, sum(debit) - sum(credit) as bal from `tabStudent Ledger Entry`
			where is_cancelled = 0 group by student) b"""
	)[0]
	by_mode = frappe.db.sql(
		"""select mode_of_payment as mode, sum(amount) as amount, count(*) as count from `tabStudent Payment`
		where docstatus = 1 and posting_date between %s and %s group by mode_of_payment order by amount desc""",
		(month_start, t),
		as_dict=True,
	)
	top_programmes = frappe.db.sql(
		"""select si.programme, p.programme_name, sum(si.outstanding_amount) as outstanding, count(distinct si.student)
			as students
		from `tabStudent Invoice` si left join `tabProgramme` p on p.name = si.programme
		where si.docstatus = 1 and si.outstanding_amount > 0
		group by si.programme, p.programme_name order by outstanding desc limit 5""",
		as_dict=True,
	)
	billed_trend = dict(
		frappe.db.sql(
			"""select date_format(posting_date, '%%Y-%%m'), sum(total_amount) from `tabStudent Invoice`
			where docstatus = 1 and posting_date >= %s group by 1""",
			trend_start,
		)
	)
	collected_trend = dict(
		frappe.db.sql(
			"""select date_format(posting_date, '%%Y-%%m'), sum(amount) from `tabStudent Payment`
			where docstatus = 1 and posting_date >= %s group by 1""",
			trend_start,
		)
	)
	trend = []
	for i in range(12):
		key = add_months(trend_start, i).strftime("%Y-%m")
		trend.append(
			{
				"month": key,
				"billed": fees.money(billed_trend.get(key)),
				"collected": fees.money(collected_trend.get(key)),
			}
		)
	mpesa_counts = dict(
		frappe.db.sql(
			"""select status, count(*) from `tabM-Pesa Transaction`
			where status in ('Unmatched', 'Matched') and (payment is null or payment = '') group by status"""
		)
	)
	return {
		"currency": setting("currency", "KES"),
		"collected": {k: fees.money(collected[k]) for k in ("today", "week", "month")},
		"term": {
			"academic_term": term,
			"billed": billed,
			"collected": fees.money(billed - term_outstanding),
			"outstanding": term_outstanding,
			"collection_rate": round((billed - term_outstanding) * 100.0 / billed, 2) if billed else 0.0,
		},
		"total_outstanding": fees.money(balances[0]),
		"total_credit": fees.money(balances[1]),
		"students_owing": cint(balances[2]),
		"aging": aging_buckets(),
		"collections_by_mode": [{**r, "amount": fees.money(r.amount)} for r in by_mode],
		"top_programmes": [{**r, "outstanding": fees.money(r.outstanding)} for r in top_programmes],
		"unmatched_mpesa": cint(mpesa_counts.get("Unmatched")),
		"matched_unallocated_mpesa": cint(mpesa_counts.get("Matched")),
		"pending_refunds": frappe.db.count("Refund Request", {"status": ["in", ["Pending", "Approved"]]}),
		"overdue_invoices": frappe.db.count("Student Invoice", {"docstatus": 1, "status": "Overdue"}),
		"trend": trend,
	}


AGING_SQL = """
	case
		when datediff(%(today)s, coalesce(due_date, posting_date)) <= 30 then '0-30'
		when datediff(%(today)s, coalesce(due_date, posting_date)) <= 60 then '31-60'
		when datediff(%(today)s, coalesce(due_date, posting_date)) <= 90 then '61-90'
		else '90+'
	end"""
AGING_BUCKETS = ("0-30", "31-60", "61-90", "90+")


def aging_buckets(programme=None, campus=None) -> list[dict]:
	"""Outstanding on submitted invoices by days past due (not-yet-due counts in 0-30)."""
	cond, params = "", {"today": today()}
	if programme:
		cond += " and programme = %(programme)s"
		params["programme"] = programme
	if campus:
		cond += " and campus = %(campus)s"
		params["campus"] = campus
	rows = {
		r.bucket: r
		for r in frappe.db.sql(
			f"""select {AGING_SQL} as bucket, sum(outstanding_amount) as amount, count(*) as invoices,
				count(distinct student) as students
			from `tabStudent Invoice` where docstatus = 1 and outstanding_amount > 0 {cond} group by bucket""",
			params,
			as_dict=True,
		)
	}
	return [
		{
			"bucket": b,
			"amount": fees.money((rows.get(b) or {}).get("amount")),
			"invoices": cint((rows.get(b) or {}).get("invoices")),
			"students": cint((rows.get(b) or {}).get("students")),
		}
		for b in AGING_BUCKETS
	]


# ---------------------------------------------------------------------------------- invoices
@frappe.whitelist()
def list_invoices(
	filters=None,
	status=None,
	student=None,
	academic_term=None,
	programme=None,
	campus=None,
	search=None,
	from_date=None,
	to_date=None,
	start=0,
	page_length=20,
):
	require_finance_read()
	f = {k: v for k, v in (parse_json(filters, {}) or {}).items() if k in INVOICE_LIST_FIELDS}
	for key, value in (
		("status", status),
		("student", student),
		("academic_term", academic_term),
		("programme", programme),
		("campus", campus),
	):
		if value:
			f[key] = value
	if "docstatus" not in f and f.get("status") != "Draft":
		f.setdefault("docstatus", ["<", 2] if f.get("status") != "Cancelled" else 2)
	_date_filters(f, "posting_date", from_date, to_date)
	or_filters = None
	if search:
		like = f"%{search.strip()}%"
		or_filters = [["name", "like", like], ["student_name", "like", like], ["student", "like", like]]
	return _list(
		"Student Invoice",
		f,
		INVOICE_LIST_FIELDS,
		start,
		page_length,
		"posting_date desc, creation desc",
		or_filters,
	)


def _invoice_detail(name: str) -> dict:
	doc = frappe.get_doc("Student Invoice", name)
	data = doc.as_dict()
	data["student_number"] = frappe.db.get_value("Student", doc.student, "student_number")
	data["payments"] = frappe.db.sql(
		"""select p.name, p.posting_date, p.mode_of_payment, p.reference_no, a.allocated_amount
		from `tabPayment Allocation` a join `tabStudent Payment` p on p.name = a.parent
		where a.parenttype = 'Student Payment' and a.invoice = %s and p.docstatus = 1 order by p.posting_date""",
		name,
		as_dict=True,
	)
	data["adjustments"] = frappe.get_all(
		"Fee Adjustment",
		filters={"invoice": name, "docstatus": 1},
		fields=["name", "adjustment_type", "amount", "posting_date", "reason"],
	)
	data["balance"] = fees.get_student_balance(doc.student)
	return data


@frappe.whitelist()
def get_invoice(name):
	require_finance_read()
	frappe.has_permission("Student Invoice", "read", name, throw=True)
	return _invoice_detail(name)


@frappe.whitelist(methods=["POST"])
def create_invoice(data):
	require_finance()
	data = parse_json(data, {}) or {}
	values = clean_payload(
		data, ("student", "fee_structure", "academic_term", "posting_date", "due_date", "remarks")
	)
	if not values.get("student"):
		frappe.throw(_("Select a student"))
	items = [
		{
			"fee_component": i.get("fee_component"),
			"description": i.get("description"),
			"amount": flt(i.get("amount"), 2),
		}
		for i in (parse_json(data.get("items"), []) or [])
	]
	doc = frappe.get_doc({"doctype": "Student Invoice", **values, "items": items})
	doc.insert()
	if cint(data.get("submit")):
		doc.submit()
	return _invoice_detail(doc.name)


@frappe.whitelist(methods=["POST"])
def submit_invoice(name):
	require_finance()
	doc = frappe.get_doc("Student Invoice", name)
	doc.submit()
	return _invoice_detail(name)


@frappe.whitelist(methods=["POST"])
def cancel_invoice(name, reason=None):
	require_finance()
	doc = frappe.get_doc("Student Invoice", name)
	doc.cancel()
	if reason:
		doc.add_comment("Info", _("Cancelled: {0}").format(reason))
	return _invoice_detail(name)


@frappe.whitelist(methods=["POST"])
def bulk_invoice(term, programme=None, campus=None, study_mode=None):
	require_finance()
	if not frappe.db.exists("Academic Term", term):
		frappe.throw(_("Academic term {0} not found").format(term), frappe.DoesNotExistError)
	targets = fees.bulk_invoice_targets(term, programme, campus, study_mode)
	if len(targets) > fees.BULK_SYNC_LIMIT:
		frappe.enqueue(
			"mahanaim.services.fees.bulk_invoice_job",
			queue="long",
			timeout=3600,
			enqueue_after_commit=True,
			term=term,
			programme=programme,
			campus=campus,
			study_mode=study_mode,
			user=frappe.session.user,
		)
		return {"queued": True, "term": term, "count": len(targets)}
	return {"queued": False, **fees.bulk_invoice(term, students=targets)}


# ---------------------------------------------------------------------------------- payments
@frappe.whitelist()
def list_payments(
	filters=None,
	student=None,
	mode_of_payment=None,
	payment_for=None,
	status=None,
	search=None,
	from_date=None,
	to_date=None,
	start=0,
	page_length=20,
):
	require_finance_read()
	f = {k: v for k, v in (parse_json(filters, {}) or {}).items() if k in PAYMENT_LIST_FIELDS}
	for key, value in (
		("student", student),
		("mode_of_payment", mode_of_payment),
		("payment_for", payment_for),
		("status", status),
	):
		if value:
			f[key] = value
	_date_filters(f, "posting_date", from_date, to_date)
	or_filters = None
	if search:
		like = f"%{search.strip()}%"
		or_filters = [
			["name", "like", like],
			["payer_name", "like", like],
			["reference_no", "like", like],
			["student", "like", like],
		]
	return _list(
		"Student Payment",
		f,
		PAYMENT_LIST_FIELDS,
		start,
		page_length,
		"posting_date desc, creation desc",
		or_filters,
	)


def _payment_detail(name: str) -> dict:
	doc = frappe.get_doc("Student Payment", name)
	data = doc.as_dict()
	if doc.student:
		data["student_number"] = frappe.db.get_value("Student", doc.student, "student_number")
		data["balance"] = fees.get_student_balance(doc.student)
	data["receipt_url"] = (
		f"/api/method/mahanaim.api.finance.download?doctype=receipt&name={doc.name}"
		if doc.docstatus == 1
		else None
	)
	return data


@frappe.whitelist()
def get_payment(name):
	require_finance_read()
	frappe.has_permission("Student Payment", "read", name, throw=True)
	return _payment_detail(name)


@frappe.whitelist(methods=["POST"])
def record_payment(data):
	"""Record a cash / bank / cheque (or manually-entered M-Pesa) payment and submit it immediately."""
	require_finance()
	data = parse_json(data, {}) or {}
	values = clean_payload(data, PAYMENT_FIELDS)
	values["payment_for"] = values.get("payment_for") or "Student Fees"
	allocations = [
		{"invoice": a.get("invoice"), "allocated_amount": flt(a.get("allocated_amount"), 2)}
		for a in (parse_json(data.get("allocations"), []) or [])
		if a.get("invoice") and flt(a.get("allocated_amount")) > 0
	]
	doc = frappe.get_doc({"doctype": "Student Payment", **values, "allocations": allocations})
	doc.insert()
	doc.submit()
	return _payment_detail(doc.name)


@frappe.whitelist(methods=["POST"])
def cancel_payment(name, reason):
	require_finance()
	if not (reason or "").strip():
		frappe.throw(_("Give a reason for cancelling this payment"))
	doc = frappe.get_doc("Student Payment", name)
	doc.cancel()
	doc.add_comment("Info", _("Cancelled: {0}").format(reason.strip()))
	return _payment_detail(name)


@frappe.whitelist()
def student_statement(student, from_date=None, to_date=None):
	require_finance_read()
	frappe.has_permission("Student", "read", student, throw=True)
	return fees.statement(student, from_date, to_date)


@frappe.whitelist()
def student_account(student):
	require_finance_read()
	frappe.has_permission("Student", "read", student, throw=True)
	return account_summary(student)


# ---------------------------------------------------------------------------------- adjustments
@frappe.whitelist()
def list_adjustments(
	student=None, adjustment_type=None, docstatus=None, from_date=None, to_date=None, start=0, page_length=20
):
	require_finance_read()
	f = {}
	if student:
		f["student"] = student
	if adjustment_type:
		f["adjustment_type"] = adjustment_type
	if docstatus not in (None, ""):
		f["docstatus"] = cint(docstatus)
	_date_filters(f, "posting_date", from_date, to_date)
	return _list(
		"Fee Adjustment",
		f,
		[
			"name",
			"student",
			"student_name",
			"adjustment_type",
			"amount",
			"posting_date",
			"invoice",
			"academic_term",
			"scholarship",
			"sponsor",
			"reason",
			"approved_by",
			"docstatus",
		],
		start,
		page_length,
	)


@frappe.whitelist(methods=["POST"])
def save_adjustment(data):
	require_finance()
	data = parse_json(data, {}) or {}
	values = clean_payload(data, ADJUSTMENT_FIELDS)
	if data.get("name"):
		doc = frappe.get_doc("Fee Adjustment", data["name"])
		if doc.docstatus != 0:
			frappe.throw(_("Only draft adjustments can be edited"))
		doc.update(values)
		doc.save()
	else:
		doc = frappe.get_doc({"doctype": "Fee Adjustment", **values}).insert()
	if cint(data.get("submit")):
		doc.submit()
	return doc.as_dict()


@frappe.whitelist(methods=["POST"])
def submit_adjustment(name):
	require_finance()
	doc = frappe.get_doc("Fee Adjustment", name)
	doc.submit()
	return doc.as_dict()


@frappe.whitelist(methods=["POST"])
def cancel_adjustment(name, reason=None):
	require_finance()
	doc = frappe.get_doc("Fee Adjustment", name)
	doc.cancel()
	if reason:
		doc.add_comment("Info", _("Cancelled: {0}").format(reason))
	return doc.as_dict()


# ---------------------------------------------------------------------------------- refunds
@frappe.whitelist()
def list_refunds(status=None, student=None, start=0, page_length=20):
	require_finance_read()
	f = {}
	if status:
		f["status"] = status
	if student:
		f["student"] = student
	return _list(
		"Refund Request",
		f,
		[
			"name",
			"student",
			"student_name",
			"amount",
			"status",
			"refund_mode",
			"account_details",
			"reason",
			"approved_by",
			"approved_on",
			"paid_on",
			"reference_no",
			"creation",
		],
		start,
		page_length,
	)


@frappe.whitelist(methods=["POST"])
def save_refund(data):
	require_finance()
	data = parse_json(data, {}) or {}
	values = clean_payload(
		data, ("student", "amount", "payment", "refund_mode", "account_details", "reason", "remarks")
	)
	if data.get("name"):
		doc = frappe.get_doc("Refund Request", data["name"])
		if doc.status != "Pending":
			frappe.throw(_("Only pending refund requests can be edited"))
		doc.update(values)
		doc.save()
	else:
		doc = frappe.get_doc({"doctype": "Refund Request", **values, "status": "Pending"}).insert()
	return doc.as_dict()


@frappe.whitelist(methods=["POST"])
def decide_refund(name, decision, remarks=None, reference_no=None, paid_on=None):
	"""decision: Approved | Rejected | Paid."""
	require_finance()
	if decision not in ("Approved", "Rejected", "Paid"):
		frappe.throw(_("Decision must be Approved, Rejected or Paid"))
	doc = frappe.get_doc("Refund Request", name)
	doc.status = decision
	if remarks:
		doc.remarks = remarks
	if decision == "Paid":
		doc.reference_no = reference_no or doc.reference_no
		doc.paid_on = paid_on or doc.paid_on or today()
	doc.save()
	return doc.as_dict()


# ---------------------------------------------------------------------------------- structures & masters
@frappe.whitelist()
def list_fee_structures(
	programme=None,
	academic_term=None,
	academic_year=None,
	is_active=None,
	search=None,
	start=0,
	page_length=50,
):
	require_roles(ROLE_FINANCE, ROLE_AUDITOR, "Registrar", "Admissions Officer")
	f = {}
	for key, value in (
		("programme", programme),
		("academic_term", academic_term),
		("academic_year", academic_year),
	):
		if value:
			f[key] = value
	if is_active not in (None, ""):
		f["is_active"] = cint(is_active)
	or_filters = (
		[["structure_name", "like", f"%{search}%"], ["name", "like", f"%{search}%"]] if search else None
	)
	return _list(
		"Fee Structure",
		f,
		["name", *STRUCTURE_FIELDS, "total_amount", "modified"],
		start,
		page_length,
		"modified desc",
		or_filters,
	)


@frappe.whitelist()
def get_fee_structure(name):
	require_roles(ROLE_FINANCE, ROLE_AUDITOR, "Registrar", "Admissions Officer")
	frappe.has_permission("Fee Structure", "read", name, throw=True)
	return frappe.get_doc("Fee Structure", name).as_dict()


@frappe.whitelist(methods=["POST"])
def save_fee_structure(data):
	require_finance()
	data = parse_json(data, {}) or {}
	values = clean_payload(data, STRUCTURE_FIELDS)
	items = [
		{
			"fee_component": i.get("fee_component"),
			"description": i.get("description"),
			"amount": flt(i.get("amount"), 2),
			"is_mandatory": cint(i.get("is_mandatory", 1)),
		}
		for i in (parse_json(data.get("items"), []) or [])
	]
	installments = [
		{
			"label": i.get("label"),
			"percent": flt(i.get("percent")),
			"due_date": i.get("due_date"),
			"due_days": cint(i.get("due_days")),
			"amount": flt(i.get("amount"), 2),
		}
		for i in (parse_json(data.get("installments"), []) or [])
	]
	if data.get("name"):
		doc = frappe.get_doc("Fee Structure", data["name"])
		doc.update(values)
	else:
		doc = frappe.get_doc({"doctype": "Fee Structure", **values})
	if "items" in data:
		doc.set("items", items)
	if "installments" in data:
		doc.set("installments", installments)
	doc.save()
	return doc.as_dict()


@frappe.whitelist()
def list_fee_components(include_inactive=0):
	require_roles(ROLE_FINANCE, ROLE_AUDITOR, "Registrar", "Admissions Officer")
	f = {} if cint(include_inactive) else {"is_active": 1}
	data = frappe.get_list(
		"Fee Component",
		filters=f,
		fields=["name", *COMPONENT_FIELDS],
		order_by="component_name asc",
		limit=500,
	)
	return {"data": data, "total": len(data)}


@frappe.whitelist(methods=["POST"])
def save_fee_component(data):
	require_finance()
	data = parse_json(data, {}) or {}
	values = clean_payload(data, COMPONENT_FIELDS)
	if data.get("name") and frappe.db.exists("Fee Component", data["name"]):
		doc = frappe.get_doc("Fee Component", data["name"])
		values.pop("component_name", None)
		doc.update(values)
		doc.save()
	else:
		doc = frappe.get_doc({"doctype": "Fee Component", **values}).insert()
	return doc.as_dict()


@frappe.whitelist()
def list_scholarships(is_active=None, start=0, page_length=50):
	require_roles(ROLE_FINANCE, ROLE_AUDITOR, "Registrar", "Admissions Officer")
	f = {} if is_active in (None, "") else {"is_active": cint(is_active)}
	return _list(
		"Scholarship",
		f,
		["name", *SCHOLARSHIP_FIELDS, "utilised_amount"],
		start,
		page_length,
		"scholarship_name asc",
	)


@frappe.whitelist(methods=["POST"])
def save_scholarship(data):
	require_finance()
	data = parse_json(data, {}) or {}
	values = clean_payload(data, SCHOLARSHIP_FIELDS)
	if data.get("name") and frappe.db.exists("Scholarship", data["name"]):
		doc = frappe.get_doc("Scholarship", data["name"])
		values.pop("scholarship_name", None)
		doc.update(values)
		doc.save()
	else:
		doc = frappe.get_doc({"doctype": "Scholarship", **values}).insert()
	return doc.as_dict()


# ---------------------------------------------------------------------------------- reports
@frappe.whitelist()
def defaulters(threshold=0, programme=None, campus=None, overdue_only=0, start=0, page_length=50):
	require_finance_read()
	args = page_args(start, page_length, max_length=1000)
	cond, params = "", {"threshold": flt(threshold), "today": today()}
	if programme:
		cond += " and s.programme = %(programme)s"
		params["programme"] = programme
	if campus:
		cond += " and s.campus = %(campus)s"
		params["campus"] = campus
	having = "balance > %(threshold)s"
	if cint(overdue_only):
		having += " and oldest_due is not null"
	base = f"""select s.name as student, s.student_number, s.full_name, s.programme, s.programme_name, s.campus,
			s.phone, s.email, s.status, sum(l.debit) - sum(l.credit) as balance,
			(select min(si.due_date) from `tabStudent Invoice` si where si.student = s.name and si.docstatus = 1
				and si.outstanding_amount > 0 and si.due_date < %(today)s) as oldest_due,
			(select max(p.posting_date) from `tabStudent Payment` p where p.student = s.name and p.docstatus = 1)
				as last_payment
		from `tabStudent` s join `tabStudent Ledger Entry` l on l.student = s.name and l.is_cancelled = 0
		where 1 = 1 {cond}
		group by s.name having {having}"""
	totals = frappe.db.sql(f"select count(*), coalesce(sum(balance), 0) from ({base}) d", params)[0]
	rows = frappe.db.sql(
		f"{base} order by balance desc limit %(limit)s offset %(offset)s",
		{**params, "limit": args["page_length"], "offset": args["start"]},
		as_dict=True,
	)
	t = getdate(today())
	for r in rows:
		r.balance = fees.money(r.balance)
		r.days_overdue = (t - getdate(r.oldest_due)).days if r.oldest_due else 0
	return {"data": rows, "total": cint(totals[0]), "total_balance": fees.money(totals[1])}


@frappe.whitelist(methods=["POST"])
def send_reminders(students=None):
	require_finance()
	students = parse_json(students, None)
	if isinstance(students, str):
		students = [students]
	sent = fees.send_fee_reminders(students or None, force=bool(students))
	return {"ok": True, "sent": sent}


@frappe.whitelist()
def collections_report(from_date=None, to_date=None, group_by="day"):
	require_finance_read()
	to_date = getdate(to_date or today())
	from_date = getdate(from_date or get_first_day(to_date))
	if group_by not in ("day", "mode", "programme", "payment_for", "month"):
		frappe.throw(_("group_by must be day, month, mode, programme or payment_for"))
	key = {
		"day": "p.posting_date",
		"month": "date_format(p.posting_date, '%%Y-%%m')",
		"mode": "p.mode_of_payment",
		"payment_for": "p.payment_for",
		"programme": "coalesce(s.programme, pa.programme, '')",
	}[group_by]
	rows = frappe.db.sql(
		f"""select {key} as `key`, sum(p.amount) as amount, count(*) as count
		from `tabStudent Payment` p
		left join `tabStudent` s on s.name = p.student
		left join `tabProgramme Application` pa on pa.name = p.programme_application
		where p.docstatus = 1 and p.posting_date between %(from)s and %(to)s
		group by `key` order by {"`key` asc" if group_by in ("day", "month") else "amount desc"}""",
		{"from": from_date, "to": to_date},
		as_dict=True,
	)
	if group_by == "programme":
		names = dict(frappe.get_all("Programme", fields=["name", "programme_name"], as_list=True))
		for r in rows:
			r["label"] = names.get(r.key) or r.key or _("Unassigned")
	total = fees.money(sum(flt(r.amount) for r in rows))
	return {
		"from_date": str(from_date),
		"to_date": str(to_date),
		"group_by": group_by,
		"data": [
			{**r, "key": str(r.key) if r.key is not None else "", "amount": fees.money(r.amount)}
			for r in rows
		],
		"total": total,
		"count": sum(cint(r["count"]) for r in rows),
	}


@frappe.whitelist()
def aging_report(programme=None, campus=None, start=0, page_length=100):
	require_finance_read()
	args = page_args(start, page_length, max_length=1000)
	cond, params = "", {"today": today()}
	if programme:
		cond += " and si.programme = %(programme)s"
		params["programme"] = programme
	if campus:
		cond += " and si.campus = %(campus)s"
		params["campus"] = campus
	bucket = AGING_SQL.replace("due_date", "si.due_date").replace("posting_date", "si.posting_date")
	rows = frappe.db.sql(
		f"""select si.student, si.student_name, s.student_number, si.programme,
			sum(case when {bucket} = '0-30' then si.outstanding_amount else 0 end) as b0_30,
			sum(case when {bucket} = '31-60' then si.outstanding_amount else 0 end) as b31_60,
			sum(case when {bucket} = '61-90' then si.outstanding_amount else 0 end) as b61_90,
			sum(case when {bucket} = '90+' then si.outstanding_amount else 0 end) as b90,
			sum(si.outstanding_amount) as total
		from `tabStudent Invoice` si left join `tabStudent` s on s.name = si.student
		where si.docstatus = 1 and si.outstanding_amount > 0 {cond}
		group by si.student, si.student_name, s.student_number, si.programme
		order by total desc limit %(limit)s offset %(offset)s""",
		{**params, "limit": args["page_length"], "offset": args["start"]},
		as_dict=True,
	)
	for r in rows:
		for k in ("b0_30", "b31_60", "b61_90", "b90", "total"):
			r[k] = fees.money(r[k])
	return {"summary": aging_buckets(programme, campus), "data": rows, "total": len(rows)}


# ---------------------------------------------------------------------------------- C2B aliases
# Daraja refuses C2B URLs that contain "mpesa"/"safaricom", so register these (see docs/MPESA.md).
@frappe.whitelist(allow_guest=True, methods=["POST"])
def paybill_validation(**kwargs):
	from mahanaim.api import mpesa

	return mpesa.c2b_validation(**kwargs)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def paybill_confirmation(**kwargs):
	from mahanaim.api import mpesa

	return mpesa.c2b_confirmation(**kwargs)
