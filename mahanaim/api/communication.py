"""Communication endpoints: portal notifications/announcements and the staff messaging centre (B4).

Builds on `mahanaim.services.communication` (notify / send_email / send_sms / push_portal_notification /
announcement_recipients / send_announcement) and `mahanaim.services.messaging`.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cint, cstr, get_datetime, getdate, now_datetime, strip_html

from mahanaim.api.utils import clean_payload, page_args, parse_json, require_login, require_roles
from mahanaim.services import messaging
from mahanaim.services.communication import _context, _render, announcement_recipients, send_sms
from mahanaim.utils import (
	ROLE_ADMISSIONS,
	ROLE_COMMS,
	ROLE_DEAN,
	ROLE_FINANCE,
	ROLE_LECTURER,
	ROLE_REGISTRAR,
	normalize_phone,
)

ANNOUNCE_ROLES = (*messaging.ANNOUNCER_ROLES, ROLE_LECTURER)
COMMS_ROLES = (ROLE_COMMS,)
DIRECT_ROLES = (ROLE_COMMS, ROLE_REGISTRAR, ROLE_ADMISSIONS, ROLE_FINANCE, ROLE_DEAN)
ANNOUNCEMENT_FIELDS = (
	"title",
	"audience",
	"programme",
	"campus",
	"course_offering",
	"publish_on",
	"expires_on",
	"is_pinned",
	"show_in_portal",
	"send_email",
	"send_sms",
	"body",
	"attachment",
)
TEMPLATE_FIELDS = (
	"template_name",
	"event",
	"is_active",
	"send_email",
	"send_sms",
	"send_in_app",
	"subject",
	"email_body",
	"sms_body",
	"in_app_body",
	"description",
)
NOTIFICATION_FIELDS = ["name", "title", "message", "link", "category", "is_read", "creation"]


# ============================================================================ portal (any signed-in user)
def _unread(user: str) -> int:
	return frappe.db.count("Portal Notification", {"user": user, "is_read": 0})


@frappe.whitelist()
def my_notifications(limit=30, unread_only=0, start=0):
	"""CONTRACT (SPA shell): {"unread": int, "items": [{name,title,message,link,category,is_read,creation}]}."""
	user = require_login()
	filters = {"user": user}
	if cint(unread_only):
		filters["is_read"] = 0
	pa = page_args(start, limit or 30, max_length=100)
	items = frappe.get_all(
		"Portal Notification",
		filters=filters,
		fields=NOTIFICATION_FIELDS,
		order_by="creation desc",
		limit_start=pa["start"],
		limit_page_length=pa["page_length"],
	)
	for row in items:
		row["is_read"] = cint(row.is_read)
	return {"unread": _unread(user), "items": items, "total": frappe.db.count("Portal Notification", filters)}


@frappe.whitelist()
def unread_count():
	user = require_login()
	return {"unread": _unread(user)}


@frappe.whitelist(methods=["POST"])
def mark_notifications_read(names=None, all=0):
	"""CONTRACT (SPA shell): mark the caller's notifications read -> {"unread": int}."""
	user = require_login()
	filters = {"user": user, "is_read": 0}
	if not cint(all):
		names = parse_json(names, names)
		if isinstance(names, str):
			names = [names]
		names = [cstr(n) for n in (names or []) if n]
		if not names:
			return {"unread": _unread(user)}
		filters["name"] = ["in", names]
	targets = frappe.get_all("Portal Notification", filters=filters, pluck="name")
	if targets:
		PN = frappe.qb.DocType("Portal Notification")
		(
			frappe.qb.update(PN)
			.set(PN.is_read, 1)
			.set(PN.read_on, now_datetime())
			.where(PN.name.isin(targets) & (PN.user == user))
			.run()
		)
	return {"unread": _unread(user), "marked": len(targets)}


@frappe.whitelist(methods=["POST"])
def mark_read(names=None, all=0):
	"""Alias of mark_notifications_read (SOW naming)."""
	return mark_notifications_read(names=names, all=all)


@frappe.whitelist()
def my_announcements(limit=20, start=0):
	user = require_login()
	pa = page_args(start, limit or 20, max_length=100)
	rows = messaging.visible_announcements(user, limit=pa["page_length"], start=pa["start"])
	return {"data": rows, "total": len(rows)}


# ============================================================================ announcements (staff)
def _announcement_dict(doc) -> dict:
	out = {
		f: doc.get(f)
		for f in (
			"name",
			*ANNOUNCEMENT_FIELDS,
			"status",
			"posted_by",
			"sent_on",
			"recipients_count",
			"modified",
			"creation",
		)
	}
	out["posted_by_name"] = frappe.db.get_value("User", doc.posted_by, "full_name") if doc.posted_by else None
	return out


def _get_announcement_for_edit(name: str):
	doc = frappe.get_doc("Announcement", name)
	user = frappe.session.user
	if messaging.is_lecturer_only(user) and doc.posted_by != user:
		frappe.throw(_("You can only manage announcements you posted."), frappe.PermissionError)
	return doc


@frappe.whitelist()
def list_announcements(status=None, audience=None, search=None, start=0, page_length=20):
	user = require_roles(*ANNOUNCE_ROLES)
	filters = {}
	if status:
		filters["status"] = status
	if audience:
		filters["audience"] = audience
	if messaging.is_lecturer_only(user):
		filters["posted_by"] = user
	or_filters = [["title", "like", f"%{search}%"], ["body", "like", f"%{search}%"]] if search else None
	pa = page_args(start, page_length)
	rows = frappe.get_all(
		"Announcement",
		filters=filters,
		or_filters=or_filters,
		fields=[
			"name",
			"title",
			"audience",
			"programme",
			"campus",
			"course_offering",
			"status",
			"publish_on",
			"expires_on",
			"is_pinned",
			"show_in_portal",
			"send_email",
			"send_sms",
			"posted_by",
			"sent_on",
			"recipients_count",
			"modified",
		],
		order_by="modified desc",
		limit_start=pa["start"],
		limit_page_length=pa["page_length"],
	)
	counts = {
		r.status: cint(r.n)
		for r in frappe.get_all(
			"Announcement",
			filters={"posted_by": user} if "posted_by" in filters else {},
			fields=["status", {"COUNT": "*", "as": "n"}],
			group_by="status",
		)
	}
	total = (
		frappe.db.count("Announcement", filters)
		if not or_filters
		else len(frappe.get_all("Announcement", filters=filters, or_filters=or_filters, pluck="name"))
	)
	return {"data": rows, "total": total, "counts": counts}


@frappe.whitelist()
def get_announcement(name):
	require_roles(*ANNOUNCE_ROLES)
	return _announcement_dict(_get_announcement_for_edit(name))


@frappe.whitelist(methods=["POST"])
def save_announcement(data):
	require_roles(*ANNOUNCE_ROLES)
	data = parse_json(data, {}) or {}
	values = clean_payload(data, ANNOUNCEMENT_FIELDS)
	if data.get("name"):
		doc = _get_announcement_for_edit(data["name"])
	else:
		doc = frappe.new_doc("Announcement")
		doc.status = "Draft"
	doc.update(values)
	doc.save(ignore_permissions=True)  # role guard above + lecturer rules in the controller
	return _announcement_dict(doc)


@frappe.whitelist(methods=["POST"])
def send_announcement_now(name):
	"""Queue delivery now (email/SMS per the flags; the portal shows it once the job marks it Sent)."""
	require_roles(*ANNOUNCE_ROLES)
	doc = _get_announcement_for_edit(name)
	if doc.status not in ("Draft", "Scheduled"):
		frappe.throw(_("Only draft or scheduled announcements can be sent."))
	doc.run_method("validate")  # re-check audience / lecturer restrictions before queuing
	if doc.status == "Scheduled":
		doc.db_set("status", "Draft")  # keep the 5-minute dispatcher from sending it a second time
	frappe.enqueue(
		"mahanaim.services.communication.send_announcement",
		queue="long",
		job_id=f"mbc-announcement-{doc.name}",
		deduplicate=True,
		enqueue_after_commit=True,
		now=bool(frappe.flags.in_test),
		name=doc.name,
	)
	doc.reload()
	return {**_announcement_dict(doc), "queued": True}


@frappe.whitelist(methods=["POST"])
def schedule_announcement(name, publish_on):
	require_roles(*ANNOUNCE_ROLES)
	doc = _get_announcement_for_edit(name)
	when = get_datetime(publish_on)
	if when <= now_datetime():
		frappe.throw(_("Pick a publish time in the future, or use Send now."))
	doc.publish_on = when
	doc.status = "Scheduled"
	doc.save(ignore_permissions=True)
	return _announcement_dict(doc)


@frappe.whitelist(methods=["POST"])
def archive_announcement(name, undo=0):
	require_roles(*ANNOUNCE_ROLES)
	doc = _get_announcement_for_edit(name)
	if cint(undo):
		doc.status = "Sent" if doc.sent_on else "Draft"
	else:
		doc.status = "Archived"
	doc.save(ignore_permissions=True)
	return _announcement_dict(doc)


@frappe.whitelist(methods=["POST"])
def delete_announcement(name):
	require_roles(*ANNOUNCE_ROLES)
	doc = _get_announcement_for_edit(name)
	doc.delete(ignore_permissions=True)
	return {"ok": True, "name": name}


@frappe.whitelist()
def preview_audience(audience, programme=None, campus=None, course_offering=None):
	user = require_roles(*ANNOUNCE_ROLES)
	if messaging.is_lecturer_only(user) and (
		audience != "Course Offering" or not messaging.teaches(user, course_offering)
	):
		frappe.throw(_("Lecturers can only address a course offering they teach."), frappe.PermissionError)
	ann = frappe._dict(audience=audience, programme=programme, campus=campus, course_offering=course_offering)
	recipients = announcement_recipients(ann)
	return {
		"count": len(recipients),
		"reachable": {
			"email": sum(1 for r in recipients if r.get("email")),
			"sms": sum(1 for r in recipients if r.get("phone")),
			"in_app": sum(1 for r in recipients if r.get("user")),
		},
		"sample": [
			{"name": r.get("name"), "email": r.get("email"), "phone": r.get("phone")} for r in recipients[:10]
		],
	}


# ============================================================================ templates
@frappe.whitelist()
def list_templates(event=None, search=None):
	require_roles(*COMMS_ROLES)
	filters = {"event": event} if event else {}
	or_filters = (
		[["template_name", "like", f"%{search}%"], ["subject", "like", f"%{search}%"]] if search else None
	)
	rows = frappe.get_all(
		"Message Template",
		filters=filters,
		or_filters=or_filters,
		fields=[
			"name",
			"template_name",
			"event",
			"is_active",
			"send_email",
			"send_sms",
			"send_in_app",
			"subject",
			"modified",
		],
		order_by="event asc, template_name asc",
	)
	events = frappe.get_meta("Message Template").get_field("event").options.split("\n")
	return {"data": rows, "total": len(rows), "events": [e for e in events if e]}


@frappe.whitelist()
def get_template(name):
	require_roles(*COMMS_ROLES)
	doc = frappe.get_doc("Message Template", name)
	return {f: doc.get(f) for f in ("name", *TEMPLATE_FIELDS, "modified")}


@frappe.whitelist(methods=["POST"])
def save_template(data):
	require_roles(*COMMS_ROLES)
	data = parse_json(data, {}) or {}
	values = clean_payload(data, TEMPLATE_FIELDS)
	if data.get("name"):
		doc = frappe.get_doc("Message Template", data["name"])
		values.pop("template_name", None)  # the name is the primary key
		doc.check_permission("write")
	else:
		doc = frappe.new_doc("Message Template")
		doc.check_permission("create")
	doc.update(values)
	doc.save()
	return get_template(doc.name)


@frappe.whitelist()
def preview_template(name, doctype=None, docname=None):
	"""Render a template against a real document (if given) or a sample recipient."""
	require_roles(*COMMS_ROLES)
	tpl = frappe.get_doc("Message Template", name)
	doc = None
	if doctype and docname:
		frappe.has_permission(doctype, "read", docname, throw=True)
		doc = frappe.get_doc(doctype, docname)
	me = frappe.db.get_value(
		"User", frappe.session.user, ["name", "email", "mobile_no", "full_name"], as_dict=True
	)
	recipient = {
		"user": me.name,
		"email": me.email,
		"phone": me.mobile_no,
		"name": me.full_name or "Jane Doe",
	}
	ctx = _context(doc, {}, recipient)
	out, errors = {}, {}
	for field in ("subject", "email_body", "sms_body", "in_app_body"):
		try:
			out[field] = _render(tpl.get(field), ctx)
		except Exception as e:
			out[field] = None
			errors[field] = cstr(e)[:300]
	out["sms_length"] = len(out.get("sms_body") or "")
	out["sms_parts"] = (
		(out["sms_length"] + 152) // 153 if out["sms_length"] > 160 else (1 if out["sms_length"] else 0)
	)
	return {
		"rendered": out,
		"errors": errors,
		"document": {"doctype": doctype, "name": docname} if doc else None,
	}


# ============================================================================ delivery log & direct messages
def _log_filters(filters) -> tuple[dict, list | None]:
	f = parse_json(filters, {}) or {}
	out = {}
	for key in ("channel", "status", "event", "reference_doctype", "reference_name", "user", "template"):
		if f.get(key):
			out[key] = f[key]
	if f.get("from_date") and f.get("to_date"):
		out["creation"] = ["between", [getdate(f["from_date"]), f"{getdate(f['to_date'])} 23:59:59"]]
	elif f.get("from_date"):
		out["creation"] = [">=", getdate(f["from_date"])]
	elif f.get("to_date"):
		out["creation"] = ["<=", f"{getdate(f['to_date'])} 23:59:59"]
	or_filters = None
	if f.get("search"):
		like = f"%{f['search']}%"
		or_filters = [["recipient", "like", like], ["subject", "like", like]]
	return out, or_filters


@frappe.whitelist()
def message_log(filters=None, start=0, page_length=50):
	require_roles(*COMMS_ROLES, "Auditor")
	f, or_filters = _log_filters(filters)
	pa = page_args(start, page_length)
	rows = frappe.get_all(
		"Message Log",
		filters=f,
		or_filters=or_filters,
		fields=[
			"name",
			"channel",
			"recipient",
			"user",
			"subject",
			"status",
			"event",
			"template",
			"sent_on",
			"retries",
			"reference_doctype",
			"reference_name",
			"provider_response",
			"creation",
			"message",
		],
		order_by="creation desc",
		limit_start=pa["start"],
		limit_page_length=pa["page_length"],
	)
	for r in rows:
		r["preview"] = strip_html(r.pop("message") or "")[:160]
	grouped = frappe.get_all(
		"Message Log",
		filters=f,
		or_filters=or_filters,
		fields=["channel", "status", {"COUNT": "*", "as": "n"}],
		group_by="channel, status",
	)
	by_channel, by_status, matrix = {}, {}, {}
	for g in grouped:
		by_channel[g.channel] = by_channel.get(g.channel, 0) + cint(g.n)
		by_status[g.status] = by_status.get(g.status, 0) + cint(g.n)
		matrix.setdefault(g.channel, {})[g.status] = cint(g.n)
	return {
		"data": rows,
		"total": sum(by_channel.values()),
		"counts": {"by_channel": by_channel, "by_status": by_status, "matrix": matrix},
	}


@frappe.whitelist(methods=["POST"])
def retry_failed(names=None):
	"""Re-queue failed SMS (emails are retried by Frappe's Email Queue)."""
	require_roles(*COMMS_ROLES)
	names = parse_json(names, names)
	if isinstance(names, str):
		names = [names]
	filters = {"channel": "SMS", "status": "Failed"}
	if names:
		filters["name"] = ["in", names]
	logs = frappe.get_all("Message Log", filters=filters, pluck="name", limit_page_length=500)
	for name in logs:
		frappe.db.set_value("Message Log", name, {"status": "Queued", "provider_response": None})
		frappe.enqueue(
			"mahanaim.services.communication.deliver_sms",
			queue="short",
			log_name=name,
			enqueue_after_commit=True,
			now=bool(frappe.flags.in_test),
		)
	skipped = len(names or []) - len(logs) if names else 0
	return {"queued": len(logs), "skipped": max(skipped, 0)}


@frappe.whitelist(methods=["POST"])
def send_test_sms(phone, message=None):
	user = require_roles(*COMMS_ROLES)
	number = normalize_phone(phone)
	if not number or len(number) != 12:
		frappe.throw(_("Enter a valid Kenyan mobile number, e.g. 0712 345 678."))
	text = cstr(message).strip() or _("Test message from {0}.").format(
		frappe.db.get_single_value("Mahanaim Settings", "short_name") or "MBC"
	)
	send_sms(number, text[:459], event="Direct Message", user=user)
	log = frappe.get_all(
		"Message Log",
		filters={"channel": "SMS", "recipient": number},
		fields=["name", "status", "provider_response"],
		order_by="creation desc",
		limit_page_length=1,
	)
	return {"ok": True, "log": log[0] if log else None}


@frappe.whitelist(methods=["POST"])
def send_direct_message(recipients, subject, message, channels=None):
	"""recipients: [{user|student|staff_member|sponsor|email|phone}], channels ⊆ Email/SMS/In-App."""
	user = require_roles(*DIRECT_ROLES)
	specs = parse_json(recipients, []) or []
	if not isinstance(specs, list):
		specs = [specs]
	channels = parse_json(channels, channels) or ["In-App", "Email"]
	if isinstance(channels, str):
		channels = [c.strip() for c in channels.split(",")]
	channels = [c for c in channels if c in messaging.CHANNELS]
	if not channels:
		frappe.throw(_("Choose at least one channel."))
	subject = cstr(subject).strip()
	if not subject or not strip_html(cstr(message)).strip():
		frappe.throw(_("A subject and message are required."))
	if len(specs) > messaging.DIRECT_MAX_RECIPIENTS:
		frappe.throw(
			_("Send to at most {0} recipients at a time, or use an announcement.").format(
				messaging.DIRECT_MAX_RECIPIENTS
			)
		)
	resolved, skipped, seen = [], [], set()
	for spec in specs:
		r = messaging.resolve_recipient(spec)
		key = r and (r.get("user") or r.get("email") or r.get("phone"))
		if not key:
			skipped.append(spec)
			continue
		if key in seen:
			continue
		seen.add(key)
		resolved.append(r)
	if not resolved:
		frappe.throw(_("None of the recipients could be reached."))
	if len(resolved) > messaging.DIRECT_SYNC_LIMIT and not frappe.flags.in_test:
		frappe.enqueue(
			"mahanaim.services.messaging.deliver_direct_job",
			queue="long",
			enqueue_after_commit=True,
			recipients=resolved,
			subject=subject,
			message=message,
			channels=channels,
			sender=user,
		)
		return {"queued": True, "recipients": len(resolved), "skipped": skipped}
	stats = messaging.deliver_direct(resolved, subject, message, channels, user)
	return {"queued": False, "recipients": len(resolved), "sent": stats, "skipped": skipped}
