# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

from datetime import timedelta

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, flt, format_datetime, get_datetime

from mahanaim.services.website import (
	DEFAULT_EVENT_HOURS,
	clear_website_cache,
	ensure_route,
	seats_taken,
	status_for_dates,
)


class CampusEvent(Document):
	def validate(self):
		self.title = (self.title or "").strip()
		ensure_route(self, "title")
		self.validate_dates()
		self.validate_registration()
		if self.status not in ("Draft", "Cancelled"):
			self.status = status_for_dates(self)

	def validate_dates(self):
		start = get_datetime(self.start_datetime)
		if not self.end_datetime:
			self.end_datetime = start + timedelta(hours=DEFAULT_EVENT_HOURS)
		if get_datetime(self.end_datetime) <= start:
			frappe.throw(_("The event must end after it starts."))
		if self.registration_deadline and get_datetime(self.registration_deadline) > get_datetime(
			self.end_datetime
		):
			frappe.throw(_("The registration deadline cannot be after the event ends."))

	def validate_registration(self):
		if cint(self.capacity) < 0:
			frappe.throw(_("Capacity cannot be negative."))
		if flt(self.fee) < 0:
			frappe.throw(_("The event fee cannot be negative."))
		if not self.is_new() and cint(self.capacity):
			taken = seats_taken(self.name)
			if cint(self.capacity) < taken:
				frappe.throw(_("Capacity cannot be lower than the {0} seats already taken.").format(taken))

	def on_update(self):
		clear_website_cache()
		before = self.get_doc_before_save()
		if before and before.status != "Cancelled" and self.status == "Cancelled":
			self.notify_cancellation()

	def on_trash(self):
		if frappe.db.exists("Event Registration", {"campus_event": self.name, "status": ["!=", "Cancelled"]}):
			frappe.throw(_("This event has registrations. Cancel the event instead of deleting it."))
		clear_website_cache()

	def notify_cancellation(self):
		"""Tell everyone still holding a seat (or waiting for one) that the event is off."""
		from mahanaim.services.communication import notify

		regs = frappe.get_all(
			"Event Registration",
			filters={"campus_event": self.name, "status": ["in", ["Registered", "Confirmed", "Waitlisted"]]},
			fields=["full_name", "email", "phone", "user"],
		)
		if not regs:
			return
		# The fallback copy is used until an active "Event Cancelled" Message Template exists.
		notify(
			"Event Cancelled",
			doc=self,
			recipients=[
				{"user": r.user, "email": r.email, "phone": r.phone, "name": r.full_name} for r in regs
			],
			context={"event": self},
			link=f"/events/{self.route}",
			category="Event",
			fallback={
				"subject": _("Cancelled: {0}").format(self.title),
				"message": _("We are sorry — {0} scheduled for {1} has been cancelled.").format(
					self.title, format_datetime(self.start_datetime, "d MMM yyyy, h:mm a")
				),
			},
		)
