"""Jinja helpers for print formats (admission letter, receipts, transcripts, certificates)."""

from __future__ import annotations

import base64
import io

import frappe
from frappe.utils import get_url

from mahanaim.utils import fmt_money, setting


def qr_data_uri(text: str, scale: int = 4) -> str:
	"""Return a PNG data URI for `text` (uses pyqrcode + pypng, both shipped with Frappe)."""
	import pyqrcode

	qr = pyqrcode.create(text or "", error="M")
	buf = io.BytesIO()
	qr.png(buf, scale=scale, module_color=(20, 55, 42), background=(255, 255, 255))
	return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def money(amount, with_currency=True) -> str:
	return fmt_money(amount, with_currency)


def mbc_settings():
	return frappe.get_cached_doc("Mahanaim Settings")


def verification_url(code: str) -> str:
	base = (setting("verification_base_url") or get_url("/verify")).rstrip("/")
	return f"{base}/{code}"


def absolute_file_url(path: str | None) -> str:
	if not path:
		return ""
	if path.startswith("http"):
		return path
	return get_url(path)
