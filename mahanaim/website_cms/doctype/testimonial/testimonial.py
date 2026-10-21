# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint

from mahanaim.services.website import clear_website_cache
from mahanaim.website_cms.doctype.faq.faq import next_sequence

MAX_QUOTE = 600


class Testimonial(Document):
	def validate(self):
		self.person_name = " ".join((self.person_name or "").split())
		self.quote = (self.quote or "").strip().strip('"“”').strip()
		if not self.quote:
			frappe.throw(_("Please enter the testimonial quote."))
		if len(self.quote) > MAX_QUOTE:
			frappe.throw(
				_("Keep testimonials under {0} characters so they fit on the home page.").format(MAX_QUOTE)
			)
		if cint(self.sequence) <= 0:
			self.sequence = next_sequence(self.doctype)

	def on_update(self):
		clear_website_cache()

	def on_trash(self):
		clear_website_cache()
