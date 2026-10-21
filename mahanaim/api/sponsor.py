"""Sponsor / partner-church portal endpoints (backend domain B4).

Guard: `require_sponsor()` — users with the Sponsor role linked to a Sponsor record. Staff may preview a sponsor's
portal by passing `sponsor=<name>` (church/finance roles only). A sponsor only ever sees students they sponsor
(Sponsorship status Active, Suspended or Completed); published results only.
"""

from __future__ import annotations

from collections import defaultdict

import frappe
from frappe import _
from frappe.rate_limiter import rate_limit
from frappe.utils import cint, flt, now_datetime, nowdate

from mahanaim.api.utils import clean_payload, require_login, require_sponsor
from mahanaim.services import church as svc
from mahanaim.utils import ROLE_ADMIN, ROLE_CHAPLAIN, ROLE_FINANCE, current_term, setting, user_roles

PROFILE_FIELDS = (
	"sponsor_name",
	"sponsor_type",
	"partner_church",
	"status",
	"email",
	"phone",
	"preferred_communication",
	"contact_person",
	"country",
	"address",
	"total_committed",
	"total_disbursed",
	"active_sponsorships",
	"user",
)
EDITABLE_FIELDS = ("phone", "preferred_communication", "contact_person", "country", "address")
PREVIEW_ROLES = {"System Manager", ROLE_ADMIN, ROLE_CHAPLAIN, ROLE_FINANCE}
STUDENT_FIELDS = [
	"name",
	"full_name",
	"student_number",
	"photo",
	"programme",
	"programme_name",
	"year_of_study",
	"campus",
	"status",
	"cgpa",
	"credits_earned",
	"academic_standing",
	"current_term",
]


def _me(sponsor: str | None = None):
	"""The caller's Sponsor; church/finance staff may preview another sponsor's portal with `sponsor=`."""
	user = require_login()
	if sponsor and (user == "Administrator" or user_roles(user) & PREVIEW_ROLES):
		if not frappe.db.exists("Sponsor", sponsor):
			frappe.throw(_("Sponsor {0} was not found.").format(sponsor), frappe.DoesNotExistError)
		return frappe.get_doc("Sponsor", sponsor)
	doc = require_sponsor()
	if not doc:
		frappe.throw(_("No sponsor profile is linked to your account."), frappe.PermissionError)
	return doc


def _ensure_sponsors(me, student: str):
	if not svc.is_sponsored_by(me.name, student):
		frappe.throw(_("You can only view students you sponsor."), frappe.PermissionError)


def _sponsorships(sponsor: str) -> list:
	return frappe.get_all(
		"Sponsorship",
		filters={"sponsor": sponsor, "status": ["in", list(svc.SPONSORED_STATUSES)]},
		fields=[
			"name",
			"student",
			"status",
			"coverage",
			"amount",
			"percentage",
			"start_term",
			"end_term",
			"amount_disbursed",
			"reporting_frequency",
		],
		order_by="student_name asc",
	)


def _campus_names(names) -> dict:
	names = [n for n in set(names) if n]
	return (
		dict(
			frappe.get_all(
				"Campus", filters={"name": ["in", names]}, fields=["name", "campus_name"], as_list=True
			)
		)
		if names
		else {}
	)


def _profile(doc) -> dict:
	out = {k: doc.get(k) for k in PROFILE_FIELDS}
	out["name"] = doc.name
	out["partner_church_name"] = (
		frappe.db.get_value("Partner Church", doc.partner_church, "church_name")
		if doc.partner_church
		else None
	)
	return out


# ---------------------------------------------------------------------------------- profile
@frappe.whitelist()
def my_sponsor_profile(sponsor=None):
	me = _me(sponsor)
	rows = _sponsorships(me.name)
	students = list({r.student for r in rows})
	balances = svc.student_balances(students)
	return {
		"profile": _profile(me),
		"summary": {
			"students": len(students),
			"active_sponsorships": sum(1 for r in rows if r.status == "Active"),
			"committed": flt(me.total_committed),
			"disbursed": flt(me.total_disbursed),
			"outstanding_for_students": sum(max(flt(balances.get(s)), 0) for s in students),
		},
	}


@frappe.whitelist(methods=["POST"])
def update_my_sponsor_profile(data):
	me = _me()
	values = clean_payload(data, EDITABLE_FIELDS)
	if not values:
		frappe.throw(_("Nothing to update."))
	if "preferred_communication" in values:
		options = (me.meta.get_field("preferred_communication").options or "").split("\n")
		if values["preferred_communication"] not in options:
			frappe.throw(_("Choose a valid communication preference."))
	me.update(values)
	me.flags.ignore_permissions = True
	me.flags.create_user = False
	me.save()
	return _profile(me)


# ---------------------------------------------------------------------------------- students
@frappe.whitelist()
def my_students(sponsor=None):
	me = _me(sponsor)
	rows = _sponsorships(me.name)
	if not rows:
		return {"data": [], "total": 0}
	students = list({r.student for r in rows})
	info = {
		s.name: s
		for s in frappe.get_all("Student", filters={"name": ["in", students]}, fields=STUDENT_FIELDS)
	}
	balances = svc.student_balances(students)
	attendance = svc.attendance_by_student(students)
	campuses = _campus_names(s.campus for s in info.values())
	data = []
	for r in rows:
		s = info.get(r.student)
		if not s:
			continue
		data.append(
			{
				"student": s.name,
				"full_name": s.full_name,
				"student_number": s.student_number,
				"photo": s.photo,
				"programme": s.programme,
				"programme_name": s.programme_name,
				"year_of_study": s.year_of_study,
				"campus": s.campus,
				"campus_name": campuses.get(s.campus, s.campus),
				"status": s.status,
				"cgpa": flt(s.cgpa, 2),
				"academic_standing": s.academic_standing,
				"attendance_pct": attendance.get(s.name, {}).get("pct"),
				"fee_balance": flt(balances.get(s.name)),
				"sponsorship": {
					"name": r.name,
					"status": r.status,
					"coverage": r.coverage,
					"amount": flt(r.amount),
					"percentage": flt(r.percentage),
					"start_term": r.start_term,
					"end_term": r.end_term,
					"amount_disbursed": flt(r.amount_disbursed),
				},
			}
		)
	return {"data": data, "total": len(data)}


@frappe.whitelist()
def student_progress(student: str, sponsor=None):
	me = _me(sponsor)
	_ensure_sponsors(me, student)
	s = frappe.get_all("Student", filters={"name": student}, fields=STUDENT_FIELDS)[0]
	results = frappe.get_all(
		"Course Result",
		filters={"student": student, "is_published": 1},
		fields=[
			"academic_term",
			"course",
			"course_title",
			"credits",
			"grade",
			"grade_points",
			"result_status",
		],
		order_by="course asc",
	)
	terms = list({r.academic_term for r in results if r.academic_term})
	term_info = (
		{
			t.name: t
			for t in frappe.get_all(
				"Academic Term", filters={"name": ["in", terms]}, fields=["name", "term_label", "start_date"]
			)
		}
		if terms
		else {}
	)
	by_term = defaultdict(list)
	for r in results:
		by_term[r.academic_term].append(r)
	term_rows = []
	for term in sorted(by_term, key=lambda t: str((term_info.get(t) or {}).get("start_date") or "9999")):
		courses = by_term[term]
		credits = sum(flt(c.credits) for c in courses)
		points = sum(flt(c.credits) * flt(c.grade_points) for c in courses)
		term_rows.append(
			{
				"academic_term": term,
				"term_label": (term_info.get(term) or {}).get("term_label") or term,
				"courses": courses,
				"credits": credits,
				"gpa": round(points / credits, 2) if credits else None,
				"passed": sum(1 for c in courses if (c.result_status or "").lower() in ("pass", "passed")),
				"failed": sum(1 for c in courses if (c.result_status or "").lower() in ("fail", "failed")),
			}
		)
	term = s.current_term or current_term()
	attendance = svc.attendance_by_student([student]).get(student)
	term_attendance = svc.attendance_by_student([student], term).get(student) if term else None
	invoices = frappe.get_all(
		"Student Invoice",
		filters={"student": student, "docstatus": 1},
		fields=[
			"name",
			"academic_term",
			"posting_date",
			"due_date",
			"total_amount",
			"paid_amount",
			"outstanding_amount",
			"status",
		],
		order_by="posting_date desc",
		limit_page_length=6,
	)
	s["campus_name"] = _campus_names([s.campus]).get(s.campus, s.campus)
	return {
		"student": s,
		"terms": term_rows,
		"attendance": {"overall": attendance, "current_term": term_attendance, "term": term},
		"fees": {"balance": flt(svc.student_balances([student]).get(student)), "invoices": invoices},
		"sponsorship": frappe.get_all(
			"Sponsorship",
			filters={"sponsor": me.name, "student": student},
			fields=["name", "status", "coverage", "amount", "percentage", "amount_disbursed"],
			order_by="creation desc",
			limit_page_length=1,
		)[0],
	}


# ---------------------------------------------------------------------------------- money
@frappe.whitelist()
def my_contributions(sponsor=None):
	me = _me(sponsor)
	payments = frappe.get_all(
		"Student Payment",
		filters={"sponsor": me.name, "docstatus": 1},
		fields=[
			"name",
			"student",
			"amount",
			"posting_date",
			"mode_of_payment",
			"reference_no",
			"payment_for",
		],
		order_by="posting_date desc",
		limit_page_length=500,
	)
	credits = frappe.get_all(
		"Fee Adjustment",
		filters={"sponsor": me.name, "adjustment_type": "Sponsor Credit", "docstatus": 1},
		fields=["name", "student", "amount", "posting_date", "reason"],
		order_by="posting_date desc",
		limit_page_length=500,
	)
	giving = frappe.get_all(
		"Giving Record",
		filters={"sponsor": me.name, "docstatus": 1},
		fields=[
			"name",
			"giving_type",
			"amount",
			"posting_date",
			"mode_of_payment",
			"reference_no",
			"purpose",
		],
		order_by="posting_date desc",
		limit_page_length=500,
	)
	students = list({r.student for r in payments + credits if r.student})
	names = (
		dict(
			frappe.get_all(
				"Student", filters={"name": ["in", students]}, fields=["name", "full_name"], as_list=True
			)
		)
		if students
		else {}
	)
	items = []
	for p in payments:
		items.append(
			{
				"type": "Fee Payment",
				"name": p.name,
				"student": p.student,
				"student_name": names.get(p.student),
				"amount": flt(p.amount),
				"date": p.posting_date,
				"mode": p.mode_of_payment,
				"reference": p.reference_no,
			}
		)
	for c in credits:
		items.append(
			{
				"type": "Sponsor Credit",
				"name": c.name,
				"student": c.student,
				"student_name": names.get(c.student),
				"amount": flt(c.amount),
				"date": c.posting_date,
				"mode": None,
				"reference": c.reason,
			}
		)
	for g in giving:
		items.append(
			{
				"type": "Giving",
				"name": g.name,
				"giving_type": g.giving_type,
				"amount": flt(g.amount),
				"date": g.posting_date,
				"mode": g.mode_of_payment,
				"reference": g.reference_no,
				"purpose": g.purpose,
			}
		)
	items.sort(key=lambda x: str(x["date"]), reverse=True)
	by_year = defaultdict(float)
	for i in items:
		by_year[str(i["date"])[:4]] += i["amount"]
	return {
		"data": items,
		"total": len(items),
		"totals": {
			"fees": sum(flt(p.amount) for p in payments) + sum(flt(c.amount) for c in credits),
			"giving": sum(flt(g.amount) for g in giving),
			"all": sum(i["amount"] for i in items),
			"by_year": [{"year": y, "amount": a} for y, a in sorted(by_year.items())],
		},
	}


def _initiate(phone, amount, purpose, **kwargs) -> dict:
	try:
		from mahanaim.services.mpesa import initiate_payment
	except ImportError:
		frappe.throw(_("Online payments are not available right now."))
	try:
		return initiate_payment(phone, amount, purpose, initiated_by=frappe.session.user, **kwargs) or {}
	except NotImplementedError:
		frappe.throw(_("M-Pesa payments are not available right now. Please use bank transfer."))


@frappe.whitelist(methods=["POST"])
@rate_limit(limit=10, seconds=60 * 60)
def pay_for_student(student: str, amount, phone: str | None = None):
	"""STK push for a sponsored student's fees; the payment is recorded against the student with sponsor=me."""
	me = _me()
	_ensure_sponsors(me, student)
	if not frappe.db.exists(
		"Sponsorship", {"sponsor": me.name, "student": student, "status": ["in", ["Active", "Suspended"]]}
	):
		frappe.throw(_("This sponsorship is no longer active."))
	if flt(amount) <= 0:
		frappe.throw(_("Enter an amount greater than zero."))
	phone = phone or me.phone
	if not phone:
		frappe.throw(_("Enter the M-Pesa phone number to pay from."))
	res = _initiate(phone, flt(amount), "Student Fees", student=student, sponsor=me.name)
	return {"ok": True, **res}


@frappe.whitelist(methods=["POST"])
@rate_limit(limit=10, seconds=60 * 60)
def give_online(amount, giving_type: str, phone: str | None = None, purpose: str | None = None):
	"""A sponsor's own gift (offering, project, scholarship fund) via M-Pesa — recorded when the payment completes."""
	me = _me()
	if flt(amount) <= 0:
		frappe.throw(_("Enter an amount greater than zero."))
	if not frappe.db.get_value("Giving Type", giving_type, "is_active"):
		frappe.throw(_("Choose a valid giving type."))
	phone = phone or me.phone
	if not phone:
		frappe.throw(_("Enter the M-Pesa phone number to pay from."))
	try:
		res = svc.start_online_giving(
			phone,
			flt(amount),
			giving_type,
			{
				"giver_type": "Sponsor",
				"sponsor": me.name,
				"giver_name": me.sponsor_name,
				"purpose": (purpose or "").strip()[:140] or None,
			},
		)
	except NotImplementedError:
		frappe.throw(_("M-Pesa payments are not available right now. Please use bank transfer."))
	return {"ok": True, **res}


# ---------------------------------------------------------------------------------- report
@frappe.whitelist()
def sponsor_report(sponsor=None):
	"""Printable summary: institution header, sponsor profile, each student's progress, and contributions."""
	me = _me(sponsor)
	students = my_students(sponsor=me.name if sponsor else None)["data"]
	contributions = my_contributions(sponsor=me.name if sponsor else None)
	year = nowdate()[:4]
	return {
		"institution": {
			"name": setting("institution_name") or "Mahanaim Bible College",
			"short_name": setting("short_name"),
			"logo": setting("logo"),
			"address": setting("address"),
			"email": setting("email"),
			"phone": setting("phone"),
			"currency": setting("currency") or "KES",
		},
		"generated_on": now_datetime(),
		"sponsor": _profile(me),
		"students": students,
		"contributions": {
			"this_year": sum(i["amount"] for i in contributions["data"] if str(i["date"]).startswith(year)),
			"all_time": contributions["totals"]["all"],
			"fees": contributions["totals"]["fees"],
			"giving": contributions["totals"]["giving"],
			"by_year": contributions["totals"]["by_year"],
			"recent": contributions["data"][:15],
		},
		"summary": {
			"students": len(students),
			"average_cgpa": round(sum(s["cgpa"] for s in students) / len(students), 2) if students else None,
			"outstanding_for_students": sum(max(s["fee_balance"], 0) for s in students),
			"committed": flt(me.total_committed),
			"disbursed": flt(me.total_disbursed),
		},
	}
