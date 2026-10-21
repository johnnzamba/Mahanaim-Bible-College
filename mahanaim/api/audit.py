"""Audit trail API (B3): read-only views over Frappe Version + Activity Log for the admin portal.

Guard: Auditor, College Administrator, System Manager (Administrator always passes).
Lists are newest first and paginated with `start` / `page_length` (max 200) -> {rows, total}.
"""

from __future__ import annotations

import frappe
from frappe.utils import nowdate

from mahanaim.api.utils import page_args, parse_json, require_roles
from mahanaim.services import audit as svc
from mahanaim.utils import ROLE_AUDITOR


def _guard() -> str:
	return require_roles(ROLE_AUDITOR)


@frappe.whitelist()
def document_changes(
	doctype=None,
	docname=None,
	user=None,
	from_date=None,
	to_date=None,
	search=None,
	start=0,
	page_length=20,
):
	_guard()
	return svc.document_changes(
		doctype=doctype,
		docname=docname,
		user=user,
		from_date=from_date,
		to_date=to_date,
		search=search,
		**page_args(start, page_length),
	)


@frappe.whitelist()
def access_log(user=None, operation=None, status=None, from_date=None, to_date=None, start=0, page_length=20):
	_guard()
	return svc.access_log(
		user=user,
		operation=operation,
		status=status,
		from_date=from_date,
		to_date=to_date,
		**page_args(start, page_length),
	)


@frappe.whitelist()
def audit_summary(from_date=None, to_date=None):
	_guard()
	return svc.audit_summary(from_date=from_date, to_date=to_date)


@frappe.whitelist()
def audit_doctypes():
	_guard()
	return svc.doctype_options()


@frappe.whitelist()
def export_audit(kind, filters=None):
	"""CSV download of `document_changes` or `access_log` with the same filters (max 5000 rows)."""
	_guard()
	content, _count = svc.export_csv(kind, parse_json(filters, {}) or {})
	frappe.response["filename"] = f"audit-{kind.replace('_', '-')}-{nowdate()}.csv"
	frappe.response["filecontent"] = content
	frappe.response["type"] = "download"
