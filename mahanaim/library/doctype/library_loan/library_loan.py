# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, getdate, nowdate

from mahanaim.services import library as lib
from mahanaim.utils import validate_transition

TRANSITIONS = {
	"Requested": ("Issued", "Cancelled"),
	"Issued": ("Returned", "Overdue", "Lost"),
	"Overdue": ("Returned", "Lost", "Issued"),
	"Lost": ("Returned",),
	"Returned": (),
	"Cancelled": ("Requested",),
}


class LibraryLoan(Document):
	def validate(self):
		self.status = self.status or "Issued"
		validate_transition(self, TRANSITIONS)
		before = self.get_doc_before_save()
		self.prev_status = before.status if before else None
		item = frappe.db.get_value(
			"Library Item",
			self.library_item,
			["title", "is_active", "total_copies", "item_type"],
			as_dict=True,
		)
		if not item:
			frappe.throw(_("Library item {0} was not found.").format(self.library_item))
		self.item_title = item.title
		self.set_borrower()
		self.set_dates()
		if self.status in ("Requested", "Issued") and self.prev_status != self.status:
			if not item.is_active:
				frappe.throw(_("{0} is not available for borrowing.").format(item.title))
			self.validate_duplicate()
		if self.status == "Issued" and self.prev_status in (None, "Requested"):
			self.validate_issue()
		self.set_fine()

	def set_borrower(self):
		if self.borrower_type == "Staff":
			self.student = None
			if not self.staff_member:
				frappe.throw(_("Select the staff member borrowing the item."))
			b = frappe.db.get_value("Staff Member", self.staff_member, ["full_name", "status"], as_dict=True)
		else:
			self.borrower_type = "Student"
			self.staff_member = None
			if not self.student:
				frappe.throw(_("Select the student borrowing the item."))
			b = frappe.db.get_value("Student", self.student, ["full_name", "status"], as_dict=True)
		if not b:
			frappe.throw(_("The borrower was not found."))
		self.borrower_name = b.full_name
		self.borrower_status = b.status

	def set_dates(self):
		before = self.get_doc_before_save()
		if self.status == "Issued" and self.prev_status == "Requested":
			self.issue_date = nowdate()
			if before and str(before.due_date or "") == str(self.due_date or ""):
				self.due_date = None  # the request's provisional due date restarts from the issue date
		self.issue_date = self.issue_date or nowdate()
		self.due_date = self.due_date or lib.default_due_date(self.issue_date)
		if getdate(self.due_date) < getdate(self.issue_date):
			frappe.throw(_("The due date cannot be before the issue date."))
		if self.status == "Returned":
			self.return_date = self.return_date or nowdate()
			if getdate(self.return_date) < getdate(self.issue_date):
				frappe.throw(_("The return date cannot be before the issue date."))
		elif self.status != "Lost":
			self.return_date = None

	def validate_duplicate(self):
		field = "student" if self.borrower_type == "Student" else "staff_member"
		clash = frappe.db.get_value(
			"Library Loan",
			{
				"library_item": self.library_item,
				field: self.get(field),
				"status": ["in", lib.OPEN_STATUSES],
				"name": ["!=", self.name or ""],
			},
			["name", "status"],
			as_dict=True,
		)
		if clash:
			frappe.throw(
				_("{0} already has this item ({1}, {2}).").format(
					self.borrower_name, clash.name, _(clash.status)
				),
				frappe.DuplicateEntryError,
			)

	def validate_issue(self):
		if self.borrower_type == "Student" and self.borrower_status not in (
			"Registered",
			"Active",
			"Admitted",
		):
			frappe.throw(
				_("{0} is {1} and cannot borrow items.").format(self.borrower_name, _(self.borrower_status))
			)
		if self.borrower_type == "Staff" and self.borrower_status not in (None, "", "Active"):
			frappe.throw(_("{0} is not an active staff member.").format(self.borrower_name))
		borrower = self.student or self.staff_member
		if lib.active_loan_count(self.borrower_type, borrower, exclude=self.name) >= lib.MAX_ACTIVE_LOANS:
			frappe.throw(
				_("{0} already has {1} items on loan (the maximum).").format(
					self.borrower_name, lib.MAX_ACTIVE_LOANS
				)
			)
		if lib.lock_available_copies(self.library_item, exclude=self.name) <= 0:
			frappe.throw(_("No copies of {0} are available right now.").format(self.item_title))
		self.issued_by = frappe.session.user

	def set_fine(self):
		if self.fine_paid:
			return
		if self.status in ("Requested", "Cancelled"):
			self.fine_amount = 0
		elif self.status in ("Overdue", "Returned", "Lost") or getdate(self.due_date) < getdate(nowdate()):
			as_of = self.return_date if self.status == "Returned" else None
			# max(): a renewed loan keeps the fine it accrued before renewal
			self.fine_amount = max(flt(self.fine_amount), lib.compute_fine(self.due_date, as_of))

	def on_update(self):
		if self.status != self.prev_status:
			if self.status == "Lost":
				self.write_off_copy(-1)
			elif self.prev_status == "Lost" and self.status == "Returned":
				self.write_off_copy(1)
		lib.refresh_item_counts(self.library_item)
		before = self.get_doc_before_save()
		if before and before.library_item != self.library_item:
			lib.refresh_item_counts(before.library_item)

	def write_off_copy(self, delta: int):
		LI = frappe.qb.DocType("Library Item")
		frappe.qb.update(LI).set(LI.total_copies, LI.total_copies + delta).where(
			(LI.name == self.library_item) & (LI.total_copies + delta >= 0)
		).run()

	def on_trash(self):
		if self.status not in ("Requested", "Cancelled"):
			frappe.throw(_("Only requests can be deleted; return or mark the loan lost instead."))

	def after_delete(self):
		lib.refresh_item_counts(self.library_item)
