"""Notification engine (M15): email, SMS and in-app messages driven by Message Templates.

Usage from any controller/service:

	from mahanaim.services.communication import notify, recipient_for_student
	notify("Payment Received", doc=payment, recipients=[recipient_for_student(student)],
	       context={"amount": payment.amount}, link="/student/fees", category="Finance")

If no active template exists for the event, `fallback={"subject":..., "message":...}` is used so a
fresh site still communicates. Every message is written to Message Log.
"""

from __future__ import annotations

import json

import frappe
from frappe import _
from frappe.utils import cint, get_url, now_datetime, strip_html

from mahanaim.utils import normalize_phone, setting


# ---------------------------------------------------------------------------------- recipients
def recipient_for_user(user: str) -> dict:
	u = frappe.db.get_value("User", user, ["name", "email", "mobile_no", "full_name"], as_dict=True) or {}
	return {"user": u.get("name"), "email": u.get("email"), "phone": u.get("mobile_no"), "name": u.get("full_name")}


def recipient_for_student(student) -> dict:
	if isinstance(student, str):
		student = frappe.db.get_value("Student", student, ["user", "email", "phone", "full_name"], as_dict=True)
	return {"user": student.get("user"), "email": student.get("email"), "phone": student.get("phone"),
			"name": student.get("full_name")}


def recipient_for_application(app) -> dict:
	return {"user": app.get("user"), "email": app.get("email"), "phone": app.get("phone"), "name": app.get("full_name")}


def recipient_for_sponsor(sponsor) -> dict:
	if isinstance(sponsor, str):
		sponsor = frappe.db.get_value("Sponsor", sponsor, ["user", "email", "phone", "sponsor_name"], as_dict=True)
	return {"user": sponsor.get("user"), "email": sponsor.get("email"), "phone": sponsor.get("phone"),
			"name": sponsor.get("sponsor_name")}


# ---------------------------------------------------------------------------------- core
def _render(template: str | None, ctx: dict) -> str:
	if not template:
		return ""
	return frappe.render_template(template, ctx)


def _context(doc=None, context: dict | None = None, recipient: dict | None = None) -> dict:
	settings = frappe.get_cached_doc("Mahanaim Settings")
	ctx = {
		"doc": doc,
		"settings": settings,
		"college": settings.institution_name,
		"site_url": get_url(),
		"recipient": recipient or {},
		"frappe": frappe._dict(utils=frappe.utils, format=frappe.format),
	}
	ctx.update(context or {})
	return ctx


def notify(
	event: str,
	doc=None,
	recipients: list[dict] | None = None,
	context: dict | None = None,
	link: str | None = None,
	category: str = "Info",
	fallback: dict | None = None,
	channels: tuple[str, ...] | None = None,
):
	"""Send `event` to `recipients` across the template's channels. Never raises for delivery errors."""
	recipients = [r for r in (recipients or []) if r and (r.get("email") or r.get("phone") or r.get("user"))]
	if not recipients:
		return
	templates = frappe.get_all(
		"Message Template",
		filters={"event": event, "is_active": 1},
		fields=["name", "subject", "email_body", "sms_body", "in_app_body", "send_email", "send_sms", "send_in_app"],
	)
	if not templates and fallback:
		templates = [
			frappe._dict(
				name=None,
				subject=fallback.get("subject"),
				email_body=fallback.get("message"),
				sms_body=fallback.get("sms") or strip_html(fallback.get("message") or "")[:300],
				in_app_body=fallback.get("in_app") or strip_html(fallback.get("message") or "")[:300],
				send_email=1,
				send_sms=cint(fallback.get("send_sms")),
				send_in_app=1,
			)
		]
	for tpl in templates:
		for r in recipients:
			ctx = _context(doc, context, r)
			try:
				subject = _render(tpl.subject, ctx) or event
				if tpl.send_email and r.get("email") and (not channels or "Email" in channels):
					send_email(r["email"], subject, _render(tpl.email_body, ctx), doc, tpl.name, event, r.get("user"))
				if tpl.send_sms and r.get("phone") and (not channels or "SMS" in channels):
					send_sms(r["phone"], _render(tpl.sms_body, ctx), doc, tpl.name, event, r.get("user"))
				if tpl.send_in_app and r.get("user") and (not channels or "In-App" in channels):
					push_portal_notification(
						r["user"], subject, _render(tpl.in_app_body, ctx) or strip_html(_render(tpl.email_body, ctx))[:300],
						link=link, category=category, doc=doc,
					)
			except Exception:
				frappe.log_error(title=f"Mahanaim notify failed: {event}")


def _log(channel, recipient, subject, message, status, doc=None, template=None, event=None, user=None, response=None):
	log = frappe.get_doc(
		{
			"doctype": "Message Log",
			"channel": channel,
			"recipient": recipient,
			"user": user,
			"subject": subject,
			"message": message,
			"status": status,
			"template": template,
			"event": event,
			"sent_on": now_datetime() if status in ("Sent", "Delivered") else None,
			"provider_response": (response or "")[:1000] if response else None,
			"reference_doctype": doc.doctype if doc else None,
			"reference_name": doc.name if doc else None,
		}
	)
	log.insert(ignore_permissions=True)
	return log


def send_email(email, subject, message, doc=None, template=None, event=None, user=None):
	if not message:
		return
	frappe.sendmail(
		recipients=[email],
		subject=subject,
		message=message,
		reference_doctype=doc.doctype if doc else None,
		reference_name=doc.name if doc else None,
		now=False,
	)
	_log("Email", email, subject, message, "Queued", doc, template, event, user)


def send_sms(phone, message, doc=None, template=None, event=None, user=None):
	phone = normalize_phone(phone)
	if not phone or not message:
		return
	log = _log("SMS", phone, None, message, "Queued", doc, template, event, user)
	if frappe.flags.in_test or frappe.flags.in_install:
		frappe.db.set_value("Message Log", log.name, {"status": "Sent", "provider_response": "test-mode"})
		return
	frappe.enqueue("mahanaim.services.communication.deliver_sms", queue="short", log_name=log.name,
				   enqueue_after_commit=True)


def deliver_sms(log_name: str):
	"""Background job: push a queued SMS through the configured gateway."""
	log = frappe.get_doc("Message Log", log_name)
	settings = frappe.get_single("Mahanaim Settings")
	if not cint(settings.sms_enabled) or settings.sms_provider in (None, "", "None"):
		log.db_set({"status": "Failed", "provider_response": "SMS gateway disabled"})
		return
	try:
		if settings.sms_provider == "Africa's Talking":
			response = _send_africastalking(settings, log.recipient, log.message)
		else:
			response = _send_generic(settings, log.recipient, log.message)
		log.db_set({"status": "Sent", "sent_on": now_datetime(), "provider_response": str(response)[:1000]})
	except Exception as e:
		log.db_set({"status": "Failed", "retries": cint(log.retries) + 1, "provider_response": str(e)[:1000]})
		frappe.log_error(title="Mahanaim SMS delivery failed")


def _send_africastalking(settings, phone, message):
	import requests

	username = settings.sms_username
	host = "api.sandbox.africastalking.com" if username == "sandbox" else "api.africastalking.com"
	data = {"username": username, "to": "+" + phone, "message": message}
	if settings.sms_sender_id:
		data["from"] = settings.sms_sender_id
	r = requests.post(
		f"https://{host}/version1/messaging",
		data=data,
		headers={"apiKey": settings.get_password("sms_api_key"), "Accept": "application/json"},
		timeout=20,
	)
	r.raise_for_status()
	return r.json()


def _send_generic(settings, phone, message):
	import requests

	template = settings.sms_generic_payload or '{"to": "{to}", "message": "{message}", "sender": "{sender}"}'
	body = (
		template.replace("{to}", phone)
		.replace("{message}", json.dumps(message)[1:-1])
		.replace("{sender}", settings.sms_sender_id or "")
	)
	headers = {"Content-Type": "application/json"}
	key = settings.get_password("sms_api_key", raise_exception=False)
	if key:
		headers["Authorization"] = f"Bearer {key}"
	r = requests.post(settings.sms_generic_url, data=body.encode(), headers=headers, timeout=20)
	r.raise_for_status()
	return r.text


def push_portal_notification(user, title, message=None, link=None, category="Info", doc=None):
	if not user or user == "Guest":
		return
	n = frappe.get_doc(
		{
			"doctype": "Portal Notification",
			"user": user,
			"title": (title or "")[:140],
			"message": message,
			"link": link,
			"category": category if category in (
				"Info", "Academic", "Finance", "Admissions", "Exam", "Announcement", "Event", "System"
			) else "Info",
			"reference_doctype": doc.doctype if doc else None,
			"reference_name": doc.name if doc else None,
		}
	)
	n.insert(ignore_permissions=True)
	_log("In-App", user, title, message, "Sent", doc, None, None, user)
	frappe.publish_realtime("mbc_notification", {"title": n.title, "link": link, "category": n.category}, user=user,
							after_commit=True)
	return n.name


# ---------------------------------------------------------------------------------- announcements
def announcement_recipients(ann) -> list[dict]:
	aud = ann.audience
	fields = ["user", "email", "phone", "full_name"]
	active = ["in", ["Registered", "Active"]]
	rows = []
	if aud in ("All Students", "Everyone"):
		rows += frappe.get_all("Student", filters={"status": active}, fields=fields)
	if aud == "Programme" and ann.programme:
		rows += frappe.get_all("Student", filters={"status": active, "programme": ann.programme}, fields=fields)
	if aud == "Campus" and ann.campus:
		rows += frappe.get_all("Student", filters={"status": active, "campus": ann.campus}, fields=fields)
	if aud == "Course Offering" and ann.course_offering:
		students = frappe.get_all(
			"Course Enrolment", filters={"course_offering": ann.course_offering, "status": "Enrolled"}, pluck="student"
		)
		if students:
			rows += frappe.get_all("Student", filters={"name": ["in", students]}, fields=fields)
	if aud in ("All Staff", "Everyone", "Lecturers"):
		f = {"status": "Active"}
		if aud == "Lecturers":
			f["is_lecturer"] = 1
		rows += [
			{"user": s.user, "email": s.email, "phone": s.phone, "full_name": s.full_name}
			for s in frappe.get_all("Staff Member", filters=f, fields=["user", "email", "phone", "full_name"])
		]
	if aud == "Applicants":
		rows += frappe.get_all(
			"Programme Application",
			filters={"status": ["in", ["Submitted", "Under Review", "Interview", "Admitted", "Waitlisted"]]},
			fields=fields,
		)
	if aud == "Sponsors":
		rows += [
			{"user": s.user, "email": s.email, "phone": s.phone, "full_name": s.sponsor_name}
			for s in frappe.get_all("Sponsor", filters={"status": "Active"}, fields=["user", "email", "phone", "sponsor_name"])
		]
	if aud == "Alumni":
		rows += frappe.get_all("Student", filters={"status": "Alumni"}, fields=fields)
	seen, out = set(), []
	for r in rows:
		key = r.get("user") or r.get("email") or r.get("phone")
		if key and key not in seen:
			seen.add(key)
			out.append({"user": r.get("user"), "email": r.get("email"), "phone": r.get("phone"), "name": r.get("full_name")})
	return out


def send_announcement(name: str):
	ann = frappe.get_doc("Announcement", name)
	recipients = announcement_recipients(ann)
	channels = []
	if cint(ann.send_email):
		channels.append("Email")
	if cint(ann.send_sms):
		channels.append("SMS")
	if channels:
		message = ann.body
		notify(
			"Announcement",
			doc=ann,
			recipients=recipients,
			context={"announcement": ann},
			category="Announcement",
			fallback={"subject": ann.title, "message": message, "send_sms": cint(ann.send_sms)},
			channels=tuple(channels),
		)
	ann.db_set({"status": "Sent", "sent_on": now_datetime(), "recipients_count": len(recipients)})
	return len(recipients)


def dispatch_scheduled_announcements():
	due = frappe.get_all(
		"Announcement", filters={"status": "Scheduled", "publish_on": ["<=", now_datetime()]}, pluck="name"
	)
	for name in due:
		try:
			send_announcement(name)
			frappe.db.commit()
		except Exception:
			frappe.db.rollback()
			frappe.log_error(title=f"Announcement dispatch failed: {name}")
