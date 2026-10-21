"""Fees, invoicing and student ledger (owned by backend domain B3).

CONTRACT (other domains import these; keep signatures):
	create_invoice_for_registration(registration) -> str | None
		Called by B1 when a Semester Registration is approved (if settings.auto_invoice_on_registration).
	get_student_balance(student: str) -> float      # sum(debit - credit) on non-cancelled ledger entries
	fee_clearance(student: str, purpose: str) -> dict
		purpose in {"exam", "lms", "transcript", "registration", "certificate"}; returns
		{"cleared": bool, "balance": float, "paid_percent": float, "required_percent": float, "message": str}

Accounting model
----------------
* Every money movement posts one Student Ledger Entry (debit = student owes more, credit = student owes
  less). The student's balance is always Σ(debit − credit) over non-cancelled entries.
* Invoices track `paid_amount` (explicit Payment Allocations of submitted payments) and `credit_applied`
  (credit Fee Adjustments targeted at the invoice plus free account credit auto-applied oldest-first).
  `refresh_student_account()` recomputes these from source documents, so submit/cancel in any order
  keeps invoices, installments, ledger and Student.fee_balance consistent.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.query_builder import DocType
from frappe.query_builder.functions import Coalesce, Sum
from frappe.utils import add_days, cint, flt, getdate, now_datetime, today

from mahanaim.utils import current_term, fmt_money, has_app, setting

CREDIT_ADJUSTMENTS = (
	"Scholarship",
	"Bursary",
	"Waiver",
	"Discount",
	"Sponsor Credit",
	"Write-off",
	"Correction Credit",
)
DEBIT_ADJUSTMENTS = ("Penalty", "Correction Debit")
OPEN_STATUSES = ("Unpaid", "Partly Paid", "Overdue")
LEDGER = "Student Ledger Entry"
CLEARANCE_PURPOSES = ("exam", "lms", "transcript", "registration", "certificate")

# (field, tie-break weight) used to rank fee structures; empty fields on a structure are wildcards.
MATCH_FIELDS = (
	("academic_term", 32),
	("academic_year", 16),
	("year_of_study", 8),
	("campus", 4),
	("study_mode", 2),
	("fee_category", 1),
)


def money(value) -> float:
	return flt(value, 2)


# ---------------------------------------------------------------------------------- ledger
def make_ledger_entry(
	student, voucher_type, voucher_no, debit=0, credit=0, posting_date=None, academic_term=None, remarks=None
) -> str | None:
	debit, credit = money(debit), money(credit)
	if not debit and not credit:
		return None
	doc = frappe.get_doc(
		{
			"doctype": LEDGER,
			"student": student,
			"posting_date": posting_date or today(),
			"voucher_type": voucher_type,
			"voucher_no": voucher_no,
			"debit": debit,
			"credit": credit,
			"academic_term": academic_term,
			"remarks": remarks,
		}
	)
	doc.flags.from_fees_service = True
	doc.insert(ignore_permissions=True)
	return doc.name


def cancel_ledger_entries(voucher_type, voucher_no):
	sle = DocType(LEDGER)
	(
		frappe.qb.update(sle)
		.set(sle.is_cancelled, 1)
		.where(sle.voucher_type == voucher_type)
		.where(sle.voucher_no == voucher_no)
	).run()


def get_student_balance(student: str) -> float:
	"""Σ(debit − credit) over non-cancelled ledger entries. Negative = the student is in credit."""
	if not student:
		return 0.0
	return get_balances([student]).get(student, 0.0)


def get_balances(students: list[str] | None = None) -> dict[str, float]:
	"""Balances for many students in one query (all students with ledger activity when None)."""
	sle = DocType(LEDGER)
	q = (
		frappe.qb.from_(sle)
		.select(sle.student, (Coalesce(Sum(sle.debit), 0) - Coalesce(Sum(sle.credit), 0)).as_("balance"))
		.where(sle.is_cancelled == 0)
		.groupby(sle.student)
	)
	if students is not None:
		if not students:
			return {}
		q = q.where(sle.student.isin(list(students)))
	return {r[0]: money(r[1]) for r in q.run()}


def ledger_totals(student: str) -> dict:
	sle = DocType(LEDGER)
	row = (
		frappe.qb.from_(sle)
		.select(Coalesce(Sum(sle.debit), 0), Coalesce(Sum(sle.credit), 0))
		.where(sle.is_cancelled == 0)
		.where(sle.student == student)
	).run()
	debit, credit = row[0] if row else (0, 0)
	return {"debit": money(debit), "credit": money(credit), "balance": money(flt(debit) - flt(credit))}


def statement(student: str, from_date=None, to_date=None) -> dict:
	"""Ledger statement with opening balance and a running balance per line."""
	sle = DocType(LEDGER)
	opening = 0.0
	if from_date:
		row = (
			frappe.qb.from_(sle)
			.select(Coalesce(Sum(sle.debit), 0) - Coalesce(Sum(sle.credit), 0))
			.where(sle.is_cancelled == 0)
			.where(sle.student == student)
			.where(sle.posting_date < getdate(from_date))
		).run()
		opening = money(row[0][0] if row else 0)
	q = (
		frappe.qb.from_(sle)
		.select(
			sle.name,
			sle.posting_date,
			sle.voucher_type,
			sle.voucher_no,
			sle.debit,
			sle.credit,
			sle.academic_term,
			sle.remarks,
		)
		.where(sle.is_cancelled == 0)
		.where(sle.student == student)
		.orderby(sle.posting_date)
		.orderby(sle.creation)
	)
	if from_date:
		q = q.where(sle.posting_date >= getdate(from_date))
	if to_date:
		q = q.where(sle.posting_date <= getdate(to_date))
	running = opening
	lines, total_debit, total_credit = [], 0.0, 0.0
	for r in q.run(as_dict=True):
		running = money(running + flt(r.debit) - flt(r.credit))
		total_debit += flt(r.debit)
		total_credit += flt(r.credit)
		lines.append(
			{
				"date": str(r.posting_date),
				"voucher_type": r.voucher_type,
				"voucher_no": r.voucher_no,
				"description": r.remarks or _voucher_label(r.voucher_type),
				"academic_term": r.academic_term,
				"debit": money(r.debit),
				"credit": money(r.credit),
				"balance": running,
			}
		)
	return {
		"student": student,
		"from_date": str(getdate(from_date)) if from_date else None,
		"to_date": str(getdate(to_date)) if to_date else None,
		"opening_balance": opening,
		"total_debit": money(total_debit),
		"total_credit": money(total_credit),
		"closing_balance": running,
		"lines": lines,
	}


def _voucher_label(voucher_type: str) -> str:
	return {
		"Student Invoice": _("Invoice"),
		"Student Payment": _("Payment"),
		"Fee Adjustment": _("Adjustment"),
		"Refund Request": _("Refund"),
	}.get(voucher_type, voucher_type)


# ---------------------------------------------------------------------------------- invoice maths
def invoice_status(docstatus, total, outstanding, due_date=None) -> str:
	if cint(docstatus) == 0:
		return "Draft"
	if cint(docstatus) == 2:
		return "Cancelled"
	if money(outstanding) <= 0:
		return "Paid"
	if due_date and getdate(due_date) < getdate(today()):
		return "Overdue"
	if money(outstanding) < money(total):
		return "Partly Paid"
	return "Unpaid"


def _installment_status(amount, paid, due_date) -> str:
	if money(paid) >= money(amount):
		return "Paid"
	if due_date and getdate(due_date) < getdate(today()):
		return "Overdue"
	return "Partly Paid" if money(paid) > 0 else "Unpaid"


def free_credit(student: str) -> float:
	"""Account credit not tied to a specific invoice: unallocated payments + untargeted credit adjustments
	minus debits that are not invoices (penalties, correction debits, paid refunds)."""
	sp, fa, rr = DocType("Student Payment"), DocType("Fee Adjustment"), DocType("Refund Request")
	unallocated = (
		frappe.qb.from_(sp)
		.select(Coalesce(Sum(sp.unallocated_amount), 0))
		.where(sp.docstatus == 1)
		.where(sp.student == student)
		.where(sp.payment_for == "Student Fees")
	).run()[0][0]
	adj = (
		frappe.qb.from_(fa)
		.select(fa.adjustment_type, fa.invoice, Coalesce(Sum(fa.amount), 0))
		.where(fa.docstatus == 1)
		.where(fa.student == student)
		.groupby(fa.adjustment_type, fa.invoice)
	).run()
	credit_free = sum(flt(a) for t, inv, a in adj if t in CREDIT_ADJUSTMENTS and not inv)
	debits = sum(flt(a) for t, inv, a in adj if t in DEBIT_ADJUSTMENTS)
	refunds = (
		frappe.qb.from_(rr)
		.select(Coalesce(Sum(rr.amount), 0))
		.where(rr.student == student)
		.where(rr.status == "Paid")
	).run()[0][0]
	return money(flt(unallocated) + credit_free - debits - flt(refunds))


def refresh_student_account(student: str) -> dict:
	"""Recompute paid/credit/outstanding/status of every submitted invoice + installments + Student.fee_balance.

	Returns {"balance": float, "invoices": {name: {...values}}, "installments": {row: {...}}}."""
	result = {"balance": 0.0, "invoices": {}, "installments": {}}
	if not student:
		return result
	invoices = frappe.get_all(
		"Student Invoice",
		filters={"student": student, "docstatus": 1},
		fields=[
			"name",
			"total_amount",
			"due_date",
			"paid_amount",
			"credit_applied",
			"outstanding_amount",
			"status",
		],
		order_by="posting_date asc, creation asc",
	)
	names = [i.name for i in invoices]
	explicit, targeted = {}, {}
	if names:
		pa, sp, fa = DocType("Payment Allocation"), DocType("Student Payment"), DocType("Fee Adjustment")
		explicit = dict(
			(
				frappe.qb.from_(pa)
				.join(sp)
				.on(pa.parent == sp.name)
				.select(pa.invoice, Coalesce(Sum(pa.allocated_amount), 0))
				.where(pa.parenttype == "Student Payment")
				.where(sp.docstatus == 1)
				.where(pa.invoice.isin(names))
				.groupby(pa.invoice)
			).run()
		)
		targeted = dict(
			(
				frappe.qb.from_(fa)
				.select(fa.invoice, Coalesce(Sum(fa.amount), 0))
				.where(fa.docstatus == 1)
				.where(fa.invoice.isin(names))
				.where(fa.adjustment_type.isin(CREDIT_ADJUSTMENTS))
				.groupby(fa.invoice)
			).run()
		)
	pool = max(free_credit(student), 0.0) if names else 0.0
	settled_by_invoice = {}
	for inv in invoices:
		total = money(inv.total_amount)
		paid = money(explicit.get(inv.name))
		credit = money(targeted.get(inv.name))
		remaining = max(money(total - paid - credit), 0.0)
		from_pool = money(min(remaining, pool))
		pool = money(pool - from_pool)
		credit = money(credit + from_pool)
		outstanding = max(money(total - paid - credit), 0.0)
		values = {
			"paid_amount": paid,
			"credit_applied": credit,
			"outstanding_amount": outstanding,
			"status": invoice_status(1, total, outstanding, inv.due_date),
		}
		settled_by_invoice[inv.name] = money(total - outstanding)
		result["invoices"][inv.name] = values
		if any(money(inv.get(k)) != v if k != "status" else inv.status != v for k, v in values.items()):
			frappe.db.set_value("Student Invoice", inv.name, values, update_modified=False)
	if names:
		rows = frappe.get_all(
			"Fee Installment",
			filters={"parenttype": "Student Invoice", "parent": ["in", names]},
			fields=["name", "parent", "amount", "due_date", "paid_amount", "status"],
			order_by="parent asc, idx asc",
		)
		left = dict(settled_by_invoice)
		for row in rows:
			paid = money(min(flt(row.amount), max(left.get(row.parent, 0), 0)))
			left[row.parent] = money(left.get(row.parent, 0) - paid)
			values = {"paid_amount": paid, "status": _installment_status(row.amount, paid, row.due_date)}
			result["installments"][row.name] = values
			if money(row.paid_amount) != paid or row.status != values["status"]:
				frappe.db.set_value("Fee Installment", row.name, values, update_modified=False)
	balance = get_student_balance(student)
	frappe.db.set_value("Student", student, "fee_balance", balance, update_modified=False)
	result["balance"] = balance
	return result


def sync_invoice_doc(doc, account: dict):
	"""Copy freshly computed values onto an in-memory invoice so API responses are current."""
	values = account.get("invoices", {}).get(doc.name)
	if values:
		doc.update(values)
	for row in doc.get("installments") or []:
		if row.name in account.get("installments", {}):
			row.update(account["installments"][row.name])


def fifo_allocations(student: str, amount, preferred_invoice: str | None = None) -> list[dict]:
	"""Allocate `amount` to the student's oldest outstanding submitted invoices (preferred invoice first)."""
	amount = money(amount)
	invoices = frappe.get_all(
		"Student Invoice",
		filters={"student": student, "docstatus": 1, "outstanding_amount": [">", 0]},
		fields=["name", "academic_term", "outstanding_amount"],
		order_by="posting_date asc, creation asc",
	)
	if preferred_invoice:
		invoices.sort(key=lambda i: 0 if i.name == preferred_invoice else 1)
	rows = []
	for inv in invoices:
		if amount <= 0:
			break
		alloc = money(min(amount, flt(inv.outstanding_amount)))
		if alloc <= 0:
			continue
		rows.append(
			{
				"invoice": inv.name,
				"academic_term": inv.academic_term,
				"invoice_outstanding": money(inv.outstanding_amount),
				"allocated_amount": alloc,
			}
		)
		amount = money(amount - alloc)
	return rows


# ---------------------------------------------------------------------------------- fee structures
def find_fee_structure(
	student, term=None, programme=None, campus=None, study_mode=None, year_of_study=None, fee_category=None
) -> str | None:
	"""Most specific active Fee Structure for a student and term.

	Non-empty structure fields must match; empty fields are wildcards. The winner has the most matching
	fields (ties broken by field weight then latest modification)."""
	s = frappe._dict()
	if student:
		s = (
			frappe.db.get_value(
				"Student",
				student,
				["programme", "campus", "study_mode", "year_of_study", "fee_category"],
				as_dict=True,
			)
			or frappe._dict()
		)
	term = term or current_term()
	ctx = {
		"programme": programme or s.get("programme"),
		"campus": campus or s.get("campus"),
		"study_mode": study_mode or s.get("study_mode"),
		"year_of_study": cint(year_of_study or s.get("year_of_study")) or None,
		"fee_category": fee_category or s.get("fee_category") or "Standard",
		"academic_term": term,
		"academic_year": frappe.db.get_value("Academic Term", term, "academic_year") if term else None,
	}
	if not ctx["programme"]:
		return None
	candidates = frappe.get_all(
		"Fee Structure",
		filters={"programme": ctx["programme"], "is_active": 1},
		fields=["name", "modified", *[f for f, _w in MATCH_FIELDS]],
	)
	ranked = []
	for fs in candidates:
		count = weight = 0
		ok = True
		for field, w in MATCH_FIELDS:
			value = fs.get(field)
			if field == "year_of_study":
				value = cint(value) or None
			if field == "fee_category" and value in (None, "", "Standard"):
				value = None  # Standard is the fallback for every category
			if value in (None, ""):
				continue
			if value != ctx.get(field):
				ok = False
				break
			count += 1
			weight += w
		if ok:
			ranked.append((count, weight, str(fs.modified), fs.name))
	if not ranked:
		return None
	ranked.sort(reverse=True)
	return ranked[0][3]


def get_items_from_fee_structure(fee_structure: str) -> list[dict]:
	rows = frappe.get_all(
		"Fee Structure Item",
		filters={"parent": fee_structure, "parenttype": "Fee Structure"},
		fields=["fee_component", "description", "amount"],
		order_by="idx asc",
	)
	return [
		{
			"fee_component": r.fee_component,
			"description": r.description or r.fee_component,
			"amount": money(r.amount),
		}
		for r in rows
	]


def split_installments(total, rows, posting_date=None) -> list[dict]:
	"""Scale a structure's installment plan to `total`; the last row absorbs rounding."""
	total = money(total)
	rows = [frappe._dict(r) for r in rows or []]
	if not rows:
		return []
	base = sum(flt(r.amount) for r in rows)
	out, running = [], 0.0
	for i, r in enumerate(rows):
		if i == len(rows) - 1:
			amount = money(total - running)
		elif flt(r.percent):
			amount = money(total * flt(r.percent) / 100.0)
		elif base:
			amount = money(total * flt(r.amount) / base)
		else:
			amount = 0.0
		running = money(running + amount)
		due = r.due_date or (
			add_days(posting_date or today(), cint(r.due_days)) if posting_date or r.due_days else None
		)
		out.append(
			{
				"label": r.label,
				"percent": flt(r.percent) or (round(amount * 100.0 / total, 2) if total else 0),
				"due_days": cint(r.due_days),
				"due_date": due,
				"amount": amount,
				"paid_amount": 0,
				"status": "Unpaid",
			}
		)
	return out


# ---------------------------------------------------------------------------------- invoicing
def existing_structure_invoice(student: str, academic_term: str | None) -> str | None:
	"""A non-cancelled structure-based invoice for this student and term (idempotency key)."""
	if not academic_term:
		return None
	return frappe.db.get_value(
		"Student Invoice",
		{
			"student": student,
			"academic_term": academic_term,
			"fee_structure": ["is", "set"],
			"docstatus": ["<", 2],
		},
		"name",
	)


def make_invoice(
	student,
	fee_structure=None,
	academic_term=None,
	posting_date=None,
	due_date=None,
	items=None,
	semester_registration=None,
	remarks=None,
	submit=True,
):
	doc = frappe.get_doc(
		{
			"doctype": "Student Invoice",
			"student": student,
			"fee_structure": fee_structure,
			"academic_term": academic_term or current_term(),
			"posting_date": posting_date or today(),
			"due_date": due_date,
			"semester_registration": semester_registration,
			"remarks": remarks,
			"items": items or [],
		}
	)
	doc.insert(ignore_permissions=True)
	if submit:
		doc.submit()
	return doc


def create_invoice_for_registration(registration) -> str | None:
	"""Invoice an approved Semester Registration (idempotent). Returns the invoice name or None."""
	reg = (
		frappe.get_doc("Semester Registration", registration)
		if isinstance(registration, str)
		else registration
	)
	if reg.get("fee_invoice") and frappe.db.exists(
		"Student Invoice", {"name": reg.fee_invoice, "docstatus": ["<", 2]}
	):
		return reg.fee_invoice
	existing = frappe.db.get_value(
		"Student Invoice", {"semester_registration": reg.name, "docstatus": ["<", 2]}, "name"
	) or existing_structure_invoice(reg.student, reg.academic_term)
	if existing:
		if frappe.db.get_value("Student Invoice", existing, "docstatus") == 0:
			frappe.get_doc("Student Invoice", existing).submit()
		_link_registration(reg, existing)
		return existing
	structure = find_fee_structure(
		reg.student,
		reg.academic_term,
		programme=reg.get("programme"),
		campus=reg.get("campus"),
		study_mode=reg.get("study_mode"),
		year_of_study=reg.get("year_of_study"),
	)
	if not structure:
		frappe.logger("mahanaim").info(
			f"No fee structure matched registration {reg.name} ({reg.student}, {reg.academic_term}); not invoiced"
		)
		return None
	posting = today()
	inv = make_invoice(
		reg.student,
		fee_structure=structure,
		academic_term=reg.academic_term,
		posting_date=posting,
		due_date=add_days(posting, cint(setting("payment_terms_days", 30))),
		semester_registration=reg.name,
		submit=True,
	)
	_link_registration(reg, inv.name)
	return inv.name


def _link_registration(reg, invoice: str):
	if reg.get("fee_invoice") == invoice:
		return
	if isinstance(reg, Document) and not reg.is_new():
		reg.db_set("fee_invoice", invoice, update_modified=False)
	else:
		frappe.db.set_value("Semester Registration", reg.name, "fee_invoice", invoice, update_modified=False)
		reg.fee_invoice = invoice
	if not frappe.db.get_value("Student Invoice", invoice, "semester_registration"):
		frappe.db.set_value(
			"Student Invoice", invoice, "semester_registration", reg.name, update_modified=False
		)


BULK_SYNC_LIMIT = 50


def bulk_invoice_targets(term, programme=None, campus=None, study_mode=None) -> list[str]:
	filters = {"status": ["in", ["Registered", "Active"]]}
	if programme:
		filters["programme"] = programme
	if campus:
		filters["campus"] = campus
	if study_mode:
		filters["study_mode"] = study_mode
	students = frappe.get_all("Student", filters=filters, pluck="name")
	if not students:
		return []
	invoiced = set(
		frappe.get_all(
			"Student Invoice",
			filters={
				"student": ["in", students],
				"academic_term": term,
				"fee_structure": ["is", "set"],
				"docstatus": ["<", 2],
			},
			pluck="student",
		)
	)
	return [s for s in students if s not in invoiced]


def bulk_invoice(term, programme=None, campus=None, study_mode=None, students=None) -> dict:
	"""Invoice every eligible student for `term` (idempotent per student + term)."""
	targets = students if students is not None else bulk_invoice_targets(term, programme, campus, study_mode)
	summary = {"term": term, "created": [], "skipped_existing": 0, "no_structure": [], "errors": []}
	posting = today()
	due = add_days(posting, cint(setting("payment_terms_days", 30)))
	for student in targets:
		if existing_structure_invoice(student, term):
			summary["skipped_existing"] += 1
			continue
		structure = find_fee_structure(student, term)
		if not structure:
			summary["no_structure"].append(student)
			continue
		try:
			frappe.db.savepoint("bulk_invoice")
			inv = make_invoice(
				student, fee_structure=structure, academic_term=term, posting_date=posting, due_date=due
			)
			summary["created"].append(inv.name)
		except Exception as e:
			frappe.db.rollback(save_point="bulk_invoice")
			summary["errors"].append({"student": student, "error": str(e)[:200]})
			frappe.log_error(title=f"Bulk invoice failed for {student}")
	summary["created_count"] = len(summary["created"])
	return summary


def bulk_invoice_job(term, programme=None, campus=None, study_mode=None, user=None):
	summary = bulk_invoice(term, programme, campus, study_mode)
	if user:
		from mahanaim.services.communication import push_portal_notification

		push_portal_notification(
			user,
			_("Bulk invoicing finished"),
			_("{0} invoices created, {1} already invoiced, {2} without a fee structure, {3} errors.").format(
				summary["created_count"],
				summary["skipped_existing"],
				len(summary["no_structure"]),
				len(summary["errors"]),
			),
			link="/admin/finance/invoices",
			category="Finance",
		)
	return summary


# ---------------------------------------------------------------------------------- clearance
def _purpose_label(purpose: str) -> str:
	return {
		"exam": _("exams"),
		"lms": _("LMS access"),
		"transcript": _("transcripts"),
		"registration": _("registration"),
		"certificate": _("certificates"),
	}.get(purpose, purpose)


def _has_full_sponsorship(student: str) -> bool:
	try:
		return bool(
			frappe.db.exists("Sponsorship", {"student": student, "status": "Active", "coverage": "Full Fees"})
		)
	except Exception:
		return False


def term_invoice_totals(student: str, term: str | None) -> dict:
	if not term:
		return {"billed": 0.0, "outstanding": 0.0}
	si = DocType("Student Invoice")
	row = (
		frappe.qb.from_(si)
		.select(Coalesce(Sum(si.total_amount), 0), Coalesce(Sum(si.outstanding_amount), 0))
		.where(si.docstatus == 1)
		.where(si.student == student)
		.where(si.academic_term == term)
	).run()
	billed, outstanding = row[0] if row else (0, 0)
	return {"billed": money(billed), "outstanding": money(outstanding)}


def fee_clearance(student: str, purpose: str) -> dict:
	purpose = (purpose or "").strip().lower()
	if purpose not in CLEARANCE_PURPOSES:
		frappe.throw(_("Unknown clearance purpose {0}").format(purpose))
	totals = ledger_totals(student)
	balance = totals["balance"]
	term = current_term()
	term_totals = term_invoice_totals(student, term)

	if purpose == "exam":
		required = flt(setting("exam_fee_clearance_percent", 100))
	elif purpose == "lms":
		required = flt(setting("lms_fee_clearance_percent", 0))
	elif purpose == "transcript":
		required = 100.0 if cint(setting("transcript_requires_fee_clearance", 1)) else 0.0
	elif purpose == "certificate":
		required = 100.0
	else:  # registration: previous-term arrears must be cleared
		previous = money(balance - term_totals["outstanding"])
		required = 100.0 if previous > 0 else 0.0

	billed, paid = 0.0, 0.0
	if purpose in ("exam", "lms") and term_totals["billed"] > 0:
		billed = term_totals["billed"]
		paid = money(billed - term_totals["outstanding"])
	else:
		billed, paid = totals["debit"], totals["credit"]
	paid_percent = 100.0 if billed <= 0 else round(min(max(paid * 100.0 / billed, 0.0), 100.0), 2)

	sponsored = _has_full_sponsorship(student)
	cleared = required <= 0 or paid_percent >= round(required, 2) or sponsored
	label = _purpose_label(purpose)
	if required <= 0:
		message = _("No fee clearance is required for {0}.").format(label)
	elif sponsored and paid_percent < required:
		message = _("Cleared for {0}: your fees are fully covered by an active sponsorship.").format(label)
	elif cleared:
		message = _("Cleared for {0}: {1}% of fees paid ({2}% required).").format(
			label, paid_percent, required
		)
	else:
		message = _(
			"Fee clearance for {0} requires {1}% of fees to be paid; you have paid {2}%. Outstanding balance: {3}."
		).format(label, required, paid_percent, fmt_money(max(balance, 0)))
	return {
		"cleared": bool(cleared),
		"balance": balance,
		"paid_percent": paid_percent,
		"required_percent": flt(required, 2),
		"message": message,
		"purpose": purpose,
		"sponsored": sponsored,
	}


# ---------------------------------------------------------------------------------- scheduler jobs
def mark_overdue_invoices() -> int:
	"""Daily: flag submitted invoices and installments past due with an outstanding amount."""
	names = frappe.get_all(
		"Student Invoice",
		filters={
			"docstatus": 1,
			"status": ["in", ["Unpaid", "Partly Paid"]],
			"outstanding_amount": [">", 0],
			"due_date": ["<", today()],
		},
		pluck="name",
	)
	if names:
		si = DocType("Student Invoice")
		frappe.qb.update(si).set(si.status, "Overdue").where(si.name.isin(names)).run()
	frappe.db.sql(
		"""update `tabFee Installment` fi
		join `tabStudent Invoice` si on si.name = fi.parent and fi.parenttype = 'Student Invoice'
		set fi.status = 'Overdue'
		where si.docstatus = 1 and fi.status in ('Unpaid', 'Partly Paid') and fi.due_date < %s""",
		(today(),),
	)
	return len(names)


def _reminder_cache_key(student: str) -> str:
	return f"mahanaim:fee_reminder:{student}"


def send_fee_reminders(students: list[str] | None = None, force: bool = False) -> int:
	"""Daily: remind students with a positive balance and an overdue invoice (at most once per
	`overdue_reminder_days`). Staff can `force` reminders for chosen students."""
	from mahanaim.services.communication import notify

	days = cint(setting("overdue_reminder_days", 7)) or 7
	conditions, params = [], {}
	if students:
		conditions.append("s.name in %(students)s")
		params["students"] = tuple(students)
	if not force:
		conditions.append(
			"exists (select 1 from `tabStudent Invoice` si where si.student = s.name and si.docstatus = 1 "
			"and si.status = 'Overdue')"
		)
	where = (" and " + " and ".join(conditions)) if conditions else ""
	rows = frappe.db.sql(
		f"""select s.name, s.full_name, s.user, s.email, s.phone,
			sum(l.debit) - sum(l.credit) as balance
		from `tabStudent` s
		join `tabStudent Ledger Entry` l on l.student = s.name and l.is_cancelled = 0
		where 1 = 1 {where}
		group by s.name, s.full_name, s.user, s.email, s.phone
		having balance > 0""",
		params,
		as_dict=True,
	)
	if not rows:
		return 0
	recent = set()
	if not force:
		cutoff = add_days(now_datetime(), -days)
		recent = set(
			frappe.get_all(
				"Message Log",
				filters={
					"event": "Fee Reminder",
					"reference_doctype": "Student",
					"reference_name": ["in", [r.name for r in rows]],
					"creation": [">=", cutoff],
				},
				pluck="reference_name",
			)
		)
	sent = 0
	for r in rows:
		if not force and (r.name in recent or frappe.cache.get_value(_reminder_cache_key(r.name))):
			continue
		balance = money(r.balance)
		notify(
			"Fee Reminder",
			doc=frappe._dict(doctype="Student", name=r.name, student_name=r.full_name),
			recipients=[{"user": r.user, "email": r.email, "phone": r.phone, "name": r.full_name}],
			context={"balance": balance},
			link="/student/fees",
			category="Finance",
			fallback={
				"subject": _("Fee balance reminder"),
				"message": _(
					"Dear {0}, your fee balance is {1}. Please clear it to keep access to exams and the LMS."
				).format(r.full_name, fmt_money(balance)),
			},
		)
		frappe.cache.set_value(_reminder_cache_key(r.name), 1, expires_in_sec=days * 86400)
		sent += 1
	return sent


# ---------------------------------------------------------------------------------- notifications
def notify_invoice(inv):
	from mahanaim.services.communication import notify, recipient_for_student

	notify(
		"Invoice Issued",
		doc=inv,
		recipients=[recipient_for_student(inv.student)],
		context={"balance": get_student_balance(inv.student)},
		link="/student/fees",
		category="Finance",
		fallback={
			"subject": _("Fee invoice {0}").format(inv.name),
			"message": _("Dear {0}, invoice {1} of {2} has been issued and is due on {3}.").format(
				inv.student_name, inv.name, fmt_money(inv.total_amount), inv.due_date or "-"
			),
		},
	)


def notify_payment(payment):
	from mahanaim.services.communication import (
		notify,
		recipient_for_application,
		recipient_for_sponsor,
		recipient_for_student,
	)

	recipients, context = [], {}
	if payment.student:
		recipients.append(recipient_for_student(payment.student))
		if payment.payment_for == "Student Fees":
			context["balance"] = get_student_balance(payment.student)
	elif payment.programme_application:
		app = frappe.db.get_value(
			"Programme Application",
			payment.programme_application,
			["user", "email", "phone", "full_name"],
			as_dict=True,
		)
		if app:
			recipients.append(recipient_for_application(app))
	if payment.sponsor:
		recipients.append(recipient_for_sponsor(payment.sponsor))
	channels = None
	if payment.mode_of_payment == "M-Pesa":
		ms = frappe.get_cached_doc("M-Pesa Settings")
		channels = tuple(
			c for c, on in (("Email", ms.email_receipt), ("SMS", ms.sms_receipt), ("In-App", 1)) if cint(on)
		)
	link = "/student/fees" if payment.student else "/applicant"
	notify(
		"Payment Received",
		doc=payment,
		recipients=recipients,
		context=context,
		link=link,
		category="Finance",
		fallback={
			"subject": _("Receipt {0} — payment received").format(payment.name),
			"message": _("We have received {0} via {1} (ref {2}). Receipt no. {3}.").format(
				fmt_money(payment.amount),
				payment.mode_of_payment,
				payment.reference_no or payment.name,
				payment.name,
			),
			"send_sms": 1,
		},
		channels=channels,
	)
	return bool(recipients)


# ---------------------------------------------------------------------------------- ERPNext (optional)
def erpnext_enabled() -> bool:
	return has_app("erpnext") and bool(cint(setting("post_to_erpnext")))


def _erpnext_customer(student: str) -> str | None:
	info = frappe.db.get_value("Student", student, ["student_number", "full_name"], as_dict=True) or {}
	name = info.get("student_number") or student
	if frappe.db.exists("Customer", name):
		return name
	cust = frappe.get_doc(
		{
			"doctype": "Customer",
			"customer_name": name,
			"customer_type": "Individual",
			"customer_details": info.get("full_name"),
		}
	)
	cust.flags.ignore_mandatory = True
	cust.insert(ignore_permissions=True)
	return cust.name


def _post_journal(doc, accounts: list[dict], remark: str) -> str | None:
	if not erpnext_enabled():
		return None
	s = frappe.get_cached_doc("Mahanaim Settings")
	try:
		frappe.db.savepoint("mbc_erpnext")
		je = frappe.get_doc(
			{
				"doctype": "Journal Entry",
				"voucher_type": "Journal Entry",
				"company": s.company,
				"posting_date": doc.posting_date,
				"cheque_no": doc.name,
				"cheque_date": doc.posting_date,
				"user_remark": remark,
				"accounts": [{**a, "cost_center": s.cost_center} for a in accounts],
			}
		)
		je.insert(ignore_permissions=True)
		je.submit()
		frappe.db.set_value(doc.doctype, doc.name, "journal_entry", je.name, update_modified=False)
		return je.name
	except Exception:
		frappe.db.rollback(save_point="mbc_erpnext")
		frappe.log_error(title=f"ERPNext posting failed for {doc.doctype} {doc.name}")
		return None


def post_invoice_journal(inv) -> str | None:
	if not erpnext_enabled():
		return None
	s = frappe.get_cached_doc("Mahanaim Settings")
	try:
		customer = _erpnext_customer(inv.student)
	except Exception:
		frappe.log_error(title=f"ERPNext customer failed for {inv.student}")
		return None
	accounts = [
		{
			"account": s.receivable_account,
			"party_type": "Customer",
			"party": customer,
			"debit_in_account_currency": money(inv.total_amount),
		}
	]
	income_accounts = dict(
		frappe.get_all(
			"Fee Component",
			filters={"name": ["in", [i.fee_component for i in inv.items]]},
			fields=["name", "income_account"],
			as_list=True,
		)
	)
	by_account = {}
	for item in inv.items:
		acc = income_accounts.get(item.fee_component) or s.income_account
		by_account[acc] = money(by_account.get(acc, 0) + flt(item.amount))
	accounts += [{"account": a, "credit_in_account_currency": v} for a, v in by_account.items()]
	return _post_journal(inv, accounts, f"Student Invoice {inv.name} ({inv.student_name})")


def post_payment_journal(payment) -> str | None:
	if not erpnext_enabled() or payment.payment_for != "Student Fees" or not payment.student:
		return None
	s = frappe.get_cached_doc("Mahanaim Settings")
	try:
		customer = _erpnext_customer(payment.student)
	except Exception:
		frappe.log_error(title=f"ERPNext customer failed for {payment.student}")
		return None
	accounts = [
		{"account": s.cash_account, "debit_in_account_currency": money(payment.amount)},
		{
			"account": s.receivable_account,
			"party_type": "Customer",
			"party": customer,
			"credit_in_account_currency": money(payment.amount),
		},
	]
	return _post_journal(payment, accounts, f"Student Payment {payment.name} ({payment.mode_of_payment})")


def cancel_journal(journal_entry: str | None):
	if not journal_entry or not erpnext_enabled():
		return
	try:
		frappe.db.savepoint("mbc_erpnext_cancel")
		je = frappe.get_doc("Journal Entry", journal_entry)
		if je.docstatus == 1:
			je.flags.ignore_permissions = True
			je.cancel()
	except Exception:
		frappe.db.rollback(save_point="mbc_erpnext_cancel")
		frappe.log_error(title=f"ERPNext cancel failed for {journal_entry}")
