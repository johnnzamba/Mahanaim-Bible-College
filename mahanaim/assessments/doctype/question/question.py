# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, flt, strip_html

OPTION_TYPES = ("Multiple Choice", "Multiple Select")
TEXT_TYPES = ("Short Answer", "Fill in the Blank")


class Question(Document):
	def validate(self):
		if flt(self.marks) <= 0:
			frappe.throw(_("Marks must be greater than zero."))
		text = " ".join(strip_html(self.question or "").split())
		if not text and "<img" not in (self.question or ""):
			frappe.throw(_("Enter the question text."))
		self.question_title = (text or _("Image question"))[:140]
		self.topic = (self.topic or "").strip() or None
		if not self.created_by_staff:
			self.created_by_staff = frappe.db.get_value("Staff Member", {"user": frappe.session.user}, "name")
		self.validate_by_type()
		self.guard_live_exams()

	def validate_by_type(self):
		qtype = self.question_type
		if qtype in OPTION_TYPES:
			opts = [o for o in self.options if (o.option_text or "").strip()]
			if len(opts) != len(self.options):
				frappe.throw(_("Options cannot be blank."))
			if len(opts) < 2:
				frappe.throw(_("Add at least two options."))
			texts = [" ".join(strip_html(o.option_text).split()).casefold() for o in opts]
			if len(set(texts)) != len(texts):
				frappe.throw(_("Options must be unique."))
			correct = len([o for o in opts if cint(o.is_correct)])
			if qtype == "Multiple Choice" and correct != 1:
				frappe.throw(_("A multiple choice question needs exactly one correct option."))
			if qtype == "Multiple Select" and correct < 1:
				frappe.throw(_("Mark at least one option as correct."))
		else:
			self.set("options", [])
		if qtype == "True or False":
			if self.correct_boolean not in ("True", "False"):
				frappe.throw(_("Select whether the statement is True or False."))
		else:
			self.correct_boolean = None
		if qtype in TEXT_TYPES:
			answers = [a.strip() for a in (self.accepted_answers or "").splitlines() if a.strip()]
			if not answers:
				frappe.throw(_("Add at least one accepted answer (one per line)."))
			self.accepted_answers = "\n".join(dict.fromkeys(answers))
		else:
			self.accepted_answers = None
			self.case_sensitive = 0
		if qtype == "Matching":
			if len(self.matching_pairs) < 2:
				frappe.throw(_("Add at least two matching pairs."))
			prompts = [(p.prompt or "").strip().casefold() for p in self.matching_pairs]
			if len(set(prompts)) != len(prompts):
				frappe.throw(_("Matching prompts must be unique."))
			for p in self.matching_pairs:
				p.prompt, p.match = (p.prompt or "").strip(), (p.match or "").strip()
				if not p.prompt or not p.match:
					frappe.throw(_("Each matching pair needs a prompt and a match."))
		else:
			self.set("matching_pairs", [])
		if qtype != "Essay":
			self.marking_guide = None

	def guard_live_exams(self):
		if self.is_new():
			return
		live = frappe.get_all(
			"Exam Question",
			filters={"question": self.name, "parenttype": "Exam"},
			pluck="parent",
		)
		if live and frappe.db.exists(
			"Exam", {"name": ["in", live], "status": ["in", ["Open", "Closed", "Marking"]]}
		):
			before = self.get_doc_before_save()
			if before is not None and self.answer_signature(before) != self.answer_signature(self):
				frappe.throw(
					_(
						"This question is used in an exam that is open or being marked; its answers cannot change now."
					)
				)

	@staticmethod
	def answer_signature(doc) -> tuple:
		return (
			doc.get("question_type"),
			tuple((o.name, o.option_text, cint(o.is_correct)) for o in doc.get("options") or []),
			tuple((p.name, p.prompt, p.match) for p in doc.get("matching_pairs") or []),
			doc.get("correct_boolean"),
			doc.get("accepted_answers"),
			cint(doc.get("case_sensitive")),
			flt(doc.get("marks")),
		)
