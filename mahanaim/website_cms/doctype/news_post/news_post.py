# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import nowdate

from mahanaim.services.website import clear_website_cache, ensure_route, excerpt


class NewsPost(Document):
	def validate(self):
		self.title = (self.title or "").strip()
		ensure_route(self, "title")
		if self.published and not self.published_on:
			self.published_on = nowdate()
		if not (self.content or "").strip():
			frappe.throw(_("Please write the article content."))
		if not self.excerpt:
			self.excerpt = excerpt(self.content, 240)
		if not self.meta_description:
			self.meta_description = excerpt(self.excerpt or self.content, 160)
		if not self.author:
			self.author = frappe.db.get_value("User", frappe.session.user, "full_name") or None
		self.tags = ", ".join(t.strip() for t in (self.tags or "").split(",") if t.strip()) or None

	def on_update(self):
		clear_website_cache()

	def on_trash(self):
		clear_website_cache()
