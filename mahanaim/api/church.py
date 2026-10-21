"""Church partners, sponsors, giving, chapel and ministry endpoints for staff (backend domain B4).

Guard: Chaplain or Finance Officer (College Administrator / System Manager always pass). Partner churches are also
editable by Admissions/Communications (doctype permissions decide). Chapel services and ministry groups are read by
Chaplain, Registrar, Academic Dean and Auditor (`CHAPEL_READ_ROLES`). Lists use permission-aware `get_list` and
return `{"data": [...], "total": n}`; mutations are POST-only and go through doctype permission checks. Every role
admitted by a read gate also holds a read-only DocPerm on the doctypes that endpoint reads (asserted in tests).

Public (guest) endpoints for the /give page: `giving_options` (GET or POST), `give` (rate-limited M-Pesa STK push)
and `giving_status` (poll, GET or POST). The Giving Record is created when the M-Pesa payment completes.
`partner_churches` is a rate-limited public church pick-list (public fields only).

Student portal: `my_chapel` (scoped to the Student linked to the session user).
"""

from __future__ import annotations

from collections import defaultdict

import frappe
from frappe import _
from frappe.rate_limiter import rate_limit
from frappe.utils import cint, cstr, flt, getdate, nowdate, validate_email_address

from mahanaim.api.utils import clean_payload, page_args, parse_json, require_login, require_roles
from mahanaim.services import church as svc
from mahanaim.utils import (
	ROLE_ADMIN,
	ROLE_ADMISSIONS,
	ROLE_AUDITOR,
	ROLE_CHAPLAIN,
	ROLE_COMMS,
	ROLE_DEAN,
	ROLE_FINANCE,
	ROLE_REGISTRAR,
	normalize_phone,
	setting,
	user_roles,
)

CHURCH_ROLES = (ROLE_CHAPLAIN, ROLE_FINANCE)
READ_ROLES = (*CHURCH_ROLES, ROLE_AUDITOR, ROLE_REGISTRAR)
CHURCH_EDIT_ROLES = (*CHURCH_ROLES, ROLE_ADMISSIONS, ROLE_COMMS)
CHAPEL_READ_ROLES = (ROLE_CHAPLAIN, ROLE_REGISTRAR, ROLE_DEAN, ROLE_AUDITOR)

CHURCH_FIELDS = (
	"church_name",
	"church_code",
	"denomination",
	"church_type",
	"partnership_status",
	"partnership_since",
	"sponsor",
	"senior_pastor",
	"contact_person",
	"phone",
	"email",
	"website",
	"county",
	"town",
	"address",
	"is_group",
	"parent_partner_church",
)
SPONSOR_FIELDS = (
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
	"notes",
)
SPONSORSHIP_FIELDS = (
	"sponsor",
	"student",
	"programme",
	"status",
	"coverage",
	"amount",
	"percentage",
	"start_term",
	"end_term",
	"scholarship",
	"reporting_frequency",
	"notes",
)
GIVING_FIELDS = (
	"giving_type",
	"giver_type",
	"sponsor",
	"partner_church",
	"student",
	"giver_name",
	"giver_email",
	"posting_date",
	"amount",
	"mode_of_payment",
	"reference_no",
	"msisdn",
	"chapel_service",
	"purpose",
)
CHAPEL_FIELDS = (
	"service_date",
	"start_time",
	"service_type",
	"campus",
	"venue",
	"status",
	"theme",
	"scripture",
	"preacher",
	"preacher_staff",
	"men",
	"women",
	"children",
	"visitors",
	"offering_total",
	"notes",
	"sermon_media_url",
)
MINISTRY_FIELDS = (
	"group_name",
	"group_type",
	"campus",
	"is_active",
	"patron",
	"leader",
	"meeting_day",
	"meeting_time",
	"description",
)


# ---------------------------------------------------------------------------------- helpers
def _upsert(doctype: str, data, allowed, children: dict | None = None):
	data = parse_json(data, {}) or {}
	values = clean_payload(data, allowed)
	if data.get("name"):
		doc = frappe.get_doc(doctype, data["name"])
		doc.check_permission("write")
	else:
		doc = frappe.new_doc(doctype)
		doc.check_permission("create")
	doc.update(values)
	for table, fields in (children or {}).items():
		if table in data:
			doc.set(table, [clean_payload(row, fields) for row in (parse_json(data[table], []) or [])])
	return doc


def _like(search: str | None, fields: tuple[str, ...]):
	if not search or not search.strip():
		return None
	like = f"%{search.strip()}%"
	return [[f, "like", like] for f in fields]


def _paged(doctype, fields, filters, or_filters=None, order_by="modified desc", start=0, page_length=20):
	args = page_args(start, page_length)
	data = frappe.get_list(
		doctype,
		fields=fields,
		filters=filters,
		or_filters=or_filters,
		order_by=order_by,
		limit_start=args["start"],
		limit_page_length=args["page_length"],
	)
	counted = frappe.get_list(
		doctype, filters=filters, or_filters=or_filters, fields=[{"COUNT": "*", "as": "n"}]
	)
	total = cint(counted[0].n) if counted else 0
	return {"data": data, "total": total}


# ---------------------------------------------------------------------------------- dashboard
@frappe.whitelist()
def church_dashboard():
	require_roles(*READ_ROLES)
	data = svc.church_dashboard_data()
	data["recent_giving"] = frappe.get_all(
		"Giving Record",
		filters={"docstatus": 1},
		fields=["name", "giving_type", "giver_name", "amount", "posting_date", "mode_of_payment"],
		order_by="posting_date desc, creation desc",
		limit_page_length=8,
	)
	data["upcoming_chapel"] = frappe.get_all(
		"Chapel Service",
		filters={"status": "Scheduled", "service_date": [">=", nowdate()]},
		fields=["name", "service_date", "service_type", "campus", "theme", "preacher"],
		order_by="service_date asc",
		limit_page_length=5,
	)
	return data


# ---------------------------------------------------------------------------------- partner churches
@frappe.whitelist()
def list_churches(tree=1, search=None, status=None, start=0, page_length=50):
	require_roles(*CHURCH_EDIT_ROLES, *READ_ROLES)
	fields = [
		"name",
		"church_name",
		"church_code",
		"denomination",
		"church_type",
		"partnership_status",
		"town",
		"county",
		"senior_pastor",
		"phone",
		"email",
		"is_group",
		"parent_partner_church",
		"lft",
		"rgt",
	]
	filters = {"partnership_status": status} if status else {}
	if cint(tree) and not search:
		rows = frappe.get_list(
			"Partner Church", fields=fields, filters=filters, order_by="lft asc", limit_page_length=0
		)
		counts = _students_per_church([r.name for r in rows])
		nodes = {r.name: {**r, "students": counts.get(r.name, 0), "children": []} for r in rows}
		roots = []
		for r in rows:
			node = nodes[r.name]
			parent = nodes.get(r.parent_partner_church)
			(parent["children"] if parent else roots).append(node)
		for node in nodes.values():
			node["students_total"] = node["students"]
		for node in reversed(list(nodes.values())):  # lft order reversed: children before their parents
			parent = nodes.get(node["parent_partner_church"])
			if parent:
				parent["students_total"] += node["students_total"]
		return {"data": roots, "total": len(rows)}
	out = _paged(
		"Partner Church",
		fields,
		filters,
		_like(search, ("church_name", "church_code", "town", "denomination", "senior_pastor")),
		order_by="church_name asc",
		start=start,
		page_length=page_length,
	)
	counts = _students_per_church([r.name for r in out["data"]])
	for r in out["data"]:
		r["students"] = counts.get(r.name, 0)
	return out


def _students_per_church(churches: list[str]) -> dict[str, int]:
	if not churches:
		return {}
	return {
		r.partner_church: cint(r.n)
		for r in frappe.get_all(
			"Student",
			filters={"partner_church": ["in", churches]},
			fields=["partner_church", {"COUNT": "*", "as": "n"}],
			group_by="partner_church",
		)
	}


@frappe.whitelist()
def get_church(name: str):
	require_roles(*CHURCH_EDIT_ROLES, *READ_ROLES)
	doc = frappe.get_doc("Partner Church", name)
	doc.check_permission("read")
	out = doc.as_dict()
	out["branches"] = frappe.get_all(
		"Partner Church",
		filters={"parent_partner_church": name},
		fields=["name", "church_name", "town", "partnership_status", "is_group"],
		order_by="church_name asc",
	)
	out["students"] = frappe.get_all(
		"Student",
		filters={"partner_church": name},
		fields=["name", "full_name", "student_number", "programme", "status", "year_of_study"],
		order_by="full_name asc",
		limit_page_length=200,
	)
	out["sponsors"] = frappe.get_all(
		"Sponsor",
		filters={"partner_church": name},
		fields=["name", "sponsor_name", "status", "total_committed", "total_disbursed"],
	)
	out["giving_total"] = _giving_total({"partner_church": name})
	return out


def _giving_total(filters: dict) -> float:
	rows = frappe.get_all(
		"Giving Record", filters={**filters, "docstatus": 1}, fields=[{"SUM": "amount", "as": "total"}]
	)
	return flt(rows[0].total) if rows else 0.0


@frappe.whitelist(methods=["POST"])
def save_church(data):
	require_roles(*CHURCH_EDIT_ROLES)
	doc = _upsert("Partner Church", data, CHURCH_FIELDS)
	doc.save()
	return doc.as_dict()


# ---------------------------------------------------------------------------------- sponsors
@frappe.whitelist()
def list_sponsors(search=None, status=None, sponsor_type=None, partner_church=None, start=0, page_length=20):
	require_roles(*READ_ROLES, ROLE_ADMISSIONS)
	filters = {
		k: v
		for k, v in {"status": status, "sponsor_type": sponsor_type, "partner_church": partner_church}.items()
		if v
	}
	return _paged(
		"Sponsor",
		[
			"name",
			"sponsor_name",
			"sponsor_type",
			"partner_church",
			"status",
			"email",
			"phone",
			"user",
			"country",
			"total_committed",
			"total_disbursed",
			"active_sponsorships",
		],
		filters,
		_like(search, ("sponsor_name", "email", "phone", "contact_person")),
		order_by="sponsor_name asc",
		start=start,
		page_length=page_length,
	)


@frappe.whitelist(methods=["POST"])
def save_sponsor(data, create_user=1):
	require_roles(*CHURCH_ROLES)
	doc = _upsert("Sponsor", data, SPONSOR_FIELDS)
	doc.flags.create_user = bool(cint(create_user))
	doc.save()
	return doc.as_dict()


@frappe.whitelist(methods=["POST"])
def refresh_sponsor(name: str):
	require_roles(*CHURCH_ROLES)
	frappe.get_doc("Sponsor", name).check_permission("write")
	svc.on_sponsor_payment(name)
	return frappe.get_doc("Sponsor", name).as_dict()


@frappe.whitelist(methods=["POST"])
def send_sponsor_reports(sponsor: str | None = None):
	"""Send the "Sponsor Report" notification to one sponsor now, or to every active sponsor in the background."""
	require_roles(*CHURCH_ROLES)
	if not sponsor:
		job = frappe.enqueue(
			"mahanaim.services.church.send_sponsor_reports",
			queue="long",
			timeout=1800,
			enqueue_after_commit=True,
			now=bool(frappe.flags.in_test),
		)
		return {
			"queued": True,
			"job": getattr(job, "id", None),
			"message": _("Sponsor reports are being sent to all active sponsors."),
		}
	if not frappe.db.exists("Sponsor", sponsor):
		frappe.throw(_("Sponsor {0} not found").format(sponsor), frappe.DoesNotExistError)
	result = svc.send_sponsor_reports(sponsor)
	message = (
		_("Sponsor report sent.")
		if result["sent"]
		else _(
			"No report was sent: the sponsor is inactive, has no active sponsorship or has no contact details."
		)
	)
	return {"queued": False, **result, "message": message}


@frappe.whitelist()
def sponsor_360(name: str):
	"""Everything about a sponsor in one call: profile, sponsorships with student balances, payments, giving."""
	require_roles(*READ_ROLES, ROLE_ADMISSIONS)
	doc = frappe.get_doc("Sponsor", name)
	doc.check_permission("read")
	sponsorships = frappe.get_all(
		"Sponsorship",
		filters={"sponsor": name},
		fields=[
			"name",
			"student",
			"student_name",
			"programme",
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
	students = list({s.student for s in sponsorships})
	info = (
		{
			r.name: r
			for r in frappe.get_all(
				"Student",
				filters={"name": ["in", students]},
				fields=["name", "student_number", "photo", "status", "campus", "year_of_study", "cgpa"],
			)
		}
		if students
		else {}
	)
	balances = _balances(students)
	for s in sponsorships:
		st = info.get(s.student) or {}
		s.update(
			{
				"student_number": st.get("student_number"),
				"photo": st.get("photo"),
				"student_status": st.get("status"),
				"campus": st.get("campus"),
				"year_of_study": st.get("year_of_study"),
				"cgpa": st.get("cgpa"),
				"balance": balances.get(s.student, 0.0),
			}
		)
	payments = frappe.get_all(
		"Student Payment",
		filters={"sponsor": name, "docstatus": 1},
		fields=["name", "student", "amount", "posting_date", "mode_of_payment", "reference_no"],
		order_by="posting_date desc",
		limit_page_length=50,
	)
	giving = frappe.get_all(
		"Giving Record",
		filters={"sponsor": name, "docstatus": 1},
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
		limit_page_length=50,
	)
	return {
		"sponsor": doc.as_dict(),
		"sponsorships": sponsorships,
		"payments": payments,
		"giving": giving,
		"summary": {
			"committed": flt(doc.total_committed),
			"disbursed": flt(doc.total_disbursed),
			"active_sponsorships": cint(doc.active_sponsorships),
			"students": len(students),
			"outstanding_for_students": sum(max(balances.get(s, 0.0), 0) for s in students),
			"giving_total": sum(flt(g.amount) for g in giving),
		},
	}


def _balances(students: list[str]) -> dict[str, float]:
	return svc.student_balances(students)


# ---------------------------------------------------------------------------------- sponsorships
@frappe.whitelist()
def list_sponsorships(
	sponsor=None, student=None, status=None, coverage=None, search=None, start=0, page_length=20
):
	require_roles(*READ_ROLES)
	filters = {
		k: v
		for k, v in {"sponsor": sponsor, "student": student, "status": status, "coverage": coverage}.items()
		if v
	}
	return _paged(
		"Sponsorship",
		[
			"name",
			"sponsor",
			"sponsor_name",
			"student",
			"student_name",
			"programme",
			"status",
			"coverage",
			"amount",
			"percentage",
			"start_term",
			"end_term",
			"amount_disbursed",
			"modified",
		],
		filters,
		_like(search, ("sponsor_name", "student_name", "student", "sponsor")),
		order_by="modified desc",
		start=start,
		page_length=page_length,
	)


@frappe.whitelist(methods=["POST"])
def save_sponsorship(data):
	require_roles(*CHURCH_ROLES)
	doc = _upsert("Sponsorship", data, SPONSORSHIP_FIELDS)
	doc.save()
	return doc.as_dict()


@frappe.whitelist(methods=["POST"])
def set_sponsorship_status(name: str, status: str, notes: str | None = None):
	require_roles(*CHURCH_ROLES)
	doc = frappe.get_doc("Sponsorship", name)
	doc.check_permission("write")
	doc.status = status
	if notes:
		stamp = f"[{nowdate()} {frappe.session.user}] {notes.strip()}"
		doc.notes = f"{doc.notes}\n{stamp}" if doc.notes else stamp
	doc.save()
	return doc.as_dict()


# ---------------------------------------------------------------------------------- giving
@frappe.whitelist()
def list_giving_types(include_inactive=0):
	require_roles(*READ_ROLES)
	filters = {} if cint(include_inactive) else {"is_active": 1}
	return frappe.get_all(
		"Giving Type",
		filters=filters,
		fields=[
			"name",
			"giving_type_name",
			"is_active",
			"allow_online",
			"suggested_amounts",
			"income_account",
			"description",
		],
		order_by="name asc",
	)


@frappe.whitelist(methods=["POST"])
def save_giving_type(data):
	require_roles(*CHURCH_ROLES)
	doc = _upsert(
		"Giving Type",
		data,
		(
			"giving_type_name",
			"is_active",
			"allow_online",
			"suggested_amounts",
			"income_account",
			"description",
		),
	)
	doc.save()
	return doc.as_dict()


@frappe.whitelist()
def list_giving(
	giving_type=None,
	giver_type=None,
	sponsor=None,
	partner_church=None,
	chapel_service=None,
	from_date=None,
	to_date=None,
	search=None,
	include_cancelled=0,
	start=0,
	page_length=20,
):
	require_roles(*READ_ROLES)
	filters = {
		k: v
		for k, v in {
			"giving_type": giving_type,
			"giver_type": giver_type,
			"sponsor": sponsor,
			"partner_church": partner_church,
			"chapel_service": chapel_service,
		}.items()
		if v
	}
	filters["docstatus"] = ["!=", 2] if cint(include_cancelled) == 0 else ["<=", 2]
	if from_date and to_date:
		filters["posting_date"] = ["between", [getdate(from_date), getdate(to_date)]]
	elif from_date:
		filters["posting_date"] = [">=", getdate(from_date)]
	elif to_date:
		filters["posting_date"] = ["<=", getdate(to_date)]
	or_filters = _like(search, ("giver_name", "giver_email", "reference_no", "name", "purpose"))
	out = _paged(
		"Giving Record",
		[
			"name",
			"giving_type",
			"giver_type",
			"giver_name",
			"giver_email",
			"sponsor",
			"partner_church",
			"student",
			"posting_date",
			"amount",
			"mode_of_payment",
			"reference_no",
			"docstatus",
			"receipt_sent",
			"chapel_service",
		],
		filters,
		or_filters,
		order_by="posting_date desc, creation desc",
		start=start,
		page_length=page_length,
	)
	totals = frappe.get_list(
		"Giving Record",
		filters={**filters, "docstatus": 1},
		or_filters=or_filters,
		fields=["giving_type", {"SUM": "amount", "as": "total"}, {"COUNT": "*", "as": "n"}],
		group_by="giving_type",
	)
	out["totals"] = {
		"amount": sum(flt(t.total) for t in totals),
		"count": sum(cint(t.n) for t in totals),
		"by_type": [
			{"giving_type": t.giving_type, "total": flt(t.total), "count": cint(t.n)} for t in totals
		],
	}
	return out


@frappe.whitelist(methods=["POST"])
def record_giving(data, submit=1):
	"""Create a Giving Record and (by default) submit it — which posts the journal and sends the receipt.

	`giver_email` (optional) is stored lower-cased so walk-in givers get the emailed receipt.
	"""
	require_roles(*CHURCH_ROLES)
	payload = parse_json(data, {}) or {}
	if payload.get("name"):
		frappe.throw(_("Submitted giving records cannot be edited; cancel and record again."))
	meta = frappe.get_meta("Giving Record")
	doc = _upsert("Giving Record", payload, tuple(f for f in GIVING_FIELDS if meta.has_field(f)))
	doc.posting_date = doc.posting_date or nowdate()
	doc.insert()
	if cint(submit):
		doc.check_permission("submit")
		doc.submit()
	return doc.as_dict()


@frappe.whitelist(methods=["POST"])
def cancel_giving(name: str, reason: str | None = None):
	require_roles(*CHURCH_ROLES)
	doc = frappe.get_doc("Giving Record", name)
	doc.check_permission("cancel")
	if doc.docstatus != 1:
		frappe.throw(_("Only submitted giving records can be cancelled."))
	doc.cancel()
	if reason:
		doc.add_comment("Comment", _("Cancelled: {0}").format(frappe.utils.escape_html(reason)))
	return {"ok": True, "name": name}


# ---------------------------------------------------------------------------------- chapel
@frappe.whitelist()
def list_chapel_services(status=None, campus=None, from_date=None, to_date=None, start=0, page_length=20):
	require_roles(*CHAPEL_READ_ROLES)
	filters = {k: v for k, v in {"status": status, "campus": campus}.items() if v}
	if from_date:
		filters["service_date"] = [">=", getdate(from_date)]
	if to_date:
		filters.setdefault("service_date", ["<=", getdate(to_date)])
		if from_date:
			filters["service_date"] = ["between", [getdate(from_date), getdate(to_date)]]
	return _paged(
		"Chapel Service",
		[
			"name",
			"service_date",
			"start_time",
			"service_type",
			"campus",
			"venue",
			"status",
			"theme",
			"scripture",
			"preacher",
			"men",
			"women",
			"children",
			"visitors",
			"total_attendance",
			"offering_total",
		],
		filters,
		order_by="service_date desc, start_time desc",
		start=start,
		page_length=page_length,
	)


@frappe.whitelist()
def get_chapel_service(name: str):
	require_roles(*CHAPEL_READ_ROLES)
	doc = frappe.get_doc("Chapel Service", name)
	doc.check_permission("read")
	out = doc.as_dict()
	out["present_count"] = doc.present_count
	out["giving"] = frappe.get_all(
		"Giving Record",
		filters={"chapel_service": name, "docstatus": 1},
		fields=["name", "giving_type", "amount", "giver_name"],
	)
	return out


@frappe.whitelist(methods=["POST"])
def save_chapel_service(data):
	require_roles(ROLE_CHAPLAIN)
	doc = _upsert("Chapel Service", data, CHAPEL_FIELDS, children={"attendance": ("student", "status")})
	doc.save()
	return doc.as_dict()


@frappe.whitelist(methods=["POST"])
def record_chapel_attendance(service: str, rows=None, headcounts=None, mark_held=1):
	"""Replace the roll for a service. rows = [{student, status}]; headcounts = {men, women, children, visitors}."""
	require_roles(ROLE_CHAPLAIN)
	doc = frappe.get_doc("Chapel Service", service)
	doc.check_permission("write")
	rows = parse_json(rows, []) or []
	statuses = {"Present", "Absent", "Excused"}
	clean = []
	for r in rows:
		r = r if isinstance(r, dict) else {"student": r}
		if not r.get("student"):
			continue
		status = r.get("status") or "Present"
		if status not in statuses:
			frappe.throw(_("Invalid attendance status {0}.").format(status))
		clean.append({"student": r["student"], "status": status})
	missing = (
		set(r["student"] for r in clean)
		- set(
			frappe.get_all("Student", filters={"name": ["in", [r["student"] for r in clean]]}, pluck="name")
		)
		if clean
		else set()
	)
	if missing:
		frappe.throw(_("Unknown students: {0}").format(", ".join(sorted(missing))))
	doc.set("attendance", clean)
	for k, v in (clean_payload(headcounts or {}, ("men", "women", "children", "visitors"))).items():
		doc.set(k, cint(v))
	if cint(mark_held) and doc.status == "Scheduled" and getdate(doc.service_date) <= getdate(nowdate()):
		doc.status = "Held"
	doc.save()
	return {
		"name": doc.name,
		"total_attendance": doc.total_attendance,
		"present": doc.present_count,
		"rows": len(doc.attendance),
		"status": doc.status,
	}


@frappe.whitelist()
def my_chapel():
	"""Student portal: upcoming chapel services, the caller's chapel attendance this term and their ministries."""
	user = require_login()
	student = frappe.db.get_value("Student", {"user": user}, "name")
	if not student:
		frappe.throw(_("No student record is linked to your account."), frappe.PermissionError)
	return svc.student_chapel(student)


# ---------------------------------------------------------------------------------- ministry groups
@frappe.whitelist()
def list_ministry_groups(search=None, group_type=None, campus=None, is_active=None, start=0, page_length=50):
	require_roles(*CHAPEL_READ_ROLES)
	filters = {k: v for k, v in {"group_type": group_type, "campus": campus}.items() if v}
	if is_active not in (None, ""):
		filters["is_active"] = cint(is_active)
	out = _paged(
		"Ministry Group",
		[
			"name",
			"group_name",
			"group_type",
			"campus",
			"is_active",
			"patron",
			"leader",
			"meeting_day",
			"meeting_time",
		],
		filters,
		_like(search, ("group_name", "description")),
		order_by="group_name asc",
		start=start,
		page_length=page_length,
	)
	names = [g.name for g in out["data"]]
	counts = (
		{
			r.parent: cint(r.n)
			for r in frappe.get_all(
				"Ministry Group Member",
				filters={"parent": ["in", names], "parenttype": "Ministry Group"},
				fields=["parent", {"COUNT": "*", "as": "n"}],
				group_by="parent",
			)
		}
		if names
		else {}
	)
	leaders = [g.leader for g in out["data"] if g.leader]
	patrons = [g.patron for g in out["data"] if g.patron]
	leader_names = (
		dict(
			frappe.get_all(
				"Student", filters={"name": ["in", leaders]}, fields=["name", "full_name"], as_list=True
			)
		)
		if leaders
		else {}
	)
	patron_names = (
		dict(
			frappe.get_all(
				"Staff Member", filters={"name": ["in", patrons]}, fields=["name", "full_name"], as_list=True
			)
		)
		if patrons
		else {}
	)
	for g in out["data"]:
		g["members"] = counts.get(g.name, 0)
		g["leader_name"] = leader_names.get(g.leader)
		g["patron_name"] = patron_names.get(g.patron)
	return out


@frappe.whitelist()
def get_ministry_group(name: str):
	require_roles(*CHAPEL_READ_ROLES)
	doc = frappe.get_doc("Ministry Group", name)
	doc.check_permission("read")
	return doc.as_dict()


@frappe.whitelist(methods=["POST"])
def save_ministry_group(data):
	require_roles(ROLE_CHAPLAIN)
	doc = _upsert(
		"Ministry Group", data, MINISTRY_FIELDS, children={"members": ("student", "role", "joined_on")}
	)
	doc.save()
	return doc.as_dict()


# ---------------------------------------------------------------------------------- public church picklist
PUBLIC_CHURCH_FIELDS = ("name", "church_name", "denomination", "town", "county")
PUBLIC_CHURCH_MAX = 50


@frappe.whitelist(allow_guest=True, methods=["GET", "POST"])
@rate_limit(limit=120, seconds=10 * 60)
def partner_churches(search=None, limit=20):
	"""Active partner churches for public pick-lists (e.g. the applicant wizard); public fields only."""
	limit = min(max(cint(limit) or 20, 1), PUBLIC_CHURCH_MAX)
	search = cstr(search).strip()[:100]
	or_filters = None
	if search:
		like = f"%{search}%"
		or_filters = [
			[f, "like", like] for f in ("church_name", "town", "county", "denomination", "church_code")
		]
	return frappe.get_all(
		"Partner Church",
		filters={"partnership_status": "Active", "is_group": 0},
		or_filters=or_filters,
		fields=list(PUBLIC_CHURCH_FIELDS),
		order_by="church_name asc",
		limit=limit,
	)


# ---------------------------------------------------------------------------------- public online giving
MAX_ONLINE_GIFT = 250000


def _paybill() -> dict | None:
	"""PayBill/Till details for donors who prefer paying from the M-Pesa menu (null when M-Pesa is off)."""
	try:
		m = frappe.get_cached_doc("M-Pesa Settings")
	except Exception:
		return None
	if not cint(m.get("enabled")):
		return None
	if m.get("transaction_type") == "CustomerBuyGoodsOnline":
		return (
			{"type": "Till", "shortcode": m.get("till_number") or None, "account_hint": None}
			if m.get("till_number")
			else None
		)
	if not m.get("business_shortcode"):
		return None
	prefix = cstr(m.get("account_reference_prefix")).strip()
	return {
		"type": "PayBill",
		"shortcode": m.business_shortcode,
		"account_hint": f"{prefix}-GIVING" if prefix else "GIVING",
	}


@frappe.whitelist(allow_guest=True, methods=["GET", "POST"])
def giving_options():
	"""Giving types offered online (+ quick amounts), PayBill details and currency for the public /give page."""
	return {
		"types": svc.online_giving_types(),
		"paybill": _paybill(),
		"currency": setting("currency", "KES") or "KES",
	}


def _giver(anonymous: bool, full_name: str | None, email: str | None, sponsor: str | None) -> dict:
	user = frappe.session.user
	own_sponsor = (
		frappe.db.get_value("Sponsor", {"user": user}, ["name", "sponsor_name", "email"], as_dict=True)
		if user != "Guest"
		else None
	)
	if sponsor and not (own_sponsor and own_sponsor.name == sponsor):
		staff = user == "Administrator" or user_roles(user) & {"System Manager", ROLE_ADMIN, *CHURCH_ROLES}
		if not staff or not frappe.db.exists("Sponsor", sponsor):
			sponsor = None  # a guest cannot attribute a gift to somebody else's sponsor account
	elif own_sponsor and not anonymous:
		sponsor = own_sponsor.name
	full_name = " ".join(cstr(full_name).split())[:140] or None
	email = cstr(email).strip().lower()[:140] or None
	if email:
		validate_email_address(email, throw=True)
	if anonymous:
		return {"giver_type": "Anonymous", "giver_email": email}
	if sponsor:
		return {"giver_type": "Sponsor", "sponsor": sponsor, "giver_email": email}
	student = frappe.db.get_value("Student", {"user": user}, "name") if user != "Guest" else None
	if student:
		return {"giver_type": "Student", "student": student, "giver_email": email}
	if not full_name and user != "Guest":
		full_name = frappe.db.get_value("User", user, "full_name")
	if not full_name:
		frappe.throw(_("Please enter your name, or choose to give anonymously."))
	return {"giver_type": "Other", "giver_name": full_name, "giver_email": email}


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=5, seconds=10 * 60)
def give(
	giving_type, amount, phone, full_name=None, email=None, anonymous=0, sponsor=None, note=None, website=None
):
	"""Start an M-Pesa STK push for a gift. The Giving Record (and receipt) follows when the payment completes."""
	if website:  # honeypot
		return {"request": None, "checkout_request_id": None, "message": _("Thank you!")}
	options = {t.name for t in svc.online_giving_types()}
	if giving_type not in options:
		frappe.throw(_("Please choose what you are giving towards."))
	amount = flt(amount, 2)
	if amount <= 0:
		frappe.throw(_("Enter an amount greater than zero."))
	if amount > MAX_ONLINE_GIFT:
		frappe.throw(_("M-Pesa allows at most {0} per transaction.").format(f"KES {MAX_ONLINE_GIFT:,}"))
	if not svc.is_valid_msisdn(phone):
		frappe.throw(_("Enter a valid Safaricom M-Pesa number, e.g. 0712 345 678."))
	giver = _giver(bool(cint(anonymous)), full_name, email, sponsor)
	giver["purpose"] = " ".join(cstr(note).split())[:500] or None
	try:
		res = svc.start_online_giving(phone, amount, giving_type, giver)
	except (ImportError, NotImplementedError):
		frappe.throw(_("M-Pesa giving is not available right now. Please try again later."))
	return {
		"request": res.get("request"),
		"checkout_request_id": res.get("checkout_request_id"),
		"message": res.get("customer_message")
		or _("Check your phone and enter your M-Pesa PIN to complete the gift."),
		"simulation": bool(res.get("simulation")),
	}


GIVING_STATUS_MESSAGES = {
	"Initiated": "Waiting for you to confirm on your phone…",
	"Pending": "Waiting for you to confirm on your phone…",
	"Completed": "Thank you! Your gift has been received.",
	"Failed": "The payment did not go through. Please try again.",
	"Cancelled": "The payment was cancelled on the phone.",
	"Timeout": "The M-Pesa prompt timed out. Please try again.",
}


@frappe.whitelist(allow_guest=True, methods=["GET", "POST"])
@rate_limit(limit=120, seconds=10 * 60)
def giving_status(request, checkout_request_id=None):
	"""Guest-safe poll for a gift started with `give`: `{status, done, receipt, message}`.

	Only "Giving" requests are visible. The M-Pesa receipt is returned only to the caller who started the payment
	(pass the `checkout_request_id` returned by `give`, or be the logged-in initiator).
	"""
	request = cstr(request).strip()
	meta = (
		frappe.db.get_value(
			"M-Pesa Request", request, ["purpose", "checkout_request_id", "initiated_by"], as_dict=True
		)
		if request
		else None
	)
	if not meta or meta.purpose != "Giving":
		frappe.throw(_("Payment request not found."), frappe.DoesNotExistError)
	state = svc.giving_request_state(request) or {}
	if state.get("giving_record"):
		frappe.local.flags.commit = True
	owner = (checkout_request_id and checkout_request_id == meta.checkout_request_id) or (
		frappe.session.user != "Guest" and frappe.session.user == meta.initiated_by
	)
	status = state.get("status") or "Pending"
	return {
		"status": status,
		"done": status not in ("Initiated", "Pending"),
		"receipt": state.get("receipt") if owner else None,
		"message": _(GIVING_STATUS_MESSAGES.get(status, "Waiting for M-Pesa…")),
	}
