# Copyright (c) 2026, Mahanaim Bible College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, flt, get_datetime, now_datetime, validate_email_address

from mahanaim.services.website import SEAT_STATUSES, effective_status, refresh_event_counts, seats_taken
from mahanaim.utils import normalize_phone, validate_transition

TRANSITIONS = {
	"Registered": ("Confirmed", "Attended", "Cancelled", "Waitlisted"),
	"Confirmed": ("Attended", "Cancelled", "Registered"),
	"Waitlisted": ("Registered", "Confirmed", "Cancelled"),
	"Attended": ("Confirmed",),
	"Cancelled": ("Registered",),
}
MAX_ATTENDEES = 20


class EventRegistration(Document):
	def validate(self):
		event = self.get_event()
		self.event_title = event.title
		self.clean_contact()
		self.link_user()
		validate_transition(self, TRANSITIONS)
		if self.is_new():
			self.validate_open(event)
			self.validate_duplicate()
		self.validate_capacity(event)
		self.set_payment(event)
		if self.status == "Attended" and not self.checked_in_on:
			self.checked_in_on = now_datetime()
		elif self.status != "Attended":
			self.checked_in_on = None

	def get_event(self):
		event = frappe.db.get_value(
			"Campus Event",
			self.campus_event,
			[
				"name",
				"title",
				"route",
				"status",
				"start_datetime",
				"end_datetime",
				"registration_required",
				"registration_deadline",
				"capacity",
				"fee",
			],
			as_dict=True,
		)
		if not event:
			frappe.throw(_("Event {0} was not found.").format(self.campus_event))
		return event

	def clean_contact(self):
		self.full_name = " ".join((self.full_name or "").split())
		if not self.full_name:
			frappe.throw(_("Please enter your full name."))
		self.email = (self.email or "").strip().lower() or None
		if self.email:
			validate_email_address(self.email, throw=True)
		self.phone = normalize_phone(self.phone)
		if not self.email and not self.phone:
			frappe.throw(_("Please give an email address or phone number so we can reach you."))
		self.attendees = cint(self.attendees) or 1
		if self.attendees < 1 or self.attendees > MAX_ATTENDEES:
			frappe.throw(_("A single registration can cover between 1 and {0} people.").format(MAX_ATTENDEES))

	def link_user(self):
		if self.is_new() and not self.user and not self.flags.ignore_session_user:
			if frappe.session.user not in ("Guest", "Administrator"):
				self.user = frappe.session.user
		if self.user and not self.student:
			self.student = frappe.db.get_value("Student", {"user": self.user}, "name")

	def validate_open(self, event):
		if self.flags.staff_override:
			return
		status = effective_status(event)
		if status in ("Draft", "Cancelled", "Completed"):
			frappe.throw(_("Registration for {0} is closed.").format(event.title))
		if event.registration_deadline and now_datetime() > get_datetime(event.registration_deadline):
			frappe.throw(_("The registration deadline for {0} has passed.").format(event.title))

	def validate_duplicate(self):
		if not self.email:
			return
		existing = frappe.db.get_value(
			"Event Registration",
			{
				"campus_event": self.campus_event,
				"email": self.email,
				"status": ["!=", "Cancelled"],
				"name": ["!=", self.name or ""],
			},
			"name",
		)
		if existing:
			frappe.throw(
				_("{0} is already registered for this event (ref {1}).").format(self.email, existing),
				frappe.DuplicateEntryError,
			)

	def validate_capacity(self, event):
		capacity = cint(event.capacity)
		if not capacity or self.status not in SEAT_STATUSES:
			return
		before = self.get_doc_before_save()
		if before and before.status in SEAT_STATUSES and cint(before.attendees) >= self.attendees:
			return  # not asking for more seats than already held
		taken = seats_taken(self.campus_event, exclude=None if self.is_new() else self.name)
		if taken + self.attendees <= capacity:
			return
		if self.is_new() and self.status == "Registered":
			self.status = "Waitlisted"
			return
		frappe.throw(
			_("Only {0} seat(s) are left for this event.").format(max(capacity - taken, 0)),
			title=_("Event full"),
		)

	def set_payment(self, event):
		fee = flt(event.fee)
		if fee <= 0:
			if self.payment_status != "Waived":
				self.payment_status = "Not Required"
			self.amount = 0
			return
		self.amount = fee * self.attendees
		if self.payment_status in (None, "", "Not Required"):
			self.payment_status = "Pending"

	def after_insert(self):
		if self.status == "Waitlisted":
			self.notify_waitlisted()
		elif self.payment_status != "Pending":
			self.notify_registrant()

	def on_update(self):
		refresh_event_counts(self.campus_event)
		before = self.get_doc_before_save()
		if before and before.status == "Waitlisted" and self.status in ("Registered", "Confirmed"):
			self.notify_registrant()

	def after_delete(self):
		refresh_event_counts(self.campus_event)

	def _recipient(self):
		return {"user": self.user, "email": self.email, "phone": self.phone, "name": self.full_name}

	def _event_link(self):
		route = frappe.db.get_value("Campus Event", self.campus_event, "route")
		return f"/events/{route}" if route else "/events"

	def notify_registrant(self):
		from mahanaim.services.communication import notify

		notify(
			"Event Registration",
			doc=self,
			recipients=[self._recipient()],
			context={"registration": self},
			link=self._event_link(),
			category="Event",
			fallback={
				"subject": _("You're registered: {0}").format(self.event_title),
				"message": _(
					"<p>Dear {0},</p><p>Your registration for <b>{1}</b> is confirmed (ref {2}).</p>"
				).format(
					frappe.utils.escape_html(self.full_name),
					frappe.utils.escape_html(self.event_title),
					self.name,
				),
			},
		)

	def notify_waitlisted(self):
		from mahanaim.services.communication import notify

		# The fallback copy is used until an active "Event Waitlist" Message Template exists.
		notify(
			"Event Waitlist",
			doc=self,
			recipients=[self._recipient()],
			context={"registration": self},
			link=self._event_link(),
			category="Event",
			fallback={
				"subject": _("Waiting list: {0}").format(self.event_title),
				"message": _(
					"<p>Dear {0},</p><p>{1} is fully booked, so you are on the waiting list (ref {2}). "
					"We will let you know as soon as a seat opens up.</p>"
				).format(
					frappe.utils.escape_html(self.full_name),
					frappe.utils.escape_html(self.event_title),
					self.name,
				),
			},
		)
