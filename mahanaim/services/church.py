"""Church partners, sponsors, giving and chapel services (owned by backend domain B4).

Ported concepts from cfms_plus (partner church tree, giving types, collections -> ERPNext Journal Entry,
chapel/ministry attendance) without depending on it.

CONTRACT (for B3 / M-Pesa callbacks):
	on_mpesa_success(request, transaction=None) -> Giving Record name | None   (never raises)
		Call from the STK callback when an M-Pesa Request with purpose "Giving" completes (instead of creating a
		Student Payment). The giving intent (type, giver) is cached when `start_online_giving` starts the push.
	complete_online_giving(request, reference=None, amount=None, msisdn=None, payer_name=None)
		Same, raising on failure. `reconcile_online_giving()` is a safety-net cron for missed callbacks.
"""

from __future__ import annotations

import re
from collections import defaultdict

import frappe
from frappe import _
from frappe.utils import add_days, add_months, cint, cstr, flt, get_first_day, getdate, now_datetime, nowdate

from mahanaim.utils import ROLE_SPONSOR, has_app, normalize_phone, setting

SPONSORED_STATUSES = ("Active", "Suspended", "Completed")  # the sponsor may see the student's progress
OPEN_STATUSES = ("Proposed", "Active", "Suspended")  # at most one per sponsor + student
GIVING_INTENT_TTL = 60 * 60 * 24
DEFAULT_GIVING_AMOUNTS = (500, 1000, 2500, 5000)


# ---------------------------------------------------------------------------------- users
def split_name(full_name: str) -> tuple[str, str | None]:
	parts = (full_name or "").split()
	if not parts:
		return "Sponsor", None
	return parts[0], " ".join(parts[1:]) or None


def ensure_portal_user(
	email: str, full_name: str, phone: str | None = None, roles=(ROLE_SPONSOR,)
) -> str | None:
	"""Get-or-create a website user via B1's contract, with a local fallback while it is unavailable."""
	first, last = split_name(full_name)
	try:
		from mahanaim.services.students import ensure_user

		return ensure_user(email, first, last, phone, roles=tuple(roles))
	except (ImportError, NotImplementedError):
		return _fallback_ensure_user(email, first, last, phone, roles)


def _fallback_ensure_user(email, first_name, last_name=None, phone=None, roles=()) -> str:
	email = email.strip().lower()
	name = frappe.db.get_value("User", {"email": email}, "name")
	if name:
		user = frappe.get_doc("User", name)
	else:
		user = frappe.get_doc(
			{
				"doctype": "User",
				"email": email,
				"first_name": first_name,
				"last_name": last_name,
				"user_type": "Website User",
				"send_welcome_email": 0,
				"enabled": 1,
			}
		)
		if phone and not frappe.db.exists("User", {"mobile_no": phone}):
			user.mobile_no = phone
		user.flags.ignore_permissions = True
		user.insert()
	missing = [r for r in roles if r not in {d.role for d in user.roles}]
	if missing:
		user.flags.ignore_permissions = True
		user.add_roles(*missing)
	return user.name


# ---------------------------------------------------------------------------------- sponsorships
def sponsored_student_names(sponsor: str, statuses=SPONSORED_STATUSES) -> list[str]:
	return frappe.get_all(
		"Sponsorship",
		filters={"sponsor": sponsor, "status": ["in", list(statuses)]},
		pluck="student",
		distinct=True,
	)


def is_sponsored_by(sponsor: str | None, student: str) -> bool:
	return bool(sponsor) and bool(
		frappe.db.exists(
			"Sponsorship", {"sponsor": sponsor, "student": student, "status": ["in", SPONSORED_STATUSES]}
		)
	)


def disbursed_by_student(sponsor: str, students: list[str] | None = None) -> dict[str, float]:
	"""Payments (and sponsor credits) a sponsor has made per student — two grouped queries."""
	out = defaultdict(float)
	filters = {"sponsor": sponsor, "docstatus": 1}
	if students is not None:
		if not students:
			return {}
		filters["student"] = ["in", students]
	for r in frappe.get_all(
		"Student Payment",
		filters=filters,
		fields=["student", {"SUM": "amount", "as": "total"}],
		group_by="student",
	):
		out[r.student] += flt(r.total)
	for r in frappe.get_all(
		"Fee Adjustment",
		filters={**filters, "adjustment_type": "Sponsor Credit"},
		fields=["student", {"SUM": "amount", "as": "total"}],
		group_by="student",
	):
		out[r.student] += flt(r.total)
	return dict(out)


def invoice_totals(students: list[str]) -> dict[str, float]:
	if not students:
		return {}
	return {
		r.student: flt(r.total)
		for r in frappe.get_all(
			"Student Invoice",
			filters={"student": ["in", students], "docstatus": 1},
			fields=["student", {"SUM": "total_amount", "as": "total"}],
			group_by="student",
		)
	}


def committed_amount(row, invoiced: float) -> float:
	"""What a sponsorship row commits: its fixed amount, or its share of the student's invoices."""
	if row.coverage == "Percentage":
		return flt(row.amount) or invoiced * flt(row.percentage) / 100.0
	if row.coverage in ("Full Fees", "Tuition Only"):
		return flt(row.amount) or invoiced
	return flt(row.amount)


def refresh_sponsor_totals(sponsor: str | None):
	if not sponsor or not frappe.db.exists("Sponsor", sponsor):
		return
	rows = frappe.get_all(
		"Sponsorship",
		filters={"sponsor": sponsor, "status": ["in", SPONSORED_STATUSES]},
		fields=["name", "student", "status", "coverage", "amount", "percentage"],
	)
	invoiced = invoice_totals(list({r.student for r in rows}))
	committed = sum(committed_amount(r, invoiced.get(r.student, 0)) for r in rows)
	disbursed = sum(disbursed_by_student(sponsor).values())
	frappe.db.set_value(
		"Sponsor",
		sponsor,
		{
			"total_committed": committed,
			"total_disbursed": disbursed,
			"active_sponsorships": sum(1 for r in rows if r.status == "Active"),
		},
		update_modified=False,
	)


def refresh_sponsorship_disbursed(sponsorship: str):
	s = frappe.db.get_value("Sponsorship", sponsorship, ["sponsor", "student"], as_dict=True)
	if not s:
		return
	amount = disbursed_by_student(s.sponsor, [s.student]).get(s.student, 0)
	frappe.db.set_value("Sponsorship", sponsorship, "amount_disbursed", amount, update_modified=False)


def on_sponsor_payment(sponsor: str, student: str | None = None):
	"""Helper for finance code: refresh roll-ups after a sponsor payment is submitted/cancelled."""
	for name in frappe.get_all(
		"Sponsorship", filters={"sponsor": sponsor, **({"student": student} if student else {})}, pluck="name"
	):
		refresh_sponsorship_disbursed(name)
	refresh_sponsor_totals(sponsor)


def refresh_sponsor_rollups(doc, method=None):
	"""doc_events adapter: Student Payment / Fee Adjustment on_submit and on_cancel."""
	if doc.get("sponsor"):
		on_sponsor_payment(doc.sponsor, doc.get("student"))


def student_balances(students: list[str]) -> dict[str, float]:
	"""Fee balances for many students (B3's bulk helper, then the per-student contract, then Student.fee_balance)."""
	students = [s for s in set(students or []) if s]
	if not students:
		return {}
	try:
		from mahanaim.services.fees import get_balances

		out = get_balances(students)
		return {s: flt(out.get(s, 0)) for s in students}
	except (ImportError, AttributeError, NotImplementedError):
		pass
	try:
		from mahanaim.services.fees import get_student_balance

		return {s: flt(get_student_balance(s)) for s in students}
	except Exception:
		frappe.log_error(title="Sponsor portal: fee balance lookup failed")
		return {
			k: flt(v)
			for k, v in frappe.get_all(
				"Student", filters={"name": ["in", students]}, fields=["name", "fee_balance"], as_list=True
			)
		}


def attendance_by_student(students: list[str], academic_term: str | None = None) -> dict[str, dict]:
	"""Class attendance per student in one grouped query: {student: {present, late, absent, excused, total, pct}}."""
	from frappe.query_builder.functions import Count

	students = [s for s in set(students or []) if s]
	if not students:
		return {}
	CA, CS = frappe.qb.DocType("Class Attendance"), frappe.qb.DocType("Class Session")
	q = (
		frappe.qb.from_(CA)
		.join(CS)
		.on((CA.parent == CS.name) & (CA.parenttype == "Class Session"))
		.select(CA.student, CA.status, Count(CA.name).as_("n"))
		.where(CA.student.isin(students) & (CS.status != "Cancelled"))
		.groupby(CA.student, CA.status)
	)
	if academic_term:
		CO = frappe.qb.DocType("Course Offering")
		q = q.join(CO).on(CO.name == CS.course_offering).where(CO.academic_term == academic_term)
	out = {s: {"present": 0, "late": 0, "absent": 0, "excused": 0, "total": 0, "pct": None} for s in students}
	for r in q.run(as_dict=True):
		row = out[r.student]
		key = (r.status or "present").lower()
		if key in row:
			row[key] += cint(r.n)
		row["total"] += cint(r.n)
	for row in out.values():
		counted = row["total"] - row["excused"]
		row["pct"] = round((row["present"] + row["late"]) * 100.0 / counted, 1) if counted > 0 else None
	return out


# ---------------------------------------------------------------------------------- sponsor reports
REPORT_SPONSORSHIP_STATUSES = ("Active", "Suspended")  # students a sponsor currently supports
SPONSOR_REPORT_DAYS_AFTER_TERM = 14  # results are usually published within two weeks of the term ending


def money_text(amount) -> str:
	return f"KES {flt(amount):,.2f}"


def _sponsor_report_fallback(name: str | None, count: int, outstanding: str) -> dict:
	from frappe.utils import escape_html, get_url

	college = escape_html(setting("institution_name") or "Mahanaim Bible College")
	url = get_url("/sponsor")
	students = _("{0} student").format(count) if count == 1 else _("{0} students").format(count)
	paragraphs = (
		_("Dear {0},").format(escape_html(name or _("Partner"))),
		_("Thank you for partnering with {0}.").format(college)
		+ " "
		+ _("A progress update for the {0} you sponsor is available in your sponsor portal: {1}.").format(
			students, f'<a href="{url}">{url}</a>'
		),
		_("Outstanding fees across your sponsored students: {0}.").format(outstanding),
	)
	return {
		"subject": _("Progress update on the students you sponsor"),
		"message": "".join(f"<p>{p}</p>" for p in paragraphs),
		"in_app": _("A progress update for the {0} you sponsor is ready. Outstanding fees: {1}.").format(
			students, outstanding
		),
	}


def send_sponsor_reports(sponsor: str | None = None) -> dict:
	"""Notify active sponsors that their progress report is ready (event "Sponsor Report", link "/sponsor").

	Template context = the standard notify keys plus `students` (int: currently sponsored students) and
	`outstanding` (str: their combined fee balance, e.g. "KES 12,500.00"). Sponsors that are inactive, have no
	Active/Suspended sponsorship or have no user/email/phone are skipped.
	Returns {"sent": n, "skipped": n, "sponsors": [notified sponsor names]}.
	"""
	from mahanaim.services.communication import notify, recipient_for_sponsor

	filters = {"status": "Active", **({"name": sponsor} if sponsor else {})}
	sponsors = frappe.get_all(
		"Sponsor",
		filters=filters,
		fields=["name", "sponsor_name", "user", "email", "phone"],
		order_by="sponsor_name asc",
	)
	skipped = 0 if sponsors or not sponsor else 1
	if not sponsors:
		return {"sent": 0, "skipped": skipped, "sponsors": []}
	students = defaultdict(set)
	for r in frappe.get_all(
		"Sponsorship",
		filters={
			"sponsor": ["in", [s.name for s in sponsors]],
			"status": ["in", REPORT_SPONSORSHIP_STATUSES],
		},
		fields=["sponsor", "student"],
	):
		students[r.sponsor].add(r.student)
	balances = student_balances([st for group in students.values() for st in group])
	sent = []
	for s in sponsors:
		mine = students.get(s.name)
		recipient = recipient_for_sponsor(s)
		if not mine or not (recipient.get("user") or recipient.get("email") or recipient.get("phone")):
			skipped += 1
			continue
		outstanding = money_text(sum(max(flt(balances.get(st)), 0) for st in mine))
		notify(
			"Sponsor Report",
			doc=frappe.get_doc("Sponsor", s.name),
			recipients=[recipient],
			context={"students": len(mine), "outstanding": outstanding},
			link="/sponsor",
			category="Info",
			fallback=_sponsor_report_fallback(s.sponsor_name, len(mine), outstanding),
		)
		sent.append(s.name)
	return {"sent": len(sent), "skipped": skipped, "sponsors": sent}


def send_termly_sponsor_reports(days_after: int = SPONSOR_REPORT_DAYS_AFTER_TERM) -> dict | None:
	"""Daily cron: send every sponsor report once, `days_after` days after an academic term ends."""
	if not frappe.db.exists("Academic Term", {"end_date": add_days(nowdate(), -cint(days_after))}):
		return None
	return send_sponsor_reports()


# ---------------------------------------------------------------------------------- giving
def giver_name_for(doc) -> str | None:
	if doc.giver_type == "Anonymous":
		return _("Anonymous")
	if doc.giver_type == "Sponsor" and doc.sponsor:
		return frappe.db.get_value("Sponsor", doc.sponsor, "sponsor_name")
	if doc.giver_type == "Partner Church" and doc.partner_church:
		return frappe.db.get_value("Partner Church", doc.partner_church, "church_name")
	if doc.giver_type == "Student" and doc.student:
		return frappe.db.get_value("Student", doc.student, "full_name")
	return None


def post_giving_journal_entry(doc) -> str | None:
	"""Optional ERPNext posting (debit cash/bank/M-Pesa, credit the giving type's income account). Never raises."""
	if not (has_app("erpnext") and cint(setting("post_to_erpnext"))):
		return None
	try:
		company = setting("company") or frappe.db.get_single_value("Global Defaults", "default_company")
		income = frappe.db.get_value("Giving Type", doc.giving_type, "income_account") or setting(
			"income_account"
		)
		cash = setting("cash_account")
		if not (company and income and cash):
			frappe.log_error(
				title=f"Giving {doc.name}: ERPNext accounts not configured",
				message="Set company, cash_account and an income account on the Giving Type or settings.",
			)
			return None
		je = frappe.new_doc("Journal Entry")
		je.voucher_type = "Journal Entry"
		je.company = company
		je.posting_date = doc.posting_date
		je.cheque_no = doc.reference_no or doc.name
		je.cheque_date = doc.posting_date
		je.user_remark = _("{0} from {1} ({2})").format(
			doc.giving_type, doc.giver_name or _("Anonymous"), doc.name
		)
		cost_center = setting("cost_center")
		je.append(
			"accounts",
			{"account": cash, "debit_in_account_currency": flt(doc.amount), "cost_center": cost_center},
		)
		je.append(
			"accounts",
			{"account": income, "credit_in_account_currency": flt(doc.amount), "cost_center": cost_center},
		)
		je.flags.ignore_permissions = True
		je.insert()
		je.submit()
		doc.db_set("journal_entry", je.name, update_modified=False)
		return je.name
	except Exception:
		frappe.log_error(title=f"Giving {doc.name}: ERPNext journal entry failed")
		return None


def cancel_giving_journal_entry(doc):
	if not doc.journal_entry or not has_app("erpnext"):
		return
	try:
		je = frappe.get_doc("Journal Entry", doc.journal_entry)
		if je.docstatus == 1:
			je.flags.ignore_permissions = True
			je.cancel()
	except Exception:
		frappe.log_error(title=f"Giving {doc.name}: cancelling journal entry {doc.journal_entry} failed")


def refresh_chapel_offering(service: str | None):
	if not service or not frappe.db.exists("Chapel Service", service):
		return
	rows = frappe.get_all(
		"Giving Record",
		filters={"chapel_service": service, "docstatus": 1},
		fields=[{"SUM": "amount", "as": "total"}],
	)
	total = flt(rows[0].total) if rows else 0
	if total:
		frappe.db.set_value("Chapel Service", service, "offering_total", total, update_modified=False)


def suggested_amounts(value: str | None) -> list[float]:
	out = []
	for part in re.split(r"[,;\s]+", cstr(value)):
		amount = flt(part.replace("KES", "").strip())
		if amount > 0 and amount not in out:
			out.append(amount)
	return out[:8]


def online_giving_types() -> list[dict]:
	"""Active giving types offered on the public /give page (`allow_online`)."""
	fields = ["name", "giving_type_name", "description"]
	filters = {"is_active": 1}
	meta = frappe.get_meta("Giving Type")
	if meta.has_field("allow_online"):
		filters["allow_online"] = 1
	if meta.has_field("suggested_amounts"):
		fields.append("suggested_amounts")
	rows = frappe.get_all("Giving Type", filters=filters, fields=fields, order_by="giving_type_name asc")
	for r in rows:
		r["suggested_amounts"] = suggested_amounts(r.get("suggested_amounts")) or list(DEFAULT_GIVING_AMOUNTS)
	return rows


def is_valid_msisdn(phone: str | None) -> bool:
	"""Kenyan mobile number that M-Pesa can prompt (07xx / 01xx / +2547xx / +2541xx)."""
	return bool(re.fullmatch(r"254[17]\d{8}", normalize_phone(phone) or ""))


def _intent_key(request: str) -> str:
	return f"mbc:giving:{request}"


def start_online_giving(phone: str, amount: float, giving_type: str, giver: dict) -> dict:
	"""STK push for a gift via B3's `initiate_payment(purpose="Giving")`.

	`giver` = {giver_type, sponsor?, student?, partner_church?, giver_name?, giver_email?, purpose?}. The intent is
	cached so that the M-Pesa callback (`on_mpesa_success`) can record the Giving Record; if it expires the
	record is still created from the M-Pesa Request (default giving type, phone as the giver).
	"""
	from mahanaim.services.mpesa import initiate_payment

	res = (
		initiate_payment(
			phone, flt(amount), "Giving", sponsor=giver.get("sponsor"), initiated_by=frappe.session.user
		)
		or {}
	)
	if res.get("request"):
		frappe.cache.set_value(
			_intent_key(res["request"]),
			{"giving_type": giving_type, "amount": flt(amount), "phone": normalize_phone(phone), **giver},
			expires_in_sec=GIVING_INTENT_TTL,
		)
	return res


def giving_for_request(request: str) -> str | None:
	return frappe.db.get_value("Giving Record", {"mpesa_request": request, "docstatus": 1}, "name")


def complete_online_giving(
	request: str,
	reference: str | None = None,
	amount: float | None = None,
	msisdn: str | None = None,
	payer_name: str | None = None,
) -> str | None:
	"""CONTRACT for B3: record (and submit) the Giving Record for a completed "Giving" M-Pesa request.

	Idempotent: one Giving Record per request / M-Pesa receipt. The M-Pesa Request row is locked while
	checking so that the callback and a status poll cannot both create it.
	"""
	req = frappe.db.get_value(
		"M-Pesa Request",
		request,
		["name", "purpose", "amount", "phone_number", "sponsor", "mpesa_receipt_number"],
		as_dict=True,
		for_update=True,
	)
	if not req:
		frappe.log_error(title=f"Online giving: unknown M-Pesa Request {request}")
		return None
	if req.purpose and req.purpose != "Giving":
		return None
	reference = cstr(reference or req.mpesa_receipt_number).strip().upper() or None
	existing = giving_for_request(request) or (
		reference
		and frappe.db.get_value("Giving Record", {"reference_no": reference, "docstatus": 1}, "name")
	)
	if existing:
		frappe.cache.delete_value(_intent_key(request))
		return existing
	intent = frappe.cache.get_value(_intent_key(request)) or {}
	giving_type = intent.get("giving_type")
	if not giving_type or not frappe.db.get_value("Giving Type", giving_type, "is_active"):
		giving_type = frappe.db.get_value("Giving Type", {"is_active": 1}, "name", order_by="creation asc")
	if not giving_type:
		frappe.log_error(title=f"Online giving {request}: no active Giving Type to record the gift")
		return None
	sponsor = intent.get("sponsor") or req.sponsor
	giver_type = intent.get("giver_type") or ("Sponsor" if sponsor else "Other")
	giver_name = intent.get("giver_name") or (cstr(payer_name).strip() or None)
	if giver_type == "Other" and not giver_name:
		giver_type = "Anonymous"
	doc = frappe.get_doc(
		{
			"doctype": "Giving Record",
			"giving_type": giving_type,
			"giver_type": giver_type,
			"sponsor": sponsor,
			"partner_church": intent.get("partner_church"),
			"student": intent.get("student"),
			"giver_name": giver_name,
			"giver_email": intent.get("giver_email"),
			"posting_date": nowdate(),
			"amount": flt(amount) or flt(req.amount) or flt(intent.get("amount")),
			"mode_of_payment": "M-Pesa",
			"reference_no": reference or request,
			"msisdn": msisdn or req.phone_number or intent.get("phone"),
			"mpesa_request": request,
			"purpose": intent.get("purpose") or _("Online giving"),
		}
	)
	doc.flags.ignore_permissions = True
	doc.insert()
	doc.submit()
	frappe.cache.delete_value(_intent_key(request))
	return doc.name


def on_mpesa_success(request: str, transaction: str | None = None) -> str | None:
	"""Hook for B3's STK callback when an M-Pesa Request with purpose "Giving" completes. Never raises."""
	try:
		trans = (
			frappe.db.get_value(
				"M-Pesa Transaction", transaction, ["name", "amount", "msisdn", "payer_name"], as_dict=True
			)
			if transaction
			else None
		)
		return complete_online_giving(
			request,
			reference=trans.name if trans else None,
			amount=trans.amount if trans else None,
			msisdn=trans.msisdn if trans else None,
			payer_name=trans.payer_name if trans else None,
		)
	except Exception:
		frappe.log_error(title=f"Online giving could not be recorded for {request}")
		return None


def reconcile_online_giving(days: int = 7) -> int:
	"""Safety net (cron/poll): record gifts for completed "Giving" requests that have no Giving Record yet."""
	R = frappe.qb.DocType("M-Pesa Request")
	G = frappe.qb.DocType("Giving Record")
	recorded = (
		frappe.qb.from_(G).select(G.mpesa_request).where(G.mpesa_request.isnotnull() & (G.docstatus == 1))
	)
	pending = (
		frappe.qb.from_(R)
		.select(R.name, R.transaction)
		.where((R.purpose == "Giving") & (R.status == "Completed"))
		.where(R.creation >= add_days(now_datetime(), -cint(days)))
		.where(R.name.notin(recorded))
		.limit(200)
		.run(as_dict=True)
	)
	done = 0
	for row in pending:
		if on_mpesa_success(row.name, row.transaction):
			done += 1
			if not frappe.flags.in_test:
				frappe.db.commit()  # nosemgrep: scheduler job, commit per gift
	return done


def giving_request_state(request: str) -> dict | None:
	"""Public-safe status of a "Giving" M-Pesa request; records the gift on the first poll after completion."""
	req = frappe.db.get_value(
		"M-Pesa Request",
		request,
		["name", "status", "purpose", "transaction", "mpesa_receipt_number"],
		as_dict=True,
	)
	if not req or req.purpose != "Giving":
		return None
	record = None
	if req.status == "Completed":
		record = giving_for_request(req.name) or on_mpesa_success(req.name, req.transaction)
	return {
		"status": req.status,
		"receipt": req.mpesa_receipt_number if req.status == "Completed" else None,
		"giving_record": record,
	}


# ---------------------------------------------------------------------------------- dashboard
def month_keys(months: int = 12) -> list[str]:
	start = get_first_day(add_months(getdate(nowdate()), -(months - 1)))
	return [add_months(start, i).strftime("%Y-%m") for i in range(months)]


def church_dashboard_data() -> dict:
	from frappe.query_builder.functions import Count, DateFormat, Sum

	months = month_keys(12)
	since = f"{months[0]}-01"

	churches = frappe.get_all(
		"Partner Church",
		filters={"is_group": 0},
		fields=["partnership_status", {"COUNT": "*", "as": "n"}],
		group_by="partnership_status",
	)
	students_per_church = frappe.get_all(
		"Student",
		filters={
			"partner_church": ["is", "set"],
			"status": ["in", ["Registered", "Active", "Deferred", "Admitted"]],
		},
		fields=["partner_church", {"COUNT": "*", "as": "students"}],
		group_by="partner_church",
		order_by="students desc",
		limit_page_length=10,
	)
	church_names = (
		dict(
			frappe.get_all(
				"Partner Church",
				filters={"name": ["in", [r.partner_church for r in students_per_church]]},
				fields=["name", "church_name"],
				as_list=True,
			)
		)
		if students_per_church
		else {}
	)
	sponsors = frappe.get_all(
		"Sponsor",
		fields=[
			"status",
			{"COUNT": "*", "as": "n"},
			{"SUM": "total_committed", "as": "committed"},
			{"SUM": "total_disbursed", "as": "disbursed"},
		],
		group_by="status",
	)
	sponsorships = frappe.get_all(
		"Sponsorship", fields=["status", {"COUNT": "*", "as": "n"}], group_by="status"
	)

	GR = frappe.qb.DocType("Giving Record")
	month = DateFormat(GR.posting_date, "%Y-%m")
	giving_rows = (
		frappe.qb.from_(GR)
		.select(GR.giving_type, month.as_("month"), Sum(GR.amount).as_("total"), Count(GR.name).as_("n"))
		.where((GR.docstatus == 1) & (GR.posting_date >= since))
		.groupby(GR.giving_type, month)
		.run(as_dict=True)
	)
	by_type, by_month = defaultdict(float), {m: 0.0 for m in months}
	for r in giving_rows:
		by_type[r.giving_type] += flt(r.total)
		if r.month in by_month:
			by_month[r.month] += flt(r.total)

	CS = frappe.qb.DocType("Chapel Service")
	cmonth = DateFormat(CS.service_date, "%Y-%m")
	chapel_rows = (
		frappe.qb.from_(CS)
		.select(
			cmonth.as_("month"), Count(CS.name).as_("services"), Sum(CS.total_attendance).as_("attendance")
		)
		.where((CS.status == "Held") & (CS.service_date >= since))
		.groupby(cmonth)
		.run(as_dict=True)
	)
	chapel = {r.month: r for r in chapel_rows}
	committed = sum(flt(s.committed) for s in sponsors)
	disbursed = sum(flt(s.disbursed) for s in sponsors)
	return {
		"kpis": {
			"partner_churches": sum(cint(c.n) for c in churches),
			"active_churches": sum(cint(c.n) for c in churches if c.partnership_status == "Active"),
			"sponsors": sum(cint(s.n) for s in sponsors),
			"active_sponsors": sum(cint(s.n) for s in sponsors if s.status == "Active"),
			"active_sponsorships": sum(cint(s.n) for s in sponsorships if s.status == "Active"),
			"committed": committed,
			"disbursed": disbursed,
			"disbursed_pct": round(disbursed * 100.0 / committed, 1) if committed else 0,
			"giving_12m": sum(by_month.values()),
			"giving_this_month": by_month.get(months[-1], 0),
		},
		"churches_by_status": {c.partnership_status: cint(c.n) for c in churches},
		"sponsorships_by_status": {s.status: cint(s.n) for s in sponsorships},
		"students_per_church": [
			{
				"church": r.partner_church,
				"church_name": church_names.get(r.partner_church, r.partner_church),
				"students": cint(r.students),
			}
			for r in students_per_church
		],
		"giving_by_type": [
			{"giving_type": k, "total": v} for k, v in sorted(by_type.items(), key=lambda x: -x[1])
		],
		"giving_by_month": [{"month": m, "total": by_month[m]} for m in months],
		"chapel_trend": [
			{
				"month": m,
				"services": cint(chapel[m].services) if m in chapel else 0,
				"attendance": cint(chapel[m].attendance) if m in chapel else 0,
				"average": round(flt(chapel[m].attendance) / cint(chapel[m].services), 1)
				if m in chapel and cint(chapel[m].services)
				else 0,
			}
			for m in months
		],
		"chart": {
			"labels": months,
			"datasets": [{"name": _("Giving"), "values": [by_month[m] for m in months]}],
		},
	}
