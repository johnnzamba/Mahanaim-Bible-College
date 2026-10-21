"""Read-only audit trail (B3).

Sources (both written by Frappe itself, nothing extra is recorded by this module):
	Version        document changes on Mahanaim doctypes with "Track Changes" (field diffs, child rows, docstatus)
	Activity Log   sign-ins / sign-outs / impersonation, including failed logins (status "Failed")

Password field values are never returned (shown as MASK) and long values are truncated.
"""

from __future__ import annotations

import json
from collections import Counter

import frappe
from frappe import _
from frappe.query_builder import Order
from frappe.query_builder.functions import Count, Date
from frappe.utils import add_days, cint, cstr, date_diff, getdate, strip_html, today
from frappe.utils.csvutils import to_csv

APP = "mahanaim"
MASK = "••••"
VALUE_LIMIT = 200
EXPORT_LIMIT = 5000
MAX_SUMMARY_DAYS = 366
ACCESS_OPERATIONS = ("Login", "Logout", "Impersonate")
ACCESS_STATUSES = ("Success", "Failed", "Linked", "Closed")
DOCSTATUS = {0: "Draft", 1: "Submitted", 2: "Cancelled"}
SPECIAL_LABELS = {"docstatus": "Document Status", "name": "Name"}
SENSITIVE_SCAN = 500
SENSITIVE_LIMIT = 20
APPLICATION_DECISIONS = {"Admitted", "Waitlisted", "Rejected"}
CANCELLABLE = ("Student Payment", "Student Invoice", "Fee Adjustment")
REVOCABLE = ("Transcript", "Certificate")


# ---------------------------------------------------------------------------------- scope
def app_doctypes(tracked_only: bool = False, include_tables: bool = True) -> list[dict]:
	modules = frappe.get_all("Module Def", filters={"app_name": APP}, pluck="name")
	if not modules:
		return []
	filters = {"module": ["in", modules]}
	if tracked_only:
		filters["track_changes"] = 1
	if not include_tables:
		filters["istable"] = 0
	return frappe.get_all(
		"DocType", filters=filters, fields=["name", "module", "issingle", "istable"], order_by="name asc"
	)


def _doctype_names() -> list[str]:
	return [d.name for d in app_doctypes()]


def doctype_options() -> list[dict]:
	rows = app_doctypes(tracked_only=True, include_tables=False)
	return sorted(
		({"value": d.name, "label": _(d.name), "module": d.module} for d in rows), key=lambda r: r["label"]
	)


def _date_range(column, from_date=None, to_date=None) -> list:
	"""Inclusive calendar-day bounds on a datetime column."""
	conds = []
	if from_date:
		conds.append(column >= getdate(from_date))
	if to_date:
		conds.append(column < add_days(getdate(to_date), 1))
	return conds


def _where(query, conds):
	for cond in conds:
		query = query.where(cond)
	return query


def _full_names(users) -> dict:
	users = {u for u in users if u}
	if not users:
		return {}
	rows = frappe.get_all("User", filters={"name": ["in", list(users)]}, fields=["name", "full_name"])
	return {r.name: r.full_name for r in rows}


# ---------------------------------------------------------------------------------- version parsing
def _truncate(value):
	if value is None or isinstance(value, bool | int | float):
		return value
	if not isinstance(value, str):
		value = json.dumps(value, default=str)
	value = strip_html(value) if "<" in value else value
	return value if len(value) <= VALUE_LIMIT else value[: VALUE_LIMIT - 1] + "…"


def _meta(doctype):
	try:
		return frappe.get_meta(doctype)
	except frappe.DoesNotExistError:
		return None


def _change(meta, field, old, new, prefix_label: str = "", prefix_field: str = "") -> dict:
	df = meta.get_field(field) if meta else None
	label = (df.label if df else None) or SPECIAL_LABELS.get(field) or cstr(field).replace("_", " ").title()
	if df and df.fieldtype == "Password":
		old = new = MASK
	elif field == "docstatus":
		old, new = DOCSTATUS.get(cint(old), old), DOCSTATUS.get(cint(new), new)
	else:
		old, new = _truncate(old), _truncate(new)
	return {
		"field": f"{prefix_field}{field}",
		"label": f"{prefix_label}{_(label)}",
		"old": old,
		"new": new,
	}


def parse_version_data(ref_doctype: str, data) -> dict:
	"""Summarise a Version.data JSON: {changed: [{field, label, old, new}], added, removed, row_changed, is_new}."""
	if isinstance(data, str):
		try:
			data = json.loads(data or "{}")
		except ValueError:
			data = {}
	data = data if isinstance(data, dict) else {}
	meta = _meta(ref_doctype)
	changed = []
	for item in data.get("changed") or []:
		if isinstance(item, list | tuple) and len(item) >= 3:
			changed.append(_change(meta, item[0], item[1], item[2]))
	for item in data.get("row_changed") or []:
		if not (isinstance(item, list | tuple) and len(item) >= 4):
			continue
		table, row_changes = item[0], item[3]
		idx = cint(item[1]) + 1  # Frappe stores the 0-based row position
		table_df = meta.get_field(table) if meta else None
		child_meta = _meta(table_df.options) if table_df and table_df.options else None
		table_label = _(table_df.label) if table_df and table_df.label else table
		for change in row_changes or []:
			if isinstance(change, list | tuple) and len(change) >= 3:
				changed.append(
					_change(
						child_meta,
						change[0],
						change[1],
						change[2],
						prefix_label=_("{0} (row {1}): ").format(table_label, idx),
						prefix_field=f"{table}[{idx}].",
					)
				)
	out = {
		"changed": changed,
		"added": len(data.get("added") or []),
		"removed": len(data.get("removed") or []),
		"row_changed": len(data.get("row_changed") or []),
		"is_new": bool(data.get("creation")) and not data.get("changed"),
	}
	if data.get("impersonated_by"):
		out["impersonated_by"] = data["impersonated_by"]
	return out


def _version_row(row, names: dict) -> dict:
	return {
		"name": row.name,
		"ref_doctype": row.ref_doctype,
		"docname": row.docname,
		"owner": row.owner,
		"owner_name": names.get(row.owner) or row.owner,
		"creation": row.creation,
		**parse_version_data(row.ref_doctype, row.data),
	}


# ---------------------------------------------------------------------------------- document changes
def document_changes(
	doctype=None,
	docname=None,
	user=None,
	from_date=None,
	to_date=None,
	search=None,
	start: int = 0,
	page_length: int = 20,
) -> dict:
	allowed = _doctype_names()
	if doctype and doctype not in allowed:
		frappe.throw(_("{0} is not a Mahanaim document type.").format(doctype), frappe.ValidationError)
	V = frappe.qb.DocType("Version")
	conds = [V.ref_doctype == doctype] if doctype else [V.ref_doctype.isin(allowed or [""])]
	if docname:
		conds.append(V.docname == docname)
	if user:
		conds.append(V.owner == user)
	conds += _date_range(V.creation, from_date, to_date)
	if search and search.strip():
		like = f"%{search.strip()}%"
		conds.append(V.docname.like(like) | V.data.like(like) | V.owner.like(like))

	total = _where(frappe.qb.from_(V).select(Count(V.name)), conds).run()[0][0]
	rows = (
		_where(
			frappe.qb.from_(V).select(V.name, V.ref_doctype, V.docname, V.owner, V.creation, V.data), conds
		)
		.orderby(V.creation, order=Order.desc)
		.orderby(V.name, order=Order.desc)
		.limit(page_length)
		.offset(start)
		.run(as_dict=True)
	)
	names = _full_names(r.owner for r in rows)
	return {"rows": [_version_row(r, names) for r in rows], "total": total}


# ---------------------------------------------------------------------------------- access log
def access_log(
	user=None,
	operation=None,
	status=None,
	from_date=None,
	to_date=None,
	start: int = 0,
	page_length: int = 20,
) -> dict:
	if operation and operation not in ACCESS_OPERATIONS:
		frappe.throw(_("Unknown operation {0}.").format(operation), frappe.ValidationError)
	if status and status not in ACCESS_STATUSES:
		frappe.throw(_("Unknown status {0}.").format(status), frappe.ValidationError)
	A = frappe.qb.DocType("Activity Log")
	conds = [A.operation == operation] if operation else [A.operation.isin(ACCESS_OPERATIONS)]
	if status:
		conds.append(A.status == status)
	if user:
		conds.append(A.user == user)
	conds += _date_range(A.creation, from_date, to_date)

	total = _where(frappe.qb.from_(A).select(Count(A.name)), conds).run()[0][0]
	rows = (
		_where(
			frappe.qb.from_(A).select(
				A.name, A.creation, A.user, A.full_name, A.operation, A.status, A.subject, A.ip_address
			),
			conds,
		)
		.orderby(A.creation, order=Order.desc)
		.orderby(A.name, order=Order.desc)
		.limit(page_length)
		.offset(start)
		.run(as_dict=True)
	)
	for r in rows:
		r.subject = _truncate(r.subject)
		r.full_name = r.full_name or r.user
	return {"rows": rows, "total": total}


# ---------------------------------------------------------------------------------- summary
def _sensitive_event(row, singles: set) -> dict | None:
	parsed = parse_version_data(row.ref_doctype, row.data)
	by_field = {c["field"]: c for c in parsed["changed"]}
	kind = description = None
	status = by_field.get("status")
	docstatus = by_field.get("docstatus")
	if row.ref_doctype in singles and parsed["changed"]:
		kind = "settings_update"
		description = _("{0} updated: {1}").format(
			_(row.ref_doctype), ", ".join(c["label"] for c in parsed["changed"][:5])
		)
	elif row.ref_doctype == "Student" and status:
		kind = "student_status"
		description = _("Student status changed from {0} to {1}").format(status["old"], status["new"])
	elif row.ref_doctype == "Programme Application" and status and status["new"] in APPLICATION_DECISIONS:
		kind = "application_decision"
		description = _("Application decision: {0}").format(status["new"])
	elif row.ref_doctype in CANCELLABLE and docstatus and docstatus["new"] == DOCSTATUS[2]:
		kind = "cancellation"
		description = _("{0} cancelled").format(_(row.ref_doctype))
	elif row.ref_doctype == "Refund Request" and status and status["new"] in ("Approved", "Rejected", "Paid"):
		kind = "refund_decision"
		description = _("Refund {0}").format(status["new"])
	elif row.ref_doctype in REVOCABLE and status and status["new"] == "Revoked":
		kind = "revocation"
		description = _("{0} revoked").format(_(row.ref_doctype))
	if not kind:
		return None
	return {
		"name": row.name,
		"creation": row.creation,
		"ref_doctype": row.ref_doctype,
		"docname": row.docname,
		"owner": row.owner,
		"kind": kind,
		"description": description,
	}


def _sensitive_events(conds, V, singles: set) -> list[dict]:
	doctypes = [
		"Student",
		"Programme Application",
		"Refund Request",
		*CANCELLABLE,
		*REVOCABLE,
		*singles,
	]
	relevant = V.data.like('%"status"%') | V.data.like('%"docstatus"%')
	if singles:
		relevant = relevant | V.ref_doctype.isin(list(singles))
	rows = (
		_where(
			frappe.qb.from_(V).select(V.name, V.ref_doctype, V.docname, V.owner, V.creation, V.data), conds
		)
		.where(V.ref_doctype.isin(doctypes))
		.where(relevant)
		.orderby(V.creation, order=Order.desc)
		.limit(SENSITIVE_SCAN)
		.run(as_dict=True)
	)
	events = []
	for row in rows:
		event = _sensitive_event(row, singles)
		if event:
			events.append(event)
			if len(events) >= SENSITIVE_LIMIT:
				break
	names = _full_names(e["owner"] for e in events)
	for e in events:
		e["owner_name"] = names.get(e["owner"]) or e["owner"]
	return events


def audit_summary(from_date=None, to_date=None) -> dict:
	to_date = getdate(to_date or today())
	from_date = getdate(from_date) if from_date else add_days(to_date, -29)
	if from_date > to_date:
		frappe.throw(_("From date must be on or before the to date."), frappe.ValidationError)
	if date_diff(to_date, from_date) >= MAX_SUMMARY_DAYS:
		frappe.throw(
			_("Choose a period of at most {0} days.").format(MAX_SUMMARY_DAYS), frappe.ValidationError
		)

	doctypes = app_doctypes()
	singles = {d.name for d in doctypes if d.issingle}
	V = frappe.qb.DocType("Version")
	A = frappe.qb.DocType("Activity Log")
	v_conds = [
		V.ref_doctype.isin([d.name for d in doctypes] or [""]),
		*_date_range(V.creation, from_date, to_date),
	]
	a_conds = [A.operation == "Login", *_date_range(A.creation, from_date, to_date)]

	by_doctype = (
		_where(frappe.qb.from_(V).select(V.ref_doctype, Count(V.name).as_("count")), v_conds)
		.groupby(V.ref_doctype)
		.orderby(Count(V.name), order=Order.desc)
		.limit(10)
		.run(as_dict=True)
	)
	by_user = (
		_where(frappe.qb.from_(V).select(V.owner, Count(V.name).as_("count")), v_conds)
		.groupby(V.owner)
		.orderby(Count(V.name), order=Order.desc)
		.limit(5)
		.run(as_dict=True)
	)
	changes_daily = (
		_where(frappe.qb.from_(V).select(Date(V.creation).as_("day"), Count(V.name).as_("count")), v_conds)
		.groupby(Date(V.creation))
		.run(as_dict=True)
	)
	logins_daily = (
		_where(
			frappe.qb.from_(A).select(Date(A.creation).as_("day"), A.status, Count(A.name).as_("count")),
			a_conds,
		)
		.groupby(Date(A.creation), A.status)
		.run(as_dict=True)
	)
	active_users = _where(frappe.qb.from_(A).select(Count(A.user).distinct()), a_conds).where(
		A.status == "Success"
	)

	changes = Counter({getdate(r.day): r["count"] for r in changes_daily})
	logins, failed = Counter(), Counter()
	for r in logins_daily:
		target = failed if r.status == "Failed" else logins if r.status == "Success" else None
		if target is not None:
			target[getdate(r.day)] += r["count"]
	names = _full_names(r.owner for r in by_user)
	return {
		"from_date": from_date,
		"to_date": to_date,
		"totals": {
			"changes": sum(changes.values()),
			"logins": sum(logins.values()),
			"failed_logins": sum(failed.values()),
			"active_users": active_users.run()[0][0],
		},
		"changes_by_doctype": [
			{"doctype": r.ref_doctype, "label": _(r.ref_doctype), "count": r["count"]} for r in by_doctype
		],
		"top_users": [
			{"user": r.owner, "full_name": names.get(r.owner) or r.owner, "count": r["count"]}
			for r in by_user
		],
		"sensitive_events": _sensitive_events(v_conds, V, singles),
		"daily": [
			{"date": day, "changes": changes[day], "logins": logins[day], "failed": failed[day]}
			for day in (add_days(from_date, i) for i in range(date_diff(to_date, from_date) + 1))
		],
	}


# ---------------------------------------------------------------------------------- export
def _cell(value) -> str:
	text = "" if value is None else cstr(value)
	# Neutralise spreadsheet formula injection (=, +, -, @ and control characters at the start of a cell).
	return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


def _describe(change: dict) -> str:
	old, new = ("" if v is None else v for v in (change["old"], change["new"]))
	return f"{change['label']}: {old} → {new}"


def export_csv(kind: str, filters: dict) -> tuple[str, int]:
	"""CSV text (newest first, at most EXPORT_LIMIT rows) and the number of data rows."""
	if kind == "document_changes":
		allowed = ("doctype", "docname", "user", "from_date", "to_date", "search")
		result = document_changes(**{k: filters.get(k) for k in allowed}, page_length=EXPORT_LIMIT)
		data = [
			[
				"Date",
				"DocType",
				"Document",
				"User",
				"Full Name",
				"Action",
				"Changes",
				"Rows Added",
				"Rows Removed",
			]
		]
		for r in result["rows"]:
			data.append(
				[
					r["creation"],
					r["ref_doctype"],
					r["docname"],
					r["owner"],
					r["owner_name"],
					"Created" if r["is_new"] else "Updated",
					"; ".join(_describe(c) for c in r["changed"]),
					r["added"],
					r["removed"],
				]
			)
	elif kind == "access_log":
		allowed = ("user", "operation", "status", "from_date", "to_date")
		result = access_log(**{k: filters.get(k) for k in allowed}, page_length=EXPORT_LIMIT)
		data = [["Date", "User", "Full Name", "Operation", "Status", "IP Address", "Subject"]]
		for r in result["rows"]:
			data.append([r.creation, r.user, r.full_name, r.operation, r.status, r.ip_address, r.subject])
	else:
		frappe.throw(_("Unknown export {0}.").format(kind), frappe.ValidationError)
	return to_csv([[_cell(v) for v in row] for row in data]), len(data) - 1
