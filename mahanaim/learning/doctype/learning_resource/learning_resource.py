# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import os

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint
from frappe.utils.html_utils import sanitize_html

FILE_TYPES = {
	"PDF": {"pdf"},
	"Document": {
		"pdf",
		"doc",
		"docx",
		"odt",
		"rtf",
		"txt",
		"ppt",
		"pptx",
		"odp",
		"xls",
		"xlsx",
		"ods",
		"csv",
	},
	"Video": {"mp4", "webm", "mov", "m4v", "ogv"},
	"Audio": {"mp3", "wav", "ogg", "oga", "m4a", "aac"},
	"Image": {"png", "jpg", "jpeg", "gif", "webp", "svg"},
}
URL_TYPES = ("Link", "Video", "Audio")


def _is_url(value: str | None, https_only: bool = False) -> bool:
	value = (value or "").strip().lower()
	return value.startswith("https://") or (not https_only and value.startswith("http://"))


class LearningResource(Document):
	def validate(self):
		self.title = (self.title or "").strip()
		if self.course_module:
			module_offering = frappe.db.get_value("Course Module", self.course_module, "course_offering")
			if module_offering != self.course_offering:
				frappe.throw(
					_("Module {0} belongs to a different course offering.").format(self.course_module)
				)
		self.sequence = max(cint(self.sequence), 1)
		if cint(self.duration_minutes) < 0:
			frappe.throw(_("Duration cannot be negative."))
		self.validate_content()

	def validate_content(self):
		rtype = self.resource_type
		self.url = (self.url or "").strip() or None
		self.embed_url = (self.embed_url or "").strip() or None
		if rtype == "Text":
			if not (self.body or "").strip():
				frappe.throw(_("Add the text content for this resource."))
			self.body = sanitize_html(self.body)
			self.file = self.url = self.embed_url = None
			return
		if rtype == "Embed":
			if not _is_url(self.embed_url, https_only=True):
				frappe.throw(_("Embed resources need an https:// embed URL."))
			self.file = self.url = None
			return
		if rtype == "Link":
			if not _is_url(self.url):
				frappe.throw(_("Link resources need a valid http(s) URL."))
			self.file = self.embed_url = None
			return
		# file based types (Video/Audio may alternatively use a URL)
		if self.url and rtype in URL_TYPES and not self.file:
			if not _is_url(self.url):
				frappe.throw(_("The URL must start with https://"))
			return
		if not self.file:
			frappe.throw(_("Upload a file for this {0} resource.").format(_(rtype)))
		ext = os.path.splitext(self.file.split("?")[0])[1].lower().lstrip(".")
		allowed = FILE_TYPES.get(rtype)
		if allowed and ext not in allowed:
			frappe.throw(
				_("A {0} resource must be one of: {1}.").format(_(rtype), ", ".join(sorted(allowed)))
			)
		self.embed_url = None
		if rtype not in URL_TYPES:
			self.url = None

	def on_update(self):
		if self.file and self.has_value_changed("file"):
			file_name = frappe.db.get_value(
				"File", {"file_url": self.file, "attached_to_name": ["is", "not set"]}
			)
			if file_name:
				frappe.db.set_value(
					"File",
					file_name,
					{
						"attached_to_doctype": self.doctype,
						"attached_to_name": self.name,
						"attached_to_field": "file",
					},
					update_modified=False,
				)

	def on_trash(self):
		frappe.db.delete("Learning Progress", {"learning_resource": self.name})
