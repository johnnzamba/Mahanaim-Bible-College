"""Human-facing reference numbers (student numbers, serials, verification codes)."""

from __future__ import annotations

import re
import secrets

import frappe
from frappe import _
from frappe.model.naming import getseries
from frappe.utils import getdate, nowdate

from mahanaim.utils import setting

# No 0/O/1/I/L — codes are read aloud and typed from paper.
_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"


def render_number(fmt: str, tokens: dict) -> str:
	"""Render a format like `MBC/{programme_code}/{year}/{####}` using an atomic series per prefix."""
	m = re.search(r"\{(#+)\}", fmt)
	if not m:
		frappe.throw(_("Number format {0} needs a {{####}} sequence token").format(fmt))
	prefix = fmt[: m.start()]
	suffix = fmt[m.end() :]
	for key, value in tokens.items():
		prefix = prefix.replace("{" + key + "}", str(value or ""))
		suffix = suffix.replace("{" + key + "}", str(value or ""))
	digits = len(m.group(1))
	# getseries keeps one atomic counter per distinct prefix (tabSeries), so numbering restarts per
	# programme/year exactly as the registrar expects.
	seq = getseries(prefix, digits)
	return f"{prefix}{seq}{suffix}"


def next_student_number(programme: str, campus: str | None = None, date=None) -> str:
	fmt = setting("student_number_format") or "MBC/{programme_code}/{year}/{####}"
	date = getdate(date or nowdate())
	prog_code = frappe.db.get_value("Programme", programme, "code") or programme
	campus_code = frappe.db.get_value("Campus", campus, "code") if campus else ""
	tokens = {
		"programme_code": (prog_code or "").upper(),
		"campus_code": (campus_code or "").upper(),
		"year": date.year,
		"yy": str(date.year)[-2:],
		"short_name": setting("short_name", "MBC"),
	}
	number = render_number(fmt, tokens)
	while frappe.db.exists("Student", {"student_number": number}):
		number = render_number(fmt, tokens)
	return number


def new_verification_code(length: int = 10, doctype: str | None = None, field: str = "verification_code") -> str:
	"""Random, unambiguous, URL-safe code; unique within `doctype.field` when given."""
	for _attempt in range(20):
		code = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(length))
		if not doctype or not frappe.db.exists(doctype, {field: code}):
			return code
	frappe.throw(_("Could not generate a unique verification code"))


def next_serial(prefix: str, digits: int = 5) -> str:
	"""e.g. next_serial('MBC/CERT/2026/') -> 'MBC/CERT/2026/00001'"""
	return f"{prefix}{getseries(prefix, digits)}"
