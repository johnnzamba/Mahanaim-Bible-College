# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, getdate

from mahanaim.utils import validate_transition

TRANSITIONS = {
	"Proposed": ("Active", "Cancelled"),
	"Active": ("Suspended", "Completed", "Cancelled"),
	"Suspended": ("Active", "Completed", "Cancelled"),
	"Completed": ("Active",),
	"Cancelled": ("Proposed", "Active"),
}
OPEN_STATUSES = ("Proposed", "Active", "Suspended")
ENDED_STATUSES = ("Completed", "Cancelled")


class Sponsorship(Document):
	def validate(self):
		sponsor = frappe.db.get_value("Sponsor", self.sponsor, ["sponsor_name", "status"], as_dict=True)
		if not sponsor:
			frappe.throw(_("Sponsor {0} was not found.").format(self.sponsor))
		student = frappe.db.get_value(
			"Student", self.student, ["full_name", "programme", "status"], as_dict=True
		)
		if not student:
			frappe.throw(_("Student {0} was not found.").format(self.student))
		self.sponsor_name = sponsor.sponsor_name
		self.student_name = student.full_name
		self.programme = self.programme or student.programme
		if self.status == "Active" and sponsor.status != "Active":
			frappe.throw(_("{0} is inactive; reactivate the sponsor first.").format(sponsor.sponsor_name))
		validate_transition(self, TRANSITIONS)
		self.validate_coverage()
		self.validate_terms()
		self.validate_unique()

	def validate_coverage(self):
		if flt(self.amount) < 0:
			frappe.throw(_("The amount cannot be negative."))
		if self.coverage == "Percentage":
			if not (0 < flt(self.percentage) <= 100):
				frappe.throw(_("Percentage coverage must be more than 0 and at most 100."))
		else:
			self.percentage = 0
		if self.coverage in ("Fixed Amount", "Upkeep") and flt(self.amount) <= 0:
			frappe.throw(_("Enter the amount the sponsor commits for {0} coverage.").format(_(self.coverage)))

	def validate_terms(self):
		if not (self.start_term and self.end_term):
			return
		dates = dict(
			frappe.get_all(
				"Academic Term",
				filters={"name": ["in", [self.start_term, self.end_term]]},
				fields=["name", "start_date"],
				as_list=True,
			)
		)
		start, end = dates.get(self.start_term), dates.get(self.end_term)
		if start and end and getdate(end) < getdate(start):
			frappe.throw(_("The end term cannot be before the start term."))

	def validate_unique(self):
		if self.status not in OPEN_STATUSES:
			return
		clash = frappe.db.get_value(
			"Sponsorship",
			{
				"sponsor": self.sponsor,
				"student": self.student,
				"status": ["in", OPEN_STATUSES],
				"name": ["!=", self.name or ""],
			},
			"name",
		)
		if clash:
			frappe.throw(
				_("{0} already sponsors {1} ({2}). Update that sponsorship instead.").format(
					self.sponsor_name, self.student_name, clash
				),
				frappe.DuplicateEntryError,
			)
		if self.coverage == "Full Fees" and self.status == "Active":
			other = frappe.db.get_value(
				"Sponsorship",
				{
					"student": self.student,
					"coverage": "Full Fees",
					"status": "Active",
					"name": ["!=", self.name or ""],
				},
				"sponsor_name",
			)
			if other:
				frappe.throw(_("{0} already covers full fees for {1}.").format(other, self.student_name))
		if self.coverage == "Percentage" and self.status == "Active":
			rows = frappe.get_all(
				"Sponsorship",
				filters={
					"student": self.student,
					"coverage": "Percentage",
					"status": "Active",
					"name": ["!=", self.name or ""],
				},
				fields=[{"SUM": "percentage", "as": "pct"}],
			)
			taken = flt(rows[0].pct) if rows else 0
			if taken + flt(self.percentage) > 100:
				frappe.throw(
					_("Percentage sponsorships for {0} would exceed 100% ({1}% already covered).").format(
						self.student_name, taken
					)
				)

	def on_update(self):
		from mahanaim.services.church import refresh_sponsor_totals, refresh_sponsorship_disbursed

		before = self.get_doc_before_save()
		became_active = self.status == "Active" and (not before or before.status != "Active")
		if became_active:
			self.link_student()
		elif self.status in ENDED_STATUSES and (not before or before.status not in ENDED_STATUSES):
			self.unlink_student()
		refresh_sponsorship_disbursed(self.name)
		refresh_sponsor_totals(self.sponsor)
		if before and before.sponsor != self.sponsor:
			refresh_sponsor_totals(before.sponsor)
		if became_active:
			self.notify_student()

	def link_student(self):
		student = frappe.db.get_value(
			"Student", self.student, ["primary_sponsor", "fee_category"], as_dict=True
		)
		values = {}
		if not student.primary_sponsor:
			values["primary_sponsor"] = self.sponsor
		if student.fee_category in (None, "", "Standard"):
			values["fee_category"] = "Sponsored"
		if values:
			frappe.db.set_value("Student", self.student, values)

	def unlink_student(self):
		student = frappe.db.get_value(
			"Student", self.student, ["primary_sponsor", "fee_category"], as_dict=True
		)
		if not student or student.primary_sponsor != self.sponsor:
			return
		others = frappe.get_all(
			"Sponsorship",
			filters={"student": self.student, "status": "Active", "name": ["!=", self.name]},
			fields=["sponsor"],
			order_by="creation asc",
			limit_page_length=1,
		)
		values = {"primary_sponsor": others[0].sponsor if others else None}
		if not others and student.fee_category == "Sponsored":
			values["fee_category"] = "Standard"
		frappe.db.set_value("Student", self.student, values)

	def notify_student(self):
		from mahanaim.services.communication import push_portal_notification

		user = frappe.db.get_value("Student", self.student, "user")
		if user:
			push_portal_notification(
				user,
				_("You have a sponsor"),
				_("{0} is now sponsoring your studies ({1}).").format(self.sponsor_name, _(self.coverage)),
				link="/student/finance",
				category="Finance",
				doc=self,
			)

	def on_trash(self):
		if self.status in ("Active", "Suspended", "Completed"):
			frappe.throw(_("Cancel the sponsorship instead of deleting it."))

	def after_delete(self):
		from mahanaim.services.church import refresh_sponsor_totals

		refresh_sponsor_totals(self.sponsor)
