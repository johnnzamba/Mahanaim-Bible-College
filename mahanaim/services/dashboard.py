"""Admin dashboard, reports and global search (backend domain B4, M16 + M20).

All figures come from grouped queries (one query per metric, never per row). `overview(sections)` builds only the
sections the caller may see; the API caches it for 60 s per visible-section set.

Reports: `REPORTS` is the catalogue (key, label, category, roles, filters); `run(report, filters)` returns
`{"columns": [{key, label, type}], "rows": [...], "chart": {...}?, "summary": {...}?}`.
"""

from __future__ import annotations

from collections import defaultdict

import frappe
from frappe import _
from frappe.utils import add_days, add_months, cint, flt, get_first_day, getdate, now_datetime, nowdate

from mahanaim.utils import (
	ROLE_ADMIN,
	ROLE_ADMISSIONS,
	ROLE_AUDITOR,
	ROLE_CHAPLAIN,
	ROLE_COMMS,
	ROLE_DEAN,
	ROLE_FINANCE,
	ROLE_LIBRARY,
	ROLE_REGISTRAR,
	current_term,
	pct,
	user_roles,
)

ADMIN_ROLES = {"System Manager", ROLE_ADMIN}
ACTIVE_STUDENT = ("Registered", "Active")
CURRENT_STUDENT = ("Admitted", "Registered", "Active", "Deferred", "Suspended")
MAX_ROWS = 5000

SECTION_ROLES = {
	"admissions": {ROLE_ADMISSIONS, ROLE_REGISTRAR, ROLE_DEAN},
	"students": {ROLE_REGISTRAR, ROLE_DEAN, ROLE_ADMISSIONS, ROLE_FINANCE},
	"staff": {ROLE_REGISTRAR, ROLE_DEAN},
	"finance": {ROLE_FINANCE, ROLE_AUDITOR},
	"academics": {ROLE_REGISTRAR, ROLE_DEAN},
	"communications": {ROLE_COMMS, ROLE_ADMISSIONS},
	"library": {ROLE_LIBRARY},
	"church": {ROLE_CHAPLAIN, ROLE_FINANCE},
}
FINANCE_ROLES = {ROLE_FINANCE, ROLE_AUDITOR}
ACADEMIC_ROLES = {ROLE_DEAN, ROLE_REGISTRAR}
ADMISSION_ROLES = {ROLE_ADMISSIONS, ROLE_REGISTRAR, ROLE_DEAN}


# ---------------------------------------------------------------------------------- roles
def roles_of(user: str | None = None) -> set[str]:
	user = user or frappe.session.user
	roles = user_roles(user)
	if user == "Administrator":
		roles |= ADMIN_ROLES
	return roles


def is_admin(roles: set[str]) -> bool:
	return bool(roles & ADMIN_ROLES)


def visible_sections(roles: set[str]) -> list[str]:
	if is_admin(roles):
		return list(SECTION_ROLES)
	return [s for s, allowed in SECTION_ROLES.items() if roles & allowed]


def allowed(roles: set[str], needed: set[str]) -> bool:
	return is_admin(roles) or bool(roles & needed)


# ---------------------------------------------------------------------------------- helpers
def month_keys(months: int = 12) -> list[str]:
	start = get_first_day(add_months(getdate(nowdate()), -(months - 1)))
	return [add_months(start, i).strftime("%Y-%m") for i in range(months)]


def _count_by(doctype: str, field: str, filters: dict | None = None) -> dict:
	return {
		r.get(field): cint(r.n)
		for r in frappe.get_all(
			doctype, filters=filters or {}, fields=[field, {"COUNT": "*", "as": "n"}], group_by=field
		)
	}


def _sum(doctype: str, field: str, filters: dict) -> float:
	rows = frappe.get_all(doctype, filters=filters, fields=[{"SUM": field, "as": "total"}])
	return flt(rows[0].total) if rows else 0.0


def _names(doctype: str, names, field: str) -> dict:
	names = [n for n in set(names) if n]
	if not names:
		return {}
	return dict(
		frappe.get_all(doctype, filters={"name": ["in", names]}, fields=["name", field], as_list=True)
	)


def current_intake() -> str | None:
	name = frappe.db.get_value("Intake", {"applications_open": 1}, "name", order_by="start_date asc")
	if name:
		return name
	return frappe.db.get_value(
		"Intake", {"start_date": ["<=", add_days(nowdate(), 365)]}, "name", order_by="start_date desc"
	)


def term_window(term: str | None) -> tuple[str | None, str | None]:
	if not term:
		return None, None
	row = frappe.db.get_value("Academic Term", term, ["start_date", "end_date"], as_dict=True)
	return (row.start_date, row.end_date) if row else (None, None)


def _date_range(filters: dict, default_days: int | None = None) -> list | None:
	from_date, to_date = filters.get("from_date"), filters.get("to_date")
	if not from_date and default_days:
		from_date = add_days(nowdate(), -default_days)
	if from_date and to_date:
		return ["between", [getdate(from_date), getdate(to_date)]]
	if from_date:
		return [">=", getdate(from_date)]
	if to_date:
		return ["<=", getdate(to_date)]
	return None


def _monthly(doctype: str, date_field: str, value_field: str | None, filters_sql, months: list[str]) -> dict:
	from frappe.query_builder.functions import Count, DateFormat, Sum

	T = frappe.qb.DocType(doctype)
	month = DateFormat(T[date_field], "%Y-%m")
	agg = Sum(T[value_field]) if value_field else Count(T.name)
	q = frappe.qb.from_(T).select(month.as_("month"), agg.as_("v")).where(T[date_field] >= f"{months[0]}-01")
	for cond in filters_sql(T):
		q = q.where(cond)
	return {r.month: flt(r.v) for r in q.groupby(month).run(as_dict=True)}


# ---------------------------------------------------------------------------------- overview sections
def _admissions_section() -> dict:
	intake = current_intake()
	filters = {"intake": intake} if intake else {}
	by_status = _count_by("Programme Application", "status", filters)
	week_ago = add_days(now_datetime(), -7)
	return {
		"intake": intake,
		"applications_by_status": by_status,
		"applications_total": sum(by_status.values()),
		"new_applications_7d": frappe.db.count("Programme Application", {"creation": [">=", week_ago]}),
		"submitted_7d": frappe.db.count("Programme Application", {"submitted_on": [">=", week_ago]}),
		"awaiting_review": sum(by_status.get(s, 0) for s in ("Submitted", "Under Review")),
		"funnel": funnel(by_status),
	}


def funnel(by_status: dict) -> list[dict]:
	reviewed = ("Under Review", "Interview", "Admitted", "Waitlisted", "Rejected", "Accepted", "Declined")
	stages = [
		(_("Started"), sum(by_status.values())),
		(_("Submitted"), sum(v for k, v in by_status.items() if k not in ("Draft", "Withdrawn"))),
		(_("Reviewed"), sum(by_status.get(s, 0) for s in reviewed)),
		(_("Admitted"), sum(by_status.get(s, 0) for s in ("Admitted", "Accepted", "Declined"))),
		(_("Accepted"), by_status.get("Accepted", 0)),
	]
	top = stages[0][1]
	return [{"stage": label, "count": n, "pct": pct(n, top)} for label, n in stages]


def _students_section() -> dict:
	active = {"status": ["in", ACTIVE_STUDENT]}
	programmes = frappe.get_all(
		"Student",
		filters=active,
		fields=["programme", "programme_name", {"COUNT": "*", "as": "n"}],
		group_by="programme, programme_name",
		order_by="n desc",
	)
	by_campus = _count_by("Student", "campus", active)
	campus_names = _names("Campus", by_campus, "campus_name")
	return {
		"active_students": sum(cint(p.n) for p in programmes),
		"by_status": _count_by("Student", "status"),
		"by_programme": [
			{"programme": p.programme, "label": p.programme_name or p.programme, "count": cint(p.n)}
			for p in programmes
		],
		"by_campus": [
			{"campus": c, "label": campus_names.get(c, c), "count": n} for c, n in by_campus.items()
		],
		"by_study_mode": [
			{"study_mode": m, "count": n} for m, n in _count_by("Student", "study_mode", active).items()
		],
		"enrolment_trend": enrolment_trend(),
	}


def enrolment_trend() -> list[dict]:
	rows = _count_by("Student", "intake", {"intake": ["is", "set"], "status": ["not in", ["Applicant"]]})
	starts = (
		dict(
			frappe.get_all(
				"Intake", filters={"name": ["in", list(rows)]}, fields=["name", "start_date"], as_list=True
			)
		)
		if rows
		else {}
	)
	return [{"intake": i, "count": rows[i]} for i in sorted(rows, key=lambda i: str(starts.get(i) or i))]


def _staff_section() -> dict:
	by_type = _count_by("Staff Member", "staff_type", {"status": "Active"})
	return {
		"staff": sum(by_type.values()),
		"lecturers": frappe.db.count("Staff Member", {"status": "Active", "is_lecturer": 1}),
		"by_type": by_type,
		"on_leave": frappe.db.count("Staff Member", {"status": "On Leave"}),
	}


def _finance_section() -> dict:
	term = current_term()
	billed = frappe.get_all(
		"Student Invoice",
		filters={"docstatus": 1, "academic_term": term} if term else {"docstatus": 1},
		fields=[
			{"SUM": "total_amount", "as": "billed"},
			{"SUM": "paid_amount", "as": "paid"},
			{"SUM": "outstanding_amount", "as": "outstanding"},
		],
	)[0]
	months = month_keys(12)
	collections = _monthly("Student Payment", "posting_date", "amount", lambda T: [T.docstatus == 1], months)
	return {
		"term": term,
		"billed_this_term": flt(billed.billed),
		"collected_this_term": flt(billed.paid),
		"collection_rate": pct(billed.paid, billed.billed),
		"outstanding_this_term": flt(billed.outstanding),
		"outstanding_total": _sum("Student Invoice", "outstanding_amount", {"docstatus": 1}),
		"overdue_invoices": frappe.db.count("Student Invoice", {"docstatus": 1, "status": "Overdue"}),
		"collections_today": _sum("Student Payment", "amount", {"docstatus": 1, "posting_date": nowdate()}),
		"collections_month": collections.get(months[-1], 0.0),
		"unmatched_mpesa": frappe.db.count("M-Pesa Transaction", {"status": "Unmatched"}),
		"collections_12m": [{"month": m, "amount": collections.get(m, 0.0)} for m in months],
	}


def _academics_section() -> dict:
	today = getdate(nowdate())
	week_start = add_days(today, -today.weekday())
	week_end = add_days(week_start, 7)
	term = current_term()
	lms = _count_by(
		"Course Offering",
		"lms_sync_status",
		{"academic_term": term, "status": ["!=", "Cancelled"]} if term else {"status": ["!=", "Cancelled"]},
	)
	return {
		"term": term,
		"exams_this_week": frappe.db.count(
			"Exam",
			{"start_datetime": ["between", [week_start, week_end]], "status": ["in", ["Scheduled", "Open"]]},
		),
		"exams_open_now": frappe.db.count("Exam", {"status": "Open"}),
		"mark_sheets_pending_approval": frappe.db.count("Mark Sheet", {"status": "Submitted"}),
		"mark_sheets_by_status": _count_by("Mark Sheet", "status", {"academic_term": term} if term else {}),
		"offerings_this_term": sum(lms.values()),
		"lms_sync": {
			"synced": lms.get("Synced", 0),
			"not_synced": lms.get("Not Synced", 0),
			"error": lms.get("Error", 0),
			"health_pct": pct(lms.get("Synced", 0), sum(lms.values())),
		},
		"pending_requests": frappe.db.count(
			"Student Request", {"status": ["in", ["Pending", "Under Review"]]}
		),
	}


def _communications_section() -> dict:
	week_ago = add_days(now_datetime(), -7)
	return {
		"unread_enquiries": frappe.db.count("Contact Enquiry", {"status": "New"}),
		"open_enquiries": frappe.db.count("Contact Enquiry", {"status": ["in", ["New", "In Progress"]]}),
		"messages_7d": _count_by("Message Log", "status", {"creation": [">=", week_ago]}),
		"failed_sms_7d": frappe.db.count(
			"Message Log", {"channel": "SMS", "status": "Failed", "creation": [">=", week_ago]}
		),
		"scheduled_announcements": frappe.db.count("Announcement", {"status": "Scheduled"}),
		"upcoming_events": frappe.db.count("Campus Event", {"status": "Upcoming"}),
	}


def _library_section() -> dict:
	loans = _count_by("Library Loan", "status")
	return {
		"items": frappe.db.count("Library Item", {"is_active": 1}),
		"on_loan": loans.get("Issued", 0) + loans.get("Overdue", 0),
		"overdue": loans.get("Overdue", 0),
		"requests": loans.get("Requested", 0),
	}


def _church_section() -> dict:
	month_start = get_first_day(nowdate())
	return {
		"partner_churches": frappe.db.count(
			"Partner Church", {"is_group": 0, "partnership_status": "Active"}
		),
		"active_sponsorships": frappe.db.count("Sponsorship", {"status": "Active"}),
		"sponsored_students": len(
			frappe.get_all("Sponsorship", filters={"status": "Active"}, pluck="student", distinct=True)
		),
		"giving_this_month": _sum(
			"Giving Record", "amount", {"docstatus": 1, "posting_date": [">=", month_start]}
		),
	}


SECTION_BUILDERS = {
	"admissions": _admissions_section,
	"students": _students_section,
	"staff": _staff_section,
	"finance": _finance_section,
	"academics": _academics_section,
	"communications": _communications_section,
	"library": _library_section,
	"church": _church_section,
}

ACTIVITY_ROUTES = {
	"Student": "/admin/students/{}",
	"Programme Application": "/admin/admissions/{}",
	"Student Invoice": "/admin/finance/invoices/{}",
	"Student Payment": "/admin/finance/payments/{}",
	"Course Offering": "/admin/academics/offerings/{}",
	"Mark Sheet": "/admin/academics/mark-sheets/{}",
	"Student Request": "/admin/students/requests/{}",
	"Sponsor": "/admin/church/sponsors/{}",
	"Staff Member": "/admin/staff/{}",
}
ACTIVITY_SECTIONS = {
	"Student": "students",
	"Programme Application": "admissions",
	"Student Request": "students",
	"Student Invoice": "finance",
	"Student Payment": "finance",
	"Mark Sheet": "academics",
	"Course Offering": "academics",
	"Exam": "academics",
	"Semester Registration": "students",
	"Refund Request": "finance",
}


def route_for(doctype: str, name: str) -> str | None:
	pattern = ACTIVITY_ROUTES.get(doctype)
	return pattern.format(name) if pattern else None


def activity_feed(sections: list[str], limit: int = 15) -> list[dict]:
	"""Latest status changes (Mahanaim Status Log) + new payments + new applications, newest first."""
	SL = frappe.qb.DocType("Mahanaim Status Log")
	doctypes = [d for d, s in ACTIVITY_SECTIONS.items() if s in sections]
	items = []
	if doctypes:
		rows = (
			frappe.qb.from_(SL)
			.select(SL.parenttype, SL.parent, SL.from_status, SL.to_status, SL.note, SL.user, SL.timestamp)
			.where(SL.parenttype.isin(doctypes))
			.orderby(SL.timestamp, order=frappe.qb.desc)
			.limit(limit)
			.run(as_dict=True)
		)
		for r in rows:
			items.append(
				{
					"kind": "status",
					"doctype": r.parenttype,
					"name": r.parent,
					"title": _("{0} {1}: {2}").format(
						_(r.parenttype),
						r.parent,
						f"{r.from_status} → {r.to_status}" if r.from_status else r.to_status,
					),
					"note": r.note,
					"user": r.user,
					"timestamp": r.timestamp,
					"route": route_for(r.parenttype, r.parent),
				}
			)
	if "finance" in sections:
		for p in frappe.get_all(
			"Student Payment",
			filters={"docstatus": 1},
			fields=["name", "payer_name", "amount", "mode_of_payment", "creation", "owner"],
			order_by="creation desc",
			limit_page_length=limit,
		):
			items.append(
				{
					"kind": "payment",
					"doctype": "Student Payment",
					"name": p.name,
					"title": _("Payment {0} from {1}").format(
						f"KES {flt(p.amount):,.2f}", p.payer_name or p.name
					),
					"note": p.mode_of_payment,
					"user": p.owner,
					"timestamp": p.creation,
					"route": route_for("Student Payment", p.name),
				}
			)
	if "admissions" in sections:
		for a in frappe.get_all(
			"Programme Application",
			filters={"status": ["!=", "Draft"]},
			fields=["name", "full_name", "programme", "submitted_on", "creation", "owner"],
			order_by="creation desc",
			limit_page_length=limit,
		):
			items.append(
				{
					"kind": "application",
					"doctype": "Programme Application",
					"name": a.name,
					"title": _("New application: {0} ({1})").format(a.full_name, a.programme),
					"note": None,
					"user": a.owner,
					"timestamp": a.submitted_on or a.creation,
					"route": route_for("Programme Application", a.name),
				}
			)
	items.sort(key=lambda x: str(x["timestamp"] or ""), reverse=True)
	return items[:limit]


def overview(sections: list[str]) -> dict:
	out = {"sections": sections, "generated_on": now_datetime(), "term": current_term()}
	for key in sections:
		try:
			out[key] = SECTION_BUILDERS[key]()
		except Exception:
			frappe.log_error(title=f"Dashboard section {key} failed")
			out[key] = None
	out["kpis"] = kpi_cards(out)
	out["charts"] = charts(out)
	out["activity"] = activity_feed(sections)
	return out


def kpi_cards(data: dict) -> list[dict]:
	cards = []

	def add(key, label, value, fmt="number", route=None, section=None):
		cards.append(
			{"key": key, "label": label, "value": value, "format": fmt, "route": route, "section": section}
		)

	if data.get("admissions"):
		a = data["admissions"]
		add(
			"applications",
			_("Applications this intake"),
			a["applications_total"],
			route="/admin/admissions",
			section="admissions",
		)
		add(
			"new_applications_7d",
			_("New applications (7 days)"),
			a["new_applications_7d"],
			route="/admin/admissions",
			section="admissions",
		)
	if data.get("students"):
		add(
			"active_students",
			_("Active students"),
			data["students"]["active_students"],
			route="/admin/students",
			section="students",
		)
	if data.get("staff"):
		add("staff", _("Staff"), data["staff"]["staff"], route="/admin/staff", section="staff")
		add("lecturers", _("Lecturers"), data["staff"]["lecturers"], route="/admin/staff", section="staff")
	if data.get("finance"):
		f = data["finance"]
		add("billed", _("Billed this term"), f["billed_this_term"], "currency", "/admin/finance", "finance")
		add(
			"collected",
			_("Collected this term"),
			f["collected_this_term"],
			"currency",
			"/admin/finance",
			"finance",
		)
		add(
			"outstanding",
			_("Outstanding balances"),
			f["outstanding_total"],
			"currency",
			"/admin/finance",
			"finance",
		)
		add(
			"collections_today",
			_("Collections today"),
			f["collections_today"],
			"currency",
			"/admin/finance",
			"finance",
		)
		add(
			"unmatched_mpesa",
			_("Unmatched M-Pesa"),
			f["unmatched_mpesa"],
			route="/admin/finance/mpesa",
			section="finance",
		)
	if data.get("academics"):
		ac = data["academics"]
		add(
			"exams_this_week",
			_("Exams this week"),
			ac["exams_this_week"],
			route="/admin/academics/exams",
			section="academics",
		)
		add(
			"mark_sheets_pending",
			_("Mark sheets awaiting approval"),
			ac["mark_sheets_pending_approval"],
			route="/admin/academics/results",
			section="academics",
		)
		add(
			"lms_health",
			_("LMS sync health"),
			ac["lms_sync"]["health_pct"],
			"percent",
			"/admin/academics",
			"academics",
		)
	if data.get("communications"):
		add(
			"unread_enquiries",
			_("Unread enquiries"),
			data["communications"]["unread_enquiries"],
			route="/admin/website/enquiries",
			section="communications",
		)
	if data.get("library"):
		add(
			"overdue_loans",
			_("Overdue library loans"),
			data["library"]["overdue"],
			route="/admin/library",
			section="library",
		)
	if data.get("church"):
		add(
			"active_sponsorships",
			_("Active sponsorships"),
			data["church"]["active_sponsorships"],
			route="/admin/church",
			section="church",
		)
	return cards


def charts(data: dict) -> dict:
	out = {}
	if data.get("students"):
		trend = data["students"]["enrolment_trend"]
		out["enrolment_trend"] = {
			"type": "bar",
			"labels": [r["intake"] for r in trend],
			"datasets": [{"name": _("Students"), "values": [r["count"] for r in trend]}],
		}
	if data.get("finance"):
		c = data["finance"]["collections_12m"]
		out["collections"] = {
			"type": "line",
			"labels": [r["month"] for r in c],
			"datasets": [{"name": _("Collections"), "values": [r["amount"] for r in c]}],
		}
	if data.get("admissions"):
		f = data["admissions"]["funnel"]
		out["applications_funnel"] = {
			"type": "funnel",
			"labels": [r["stage"] for r in f],
			"datasets": [{"name": _("Applications"), "values": [r["count"] for r in f]}],
		}
	return out


# ---------------------------------------------------------------------------------- reports
def _col(key, label, type_="Data"):
	return {"key": key, "label": label, "type": type_}


def _f(key, label, type_="Data", options=None, default=None):
	"""Report filter spec. `default` may be a value or a zero-argument callable resolved per request."""
	return {"key": key, "label": label, "type": type_, "options": options, "default": default}


def _with_default(filter_: dict, default) -> dict:
	return {**filter_, "default": default}


def _days_ago(days: int):
	return lambda: str(add_days(getdate(nowdate()), -days))


def _today() -> str:
	return str(getdate(nowdate()))


def _giving_window_start() -> str:
	return str(get_first_day(add_months(getdate(nowdate()), -11)))


def _current_term() -> str | None:
	return current_term()


def _resolve_default(default):
	value = default() if callable(default) else default
	return None if value in (None, "", []) else value


F_PROGRAMME = _f("programme", "Programme", "Link", "Programme")
F_CAMPUS = _f("campus", "Campus", "Link", "Campus")
F_TERM = _f("academic_term", "Academic Term", "Link", "Academic Term")
F_INTAKE = _f("intake", "Intake", "Link", "Intake")
F_FROM = _f("from_date", "From Date", "Date")
F_TO = _f("to_date", "To Date", "Date")
F_FROM_30 = _with_default(F_FROM, _days_ago(30))
F_TERM_CURRENT = _with_default(F_TERM, _current_term)


def _apply(filters: dict, src: dict, keys: tuple[str, ...]):
	for k in keys:
		if src.get(k):
			filters[k] = src[k]
	return filters


def r_enrolment_by_programme(f: dict) -> dict:
	filters = _apply({}, f, ("campus", "study_mode", "intake"))
	rows = frappe.get_all(
		"Student",
		filters=filters,
		fields=["programme", "programme_name", "status", {"COUNT": "*", "as": "n"}],
		group_by="programme, programme_name, status",
	)
	statuses = (
		"Admitted",
		"Registered",
		"Active",
		"Deferred",
		"Suspended",
		"Withdrawn",
		"Completed",
		"Alumni",
	)
	pivot = {}
	for r in rows:
		row = pivot.setdefault(
			r.programme,
			{
				"programme": r.programme,
				"programme_name": r.programme_name,
				**{s.lower(): 0 for s in statuses},
				"total": 0,
			},
		)
		if (r.status or "").lower() in row:
			row[r.status.lower()] += cint(r.n)
		row["total"] += cint(r.n)
	data = sorted(pivot.values(), key=lambda r: -r["total"])
	for r in data:
		r["current"] = r["registered"] + r["active"]
	return {
		"columns": [
			_col("programme", _("Programme"), "Link"),
			_col("programme_name", _("Name")),
			*[_col(s.lower(), _(s), "Int") for s in statuses],
			_col("current", _("Current"), "Int"),
			_col("total", _("Total"), "Int"),
		],
		"rows": data,
		"chart": {
			"type": "bar",
			"labels": [r["programme"] for r in data],
			"datasets": [{"name": _("Current students"), "values": [r["current"] for r in data]}],
		},
	}


def r_admissions_funnel(f: dict) -> dict:
	filters = _apply({}, f, ("intake", "campus", "programme"))
	rows = frappe.get_all(
		"Programme Application",
		filters=filters,
		fields=["programme", "status", {"COUNT": "*", "as": "n"}],
		group_by="programme, status",
	)
	per = defaultdict(dict)
	total = defaultdict(int)
	for r in rows:
		per[r.programme][r.status] = cint(r.n)
		total[r.status] += cint(r.n)
	data = []
	for programme, by_status in sorted(per.items()):
		stages = {s["stage"]: s["count"] for s in funnel(by_status)}
		data.append(
			{
				"programme": programme,
				**{k.lower(): v for k, v in stages.items()},
				"rejected": by_status.get("Rejected", 0),
				"withdrawn": by_status.get("Withdrawn", 0),
				"conversion": pct(by_status.get("Accepted", 0), stages[_("Submitted")]),
			}
		)
	overall = funnel(dict(total))
	labels = [s["stage"] for s in overall]
	return {
		"columns": [
			_col("programme", _("Programme"), "Link"),
			*[_col(label.lower(), label, "Int") for label in labels],
			_col("rejected", _("Rejected"), "Int"),
			_col("withdrawn", _("Withdrawn"), "Int"),
			_col("conversion", _("Conversion %"), "Percent"),
		],
		"rows": data,
		"chart": {
			"type": "funnel",
			"labels": labels,
			"datasets": [{"name": _("Applications"), "values": [s["count"] for s in overall]}],
		},
		"summary": {"stages": overall},
	}


def r_applications_list(f: dict) -> dict:
	filters = _apply({}, f, ("intake", "campus", "programme", "status", "study_mode"))
	dr = _date_range(f)
	if dr:
		filters["creation"] = dr
	cols = [
		"name",
		"full_name",
		"email",
		"phone",
		"programme",
		"campus",
		"study_mode",
		"intake",
		"status",
		"fee_status",
		"sponsorship_type",
		"submitted_on",
	]
	rows = frappe.get_all(
		"Programme Application",
		filters=filters,
		fields=cols,
		order_by="creation desc",
		limit_page_length=MAX_ROWS,
	)
	return {
		"columns": [
			_col("name", _("Application"), "Link"),
			_col("full_name", _("Applicant")),
			_col("email", _("Email")),
			_col("phone", _("Phone")),
			_col("programme", _("Programme"), "Link"),
			_col("campus", _("Campus"), "Link"),
			_col("study_mode", _("Study Mode")),
			_col("intake", _("Intake")),
			_col("status", _("Status")),
			_col("fee_status", _("Fee")),
			_col("sponsorship_type", _("Funding")),
			_col("submitted_on", _("Submitted"), "Datetime"),
		],
		"rows": rows,
		"summary": {
			"total": len(rows),
			"by_status": dict(_count_by("Programme Application", "status", filters)),
		},
	}


def r_student_list(f: dict) -> dict:
	filters = _apply(
		{}, f, ("programme", "campus", "study_mode", "intake", "year_of_study", "partner_church")
	)
	filters["status"] = f.get("status") or ["in", list(CURRENT_STUDENT)]
	cols = [
		"name",
		"student_number",
		"full_name",
		"email",
		"phone",
		"programme",
		"campus",
		"study_mode",
		"year_of_study",
		"status",
		"cgpa",
		"fee_balance",
		"primary_sponsor",
	]
	rows = frappe.get_all(
		"Student", filters=filters, fields=cols, order_by="full_name asc", limit_page_length=MAX_ROWS
	)
	return {
		"columns": [
			_col("student_number", _("Student No.")),
			_col("full_name", _("Name")),
			_col("email", _("Email")),
			_col("phone", _("Phone")),
			_col("programme", _("Programme"), "Link"),
			_col("campus", _("Campus"), "Link"),
			_col("study_mode", _("Mode")),
			_col("year_of_study", _("Year"), "Int"),
			_col("status", _("Status")),
			_col("cgpa", _("CGPA"), "Float"),
			_col("fee_balance", _("Balance"), "Currency"),
			_col("primary_sponsor", _("Sponsor"), "Link"),
		],
		"rows": rows,
		"summary": {"total": len(rows)},
	}


def r_fee_collections(f: dict) -> dict:
	filters = {"docstatus": 1}
	dr = _date_range(f, default_days=30)
	if dr:
		filters["posting_date"] = dr
	_apply(filters, f, ("mode_of_payment", "payment_for", "student"))
	rows = frappe.get_all(
		"Student Payment",
		filters=filters,
		fields=[
			"name",
			"posting_date",
			"student",
			"payer_name",
			"payment_for",
			"mode_of_payment",
			"reference_no",
			"sponsor",
			"amount",
		],
		order_by="posting_date desc, creation desc",
		limit_page_length=MAX_ROWS,
	)
	by_day, by_mode = defaultdict(float), defaultdict(float)
	for r in rows:
		by_day[str(r.posting_date)] += flt(r.amount)
		by_mode[r.mode_of_payment] += flt(r.amount)
	days = sorted(by_day)
	return {
		"columns": [
			_col("name", _("Receipt"), "Link"),
			_col("posting_date", _("Date"), "Date"),
			_col("student", _("Student"), "Link"),
			_col("payer_name", _("Payer")),
			_col("payment_for", _("For")),
			_col("mode_of_payment", _("Mode")),
			_col("reference_no", _("Reference")),
			_col("sponsor", _("Sponsor"), "Link"),
			_col("amount", _("Amount"), "Currency"),
		],
		"rows": rows,
		"chart": {
			"type": "bar",
			"labels": days,
			"datasets": [{"name": _("Collected"), "values": [by_day[d] for d in days]}],
		},
		"summary": {
			"total": sum(by_day.values()),
			"count": len(rows),
			"by_mode": [{"mode": k, "amount": v} for k, v in sorted(by_mode.items(), key=lambda x: -x[1])],
		},
	}


def _student_balances(students=None) -> dict:
	try:
		from mahanaim.services.fees import get_balances

		return get_balances(students)
	except Exception:
		filters = {"fee_balance": ["!=", 0]}
		if students is not None:
			filters["name"] = ["in", students]
		return dict(frappe.get_all("Student", filters=filters, fields=["name", "fee_balance"], as_list=True))


def r_outstanding_balances(f: dict) -> dict:
	balances = {s: b for s, b in _student_balances().items() if flt(b) > max(flt(f.get("min_balance")), 0)}
	filters = _apply({"name": ["in", list(balances) or ["__none__"]]}, f, ("programme", "campus", "status"))
	students = frappe.get_all(
		"Student",
		filters=filters,
		fields=[
			"name",
			"student_number",
			"full_name",
			"programme",
			"campus",
			"phone",
			"status",
			"primary_sponsor",
		],
	)
	rows = sorted(({**s, "balance": flt(balances[s.name])} for s in students), key=lambda r: -r["balance"])
	return {
		"columns": [
			_col("student_number", _("Student No.")),
			_col("full_name", _("Name")),
			_col("programme", _("Programme"), "Link"),
			_col("campus", _("Campus"), "Link"),
			_col("phone", _("Phone")),
			_col("status", _("Status")),
			_col("primary_sponsor", _("Sponsor"), "Link"),
			_col("balance", _("Balance"), "Currency"),
		],
		"rows": rows[:MAX_ROWS],
		"summary": {"students": len(rows), "total": sum(r["balance"] for r in rows)},
	}


AGING_BUCKETS = (
	("not_due", "Not yet due"),
	("d0_30", "1-30 days"),
	("d31_60", "31-60 days"),
	("d61_90", "61-90 days"),
	("d90_plus", "90+ days"),
)


def r_aging(f: dict) -> dict:
	as_of = getdate(f.get("as_of") or nowdate())
	filters = _apply(
		{"docstatus": 1, "outstanding_amount": [">", 0]}, f, ("programme", "campus", "academic_term")
	)
	invoices = frappe.get_all(
		"Student Invoice",
		filters=filters,
		fields=[
			"student",
			"student_name",
			"programme",
			"campus",
			"due_date",
			"posting_date",
			"outstanding_amount",
		],
		limit_page_length=0,
	)
	per = {}
	for inv in invoices:
		row = per.setdefault(
			inv.student,
			{
				"student": inv.student,
				"student_name": inv.student_name,
				"programme": inv.programme,
				"campus": inv.campus,
				**{k: 0.0 for k, _l in AGING_BUCKETS},
				"total": 0.0,
			},
		)
		days = (as_of - getdate(inv.due_date or inv.posting_date)).days
		key = (
			"not_due"
			if days <= 0
			else "d0_30"
			if days <= 30
			else "d31_60"
			if days <= 60
			else "d61_90"
			if days <= 90
			else "d90_plus"
		)
		row[key] += flt(inv.outstanding_amount)
		row["total"] += flt(inv.outstanding_amount)
	rows = sorted(per.values(), key=lambda r: -r["total"])
	totals = {k: sum(r[k] for r in rows) for k, _l in AGING_BUCKETS}
	return {
		"columns": [
			_col("student", _("Student"), "Link"),
			_col("student_name", _("Name")),
			_col("programme", _("Programme"), "Link"),
			_col("campus", _("Campus"), "Link"),
			*[_col(k, _(label), "Currency") for k, label in AGING_BUCKETS],
			_col("total", _("Total"), "Currency"),
		],
		"rows": rows[:MAX_ROWS],
		"chart": {
			"type": "bar",
			"labels": [_(label) for _k, label in AGING_BUCKETS],
			"datasets": [{"name": _("Outstanding"), "values": [totals[k] for k, _l in AGING_BUCKETS]}],
		},
		"summary": {"as_of": as_of, "total": sum(totals.values()), **totals},
	}


def r_results_summary(f: dict) -> dict:
	filters = _apply({"is_published": 1}, f, ("academic_term", "programme"))
	rows = frappe.get_all(
		"Course Result",
		filters=filters,
		fields=[
			"programme",
			"academic_term",
			"grade",
			{"COUNT": "*", "as": "n"},
			{"AVG": "grade_points", "as": "gp"},
		],
		group_by="programme, academic_term, grade",
	)
	grades = sorted({r.grade for r in rows if r.grade})
	per, overall = {}, defaultdict(int)
	for r in rows:
		key = (r.programme, r.academic_term)
		row = per.setdefault(
			key,
			{
				"programme": r.programme,
				"academic_term": r.academic_term,
				"results": 0,
				"_gp": 0.0,
				**{f"g_{g}": 0 for g in grades},
			},
		)
		row["results"] += cint(r.n)
		row["_gp"] += flt(r.gp) * cint(r.n)
		if r.grade:
			row[f"g_{r.grade}"] += cint(r.n)
			overall[r.grade] += cint(r.n)
	data = []
	for row in sorted(per.values(), key=lambda r: (r["academic_term"] or "", r["programme"] or "")):
		row["mean_grade_points"] = round(row.pop("_gp") / row["results"], 2) if row["results"] else 0
		data.append(row)
	return {
		"columns": [
			_col("programme", _("Programme"), "Link"),
			_col("academic_term", _("Term"), "Link"),
			_col("results", _("Results"), "Int"),
			_col("mean_grade_points", _("Mean GP"), "Float"),
			*[_col(f"g_{g}", g, "Int") for g in grades],
		],
		"rows": data,
		"chart": {
			"type": "bar",
			"labels": grades,
			"datasets": [{"name": _("Results"), "values": [overall[g] for g in grades]}],
		},
	}


def r_pass_rates_by_course(f: dict) -> dict:
	filters = _apply({"is_published": 1}, f, ("academic_term", "programme", "course"))
	rows = frappe.get_all(
		"Course Result",
		filters=filters,
		fields=[
			"course",
			"course_title",
			"academic_term",
			"result_status",
			{"COUNT": "*", "as": "n"},
			{"AVG": "total_score", "as": "avg"},
		],
		group_by="course, course_title, academic_term, result_status",
	)
	per = {}
	for r in rows:
		row = per.setdefault(
			(r.course, r.academic_term),
			{
				"course": r.course,
				"course_title": r.course_title,
				"academic_term": r.academic_term,
				"sat": 0,
				"passed": 0,
				"failed": 0,
				"other": 0,
				"_score": 0.0,
			},
		)
		n = cint(r.n)
		row["sat"] += n
		row["_score"] += flt(r.avg) * n
		bucket = {"Pass": "passed", "Fail": "failed"}.get(r.result_status, "other")
		row[bucket] += n
	data = []
	for row in per.values():
		row["average_score"] = round(row.pop("_score") / row["sat"], 1) if row["sat"] else 0
		row["pass_rate"] = pct(row["passed"], row["sat"])
		data.append(row)
	data.sort(key=lambda r: (r["pass_rate"], r["course"] or ""))
	return {
		"columns": [
			_col("course", _("Course"), "Link"),
			_col("course_title", _("Title")),
			_col("academic_term", _("Term"), "Link"),
			_col("sat", _("Sat"), "Int"),
			_col("passed", _("Passed"), "Int"),
			_col("failed", _("Failed"), "Int"),
			_col("other", _("Other"), "Int"),
			_col("average_score", _("Avg score"), "Float"),
			_col("pass_rate", _("Pass rate %"), "Percent"),
		],
		"rows": data,
		"chart": {
			"type": "bar",
			"labels": [r["course"] for r in data],
			"datasets": [{"name": _("Pass rate %"), "values": [r["pass_rate"] for r in data]}],
		},
	}


def r_attendance_summary(f: dict) -> dict:
	from frappe.query_builder.functions import Count

	CA, CS, CO = (frappe.qb.DocType(d) for d in ("Class Attendance", "Class Session", "Course Offering"))
	q = (
		frappe.qb.from_(CA)
		.join(CS)
		.on((CA.parent == CS.name) & (CA.parenttype == "Class Session"))
		.join(CO)
		.on(CO.name == CS.course_offering)
		.select(
			CS.course_offering,
			CO.course_title,
			CO.campus,
			CO.academic_term,
			CA.status,
			Count(CA.name).as_("n"),
		)
		.where(CS.status != "Cancelled")
		.groupby(CS.course_offering, CO.course_title, CO.campus, CO.academic_term, CA.status)
	)
	term = f.get("academic_term") or current_term()
	if term:
		q = q.where(CO.academic_term == term)
	if f.get("campus"):
		q = q.where(CO.campus == f["campus"])
	if f.get("course_offering"):
		q = q.where(CS.course_offering == f["course_offering"])
	sessions = _count_by(
		"Class Session", "course_offering", {"attendance_taken": 1, "status": ["!=", "Cancelled"]}
	)
	per = {}
	for r in q.run(as_dict=True):
		row = per.setdefault(
			r.course_offering,
			{
				"course_offering": r.course_offering,
				"course_title": r.course_title,
				"campus": r.campus,
				"academic_term": r.academic_term,
				"sessions": sessions.get(r.course_offering, 0),
				"present": 0,
				"late": 0,
				"absent": 0,
				"excused": 0,
			},
		)
		key = (r.status or "").lower()
		if key in row:
			row[key] += cint(r.n)
	data = []
	for row in per.values():
		counted = row["present"] + row["late"] + row["absent"]
		row["attendance_rate"] = pct(row["present"] + row["late"], counted)
		data.append(row)
	data.sort(key=lambda r: r["attendance_rate"])
	return {
		"columns": [
			_col("course_offering", _("Offering"), "Link"),
			_col("course_title", _("Course")),
			_col("campus", _("Campus"), "Link"),
			_col("academic_term", _("Term"), "Link"),
			_col("sessions", _("Sessions"), "Int"),
			_col("present", _("Present"), "Int"),
			_col("late", _("Late"), "Int"),
			_col("absent", _("Absent"), "Int"),
			_col("excused", _("Excused"), "Int"),
			_col("attendance_rate", _("Rate %"), "Percent"),
		],
		"rows": data,
		"chart": {
			"type": "bar",
			"labels": [r["course_title"] for r in data],
			"datasets": [{"name": _("Attendance %"), "values": [r["attendance_rate"] for r in data]}],
		},
		"summary": {"term": term},
	}


def r_lms_engagement(f: dict) -> dict:
	term = f.get("academic_term") or current_term()
	off_filters = _apply({"status": ["!=", "Cancelled"]}, f, ("campus",))
	if term:
		off_filters["academic_term"] = term
	if f.get("course_offering"):
		off_filters["name"] = f["course_offering"]
	offerings = frappe.get_all(
		"Course Offering",
		filters=off_filters,
		fields=["name", "course_title", "campus", "enrolled_count", "lms_sync_status"],
	)
	names = [o.name for o in offerings] or ["__none__"]
	resources = _count_by(
		"Learning Resource", "course_offering", {"course_offering": ["in", names], "is_published": 1}
	)
	progress = frappe.get_all(
		"Learning Progress",
		filters={"course_offering": ["in", names]},
		fields=["course_offering", "status", {"COUNT": "*", "as": "n"}, {"AVG": "progress", "as": "avg"}],
		group_by="course_offering, status",
	)
	learners = defaultdict(int)
	for r in frappe.get_all(
		"Learning Progress",
		filters={"course_offering": ["in", names]},
		fields=["course_offering", "student"],
		group_by="course_offering, student",
	):
		learners[r.course_offering] += 1
	per = defaultdict(lambda: {"completed": 0, "in_progress": 0, "not_started": 0, "_p": 0.0, "_n": 0})
	for r in progress:
		row = per[r.course_offering]
		key = (r.status or "").lower().replace(" ", "_")
		if key in row:
			row[key] += cint(r.n)
		row["_p"] += flt(r.avg) * cint(r.n)
		row["_n"] += cint(r.n)
	data = []
	for o in offerings:
		p = per[o.name]
		data.append(
			{
				"course_offering": o.name,
				"course_title": o.course_title,
				"campus": o.campus,
				"enrolled": cint(o.enrolled_count),
				"resources": resources.get(o.name, 0),
				"active_learners": learners.get(o.name, 0),
				"engagement_pct": pct(learners.get(o.name, 0), cint(o.enrolled_count)),
				"completed": p["completed"],
				"in_progress": p["in_progress"],
				"average_progress": round(p["_p"] / p["_n"], 1) if p["_n"] else 0,
				"lms_sync_status": o.lms_sync_status,
			}
		)
	data.sort(key=lambda r: -r["engagement_pct"])
	return {
		"columns": [
			_col("course_offering", _("Offering"), "Link"),
			_col("course_title", _("Course")),
			_col("campus", _("Campus"), "Link"),
			_col("enrolled", _("Enrolled"), "Int"),
			_col("resources", _("Resources"), "Int"),
			_col("active_learners", _("Active learners"), "Int"),
			_col("engagement_pct", _("Engagement %"), "Percent"),
			_col("completed", _("Completed"), "Int"),
			_col("in_progress", _("In progress"), "Int"),
			_col("average_progress", _("Avg progress %"), "Percent"),
			_col("lms_sync_status", _("LMS sync")),
		],
		"rows": data,
		"chart": {
			"type": "bar",
			"labels": [r["course_title"] for r in data],
			"datasets": [{"name": _("Engagement %"), "values": [r["engagement_pct"] for r in data]}],
		},
		"summary": {"term": term},
	}


def r_library_loans(f: dict) -> dict:
	filters = _apply({}, f, ("status", "borrower_type", "library_item"))
	dr = _date_range(f)
	if dr:
		filters["issue_date"] = dr
	rows = frappe.get_all(
		"Library Loan",
		filters=filters,
		fields=[
			"name",
			"library_item",
			"item_title",
			"borrower_type",
			"borrower_name",
			"issue_date",
			"due_date",
			"return_date",
			"status",
			"fine_amount",
			"fine_paid",
		],
		order_by="issue_date desc",
		limit_page_length=MAX_ROWS,
	)
	by_status = defaultdict(int)
	for r in rows:
		by_status[r.status] += 1
	return {
		"columns": [
			_col("name", _("Loan"), "Link"),
			_col("item_title", _("Item")),
			_col("borrower_type", _("Borrower type")),
			_col("borrower_name", _("Borrower")),
			_col("issue_date", _("Issued"), "Date"),
			_col("due_date", _("Due"), "Date"),
			_col("return_date", _("Returned"), "Date"),
			_col("status", _("Status")),
			_col("fine_amount", _("Fine"), "Currency"),
			_col("fine_paid", _("Fine paid"), "Check"),
		],
		"rows": rows,
		"chart": {
			"type": "pie",
			"labels": list(by_status),
			"datasets": [{"name": _("Loans"), "values": list(by_status.values())}],
		},
		"summary": {"total": len(rows), "fines": sum(flt(r.fine_amount) for r in rows if not r.fine_paid)},
	}


def r_sponsorship_summary(f: dict) -> dict:
	filters = _apply({}, f, ("sponsor_type", "partner_church"))
	if f.get("status"):
		filters["status"] = f["status"]
	sponsors = frappe.get_all(
		"Sponsor",
		filters=filters,
		fields=[
			"name",
			"sponsor_name",
			"sponsor_type",
			"status",
			"total_committed",
			"total_disbursed",
			"active_sponsorships",
		],
		order_by="sponsor_name asc",
	)
	names = [s.name for s in sponsors] or ["__none__"]
	students = {
		r.sponsor: cint(r.n)
		for r in frappe.get_all(
			"Sponsorship",
			filters={"sponsor": ["in", names], "status": ["in", ["Active", "Suspended"]]},
			fields=["sponsor", {"COUNT": "*", "as": "n"}],
			group_by="sponsor",
		)
	}
	rows = [
		{
			**s,
			"students": students.get(s.name, 0),
			"disbursed_pct": pct(s.total_disbursed, s.total_committed),
			"gap": max(flt(s.total_committed) - flt(s.total_disbursed), 0),
		}
		for s in sponsors
	]
	return {
		"columns": [
			_col("name", _("Sponsor"), "Link"),
			_col("sponsor_name", _("Name")),
			_col("sponsor_type", _("Type")),
			_col("status", _("Status")),
			_col("students", _("Students"), "Int"),
			_col("active_sponsorships", _("Active sponsorships"), "Int"),
			_col("total_committed", _("Committed"), "Currency"),
			_col("total_disbursed", _("Disbursed"), "Currency"),
			_col("disbursed_pct", _("Disbursed %"), "Percent"),
			_col("gap", _("Gap"), "Currency"),
		],
		"rows": rows,
		"chart": {
			"type": "bar",
			"labels": [r["sponsor_name"] for r in rows],
			"datasets": [
				{"name": _("Committed"), "values": [flt(r["total_committed"]) for r in rows]},
				{"name": _("Disbursed"), "values": [flt(r["total_disbursed"]) for r in rows]},
			],
		},
		"summary": {
			"committed": sum(flt(r["total_committed"]) for r in rows),
			"disbursed": sum(flt(r["total_disbursed"]) for r in rows),
		},
	}


def r_giving_summary(f: dict) -> dict:
	from frappe.query_builder.functions import Count, DateFormat, Sum

	GR = frappe.qb.DocType("Giving Record")
	month = DateFormat(GR.posting_date, "%Y-%m")
	q = (
		frappe.qb.from_(GR)
		.select(month.as_("month"), GR.giving_type, Count(GR.name).as_("count"), Sum(GR.amount).as_("total"))
		.where(GR.docstatus == 1)
		.groupby(month, GR.giving_type)
		.orderby(month)
	)
	from_date = f.get("from_date") or str(get_first_day(add_months(getdate(nowdate()), -11)))
	q = q.where(GR.posting_date >= getdate(from_date))
	if f.get("to_date"):
		q = q.where(GR.posting_date <= getdate(f["to_date"]))
	if f.get("giving_type"):
		q = q.where(GR.giving_type == f["giving_type"])
	if f.get("giver_type"):
		q = q.where(GR.giver_type == f["giver_type"])
	rows = q.run(as_dict=True)
	months = sorted({r.month for r in rows})
	by_month = defaultdict(float)
	for r in rows:
		r.total = flt(r.total)
		by_month[r.month] += r.total
	return {
		"columns": [
			_col("month", _("Month")),
			_col("giving_type", _("Giving type"), "Link"),
			_col("count", _("Gifts"), "Int"),
			_col("total", _("Amount"), "Currency"),
		],
		"rows": rows,
		"chart": {
			"type": "bar",
			"labels": months,
			"datasets": [{"name": _("Giving"), "values": [by_month[m] for m in months]}],
		},
		"summary": {"total": sum(by_month.values()), "gifts": sum(cint(r.count) for r in rows)},
	}


def r_message_delivery(f: dict) -> dict:
	filters = _apply({}, f, ("channel", "event"))
	dr = _date_range(f, default_days=30)
	if dr:
		filters["creation"] = dr
	rows = frappe.get_all(
		"Message Log",
		filters=filters,
		fields=["event", "channel", "status", {"COUNT": "*", "as": "n"}],
		group_by="event, channel, status",
	)
	per = {}
	for r in rows:
		row = per.setdefault(
			(r.event, r.channel),
			{
				"event": r.event or _("(none)"),
				"channel": r.channel,
				"queued": 0,
				"sent": 0,
				"delivered": 0,
				"failed": 0,
				"total": 0,
			},
		)
		key = (r.status or "").lower()
		if key in row:
			row[key] += cint(r.n)
		row["total"] += cint(r.n)
	data = sorted(per.values(), key=lambda r: -r["total"])
	for r in data:
		r["success_rate"] = pct(r["sent"] + r["delivered"], r["total"])
	by_channel = defaultdict(lambda: [0, 0])
	for r in data:
		by_channel[r["channel"]][0] += r["sent"] + r["delivered"]
		by_channel[r["channel"]][1] += r["failed"]
	channels = sorted(by_channel)
	return {
		"columns": [
			_col("event", _("Event")),
			_col("channel", _("Channel")),
			_col("total", _("Total"), "Int"),
			_col("queued", _("Queued"), "Int"),
			_col("sent", _("Sent"), "Int"),
			_col("delivered", _("Delivered"), "Int"),
			_col("failed", _("Failed"), "Int"),
			_col("success_rate", _("Success %"), "Percent"),
		],
		"rows": data,
		"chart": {
			"type": "bar",
			"labels": channels,
			"datasets": [
				{"name": _("Delivered/Sent"), "values": [by_channel[c][0] for c in channels]},
				{"name": _("Failed"), "values": [by_channel[c][1] for c in channels]},
			],
		},
	}


# ---------------------------------------------------------------------------------- payment reconciliation
TRANSACTION_STATUSES = ("Unmatched", "Matched", "Allocated", "Reversed")
NO_TRANSACTION = "No Transaction"  # synthetic status: confirmed M-Pesa Student Payment without a transaction
EXTERNAL_MATCHES = {"Giving": "Giving Record", "Event Fee": "Event Registration"}


def _mask_phone(phone: str | None) -> str | None:
	if not phone:
		return None
	try:
		from mahanaim.services.auth import mask_phone

		return mask_phone(phone)
	except ImportError:
		phone = str(phone)
		return "*" * max(len(phone) - 3, 0) + phone[-3:]


def _day_bounds(f: dict, default_days: int | None = None) -> tuple[str | None, str | None]:
	"""[start, end) date strings for filtering a Datetime column by the from_date/to_date filters."""
	from_date, to_date = f.get("from_date"), f.get("to_date")
	if not from_date and default_days:
		from_date = add_days(nowdate(), -default_days)
	return (
		str(getdate(from_date)) if from_date else None,
		str(add_days(getdate(to_date), 1)) if to_date else None,
	)


def _external_matches(requests_by_purpose: dict[str, set]) -> dict[str, tuple[str, str]]:
	"""{M-Pesa Request: (doctype, name)} for Giving Records / Event Registrations paid by STK push."""
	out = {}
	for purpose, doctype in EXTERNAL_MATCHES.items():
		reqs = [r for r in requests_by_purpose.get(purpose, ()) if r]
		if not reqs:
			continue
		for name, req in frappe.get_all(
			doctype,
			filters={"mpesa_request": ["in", reqs]},
			fields=["name", "mpesa_request"],
			as_list=True,
		):
			out[req] = (doctype, name)
	return out


def _mpesa_transactions(f: dict, start: str | None, end: str | None) -> list[dict]:
	from frappe.query_builder import Order
	from frappe.query_builder.functions import Coalesce

	MT, RQ = frappe.qb.DocType("M-Pesa Transaction"), frappe.qb.DocType("M-Pesa Request")
	ST, PA = frappe.qb.DocType("Student"), frappe.qb.DocType("Programme Application")
	campus = Coalesce(ST.campus, PA.campus)
	q = (
		frappe.qb.from_(MT)
		.left_join(RQ)
		.on(RQ.name == MT.request)
		.left_join(ST)
		.on(ST.name == Coalesce(MT.student, RQ.student))
		.left_join(PA)
		.on(PA.name == Coalesce(MT.programme_application, RQ.programme_application))
		.select(
			MT.name,
			MT.trans_time,
			MT.source,
			MT.msisdn,
			MT.payer_name,
			MT.amount,
			MT.bill_ref_number,
			MT.status,
			MT.request,
			MT.payment,
			RQ.purpose,
			ST.name.as_("student"),
			PA.name.as_("programme_application"),
			campus.as_("campus"),
		)
		.orderby(MT.trans_time, order=Order.desc)
		.limit(MAX_ROWS)
	)
	if start:
		q = q.where(MT.trans_time >= start)
	if end:
		q = q.where(MT.trans_time < end)
	if f.get("campus"):
		q = q.where(campus == f["campus"])
	if f.get("status") in TRANSACTION_STATUSES:
		q = q.where(MT.status == f["status"])
	return q.run(as_dict=True)


def _payments_without_transaction(f: dict) -> list[dict]:
	"""Confirmed M-Pesa Student Payments that no M-Pesa Transaction backs (by link, reference or allocation)."""
	from frappe.query_builder.functions import Coalesce

	SP, ST = frappe.qb.DocType("Student Payment"), frappe.qb.DocType("Student")
	PA = frappe.qb.DocType("Programme Application")
	campus = Coalesce(ST.campus, PA.campus)
	q = (
		frappe.qb.from_(SP)
		.left_join(ST)
		.on(ST.name == SP.student)
		.left_join(PA)
		.on(PA.name == SP.programme_application)
		.select(
			SP.name,
			SP.posting_date,
			SP.payment_for,
			SP.student,
			SP.programme_application,
			SP.payer_name,
			SP.amount,
			SP.reference_no,
			SP.msisdn,
			SP.mpesa_transaction,
			campus.as_("campus"),
		)
		.where((SP.docstatus == 1) & (SP.mode_of_payment == "M-Pesa"))
		.limit(MAX_ROWS)
	)
	start, end = _day_bounds(f, default_days=30)
	if start:
		q = q.where(SP.posting_date >= start)
	if end:
		q = q.where(SP.posting_date < end)
	if f.get("campus"):
		q = q.where(campus == f["campus"])
	payments = q.run(as_dict=True)
	if not payments:
		return []
	refs = set()
	for p in payments:
		refs.update(x for x in (p.mpesa_transaction, p.reference_no, (p.reference_no or "").upper()) if x)
	known = set(frappe.get_all("M-Pesa Transaction", filters={"name": ["in", list(refs)]}, pluck="name"))
	allocated = set(
		frappe.get_all(
			"M-Pesa Transaction", filters={"payment": ["in", [p.name for p in payments]]}, pluck="payment"
		)
	)
	return [
		p
		for p in payments
		if p.name not in allocated
		and not {p.mpesa_transaction, p.reference_no, (p.reference_no or "").upper()} & known
	]


def r_payment_reconciliation(f: dict) -> dict:
	start, end = _day_bounds(f, default_days=30)
	status = f.get("status")
	trans = [] if status == NO_TRANSACTION else _mpesa_transactions(f, start, end)
	by_purpose = defaultdict(set)
	for t in trans:
		if not t.payment and t.purpose in EXTERNAL_MATCHES:
			by_purpose[t.purpose].add(t.request)
	external = _external_matches(by_purpose)
	rows = []
	by_status = {s: 0 for s in TRANSACTION_STATUSES}
	amount_by_status = {s: 0.0 for s in TRANSACTION_STATUSES}
	matched_by_day, unmatched_by_day = defaultdict(float), defaultdict(float)
	for t in trans:
		if t.payment:
			matched = ("Student Payment", t.payment)
		elif t.request in external:
			matched = external[t.request]
		elif t.programme_application:
			matched = ("Programme Application", t.programme_application)
		elif t.student:
			matched = ("Student", t.student)
		else:
			matched = (None, None)
		rows.append(
			{
				"receipt": t.name,
				"trans_time": t.trans_time,
				"source": t.source,
				"phone": _mask_phone(t.msisdn),
				"payer_name": t.payer_name,
				"amount": flt(t.amount),
				"bill_ref_number": t.bill_ref_number,
				"purpose": t.purpose,
				"matched_doctype": matched[0],
				"matched_name": matched[1],
				"matched_route": route_for(*matched) if matched[0] else None,
				"student": t.student,
				"campus": t.campus,
				"payment": t.payment,
				"status": t.status,
			}
		)
		if t.status in by_status:
			by_status[t.status] += 1
			amount_by_status[t.status] += flt(t.amount)
		day = str(getdate(t.trans_time)) if t.trans_time else ""
		(unmatched_by_day if t.status == "Unmatched" else matched_by_day)[day] += flt(t.amount)
	orphans = [] if status in TRANSACTION_STATUSES else _payments_without_transaction(f)
	for p in orphans:
		rows.append(
			{
				"receipt": p.reference_no,
				"trans_time": p.posting_date,
				"source": None,
				"phone": _mask_phone(p.msisdn),
				"payer_name": p.payer_name,
				"amount": flt(p.amount),
				"bill_ref_number": None,
				"purpose": p.payment_for,
				"matched_doctype": "Student Payment",
				"matched_name": p.name,
				"matched_route": route_for("Student Payment", p.name),
				"student": p.student,
				"campus": p.campus,
				"payment": p.name,
				"status": NO_TRANSACTION,
			}
		)
	days = sorted(d for d in set(matched_by_day) | set(unmatched_by_day) if d)
	return {
		"columns": [
			_col("receipt", _("Receipt")),
			_col("trans_time", _("Date"), "Datetime"),
			_col("source", _("Source")),
			_col("phone", _("Phone")),
			_col("payer_name", _("Payer")),
			_col("amount", _("Amount"), "Currency"),
			_col("bill_ref_number", _("Account / Bill ref")),
			_col("purpose", _("Purpose")),
			_col("matched_doctype", _("Matched to")),
			_col("matched_name", _("Matched document")),
			_col("student", _("Student"), "Link"),
			_col("campus", _("Campus"), "Link"),
			_col("payment", _("Payment"), "Link"),
			_col("status", _("Status")),
		],
		"rows": rows[:MAX_ROWS],
		"chart": {
			"type": "bar",
			"labels": days,
			"datasets": [
				{"name": _("Matched amount"), "values": [matched_by_day[d] for d in days]},
				{"name": _("Unmatched amount"), "values": [unmatched_by_day[d] for d in days]},
			],
		},
		"summary": {
			"transactions": len(trans),
			"total_amount": sum(amount_by_status.values()),
			"allocated_amount": amount_by_status["Allocated"],
			"unmatched": by_status["Unmatched"],
			"unmatched_amount": amount_by_status["Unmatched"],
			"payments_without_transaction": len(orphans),
			"payments_without_transaction_amount": sum(flt(p.amount) for p in orphans),
			"by_status": {**by_status, NO_TRANSACTION: len(orphans)},
			"amount_by_status": {
				**amount_by_status,
				NO_TRANSACTION: sum(flt(p.amount) for p in orphans),
			},
		},
	}


# ---------------------------------------------------------------------------------- lecturer workload
GRADING_DUE = ("Submitted", "Late")
MARKS_SUBMITTED = ("Submitted", "Approved", "Published")
LIVE_ENROLMENT = ("Enrolled", "Completed", "Failed")


def r_lecturer_workload(f: dict) -> dict:
	term = f.get("academic_term") or current_term()
	off_filters = _apply({"status": ["!=", "Cancelled"]}, f, ("campus",))
	if term:
		off_filters["academic_term"] = term
	offerings = {
		o.name: o
		for o in frappe.get_all(
			"Course Offering",
			filters=off_filters,
			fields=["name", "course", "course_title", "credits"],
			limit_page_length=MAX_ROWS,
		)
	}
	names = list(offerings)
	teachers, sessions = defaultdict(set), []
	if names:
		for parent, staff in frappe.get_all(
			"Course Offering Lecturer",
			filters={"parenttype": "Course Offering", "parent": ["in", names], "staff_member": ["is", "set"]},
			fields=["parent", "staff_member"],
			as_list=True,
		):
			teachers[parent].add(staff)
		in_offerings = {"course_offering": ["in", names]}
		students = _count_by(
			"Course Enrolment", "course_offering", {**in_offerings, "status": ["in", LIVE_ENROLMENT]}
		)
		assignments = _count_by("Assignment", "course_offering", {**in_offerings, "status": ["!=", "Draft"]})
		to_grade = _count_by(
			"Assignment Submission", "course_offering", {**in_offerings, "status": ["in", GRADING_DUE]}
		)
		marks_done = _count_by(
			"Mark Sheet", "course_offering", {**in_offerings, "status": ["in", MARKS_SUBMITTED]}
		)
		sessions = frappe.get_all(
			"Class Session",
			filters={**in_offerings, "attendance_taken": 1, "status": ["!=", "Cancelled"]},
			fields=["course_offering", "lecturer", {"COUNT": "*", "as": "n"}],
			group_by="course_offering, lecturer",
		)
	else:
		students = assignments = to_grade = marks_done = {}
	staff_filters = _apply({}, f, ("department",))
	active_lecturers = frappe.get_all(
		"Staff Member",
		filters={**staff_filters, "is_lecturer": 1, "status": "Active", **_apply({}, f, ("campus",))},
		pluck="name",
	)
	involved = {s for group in teachers.values() for s in group} | {
		s.lecturer for s in sessions if s.lecturer
	}
	staff = frappe.get_all(
		"Staff Member",
		filters={**staff_filters, "name": ["in", list(involved | set(active_lecturers)) or [""]]},
		fields=["name", "full_name", "department", "campus"],
	)
	per = {
		s.name: {
			"staff_member": s.name,
			"lecturer_name": s.full_name,
			"department": s.department,
			"campus": s.campus,
			"offerings": 0,
			"courses": [],
			"credit_hours": 0.0,
			"students": 0,
			"assignments_published": 0,
			"submissions_to_grade": 0,
			"mark_sheets_pending": 0,
			"sessions_recorded": 0,
		}
		for s in staff
	}
	for offering, lecturers in teachers.items():
		o = offerings[offering]
		for staff_member in lecturers:
			row = per.get(staff_member)
			if not row:
				continue
			row["offerings"] += 1
			row["courses"].append(o.course or o.course_title)
			row["credit_hours"] += flt(o.credits)
			row["students"] += students.get(offering, 0)
			row["assignments_published"] += assignments.get(offering, 0)
			row["submissions_to_grade"] += to_grade.get(offering, 0)
			row["mark_sheets_pending"] += 0 if marks_done.get(offering) else 1
	for s in sessions:
		# a session is credited to the lecturer who took it, else to everyone teaching the offering
		for staff_member in [s.lecturer] if s.lecturer else teachers.get(s.course_offering, ()):
			if staff_member in per:
				per[staff_member]["sessions_recorded"] += cint(s.n)
	data = sorted(per.values(), key=lambda r: (-r["credit_hours"], -r["offerings"], r["lecturer_name"] or ""))
	for r in data:
		r["courses"] = ", ".join(sorted(c for c in r["courses"] if c))
	teaching = [r for r in data if r["offerings"]]
	return {
		"columns": [
			_col("staff_member", _("Staff ID")),
			_col("lecturer_name", _("Lecturer")),
			_col("department", _("Department"), "Link"),
			_col("campus", _("Campus"), "Link"),
			_col("offerings", _("Offerings"), "Int"),
			_col("courses", _("Courses")),
			_col("credit_hours", _("Credit hours"), "Float"),
			_col("students", _("Students"), "Int"),
			_col("assignments_published", _("Assignments published"), "Int"),
			_col("submissions_to_grade", _("Submissions to grade"), "Int"),
			_col("mark_sheets_pending", _("Mark sheets pending"), "Int"),
			_col("sessions_recorded", _("Sessions recorded"), "Int"),
		],
		"rows": data,
		"chart": {
			"type": "bar",
			"labels": [r["lecturer_name"] or r["staff_member"] for r in teaching],
			"datasets": [
				{"name": _("Credit hours"), "values": [r["credit_hours"] for r in teaching]},
				{"name": _("Offerings"), "values": [r["offerings"] for r in teaching]},
			],
		},
		"summary": {
			"term": term,
			"lecturers": len(data),
			"teaching": len(teaching),
			"offerings": len(offerings),
			"unassigned_offerings": sum(1 for o in offerings if not teachers.get(o)),
			"credit_hours": sum(flt(o.credits) for o in offerings.values()),
			"submissions_to_grade": sum(to_grade.values()),
			"mark_sheets_pending": sum(1 for o in offerings if not marks_done.get(o)),
		},
	}


# ---------------------------------------------------------------------------------- credentials
CREDENTIAL_TYPES = ("Transcript", "Certificate")
CREDENTIAL_STATUSES = ("Pending", "Issued", "Reissued", "Revoked")


def _credentials(doctype: str, f: dict) -> list[dict]:
	"""All credentials of one doctype (oldest first) with a display status; "Reissued" = issued after the same
	student's earlier credential of the same kind (programme, and transcript type) was revoked."""
	detail = "transcript_type" if doctype == "Transcript" else "award_title"
	rows = frappe.get_all(
		doctype,
		filters=_apply({}, f, ("programme",)),
		fields=[
			"name",
			"student",
			"student_name",
			"student_number",
			"programme",
			"status",
			"issue_date",
			"verification_count",
			"revoked_reason",
			"creation",
			detail,
		],
		order_by="creation asc",
	)
	revoked = set()
	for r in rows:
		r.detail = r.get(detail)
		key = (r.student, r.programme, r.detail if doctype == "Transcript" else None)
		r.credential_type = doctype
		r.display_status = {"Draft": "Pending"}.get(r.status, r.status)
		if r.status == "Issued" and key in revoked:
			r.display_status = "Reissued"
		elif r.status == "Revoked":
			revoked.add(key)
	return rows


def r_credentials_issued(f: dict) -> dict:
	types = [f["credential_type"]] if f.get("credential_type") in CREDENTIAL_TYPES else list(CREDENTIAL_TYPES)
	from_date = getdate(f["from_date"]) if f.get("from_date") else None
	to_date = getdate(f["to_date"]) if f.get("to_date") else None
	status = f.get("status") if f.get("status") in CREDENTIAL_STATUSES else None
	docs = []
	for doctype in types:
		for r in _credentials(doctype, f):
			day = getdate(r.issue_date or r.creation)
			if (from_date and day < from_date) or (to_date and day > to_date):
				continue
			if status and r.display_status != status:
				continue
			docs.append(r)
	docs.sort(key=lambda r: (getdate(r.issue_date or r.creation), r.creation), reverse=True)
	docs = docs[:MAX_ROWS]
	logs = {}
	for doctype in types:
		names = [r.name for r in docs if r.credential_type == doctype]
		if not names:
			continue
		for r in frappe.get_all(
			"Verification Log",
			filters={"document_type": doctype, "document_name": ["in", names]},
			fields=["document_name", {"COUNT": "*", "as": "n"}, {"MAX": "verified_on", "as": "last"}],
			group_by="document_name",
		):
			logs[(doctype, r.document_name)] = r
	rows, by_type = [], {t: 0 for t in types}
	by_status = {s: 0 for s in CREDENTIAL_STATUSES}
	per_type_status = {t: dict.fromkeys(CREDENTIAL_STATUSES, 0) for t in types}
	for r in docs:
		log = logs.get((r.credential_type, r.name))
		rows.append(
			{
				"name": r.name,
				"credential_type": r.credential_type,
				"detail": r.detail,
				"student": r.student,
				"student_name": r.student_name,
				"student_number": r.student_number,
				"programme": r.programme,
				"issue_date": r.issue_date,
				"status": r.display_status,
				"verification_count": max(cint(r.verification_count), cint(log.n) if log else 0),
				"last_verified": log.last if log else None,
				"revoked_reason": r.revoked_reason,
			}
		)
		by_type[r.credential_type] += 1
		by_status[r.display_status] += 1
		per_type_status[r.credential_type][r.display_status] += 1
	type_labels = {"Transcript": _("Transcripts"), "Certificate": _("Certificates")}
	return {
		"columns": [
			_col("name", _("Document")),
			_col("credential_type", _("Type")),
			_col("detail", _("Kind / award")),
			_col("student", _("Student"), "Link"),
			_col("student_name", _("Name")),
			_col("student_number", _("Student No.")),
			_col("programme", _("Programme"), "Link"),
			_col("issue_date", _("Issued on"), "Date"),
			_col("status", _("Status")),
			_col("verification_count", _("Verifications"), "Int"),
			_col("last_verified", _("Last verified"), "Datetime"),
			_col("revoked_reason", _("Revocation reason")),
		],
		"rows": rows,
		"chart": {
			"type": "bar",
			"labels": [_(s) for s in CREDENTIAL_STATUSES],
			"datasets": [
				{"name": type_labels[t], "values": [per_type_status[t][s] for s in CREDENTIAL_STATUSES]}
				for t in types
			],
		},
		"summary": {
			"credentials": len(rows),
			"issued": by_status["Issued"],
			"reissued": by_status["Reissued"],
			"pending": by_status["Pending"],
			"revoked": by_status["Revoked"],
			"verifications": sum(r["verification_count"] for r in rows),
			"by_type": by_type,
			"by_status": by_status,
		},
	}


REPORTS = {
	"enrolment_by_programme": {
		"label": "Enrolment by programme",
		"category": "Academic",
		"roles": ACADEMIC_ROLES | {ROLE_ADMISSIONS},
		"filters": [F_CAMPUS, _f("study_mode", "Study Mode", "Link", "Study Mode"), F_INTAKE],
		"run": r_enrolment_by_programme,
	},
	"admissions_funnel": {
		"label": "Admissions funnel",
		"category": "Admissions",
		"roles": ADMISSION_ROLES,
		"filters": [F_INTAKE, F_PROGRAMME, F_CAMPUS],
		"run": r_admissions_funnel,
	},
	"applications_list": {
		"label": "Applications list",
		"category": "Admissions",
		"roles": ADMISSION_ROLES,
		"filters": [
			F_INTAKE,
			F_PROGRAMME,
			F_CAMPUS,
			_f(
				"status",
				"Status",
				"Select",
				"Draft\nSubmitted\nUnder Review\nInterview\nAdmitted\nWaitlisted"
				"\nRejected\nAccepted\nDeclined\nWithdrawn",
			),
			F_FROM,
			F_TO,
		],
		"run": r_applications_list,
	},
	"student_list": {
		"label": "Student list",
		"category": "Academic",
		"roles": ACADEMIC_ROLES,
		"filters": [
			F_PROGRAMME,
			F_CAMPUS,
			_f("study_mode", "Study Mode", "Link", "Study Mode"),
			F_INTAKE,
			_f("year_of_study", "Year of study", "Int"),
			_f(
				"status",
				"Status",
				"Select",
				"Admitted\nRegistered\nActive\nDeferred\nSuspended\nWithdrawn\nCompleted\nAlumni",
			),
		],
		"run": r_student_list,
	},
	"fee_collections": {
		"label": "Fee collections",
		"category": "Finance",
		"roles": FINANCE_ROLES,
		"filters": [
			F_FROM_30,
			F_TO,
			_f(
				"mode_of_payment",
				"Mode",
				"Select",
				"M-Pesa\nBank Deposit\nBank Transfer\nCash\nCheque\nCard\nSponsor Remittance",
			),
		],
		"run": r_fee_collections,
	},
	"outstanding_balances": {
		"label": "Outstanding balances",
		"category": "Finance",
		"roles": FINANCE_ROLES,
		"filters": [F_PROGRAMME, F_CAMPUS, _f("min_balance", "Minimum balance", "Currency")],
		"run": r_outstanding_balances,
	},
	"aging": {
		"label": "Receivables aging",
		"category": "Finance",
		"roles": FINANCE_ROLES,
		"filters": [F_PROGRAMME, F_CAMPUS, F_TERM, _f("as_of", "As of", "Date", default=_today)],
		"run": r_aging,
	},
	"payment_reconciliation": {
		"label": "M-Pesa payment reconciliation",
		"category": "Finance",
		"roles": FINANCE_ROLES,
		"filters": [
			F_FROM_30,
			F_TO,
			F_CAMPUS,
			_f("status", "Status", "Select", "\n".join((*TRANSACTION_STATUSES, NO_TRANSACTION))),
		],
		"run": r_payment_reconciliation,
	},
	"results_summary": {
		"label": "Results summary (grade distribution)",
		"category": "Academic",
		"roles": ACADEMIC_ROLES,
		"filters": [F_TERM, F_PROGRAMME],
		"run": r_results_summary,
	},
	"pass_rates_by_course": {
		"label": "Pass rates by course",
		"category": "Academic",
		"roles": ACADEMIC_ROLES,
		"filters": [F_TERM, F_PROGRAMME],
		"run": r_pass_rates_by_course,
	},
	"attendance_summary": {
		"label": "Attendance summary",
		"category": "Academic",
		"roles": ACADEMIC_ROLES,
		"filters": [
			F_TERM_CURRENT,
			F_CAMPUS,
			_f("course_offering", "Course Offering", "Link", "Course Offering"),
		],
		"run": r_attendance_summary,
	},
	"lms_engagement": {
		"label": "LMS engagement",
		"category": "Academic",
		"roles": ACADEMIC_ROLES,
		"filters": [
			F_TERM_CURRENT,
			F_CAMPUS,
			_f("course_offering", "Course Offering", "Link", "Course Offering"),
		],
		"run": r_lms_engagement,
	},
	"lecturer_workload": {
		"label": "Lecturer workload",
		"category": "Academic",
		"roles": ACADEMIC_ROLES,
		"filters": [F_TERM_CURRENT, F_CAMPUS, _f("department", "Department", "Link", "Department")],
		"run": r_lecturer_workload,
	},
	"credentials_issued": {
		"label": "Transcripts & certificates",
		"category": "Academic",
		"roles": ACADEMIC_ROLES | {ROLE_AUDITOR},
		"filters": [
			F_FROM,
			F_TO,
			_f("credential_type", "Type", "Select", "\n".join(CREDENTIAL_TYPES)),
			F_PROGRAMME,
			_f("status", "Status", "Select", "\n".join(CREDENTIAL_STATUSES)),
		],
		"run": r_credentials_issued,
	},
	"library_loans": {
		"label": "Library loans",
		"category": "Library",
		"roles": {ROLE_LIBRARY, ROLE_AUDITOR},
		"filters": [
			_f("status", "Status", "Select", "Requested\nIssued\nReturned\nOverdue\nLost\nCancelled"),
			_f("borrower_type", "Borrower type", "Select", "Student\nStaff"),
			F_FROM,
			F_TO,
		],
		"run": r_library_loans,
	},
	"sponsorship_summary": {
		"label": "Sponsorship summary",
		"category": "Church & Sponsors",
		"roles": FINANCE_ROLES | {ROLE_CHAPLAIN},
		"filters": [
			_f(
				"sponsor_type",
				"Sponsor type",
				"Select",
				"Individual\nChurch\nOrganisation\nFoundation\nAlumni",
			),
			_f("status", "Status", "Select", "Active\nInactive"),
		],
		"run": r_sponsorship_summary,
	},
	"giving_summary": {
		"label": "Giving summary",
		"category": "Church & Sponsors",
		"roles": FINANCE_ROLES | {ROLE_CHAPLAIN},
		"filters": [
			_with_default(F_FROM, _giving_window_start),
			F_TO,
			_f("giving_type", "Giving type", "Link", "Giving Type"),
		],
		"run": r_giving_summary,
	},
	"message_delivery": {
		"label": "Message delivery",
		"category": "Communication",
		"roles": {ROLE_COMMS, ROLE_AUDITOR},
		"filters": [F_FROM_30, F_TO, _f("channel", "Channel", "Select", "Email\nSMS\nIn-App")],
		"run": r_message_delivery,
	},
}


def catalog(roles: set[str]) -> list[dict]:
	"""Reports the roles may run. Each filter carries `default`: today's resolved value, or None."""
	return [
		{
			"key": key,
			"label": _(r["label"]),
			"category": _(r["category"]),
			"filters": [
				{**flt_, "label": _(flt_["label"]), "default": _resolve_default(flt_.get("default"))}
				for flt_ in r["filters"]
			],
		}
		for key, r in REPORTS.items()
		if allowed(roles, r["roles"])
	]


def applied_filters(spec: dict, filters: dict | None) -> dict:
	"""Effective filters: the caller's non-blank values over the report's declared defaults."""
	out = {}
	for flt_ in spec["filters"]:
		value = _resolve_default(flt_.get("default"))
		if value is not None:
			out[flt_["key"]] = value
	out.update({k: v for k, v in (filters or {}).items() if v not in (None, "", [])})
	return out


def run(report: str, filters: dict, roles: set[str]) -> dict:
	spec = REPORTS.get(report)
	if not spec:
		frappe.throw(_("Unknown report {0}.").format(report), frappe.DoesNotExistError)
	if not allowed(roles, spec["roles"]):
		frappe.throw(
			_("You do not have access to the {0} report.").format(_(spec["label"])), frappe.PermissionError
		)
	applied = applied_filters(spec, filters)
	out = spec["run"](applied)
	out["report"] = report
	out["label"] = _(spec["label"])
	out["filters"] = filters or {}
	out["applied_filters"] = applied
	return out


def to_csv(result: dict) -> str:
	import csv
	import io

	buf = io.StringIO()
	writer = csv.writer(buf)
	cols = result["columns"]
	writer.writerow([c["label"] for c in cols])
	for row in result["rows"]:
		values = []
		for c in cols:
			v = row.get(c["key"])
			v = "" if v is None else v
			if isinstance(v, str) and v[:1] in ("=", "+", "-", "@"):
				v = "'" + v  # neutralise spreadsheet formulas
			values.append(v)
		writer.writerow(values)
	return buf.getvalue()


# ---------------------------------------------------------------------------------- global search
SEARCH_GROUPS = (
	# type, doctype, roles, search fields, result fields, title, subtitle builder, route pattern
	(
		"Student",
		"Student",
		{ROLE_REGISTRAR, ROLE_DEAN, ROLE_ADMISSIONS, ROLE_FINANCE, ROLE_LIBRARY, ROLE_CHAPLAIN, ROLE_AUDITOR},
		("full_name", "student_number", "email", "phone", "name"),
		["name", "full_name", "student_number", "programme", "status"],
		"full_name",
		lambda r: " · ".join(x for x in (r.student_number, r.programme, r.status) if x),
		"/admin/students/{}",
	),
	(
		"Application",
		"Programme Application",
		{ROLE_ADMISSIONS, ROLE_REGISTRAR, ROLE_DEAN},
		("full_name", "email", "phone", "name"),
		["name", "full_name", "programme", "status"],
		"full_name",
		lambda r: " · ".join(x for x in (r.name, r.programme, r.status) if x),
		"/admin/admissions/{}",
	),
	(
		"Staff",
		"Staff Member",
		{ROLE_REGISTRAR, ROLE_DEAN},
		("full_name", "email", "staff_number", "phone", "name"),
		["name", "full_name", "designation", "email"],
		"full_name",
		lambda r: " · ".join(x for x in (r.designation, r.email) if x),
		"/admin/staff/{}",
	),
	(
		"Invoice",
		"Student Invoice",
		{ROLE_FINANCE, ROLE_AUDITOR},
		("name", "student_name", "student"),
		["name", "student_name", "outstanding_amount", "status"],
		"name",
		lambda r: " · ".join(x for x in (r.student_name, r.status) if x),
		"/admin/finance/invoices/{}",
	),
	(
		"Payment",
		"Student Payment",
		{ROLE_FINANCE, ROLE_AUDITOR},
		("name", "reference_no", "payer_name", "msisdn"),
		["name", "payer_name", "reference_no", "amount"],
		"name",
		lambda r: " · ".join(x for x in (r.payer_name, r.reference_no) if x),
		"/admin/finance/payments/{}",
	),
	(
		"Course",
		"Course",
		{ROLE_REGISTRAR, ROLE_DEAN},
		("name", "course_title"),
		["name", "course_title", "credits"],
		"course_title",
		lambda r: f"{r.name} · {flt(r.credits):g} credits",
		"/admin/academics/courses/{}",
	),
	(
		"Offering",
		"Course Offering",
		{ROLE_REGISTRAR, ROLE_DEAN},
		("name", "course_title", "course"),
		["name", "course_title", "academic_term", "campus"],
		"course_title",
		lambda r: " · ".join(x for x in (r.name, r.academic_term, r.campus) if x),
		"/admin/academics/offerings/{}",
	),
	(
		"Sponsor",
		"Sponsor",
		{ROLE_FINANCE, ROLE_CHAPLAIN, ROLE_ADMISSIONS},
		("sponsor_name", "email", "phone", "name"),
		["name", "sponsor_name", "sponsor_type", "email"],
		"sponsor_name",
		lambda r: " · ".join(x for x in (r.sponsor_type, r.email) if x),
		"/admin/church/sponsors/{}",
	),
)


def global_search(q: str, roles: set[str], limit: int = 8) -> list[dict]:
	q = (q or "").strip()
	if len(q) < 2:
		return []
	like = f"%{q}%"
	results = []
	for type_, doctype, needed, search_fields, fields, title_field, subtitle, route in SEARCH_GROUPS:
		if not allowed(roles, needed):
			continue
		rows = frappe.get_all(
			doctype,
			or_filters=[[f, "like", like] for f in search_fields],
			fields=fields,
			order_by="modified desc",
			limit_page_length=limit,
		)
		for r in rows:
			results.append(
				{
					"type": type_,
					"title": r.get(title_field) or r.name,
					"subtitle": subtitle(r),
					"route": route.format(r.name),
					"name": r.name,
					"doctype": doctype,
				}
			)
	return results


# ---------------------------------------------------------------------------------- campus comparison (M20)
def campus_comparison() -> dict:
	campuses = frappe.get_all(
		"Campus",
		fields=["name", "campus_name", "code", "is_main_campus", "is_active", "town"],
		order_by="is_main_campus desc, campus_name asc",
	)
	term = current_term()
	intake = current_intake()
	active = _count_by("Student", "campus", {"status": ["in", ACTIVE_STUDENT]})
	alumni = _count_by("Student", "campus", {"status": "Alumni"})
	applications = _count_by("Programme Application", "campus", {"intake": intake} if intake else {})
	staff = _count_by("Staff Member", "campus", {"status": "Active"})
	lecturers = _count_by("Staff Member", "campus", {"status": "Active", "is_lecturer": 1})
	offerings = _count_by(
		"Course Offering",
		"campus",
		{"academic_term": term, "status": ["!=", "Cancelled"]} if term else {"status": ["!=", "Cancelled"]},
	)
	inv_filters = {"docstatus": 1, **({"academic_term": term} if term else {})}
	finance = {
		r.campus: r
		for r in frappe.get_all(
			"Student Invoice",
			filters=inv_filters,
			fields=[
				"campus",
				{"SUM": "total_amount", "as": "billed"},
				{"SUM": "paid_amount", "as": "paid"},
				{"SUM": "outstanding_amount", "as": "outstanding"},
			],
			group_by="campus",
		)
	}
	cgpa = {
		r.campus: flt(r.avg, 2)
		for r in frappe.get_all(
			"Student",
			filters={"status": ["in", ACTIVE_STUDENT], "cgpa": [">", 0]},
			fields=["campus", {"AVG": "cgpa", "as": "avg"}],
			group_by="campus",
		)
	}
	chapel = {
		r.campus: r
		for r in frappe.get_all(
			"Chapel Service",
			filters={"status": "Held", "service_date": [">=", add_days(nowdate(), -90)]},
			fields=["campus", {"COUNT": "*", "as": "services"}, {"AVG": "total_attendance", "as": "avg"}],
			group_by="campus",
		)
	}
	library = _count_by("Library Item", "campus", {"is_active": 1})
	rows = []
	for c in campuses:
		fin = finance.get(c.name) or frappe._dict()
		rows.append(
			{
				"campus": c.name,
				"campus_name": c.campus_name,
				"code": c.code,
				"is_main_campus": c.is_main_campus,
				"is_active": c.is_active,
				"town": c.town,
				"active_students": active.get(c.name, 0),
				"alumni": alumni.get(c.name, 0),
				"applications": applications.get(c.name, 0),
				"staff": staff.get(c.name, 0),
				"lecturers": lecturers.get(c.name, 0),
				"offerings": offerings.get(c.name, 0),
				"student_lecturer_ratio": round(active.get(c.name, 0) / lecturers[c.name], 1)
				if lecturers.get(c.name)
				else None,
				"billed": flt(fin.billed),
				"collected": flt(fin.paid),
				"outstanding": flt(fin.outstanding),
				"collection_rate": pct(fin.paid, fin.billed),
				"average_cgpa": cgpa.get(c.name),
				"chapel_services_90d": cint((chapel.get(c.name) or {}).get("services")),
				"chapel_average_attendance": round(flt((chapel.get(c.name) or {}).get("avg")), 1),
				"library_items": library.get(c.name, 0),
			}
		)
	metrics = [
		"active_students",
		"applications",
		"staff",
		"lecturers",
		"offerings",
		"billed",
		"collected",
		"outstanding",
	]
	return {
		"term": term,
		"intake": intake,
		"campuses": rows,
		"totals": {m: sum(flt(r[m]) for r in rows) for m in metrics},
		"chart": {
			"type": "bar",
			"labels": [r["campus_name"] for r in rows],
			"datasets": [
				{"name": _("Active students"), "values": [r["active_students"] for r in rows]},
				{"name": _("Applications"), "values": [r["applications"] for r in rows]},
			],
		},
	}
