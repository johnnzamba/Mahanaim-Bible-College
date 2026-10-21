# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import cint

from mahanaim.services.website import clear_website_cache


class FAQ(Document):
	def validate(self):
		self.question = (self.question or "").strip()
		if not self.question.endswith("?") and len(self.question) < 140:
			self.question = self.question.rstrip(".") + "?"
		if cint(self.sequence) <= 0:
			self.sequence = next_sequence(self.doctype, {"category": self.category})

	def on_update(self):
		clear_website_cache()

	def on_trash(self):
		clear_website_cache()


def next_sequence(doctype: str, filters: dict | None = None) -> int:
	rows = frappe.get_all(doctype, filters=filters or {}, fields=[{"MAX": "sequence", "as": "seq"}])
	return (cint(rows[0].seq) if rows else 0) + 10
