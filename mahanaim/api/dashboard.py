"""Admin dashboard, reports, global search and campus comparison (backend domain B4, M16 + M20).

Guard: any staff role (`require_staff`). Dashboard sections, reports and search groups are further filtered by the
caller's roles (finance data → Finance Officer/Auditor; academic → Academic Dean/Registrar; College Administrator and
System Manager see everything).
"""

from __future__ import annotations

import hashlib

import frappe
from frappe import _
from frappe.utils import cint, nowdate

from mahanaim.api.utils import parse_json, require_staff
from mahanaim.services import dashboard as svc

OVERVIEW_TTL = 60


@frappe.whitelist()
def admin_overview(refresh=0):
	require_staff()
	roles = svc.roles_of()
	sections = svc.visible_sections(roles)
	key = "mbc:dash:overview:" + hashlib.md5(",".join(sorted(sections)).encode()).hexdigest()
	use_cache = not frappe.flags.in_test and not cint(refresh)
	if use_cache:
		cached = frappe.cache.get_value(key)
		if cached:
			return cached
	data = svc.overview(sections)
	if use_cache:
		frappe.cache.set_value(key, data, expires_in_sec=OVERVIEW_TTL)
	return data


@frappe.whitelist()
def reports_catalog():
	require_staff()
	return svc.catalog(svc.roles_of())


@frappe.whitelist()
def run_report(report: str, filters=None):
	require_staff()
	return svc.run(report, parse_json(filters, {}) or {}, svc.roles_of())


@frappe.whitelist()
def export_report(report: str, filters=None):
	"""CSV export of `run_report`: `{filename, content, mimetype, rows}` (the SPA turns `content` into a download)."""
	require_staff()
	result = svc.run(report, parse_json(filters, {}) or {}, svc.roles_of())
	return {
		"filename": f"{report}-{nowdate()}.csv",
		"content": svc.to_csv(result),
		"mimetype": "text/csv",
		"rows": len(result["rows"]),
	}


@frappe.whitelist()
def global_search(q: str | None = None, limit=8):
	"""Pinned contract: flat list of `{type, title, subtitle, route}` (plus `name`, `doctype`), `limit` per type."""
	require_staff()
	limit = min(max(cint(limit) or 8, 1), 20)
	return svc.global_search(q or "", svc.roles_of(), limit)


@frappe.whitelist()
def campus_comparison():
	require_staff()
	roles = svc.roles_of()
	data = svc.campus_comparison()
	if not svc.allowed(roles, svc.FINANCE_ROLES):
		for row in data["campuses"]:
			for k in ("billed", "collected", "outstanding", "collection_rate"):
				row[k] = None
		for k in ("billed", "collected", "outstanding"):
			data["totals"][k] = None
	return data
