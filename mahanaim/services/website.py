"""Public website / CMS services (owned by backend domain B4).

CONTRACT (keep signatures):
	route_meta(path) -> {title, description, image}
		SEO/OpenGraph meta for a public SPA path; used by www/mbc.py. Never raises.
	update_event_statuses()            # daily scheduler: Upcoming -> Ongoing -> Completed
	mark_event_registration_paid(registration=None, reference=None, request=None)
		For B3: call when an M-Pesa Request with purpose "Event Fee" completes. The registration
		is found from `registration` or from Event Registration.mpesa_request == `request`.
	clear_website_cache(doc=None, method=None)
		Safe as a doc_events hook (e.g. Programme / Staff Member / Campus / Intake on_update).
"""

from __future__ import annotations

import re
from datetime import timedelta

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt, get_datetime, get_url, getdate, now_datetime, nowdate, strip_html

CACHE_PREFIX = "mbc:web:"
CACHE_TTL = 300  # seconds; public pages tolerate 5 minutes of staleness, saves clear it immediately

SEAT_STATUSES = ("Registered", "Confirmed", "Attended")
DEFAULT_EVENT_HOURS = 2


# ---------------------------------------------------------------------------------- slugs
def slugify(text: str | None, max_length: int = 80) -> str:
	text = (text or "").lower().replace("&", " and ")
	text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
	return text[:max_length].strip("-") or "item"


def unique_route(doctype: str, value: str, name: str | None = None, fieldname: str = "route") -> str:
	"""Slugify `value` and suffix -2, -3… until it is unique in `doctype`."""
	base = slugify(value)
	route, i = base, 2
	while True:
		existing = frappe.db.get_value(doctype, {fieldname: route}, "name")
		if not existing or existing == name:
			return route
		route = f"{base}-{i}"
		i += 1


def ensure_route(doc, source_field: str = "title"):
	"""Derive a unique slug from the title, or validate a slug typed by the editor."""
	if not doc.route:
		doc.route = unique_route(doc.doctype, doc.get(source_field), doc.name if not doc.is_new() else None)
		return
	doc.route = slugify(doc.route)
	clash = frappe.db.get_value(doc.doctype, {"route": doc.route, "name": ["!=", doc.name or ""]}, "name")
	if clash:
		frappe.throw(
			_("The web address '{0}' is already used by {1}. Choose another one.").format(doc.route, clash),
			frappe.DuplicateEntryError,
		)


# ---------------------------------------------------------------------------------- cache
def cached(key: str, generator, ttl: int = CACHE_TTL):
	"""Short-TTL redis cache for anonymous website payloads (bypassed in tests)."""
	if frappe.flags.in_test:
		return generator()
	full_key = CACHE_PREFIX + key
	value = frappe.cache.get_value(full_key, expires=True)
	if value is None:
		value = generator()
		frappe.cache.set_value(full_key, value, expires_in_sec=ttl)
	return value


def clear_website_cache(doc=None, method=None):
	try:
		frappe.cache.delete_keys(CACHE_PREFIX)
	except Exception:
		frappe.log_error(title="Mahanaim website cache clear failed")


# ---------------------------------------------------------------------------------- events
def event_end(ev) -> object:
	start = get_datetime(ev.get("start_datetime"))
	end = ev.get("end_datetime")
	return get_datetime(end) if end else start + timedelta(hours=DEFAULT_EVENT_HOURS)


def status_for_dates(ev, now=None) -> str:
	now = now or now_datetime()
	start = get_datetime(ev.get("start_datetime"))
	if now < start:
		return "Upcoming"
	if now <= event_end(ev):
		return "Ongoing"
	return "Completed"


def effective_status(ev, now=None) -> str:
	if ev.get("status") in ("Draft", "Cancelled"):
		return ev.get("status")
	return status_for_dates(ev, now)


def seats_taken(event: str, exclude: str | None = None) -> int:
	filters = {"campus_event": event, "status": ["in", SEAT_STATUSES]}
	if exclude:
		filters["name"] = ["!=", exclude]
	rows = frappe.get_all("Event Registration", filters=filters, fields=[{"SUM": "attendees", "as": "seats"}])
	return cint(rows[0].seats) if rows else 0


def refresh_event_counts(event: str):
	if not event or not frappe.db.exists("Campus Event", event):
		return
	rows = frappe.get_all(
		"Event Registration",
		filters={"campus_event": event, "status": ["in", SEAT_STATUSES]},
		fields=["status", {"SUM": "attendees", "as": "seats"}],
		group_by="status",
	)
	registered = sum(cint(r.seats) for r in rows)
	attended = sum(cint(r.seats) for r in rows if r.status == "Attended")
	frappe.db.set_value(
		"Campus Event",
		event,
		{"registered_count": registered, "attended_count": attended},
		update_modified=False,
	)


def registration_state(ev, user: str | None = None) -> dict:
	"""Public registration state for an event dict/doc."""
	user = user or frappe.session.user
	status = effective_status(ev)
	capacity = cint(ev.get("capacity"))
	taken = cint(ev.get("registered_count"))
	seats_left = max(capacity - taken, 0) if capacity else None
	state = {
		"required": bool(cint(ev.get("registration_required"))),
		"open": False,
		"reason": None,
		"capacity": capacity or None,
		"registered": taken,
		"seats_left": seats_left,
		"deadline": ev.get("registration_deadline"),
		"fee": flt(ev.get("fee")),
		"is_paid": flt(ev.get("fee")) > 0,
		"waitlist": False,
		"my_registration": None,
	}
	if not state["required"]:
		state["reason"] = _("No registration needed — just come.")
	elif status in ("Completed", "Cancelled", "Draft"):
		state["reason"] = _("Registration is closed.")
	elif ev.get("registration_deadline") and now_datetime() > get_datetime(ev.get("registration_deadline")):
		state["reason"] = _("The registration deadline has passed.")
	else:
		state["open"] = True
		if capacity and seats_left <= 0:
			state["waitlist"] = True
			state["reason"] = _("This event is fully booked; new registrations join the waiting list.")
	if user and user != "Guest" and ev.get("name"):
		mine = frappe.db.get_value(
			"Event Registration",
			{"campus_event": ev.get("name"), "user": user, "status": ["!=", "Cancelled"]},
			["name", "status", "attendees", "payment_status"],
			as_dict=True,
		)
		state["my_registration"] = mine
	return state


def update_event_statuses():
	"""Daily: move published events through Upcoming -> Ongoing -> Completed by their dates."""
	now = now_datetime()
	events = frappe.get_all(
		"Campus Event",
		filters={"status": ["in", ["Upcoming", "Ongoing", "Completed"]]},
		fields=["name", "status", "start_datetime", "end_datetime"],
	)
	changed = 0
	for ev in events:
		new = status_for_dates(ev, now)
		if new != ev.status:
			frappe.db.set_value("Campus Event", ev.name, "status", new, update_modified=False)
			changed += 1
	if changed:
		clear_website_cache()
	return changed


def mark_event_registration_paid(
	registration: str | None = None, reference: str | None = None, request: str | None = None
):
	"""CONTRACT for B3: an "Event Fee" M-Pesa request completed.

	Pass the registration name, or just `request` (the M-Pesa Request name stored on the registration)."""
	if not registration and request:
		registration = frappe.db.get_value("Event Registration", {"mpesa_request": request}, "name")
	if not registration:
		return None
	reg = frappe.get_doc("Event Registration", registration)
	if reg.payment_status == "Paid":
		return reg.name
	reg.payment_status = "Paid"
	if reference:
		reg.payment_reference = reference
	if request:
		reg.mpesa_request = request
	if reg.status == "Registered":
		reg.status = "Confirmed"
	reg.flags.ignore_permissions = True
	reg.save()
	reg.notify_registrant()
	return reg.name


EVENT_PAYMENT_MESSAGES = {
	"Initiated": "Waiting for you to confirm on your phone…",
	"Pending": "Waiting for you to confirm on your phone…",
	"Completed": "Payment received. Your seat is confirmed.",
	"Received": "Payment received. We are confirming your seat.",
	"Failed": "The payment did not go through. Please try again.",
	"Cancelled": "The payment was cancelled on the phone.",
	"Timeout": "The M-Pesa prompt timed out. Please try again.",
	"Not Started": "No M-Pesa payment has been started for this registration.",
	"Not Required": "This registration does not need a payment.",
	"Waived": "The fee for this registration was waived.",
}


def event_payment_state(reg) -> dict:
	"""Read-only `{status, done, receipt, message}` for an Event Registration's M-Pesa fee payment.

	`status` is the M-Pesa Request status (Initiated/Pending/Completed/Failed/Cancelled/Timeout), "Completed" once the
	registration is Paid, "Received" when M-Pesa confirmed but the registration is still being updated, or
	"Not Started" / "Not Required" / "Waived"."""
	req = (
		frappe.db.get_value(
			"M-Pesa Request",
			reg.mpesa_request,
			["status", "purpose", "mpesa_receipt_number"],
			as_dict=True,
		)
		if reg.mpesa_request
		else None
	)
	if req and req.purpose != "Event Fee":
		req = None
	receipt = None
	if reg.payment_status == "Paid":
		status = "Completed"
		receipt = (req and req.mpesa_receipt_number) or reg.payment_reference
	elif reg.payment_status in ("Not Required", "Waived"):
		status = reg.payment_status
	elif not req:
		status = "Not Started"
	elif req.status == "Completed":
		status, receipt = "Received", req.mpesa_receipt_number
	else:
		status = req.status or "Pending"
	return {
		"status": status,
		"done": status not in ("Initiated", "Pending"),
		"receipt": receipt,
		"message": _(EVENT_PAYMENT_MESSAGES.get(status, "Waiting for M-Pesa…")),
	}


def public_payment_details() -> dict:
	"""Public M-Pesa PayBill / Till numbers for the fees pages; never exposes keys, passkeys or tokens."""
	out = {"enabled": False, "paybill": None, "till": None, "account_hint": None}
	try:
		m = frappe.get_cached_doc("M-Pesa Settings")
	except Exception:
		return out
	if not cint(m.get("enabled")):
		return out
	if m.get("transaction_type") == "CustomerBuyGoodsOnline":
		out["till"] = cstr(m.get("till_number")).strip() or None
	else:
		out["paybill"] = cstr(m.get("business_shortcode")).strip() or None
		if out["paybill"]:
			out["account_hint"] = _(
				"Your student number, or your application number if you have not enrolled yet."
			)
	out["enabled"] = bool(out["paybill"] or out["till"])
	return out


# ---------------------------------------------------------------------------------- serialisers
def site_brand() -> dict:
	s = frappe.get_cached_doc("Mahanaim Settings")
	return {
		"institution_name": s.institution_name,
		"short_name": s.short_name,
		"motto": s.motto,
		"logo": s.logo,
		"currency": s.currency or "KES",
	}


def split_lines(value: str | None) -> list[str]:
	return [line.strip() for line in (value or "").splitlines() if line.strip()]


def excerpt(html: str | None, length: int = 220) -> str:
	text = re.sub(r"\s+", " ", strip_html(html or "")).strip()
	return text if len(text) <= length else text[: length - 1].rsplit(" ", 1)[0] + "…"


def programme_children(codes: list[str]) -> dict:
	"""Campuses and study modes for many programmes in two queries."""
	out = {c: {"campuses": [], "study_modes": []} for c in codes}
	if not codes:
		return out
	for row in frappe.get_all(
		"Programme Campus",
		filters={"parenttype": "Programme", "parent": ["in", codes]},
		fields=["parent", "campus"],
		order_by="idx asc",
	):
		out[row.parent]["campuses"].append(row.campus)
	for row in frappe.get_all(
		"Programme Study Mode",
		filters={"parenttype": "Programme", "parent": ["in", codes]},
		fields=["parent", "study_mode"],
		order_by="idx asc",
	):
		out[row.parent]["study_modes"].append(row.study_mode)
	return out


PROGRAMME_LIST_FIELDS = [
	"name",
	"code",
	"programme_name",
	"level",
	"duration_years",
	"terms_per_year",
	"overview",
	"image",
	"award_title",
	"application_fee",
	"indicative_fee_per_term",
	"department",
	"minimum_entry",
]


def published_programmes(filters: dict | None = None, or_filters=None, limit: int = 0) -> list[dict]:
	f = {"is_published": 1, "status": "Active"}
	f.update(filters or {})
	rows = frappe.get_all(
		"Programme",
		filters=f,
		or_filters=or_filters,
		fields=PROGRAMME_LIST_FIELDS,
		order_by="level asc, programme_name asc",
		limit_page_length=limit or 0,
	)
	children = programme_children([r.name for r in rows])
	default_fee = flt(frappe.db.get_single_value("Mahanaim Settings", "application_fee"))
	return [programme_card(r, children.get(r.name), default_fee) for r in rows]


def programme_card(r, children: dict | None = None, default_fee: float = 0) -> dict:
	children = children or {}
	return {
		"code": r.code or r.name,
		"name": r.programme_name,
		"level": r.level,
		"duration_years": flt(r.duration_years),
		"duration": _duration_label(r.duration_years),
		"terms_per_year": cint(r.terms_per_year),
		"study_modes": children.get("study_modes", []),
		"campuses": children.get("campuses", []),
		"short_description": r.overview or "",
		"image": r.image,
		"award_title": r.award_title,
		"application_fee": flt(r.application_fee) or default_fee,
		"indicative_fee_per_term": flt(r.indicative_fee_per_term),
		"department": r.department,
		"minimum_entry": r.minimum_entry,
		"route": f"/programmes/{r.code or r.name}",
	}


def _duration_label(years) -> str:
	years = flt(years)
	if not years:
		return ""
	if years < 1:
		months = round(years * 12)
		return _("{0} months").format(months)
	if years == int(years):
		return _("{0} year").format(int(years)) if years == 1 else _("{0} years").format(int(years))
	return _("{0} years").format(years)


NEWS_LIST_FIELDS = [
	"name",
	"title",
	"route",
	"category",
	"author",
	"published_on",
	"cover_image",
	"excerpt",
	"is_featured",
	"tags",
	"views",
]


def news_filters(category: str | None = None) -> dict:
	f = {"published": 1, "published_on": ["<=", nowdate()]}
	if category:
		f["category"] = category
	return f


def news_card(r) -> dict:
	return {
		"name": r.name,
		"title": r.title,
		"route": r.route,
		"url": f"/news/{r.route}",
		"category": r.category,
		"author": r.author,
		"published_on": r.published_on,
		"cover_image": r.cover_image,
		"excerpt": r.excerpt,
		"is_featured": cint(r.is_featured),
		"tags": [t.strip() for t in (r.tags or "").split(",") if t.strip()],
	}


EVENT_LIST_FIELDS = [
	"name",
	"title",
	"route",
	"event_type",
	"status",
	"start_datetime",
	"end_datetime",
	"venue",
	"campus",
	"cover_image",
	"summary",
	"registration_required",
	"capacity",
	"registration_deadline",
	"fee",
	"registered_count",
	"livestream_url",
	"organiser",
	"partner_church",
]


def event_card(r, now=None) -> dict:
	capacity = cint(r.capacity)
	return {
		"name": r.name,
		"title": r.title,
		"route": r.route,
		"url": f"/events/{r.route}",
		"event_type": r.event_type,
		"status": effective_status(r, now),
		"start_datetime": r.start_datetime,
		"end_datetime": r.end_datetime,
		"venue": r.venue,
		"campus": r.campus,
		"cover_image": r.cover_image,
		"summary": r.summary,
		"organiser": r.organiser,
		"livestream_url": r.livestream_url,
		"registration_required": cint(r.registration_required),
		"fee": flt(r.fee),
		"capacity": capacity or None,
		"seats_left": max(capacity - cint(r.registered_count), 0) if capacity else None,
	}


def upcoming_events(limit: int = 4, start: int = 0) -> tuple[list[dict], int]:
	now = now_datetime()
	filters = {
		"is_public": 1,
		"status": ["in", ["Upcoming", "Ongoing", "Cancelled"]],
		"end_datetime": [">=", now],
	}
	rows = frappe.get_all(
		"Campus Event",
		filters=filters,
		fields=EVENT_LIST_FIELDS,
		order_by="start_datetime asc",
		limit_start=start,
		limit_page_length=limit,
	)
	return [event_card(r, now) for r in rows], frappe.db.count("Campus Event", filters)


def past_events(limit: int = 9, start: int = 0) -> tuple[list[dict], int]:
	now = now_datetime()
	filters = {
		"is_public": 1,
		"status": ["in", ["Upcoming", "Ongoing", "Completed"]],
		"end_datetime": ["<", now],
	}
	rows = frappe.get_all(
		"Campus Event",
		filters=filters,
		fields=EVENT_LIST_FIELDS,
		order_by="start_datetime desc",
		limit_start=start,
		limit_page_length=limit,
	)
	return [event_card(r, now) for r in rows], frappe.db.count("Campus Event", filters)


def published_testimonials(limit: int = 0) -> list[dict]:
	rows = frappe.get_all(
		"Testimonial",
		filters={"is_published": 1},
		fields=["name", "person_name", "role_title", "programme", "photo", "quote", "sequence"],
		order_by="sequence asc, creation asc",
		limit_page_length=limit,
	)
	names = (
		{
			p.name: p.programme_name
			for p in frappe.get_all(
				"Programme",
				filters={"name": ["in", list({r.programme for r in rows if r.programme})]},
				fields=["name", "programme_name"],
			)
		}
		if any(r.programme for r in rows)
		else {}
	)
	return [
		{
			"name": r.name,
			"person_name": r.person_name,
			"role_title": r.role_title,
			"programme": r.programme,
			"programme_name": names.get(r.programme),
			"photo": r.photo,
			"quote": r.quote,
		}
		for r in rows
	]


# ---------------------------------------------------------------------------------- SEO
_STATIC_PAGES = {
	"about": ("About Us", "about_summary"),
	"academics": ("Academics", None),
	"programmes": ("Programmes", None),
	"admissions": ("Admissions", "admissions_intro"),
	"apply": ("Apply Online", "admissions_intro"),
	"fees": ("Fees & Financing", "fees_intro"),
	"e-library": ("E-Library", "library_intro"),
	"news": ("News & Stories", None),
	"events": ("Events", None),
	"faculty": ("Our Faculty", None),
	"contact": ("Contact Us", None),
	"faq": ("Frequently Asked Questions", None),
	"verify": ("Verify a Certificate or Transcript", None),
	"signin": ("Sign In", None),
	"forgot-password": ("Reset Password", None),
}
_PORTALS = {
	"applicant": "Applicant Portal",
	"student": "Student Portal",
	"lecturer": "Lecturer Portal",
	"admin": "Administration",
	"sponsor": "Sponsor Portal",
}


def _abs(url: str | None) -> str | None:
	if not url:
		return None
	return get_url(url) if url.startswith("/") else url


def route_meta(path: str) -> dict:
	"""CONTRACT (B4): SEO/OpenGraph meta for a public SPA path. Never raises."""
	default = {"title": "Mahanaim Bible College", "description": "", "image": None}
	try:
		default = _default_meta()
		meta = _route_meta(path or "/", default)
		return {
			"title": (meta.get("title") or default["title"])[:140],
			"description": excerpt(meta.get("description") or default["description"], 300),
			"image": _abs(meta.get("image") or default["image"]),
		}
	except Exception:
		try:
			frappe.log_error(title=f"route_meta failed for {path}")
		except Exception:
			pass
		return default


def _default_meta() -> dict:
	brand = site_brand()
	ws = frappe.get_cached_doc("Campus Website Settings")
	name = brand.get("institution_name") or "Mahanaim Bible College"
	return {
		"title": f"{name} — {brand['motto']}" if brand.get("motto") else name,
		"description": ws.meta_description or ws.about_summary or ws.hero_subtitle or "",
		"image": ws.hero_image or brand.get("logo"),
		"_name": brand.get("short_name") or name,
		"_ws": ws,
	}


def _route_meta(path: str, default: dict) -> dict:
	parts = [p for p in str(path).split("?")[0].split("#")[0].strip("/").split("/") if p]
	short = default["_name"]
	ws = default["_ws"]
	if not parts:
		return default
	head = parts[0].lower()
	if head in _PORTALS:
		return {"title": f"{_(_PORTALS[head])} | {short}"}
	if head == "programmes" and len(parts) > 1:
		p = frappe.db.get_value(
			"Programme",
			{"name": parts[1], "is_published": 1},
			["programme_name", "overview", "description", "image"],
			as_dict=True,
		)
		if p:
			return {
				"title": f"{p.programme_name} | {short}",
				"description": p.overview or p.description,
				"image": p.image,
			}
	if head == "news" and len(parts) > 1:
		n = frappe.db.get_value(
			"News Post",
			{"route": parts[1], "published": 1},
			["title", "meta_description", "excerpt", "content", "cover_image"],
			as_dict=True,
		)
		if n:
			return {
				"title": f"{n.title} | {short}",
				"description": n.meta_description or n.excerpt or n.content,
				"image": n.cover_image,
			}
	if head == "events" and len(parts) > 1:
		e = frappe.db.get_value(
			"Campus Event",
			{"route": parts[1], "is_public": 1, "status": ["!=", "Draft"]},
			["title", "summary", "description", "cover_image"],
			as_dict=True,
		)
		if e:
			return {
				"title": f"{e.title} | {short}",
				"description": e.summary or e.description,
				"image": e.cover_image,
			}
	if head in _STATIC_PAGES:
		label, field = _STATIC_PAGES[head]
		return {"title": f"{_(label)} | {short}", "description": ws.get(field) if field else None}
	return default
