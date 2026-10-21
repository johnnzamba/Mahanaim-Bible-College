# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import validate_email_address

from mahanaim.services.website import clear_website_cache

URL_FIELDS = (
	"hero_cta_link",
	"announcement_link",
	"hero_video_url",
	"map_embed_url",
	"facebook",
	"youtube",
	"instagram",
	"x_twitter",
)


class CampusWebsiteSettings(Document):
	def validate(self):
		if self.contact_email:
			self.contact_email = self.contact_email.strip().lower()
			validate_email_address(self.contact_email, throw=True)
		for field in URL_FIELDS:
			value = (self.get(field) or "").strip()
			if value and not (value.startswith(("/", "https://", "http://"))):
				frappe.throw(
					_("{0} must be a full https:// link or a site path starting with /.").format(
						_(self.meta.get_label(field))
					)
				)
			self.set(field, value or None)
		for field in ("stat_students", "stat_graduates", "stat_churches", "stat_years"):
			if (self.get(field) or 0) < 0:
				frappe.throw(_("{0} cannot be negative.").format(_(self.meta.get_label(field))))

	def on_update(self):
		clear_website_cache()
