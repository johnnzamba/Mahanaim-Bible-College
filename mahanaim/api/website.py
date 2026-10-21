"""Public website + staff CMS endpoints (backend domain B4).

Public reads are guest-accessible and cached for a few minutes in redis (`services.website.cached`);
controllers clear the cache whenever CMS content changes. Public writes (event registration and the contact
form) are POST-only, rate-limited per IP and protected by a `website` honeypot field that real users never see.
Staff CMS endpoints require the Communications Officer role (College Administrator / System Manager always pass).
"""

from __future__ import annotations

import csv
import io

import frappe
from frappe import _
from frappe.model import no_value_fields
from frappe.rate_limiter import rate_limit
from frappe.utils import cint, cstr, flt, getdate, now_datetime, nowdate, today

from mahanaim.api.utils import clean_payload, page_args, parse_json, require_roles
from mahanaim.services import website as web
from mahanaim.utils import ROLE_ADMISSIONS, ROLE_CHAPLAIN, ROLE_COMMS, normalize_phone, setting

CMS_ROLES = (ROLE_COMMS,)
EVENT_ROLES = (ROLE_COMMS, ROLE_CHAPLAIN)
ENQUIRY_ROLES = (ROLE_COMMS, ROLE_ADMISSIONS)

ENQUIRY_TYPES = ("General", "Admissions", "Fees", "Partnership", "Media", "Prayer Request", "Other")
NEWS_FIELDS = (
	"title",
	"route",
	"category",
	"author",
	"published",
	"published_on",
	"is_featured",
	"cover_image",
	"excerpt",
	"content",
	"tags",
	"meta_description",
)
EVENT_FIELDS = (
	"title",
	"route",
	"event_type",
	"status",
	"start_datetime",
	"end_datetime",
	"venue",
	"campus",
	"is_public",
	"partner_church",
	"organiser",
	"cover_image",
	"livestream_url",
	"summary",
	"description",
	"notices",
	"registration_required",
	"capacity",
	"registration_deadline",
	"fee",
)
FAQ_FIELDS = ("question", "category", "is_published", "sequence", "answer")
TESTIMONIAL_FIELDS = ("person_name", "role_title", "programme", "photo", "is_published", "sequence", "quote")
SETTINGS_SKIP = {"name", "doctype", "owner", "creation", "modified", "modified_by", "idx", "docstatus"}

NAV = [
	{
		"label": "About",
		"to": "/about",
		"children": [
			{"to": "/about", "label": "Our story", "desc": "History, vision, mission and statement of faith"},
			{
				"to": "/faculty",
				"label": "Faculty & leadership",
				"desc": "Meet the people who teach and shepherd",
			},
			{"to": "/about#campuses", "label": "Campuses", "desc": "Where we study and gather"},
		],
	},
	{
		"label": "Academics",
		"to": "/academics",
		"children": [
			{"to": "/programmes", "label": "Programmes", "desc": "Certificate, diploma and degree pathways"},
			{"to": "/academics", "label": "Academic life", "desc": "Calendar, study modes and assessment"},
			{"to": "/e-library", "label": "E-Library", "desc": "Books, journals and sermon archives"},
		],
	},
	{
		"label": "Admissions",
		"to": "/admissions",
		"children": [
			{"to": "/admissions", "label": "How to apply", "desc": "Requirements, intakes and deadlines"},
			{"to": "/fees", "label": "Fees & funding", "desc": "Fee structures, sponsorship and M-Pesa"},
			{"to": "/apply", "label": "Apply online", "desc": "Start or continue your application"},
		],
	},
	{"label": "News", "to": "/news"},
	{"label": "Events", "to": "/events"},
	{"label": "Contact", "to": "/contact"},
]
FOOTER_LINKS = [
	{
		"title": "Study",
		"links": [
			{"label": "Programmes", "to": "/programmes"},
			{"label": "Admissions", "to": "/admissions"},
			{"label": "Fees & funding", "to": "/fees"},
			{"label": "Apply online", "to": "/apply"},
		],
	},
	{
		"title": "College",
		"links": [
			{"label": "About us", "to": "/about"},
			{"label": "Faculty", "to": "/faculty"},
			{"label": "News", "to": "/news"},
			{"label": "Events", "to": "/events"},
		],
	},
	{
		"title": "Services",
		"links": [
			{"label": "E-Library", "to": "/e-library"},
			{"label": "Verify a certificate", "to": "/verify"},
			{"label": "FAQs", "to": "/faq"},
			{"label": "Sign in", "to": "/signin"},
		],
	},
]


def _ws():
	return frappe.get_cached_doc("Campus Website Settings")


def _translate_links(items):
	out = []
	for item in items:
		row = dict(item)
		if item.get("label"):
			row["label"] = _(item["label"])
		if item.get("desc"):
			row["desc"] = _(item["desc"])
		if item.get("children"):
			row["children"] = _translate_links(item["children"])
		if item.get("links"):
			row["links"] = _translate_links(item["links"])
		if item.get("title"):
			row["title"] = _(item["title"])
		out.append(row)
	return out


def _main_campus():
	return (
		frappe.db.get_value(
			"Campus",
			{"is_active": 1},
			["name", "phone", "email", "address", "map_url"],
			as_dict=True,
			order_by="is_main_campus desc, creation asc",
		)
		or frappe._dict()
	)


# ============================================================================ public reads
@frappe.whitelist(allow_guest=True)
def site_settings():
	"""Header/footer payload for every public page (contract pinned by the lead)."""
	return web.cached("site_settings", _site_settings)


def _site_settings():
	ws = _ws()
	brand = web.site_brand()
	s = frappe.get_cached_doc("Mahanaim Settings")
	campus = _main_campus()
	whatsapp = normalize_phone(ws.whatsapp) if ws.whatsapp else None
	return {
		"institution": {
			"name": brand["institution_name"],
			"short_name": brand["short_name"],
			"motto": brand["motto"],
			"logo": brand["logo"],
			"currency": brand["currency"],
		},
		"contact": {
			"phone": ws.contact_phone or s.phone or campus.phone,
			"email": ws.contact_email or s.email or campus.email,
			"address": ws.contact_address or s.address or campus.address,
			"map_url": ws.map_embed_url or campus.map_url,
			"office_hours": ws.office_hours,
			"whatsapp": whatsapp,
		},
		"social": {
			"facebook": ws.facebook,
			"youtube": ws.youtube,
			"instagram": ws.instagram,
			"x": ws.x_twitter,
			"whatsapp": f"https://wa.me/{whatsapp}" if whatsapp else None,
		},
		"nav": _translate_links(NAV),
		"footer_links": _translate_links(FOOTER_LINKS),
		"footer_text": ws.footer_text,
		"announcement_bar": {"text": ws.announcement_bar, "link": ws.announcement_link}
		if ws.announcement_bar
		else None,
		"meta_description": ws.meta_description or ws.about_summary,
		"cta": {"label": ws.hero_cta_label or _("Apply now"), "to": ws.hero_cta_link or "/apply"},
		"payments": web.public_payment_details(),
		"admissions": _admissions_block(ws),
	}


def _admissions_block(ws) -> dict:
	"""Admissions intro, steps and open intakes (shared by `home` and `site_settings`)."""
	return {
		"intro": web.excerpt(ws.admissions_intro, 300),
		"steps": web.split_lines(ws.admissions_steps),
		"intakes": _open_intakes(),
	}


@frappe.whitelist(allow_guest=True)
def home():
	return web.cached("home", _home)


def _home():
	ws = _ws()
	news = frappe.get_all(
		"News Post",
		filters=web.news_filters(),
		fields=web.NEWS_LIST_FIELDS,
		order_by="is_featured desc, published_on desc, creation desc",
		limit_page_length=3,
	)
	events, _total = web.upcoming_events(limit=4)
	return {
		"hero": {
			"eyebrow": ws.hero_eyebrow,
			"title": ws.hero_title,
			"subtitle": ws.hero_subtitle,
			"image": ws.hero_image,
			"video_url": ws.hero_video_url,
			"cta_label": ws.hero_cta_label,
			"cta_link": ws.hero_cta_link or "/apply",
		},
		"stats": [
			{"key": "students", "label": _("Students trained"), "value": cint(ws.stat_students)},
			{"key": "graduates", "label": _("Graduates in ministry"), "value": cint(ws.stat_graduates)},
			{"key": "churches", "label": _("Partner churches"), "value": cint(ws.stat_churches)},
			{"key": "years", "label": _("Years of training"), "value": cint(ws.stat_years)},
		],
		"about": {
			"summary": ws.about_summary,
			"mission": ws.mission,
			"vision": ws.vision,
			"values": web.split_lines(ws.core_values),
		},
		"programmes": web.published_programmes(limit=8),
		"news": [web.news_card(r) for r in news],
		"events": events,
		"testimonials": web.published_testimonials(limit=6),
		"principal": {
			"name": ws.principal_name,
			"title": ws.principal_title,
			"photo": ws.principal_photo,
			"excerpt": web.excerpt(ws.principal_message, 320),
		},
		"admissions": _admissions_block(ws),
	}


@frappe.whitelist(allow_guest=True)
def about():
	return web.cached("about", _about)


def _leadership():
	return [
		{
			"name": r.name,
			"full_name": " ".join(p for p in (r.salutation, r.full_name) if p),
			"designation": r.designation,
			"photo": r.photo,
			"department": r.department,
			"specialisation": r.specialisation,
			"qualifications": web.split_lines(r.qualifications),
			"bio": r.bio,
			"is_lecturer": cint(r.is_lecturer),
		}
		for r in frappe.get_all(
			"Staff Member",
			filters={"show_on_website": 1, "status": ["!=", "Inactive"]},
			fields=[
				"name",
				"salutation",
				"full_name",
				"designation",
				"photo",
				"department",
				"specialisation",
				"qualifications",
				"bio",
				"is_lecturer",
			],
			order_by="website_sequence asc, full_name asc",
		)
	]


def _campuses():
	return [
		{
			"name": r.name,
			"code": r.code,
			"is_main_campus": cint(r.is_main_campus),
			"town": r.town,
			"county": r.county,
			"address": r.address,
			"phone": r.phone,
			"email": r.email,
			"map_url": r.map_url,
			"image": r.image,
		}
		for r in frappe.get_all(
			"Campus",
			filters={"is_active": 1},
			fields=[
				"name",
				"code",
				"is_main_campus",
				"town",
				"county",
				"address",
				"phone",
				"email",
				"map_url",
				"image",
			],
			order_by="is_main_campus desc, campus_name asc",
		)
	]


def _about():
	ws = _ws()
	return {
		"summary": ws.about_summary,
		"mission": ws.mission,
		"vision": ws.vision,
		"values": web.split_lines(ws.core_values),
		"body": ws.about_body,
		"statement_of_faith": ws.statement_of_faith,
		"history": ws.history,
		"principal": {
			"name": ws.principal_name,
			"title": ws.principal_title,
			"photo": ws.principal_photo,
			"message": ws.principal_message,
		},
		"leadership": _leadership(),
		"campuses": _campuses(),
		"stats": {
			"students": cint(ws.stat_students),
			"graduates": cint(ws.stat_graduates),
			"churches": cint(ws.stat_churches),
			"years": cint(ws.stat_years),
		},
	}


@frappe.whitelist(allow_guest=True)
def faculty():
	"""Faculty & leadership page: everyone flagged show_on_website, grouped by department."""
	people = web.cached("faculty", _leadership)
	departments = sorted({p["department"] for p in people if p["department"]})
	return {"data": people, "departments": departments}


@frappe.whitelist(allow_guest=True)
def programmes(level=None, search=None, study_mode=None, campus=None):
	all_rows = web.cached("programmes", web.published_programmes)
	rows = all_rows
	if level:
		rows = [r for r in rows if r["level"] == level]
	if study_mode:
		rows = [r for r in rows if study_mode in r["study_modes"]]
	if campus:
		rows = [r for r in rows if campus in r["campuses"]]
	if search:
		needle = cstr(search).strip().lower()
		rows = [r for r in rows if needle in f"{r['code']} {r['name']} {r['short_description']}".lower()]
	return {
		"data": rows,
		"total": len(rows),
		"facets": {
			"levels": sorted({r["level"] for r in all_rows if r["level"]}),
			"study_modes": sorted({m for r in all_rows for m in r["study_modes"]}),
			"campuses": sorted({c for r in all_rows for c in r["campuses"]}),
		},
	}


@frappe.whitelist(allow_guest=True)
def programme(code):
	code = cstr(code).strip()
	return web.cached(f"programme:{code.lower()}", lambda: _programme(code))


def _programme(code):
	name = frappe.db.get_value(
		"Programme", {"name": code, "is_published": 1, "status": "Active"}, "name"
	) or frappe.db.get_value("Programme", {"code": code, "is_published": 1, "status": "Active"}, "name")
	if not name:
		frappe.throw(_("Programme {0} was not found.").format(code), frappe.DoesNotExistError)
	p = frappe.get_doc("Programme", name)
	default_fee = flt(setting("application_fee", 0))
	card = web.programme_card(
		frappe._dict({f: p.get(f) for f in web.PROGRAMME_LIST_FIELDS}),
		{"campuses": [r.campus for r in p.campuses], "study_modes": [r.study_mode for r in p.study_modes]},
		default_fee,
	)
	curriculum = {}
	for row in sorted(p.curriculum, key=lambda r: (cint(r.year_of_study), cint(r.term_number), r.idx)):
		key = (cint(row.year_of_study), cint(row.term_number))
		curriculum.setdefault(key, []).append(
			{
				"course_code": row.course,
				"title": row.course_title,
				"credits": flt(row.credits),
				"type": row.course_type,
			}
		)
	campuses = {c["name"]: c for c in _campuses()}
	return {
		**card,
		"overview": p.overview,
		"description": p.description,
		"entry_requirements": p.entry_requirements,
		"career_paths": p.career_paths,
		"total_credits": flt(p.total_credits) or sum(flt(r.credits) for r in p.curriculum),
		"min_cgpa_to_graduate": flt(p.min_cgpa_to_graduate),
		"curriculum": [
			{
				"year": year,
				"term": term,
				"label": _("Year {0}, Term {1}").format(year, term),
				"credits": sum(c["credits"] for c in courses),
				"courses": courses,
			}
			for (year, term), courses in curriculum.items()
		],
		"campus_details": [campuses[c] for c in card["campuses"] if c in campuses],
		"fees": _fee_structures(name, card["indicative_fee_per_term"]),
		"intakes": _open_intakes(),
		"apply_link": f"/apply?programme={p.name}",
	}


def _fee_structures(programme: str, indicative: float) -> dict:
	structures = frappe.get_all(
		"Fee Structure",
		filters={"programme": programme, "is_active": 1, "fee_category": "Standard"},
		fields=[
			"name",
			"structure_name",
			"campus",
			"study_mode",
			"academic_term",
			"year_of_study",
			"total_amount",
		],
		order_by="year_of_study asc, creation desc",
		limit_page_length=6,
	)
	items = {}
	if structures:
		for row in frappe.get_all(
			"Fee Structure Item",
			filters={"parenttype": "Fee Structure", "parent": ["in", [s.name for s in structures]]},
			fields=["parent", "fee_component", "description", "amount"],
			order_by="idx asc",
		):
			items.setdefault(row.parent, []).append(
				{"component": row.fee_component, "description": row.description, "amount": flt(row.amount)}
			)
	return {
		"indicative_per_term": indicative,
		"currency": setting("currency", "KES"),
		"structures": [
			{
				"title": s.structure_name,
				"campus": s.campus,
				"study_mode": s.study_mode,
				"academic_term": s.academic_term,
				"year_of_study": cint(s.year_of_study) or None,
				"total": flt(s.total_amount),
				"items": items.get(s.name, []),
			}
			for s in structures
		],
	}


def _open_intakes():
	return [
		{
			"name": r.name,
			"academic_year": r.academic_year,
			"start_date": r.start_date,
			"application_close_date": r.application_close_date,
		}
		for r in frappe.get_all(
			"Intake",
			filters={"applications_open": 1},
			or_filters=[
				["application_close_date", "is", "not set"],
				["application_close_date", ">=", today()],
			],
			fields=["name", "academic_year", "start_date", "application_close_date"],
			order_by="start_date asc",
		)
	]


@frappe.whitelist(allow_guest=True)
def news(page=1, page_length=9, category=None):
	page = max(cint(page), 1)
	length = page_args(0, page_length or 9, max_length=50)["page_length"]
	filters = web.news_filters(category)
	rows = frappe.get_all(
		"News Post",
		filters=filters,
		fields=web.NEWS_LIST_FIELDS,
		order_by="published_on desc, creation desc",
		limit_start=(page - 1) * length,
		limit_page_length=length,
	)
	total = frappe.db.count("News Post", filters)
	cats = frappe.get_all(
		"News Post",
		filters=web.news_filters(),
		fields=["category", {"COUNT": "*", "as": "n"}],
		group_by="category",
		order_by="category asc",
	)
	return {
		"data": [web.news_card(r) for r in rows],
		"total": total,
		"page": page,
		"pages": max((total + length - 1) // length, 1),
		"categories": [{"category": c.category, "count": cint(c.n)} for c in cats if c.category],
	}


@frappe.whitelist(allow_guest=True)
def news_post(route):
	filters = web.news_filters()
	filters["route"] = cstr(route).strip("/")
	name = frappe.db.get_value("News Post", filters, "name")
	if not name:
		frappe.throw(_("This article was not found."), frappe.DoesNotExistError)
	post = frappe.db.get_value(
		"News Post", name, [*web.NEWS_LIST_FIELDS, "content", "meta_description"], as_dict=True
	)
	frappe.db.set_value("News Post", name, "views", cint(post.views) + 1, update_modified=False)
	frappe.local.flags.commit = True
	related_filters = web.news_filters(post.category)
	related_filters["name"] = ["!=", name]
	related = frappe.get_all(
		"News Post",
		filters=related_filters,
		fields=web.NEWS_LIST_FIELDS,
		order_by="published_on desc",
		limit_page_length=3,
	)
	if len(related) < 3:
		more = web.news_filters()
		more["name"] = ["not in", [name, *[r.name for r in related]]]
		related += frappe.get_all(
			"News Post",
			filters=more,
			fields=web.NEWS_LIST_FIELDS,
			order_by="published_on desc",
			limit_page_length=3 - len(related),
		)
	return {
		**web.news_card(post),
		"content": post.content,
		"meta_description": post.meta_description,
		"views": cint(post.views) + 1,
		"related": [web.news_card(r) for r in related],
	}


@frappe.whitelist(allow_guest=True)
def events(scope="upcoming", page=1, page_length=9):
	page = max(cint(page), 1)
	length = page_args(0, page_length or 9, max_length=50)["page_length"]
	fn = web.past_events if scope == "past" else web.upcoming_events
	rows, total = fn(limit=length, start=(page - 1) * length)
	return {
		"data": rows,
		"total": total,
		"page": page,
		"pages": max((total + length - 1) // length, 1),
		"scope": "past" if scope == "past" else "upcoming",
	}


def _public_event_name(event: str) -> str:
	event = cstr(event).strip("/")
	base = {"is_public": 1, "status": ["!=", "Draft"]}
	name = frappe.db.get_value("Campus Event", {**base, "route": event}, "name") or frappe.db.get_value(
		"Campus Event", {**base, "name": event}, "name"
	)
	if not name:
		frappe.throw(_("This event was not found."), frappe.DoesNotExistError)
	return name


@frappe.whitelist(allow_guest=True)
def event(route):
	name = _public_event_name(route)
	ev = frappe.db.get_value(
		"Campus Event", name, [*web.EVENT_LIST_FIELDS, "description", "notices"], as_dict=True
	)
	card = web.event_card(ev)
	church = (
		frappe.db.get_value("Partner Church", ev.partner_church, "church_name") if ev.partner_church else None
	)
	return {
		**card,
		"description": ev.description,
		"notices": web.split_lines(ev.notices),
		"partner_church": church,
		"registration": web.registration_state(ev),
	}


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=10, seconds=60 * 60)
def register_for_event(
	event, full_name=None, email=None, phone=None, attendees=1, church=None, answers=None, website=None
):
	"""Public RSVP. Returns a reference; paid events also return an M-Pesa payment step."""
	if website:
		return {"ok": True}
	name = _public_event_name(event)
	ev = frappe.db.get_value("Campus Event", name, ["registration_required", "fee", "title"], as_dict=True)
	if not cint(ev.registration_required):
		frappe.throw(_("{0} does not need registration — just come.").format(ev.title))
	answers = parse_json(answers, answers) if answers else None
	if isinstance(answers, (dict, list)):
		answers = frappe.as_json(answers)
	reg = frappe.get_doc(
		{
			"doctype": "Event Registration",
			"campus_event": name,
			"full_name": cstr(full_name)[:140],
			"email": cstr(email)[:140] or None,
			"phone": cstr(phone)[:20] or None,
			"attendees": cint(attendees) or 1,
			"church": cstr(church)[:140] or None,
			"answers": cstr(answers)[:2000] or None,
		}
	)
	reg.insert(ignore_permissions=True)
	payment = None
	if reg.payment_status == "Pending" and reg.status != "Waitlisted":
		payment = _start_event_payment(reg, reg.phone)
	if reg.status == "Waitlisted":
		message = _(
			"The event is full, so you are on the waiting list. We will contact you if a seat opens up."
		)
	elif payment:
		message = _("Almost done — complete the M-Pesa payment to confirm your seat.")
	else:
		message = _("You're registered! A confirmation has been sent to you.")
	return {
		"ok": True,
		"reference": reg.name,
		"status": reg.status,
		"waitlisted": reg.status == "Waitlisted",
		"payment": payment,
		"message": message,
	}


def _start_event_payment(reg, phone) -> dict:
	"""Prompt an M-Pesa STK push for a paid event via the B3 contract; never fails the registration."""
	step = {
		"required": True,
		"amount": flt(reg.amount),
		"currency": setting("currency", "KES"),
		"registration": reg.name,
		"request": None,
		"customer_message": None,
		"error": None,
	}
	if not phone:
		step["error"] = _("Add an M-Pesa phone number to pay for this event.")
		return step
	try:
		from mahanaim.services.mpesa import initiate_payment

		res = initiate_payment(phone, flt(reg.amount), "Event Fee", initiated_by=frappe.session.user) or {}
		step["request"] = res.get("request")
		step["customer_message"] = res.get("customer_message")
		if res.get("request"):
			frappe.db.set_value(
				"Event Registration", reg.name, "mpesa_request", res["request"], update_modified=False
			)
	except frappe.ValidationError as e:
		step["error"] = cstr(e) or _("We could not start the M-Pesa payment. Please try again.")
		frappe.clear_last_message()
	except Exception:
		frappe.log_error(title=f"Event fee payment failed for {reg.name}")
		step["error"] = _(
			"M-Pesa payments are temporarily unavailable. Your seat is reserved; we will contact you."
		)
	return step


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=5, seconds=60 * 60)
def pay_event_fee(registration, email=None, phone=None):
	"""Retry the M-Pesa prompt for a pending paid registration (the email must match the registration)."""
	reg = frappe.db.get_value(
		"Event Registration",
		cstr(registration),
		["name", "email", "phone", "user", "payment_status"],
		as_dict=True,
	)
	session_user = frappe.session.user
	if not reg or not (
		(email and reg.email and cstr(email).strip().lower() == reg.email)
		or (reg.user and reg.user == session_user and session_user != "Guest")
	):
		frappe.throw(_("Registration not found."), frappe.DoesNotExistError)
	if reg.payment_status != "Pending":
		frappe.throw(_("This registration has no pending payment."))
	doc = frappe.get_doc("Event Registration", reg.name)
	return _start_event_payment(doc, normalize_phone(phone) or reg.phone)


@frappe.whitelist(allow_guest=True, methods=["GET", "POST"])
@rate_limit(limit=120, seconds=10 * 60)
def event_payment_status(registration, email=None):
	"""Guest-safe poll for an event-fee M-Pesa payment: `{status, done, receipt, message}`.

	The email must match the registration (or the caller is the signed-in registrant); anything else gets the same
	"not found" error so registrations cannot be enumerated."""
	reg = (
		frappe.db.get_value(
			"Event Registration",
			cstr(registration).strip(),
			["name", "email", "user", "payment_status", "payment_reference", "mpesa_request"],
			as_dict=True,
		)
		if cstr(registration).strip()
		else None
	)
	email = cstr(email).strip().lower()
	session_user = frappe.session.user
	if not reg or not (
		(email and reg.email and email == reg.email.strip().lower())
		or (reg.user and session_user != "Guest" and reg.user == session_user)
	):
		frappe.throw(_("Registration not found."), frappe.DoesNotExistError)
	return web.event_payment_state(reg)


@frappe.whitelist(allow_guest=True)
def faqs(category=None):
	rows = web.cached(
		"faqs",
		lambda: frappe.get_all(
			"FAQ",
			filters={"is_published": 1},
			fields=["name", "question", "answer", "category", "sequence"],
			order_by="category asc, sequence asc, creation asc",
		),
	)
	if category:
		rows = [r for r in rows if r.category == category]
	categories = []
	for r in rows:
		if r.category not in categories:
			categories.append(r.category)
	return {
		"data": [
			{"name": r.name, "question": r.question, "answer": r.answer, "category": r.category} for r in rows
		],
		"categories": categories,
	}


@frappe.whitelist(allow_guest=True)
def testimonials():
	return {"data": web.cached("testimonials", web.published_testimonials)}


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=5, seconds=60 * 60)
def submit_enquiry(
	full_name=None, email=None, phone=None, subject=None, message=None, enquiry_type="General", website=None
):
	"""Public contact form. `enquiry_type` maps to the Select; a free-text `subject` is kept in the message."""
	if website:
		return {"ok": True}
	if not cstr(message).strip():
		frappe.throw(_("Please write your message."))
	if len(cstr(message)) > 5000:
		frappe.throw(_("Please keep your message under 5,000 characters."))
	kind = enquiry_type if enquiry_type in ENQUIRY_TYPES else ("Other" if enquiry_type else "General")
	body = cstr(message).strip()
	if subject and cstr(subject).strip() and cstr(subject).strip() not in ENQUIRY_TYPES:
		body = _("Subject: {0}").format(cstr(subject).strip()[:140]) + "\n\n" + body
	enquiry = frappe.get_doc(
		{
			"doctype": "Contact Enquiry",
			"full_name": cstr(full_name)[:140],
			"email": cstr(email)[:140],
			"phone": cstr(phone)[:20] or None,
			"subject": kind,
			"message": body,
			"ip_address": getattr(frappe.local, "request_ip", None),
		}
	)
	enquiry.insert(ignore_permissions=True)
	_notify_enquiry_staff(enquiry)
	return {
		"ok": True,
		"reference": enquiry.name,
		"message": _(
			"Thank you, {0}. We have received your message and will respond within two working days."
		).format(enquiry.full_name.split(" ")[0]),
	}


def _role_users(*roles) -> list[str]:
	return frappe.get_all(
		"Has Role",
		filters={
			"role": ["in", roles],
			"parenttype": "User",
			"parent": ["not in", ["Administrator", "Guest"]],
		},
		pluck="parent",
		distinct=True,
	)


def _notify_enquiry_staff(enquiry):
	from mahanaim.services.communication import notify, recipient_for_user

	users = _role_users(ROLE_COMMS)
	if enquiry.subject == "Admissions":
		users += _role_users(ROLE_ADMISSIONS)
	enabled = (
		set(frappe.get_all("User", filters={"name": ["in", list(set(users))], "enabled": 1}, pluck="name"))
		if users
		else set()
	)
	if not enabled:
		return
	recipients = [recipient_for_user(u) for u in sorted(enabled)]
	for r in recipients:
		r.pop("phone", None)  # staff alerts go in-app + email only
	notify(
		"Contact Enquiry",
		doc=enquiry,
		recipients=recipients,
		context={"enquiry": enquiry},
		link=f"/admin/website/enquiries/{enquiry.name}",
		category="Info",
		fallback={
			"subject": _("New {0} enquiry from {1}").format(_(enquiry.subject), enquiry.full_name),
			"message": "<p>{}</p><p><b>{}</b> &lt;{}&gt; {}</p><blockquote>{}</blockquote>".format(
				_("A new enquiry was submitted on the website."),
				frappe.utils.escape_html(enquiry.full_name),
				frappe.utils.escape_html(enquiry.email),
				frappe.utils.escape_html(enquiry.phone or ""),
				frappe.utils.escape_html(enquiry.message).replace("\n", "<br>"),
			),
		},
		channels=("Email", "In-App"),
	)


@frappe.whitelist(allow_guest=True)
def apply_lookups():
	"""Everything the public application form needs in one call."""
	return web.cached("apply_lookups", _apply_lookups)


def _apply_lookups():
	progs = web.published_programmes()
	modes = frappe.get_all(
		"Study Mode",
		filters={"is_active": 1},
		fields=["name", "code", "is_online", "description"],
		order_by="study_mode_name asc",
	)
	churches = frappe.get_all(
		"Partner Church",
		filters={"partnership_status": "Active", "is_group": 0},
		fields=["name", "church_name", "denomination", "town"],
		order_by="church_name asc",
	)
	fee = flt(setting("application_fee", 0))
	return {
		"programmes": [
			{
				k: p[k]
				for k in (
					"code",
					"name",
					"level",
					"duration",
					"campuses",
					"study_modes",
					"application_fee",
					"minimum_entry",
					"award_title",
				)
			}
			for p in progs
		],
		"campuses": [
			{k: c[k] for k in ("name", "code", "town", "county", "is_main_campus")} for c in _campuses()
		],
		"study_modes": [
			{"name": m.name, "code": m.code, "is_online": cint(m.is_online), "description": m.description}
			for m in modes
		],
		"intakes": _open_intakes(),
		"partner_churches": churches,
		"application_fee": fee,
		"application_fee_required": cint(setting("application_fee_required", 1)),
		"currency": setting("currency", "KES"),
		"sponsorship_types": ["Self", "Church", "Sponsor", "Scholarship", "Employer"],
	}


@frappe.whitelist(allow_guest=True)
def search(q=None):
	q = cstr(q).strip()
	if len(q) < 2:
		return {"query": q, "results": [], "total": 0}
	like = f"%{q}%"
	results = []
	for p in frappe.get_all(
		"Programme",
		filters={"is_published": 1, "status": "Active"},
		or_filters=[["programme_name", "like", like], ["code", "like", like], ["overview", "like", like]],
		fields=["name", "programme_name", "level", "overview"],
		limit_page_length=5,
	):
		results.append(
			{
				"type": "Programme",
				"title": p.programme_name,
				"subtitle": p.level,
				"excerpt": web.excerpt(p.overview, 140),
				"route": f"/programmes/{p.name}",
			}
		)
	for n in frappe.get_all(
		"News Post",
		filters=web.news_filters(),
		or_filters=[["title", "like", like], ["excerpt", "like", like], ["tags", "like", like]],
		fields=["title", "route", "category", "excerpt", "published_on"],
		order_by="published_on desc",
		limit_page_length=5,
	):
		results.append(
			{
				"type": "News",
				"title": n.title,
				"subtitle": n.category,
				"excerpt": web.excerpt(n.excerpt, 140),
				"route": f"/news/{n.route}",
				"date": n.published_on,
			}
		)
	for e in frappe.get_all(
		"Campus Event",
		filters={"is_public": 1, "status": ["!=", "Draft"]},
		or_filters=[["title", "like", like], ["summary", "like", like], ["venue", "like", like]],
		fields=["title", "route", "event_type", "summary", "start_datetime"],
		order_by="start_datetime desc",
		limit_page_length=5,
	):
		results.append(
			{
				"type": "Event",
				"title": e.title,
				"subtitle": e.event_type,
				"excerpt": web.excerpt(e.summary, 140),
				"route": f"/events/{e.route}",
				"date": e.start_datetime,
			}
		)
	for f in frappe.get_all(
		"FAQ",
		filters={"is_published": 1},
		or_filters=[["question", "like", like], ["answer", "like", like]],
		fields=["name", "question", "category", "answer"],
		limit_page_length=5,
	):
		results.append(
			{
				"type": "FAQ",
				"title": f.question,
				"subtitle": f.category,
				"excerpt": web.excerpt(f.answer, 140),
				"route": f"/faq#{f.name}",
			}
		)
	return {"query": q, "results": results, "total": len(results)}


# ============================================================================ staff CMS
def _upsert(doctype: str, data, allowed) -> frappe.model.document.Document:
	data = parse_json(data, {}) or {}
	values = clean_payload(data, allowed)
	if data.get("name"):
		doc = frappe.get_doc(doctype, data["name"])
		doc.check_permission("write")
	else:
		doc = frappe.new_doc(doctype)
		doc.check_permission("create")
	doc.update(values)
	doc.save()
	return doc


def _delete(doctype: str, name: str):
	frappe.delete_doc(doctype, name)
	return {"ok": True, "name": name}


@frappe.whitelist()
def cms_overview():
	require_roles(*CMS_ROLES, *EVENT_ROLES, *ENQUIRY_ROLES)
	enquiries = frappe.get_all(
		"Contact Enquiry", fields=["status", {"COUNT": "*", "as": "n"}], group_by="status"
	)
	now = now_datetime()
	upcoming = frappe.get_all(
		"Campus Event",
		filters={"status": ["in", ["Upcoming", "Ongoing"]], "end_datetime": [">=", now]},
		fields=[
			"name",
			"title",
			"route",
			"start_datetime",
			"capacity",
			"registered_count",
			"registration_required",
			"status",
		],
		order_by="start_datetime asc",
		limit_page_length=5,
	)
	return {
		"counts": {
			"news_published": frappe.db.count("News Post", web.news_filters()),
			"news_drafts": frappe.db.count("News Post", {"published": 0}),
			"news_scheduled": frappe.db.count(
				"News Post", {"published": 1, "published_on": [">", nowdate()]}
			),
			"events_upcoming": frappe.db.count("Campus Event", {"status": ["in", ["Upcoming", "Ongoing"]]}),
			"events_draft": frappe.db.count("Campus Event", {"status": "Draft"}),
			"registrations_upcoming": sum(cint(e.registered_count) for e in upcoming),
			"faqs": frappe.db.count("FAQ", {"is_published": 1}),
			"testimonials": frappe.db.count("Testimonial", {"is_published": 1}),
			"enquiries": {r.status: cint(r.n) for r in enquiries},
			"enquiries_open": sum(cint(r.n) for r in enquiries if r.status in ("New", "In Progress")),
		},
		"recent_enquiries": frappe.get_all(
			"Contact Enquiry",
			fields=["name", "full_name", "email", "subject", "status", "assigned_to", "creation"],
			order_by="creation desc",
			limit_page_length=8,
		),
		"upcoming_events": [
			{
				**e,
				"seats_left": max(cint(e.capacity) - cint(e.registered_count), 0)
				if cint(e.capacity)
				else None,
			}
			for e in upcoming
		],
	}


@frappe.whitelist()
def list_news(status=None, category=None, search=None, start=0, page_length=20):
	require_roles(*CMS_ROLES)
	filters = {}
	if status == "published":
		filters.update(web.news_filters())
	elif status == "scheduled":
		filters.update({"published": 1, "published_on": [">", nowdate()]})
	elif status == "draft":
		filters["published"] = 0
	if category:
		filters["category"] = category
	or_filters = [["title", "like", f"%{search}%"], ["tags", "like", f"%{search}%"]] if search else None
	pa = page_args(start, page_length)
	rows = frappe.get_list(
		"News Post",
		filters=filters,
		or_filters=or_filters,
		fields=[*web.NEWS_LIST_FIELDS, "published", "modified"],
		order_by="modified desc",
		limit_start=pa["start"],
		limit_page_length=pa["page_length"],
	)
	for r in rows:
		r["state"] = _news_state(r)
	return {
		"data": rows,
		"total": len(frappe.get_list("News Post", filters=filters, or_filters=or_filters, pluck="name")),
	}


def _news_state(r) -> str:
	if not cint(r.get("published")):
		return "Draft"
	if r.get("published_on") and getdate(r["published_on"]) > getdate(nowdate()):
		return "Scheduled"
	return "Published"


@frappe.whitelist()
def get_news(name):
	require_roles(*CMS_ROLES)
	doc = frappe.get_doc("News Post", name)
	doc.check_permission("read")
	out = {f: doc.get(f) for f in ("name", *NEWS_FIELDS, "views", "modified")}
	out["state"] = _news_state(out)
	return out


@frappe.whitelist(methods=["POST"])
def save_news(data):
	require_roles(*CMS_ROLES)
	doc = _upsert("News Post", data, NEWS_FIELDS)
	return get_news(doc.name)


@frappe.whitelist(methods=["POST"])
def publish_news(name, publish=1, published_on=None):
	require_roles(*CMS_ROLES)
	doc = frappe.get_doc("News Post", name)
	doc.check_permission("write")
	doc.published = 1 if cint(publish) else 0
	if doc.published:
		doc.published_on = published_on or doc.published_on or nowdate()
	doc.save()
	return get_news(doc.name)


@frappe.whitelist(methods=["POST"])
def delete_news(name):
	require_roles(*CMS_ROLES)
	return _delete("News Post", name)


@frappe.whitelist()
def list_events(status=None, scope=None, search=None, start=0, page_length=20):
	require_roles(*EVENT_ROLES)
	filters = {}
	if status:
		filters["status"] = status
	if scope == "upcoming":
		filters["end_datetime"] = [">=", now_datetime()]
	elif scope == "past":
		filters["end_datetime"] = ["<", now_datetime()]
	or_filters = [["title", "like", f"%{search}%"], ["venue", "like", f"%{search}%"]] if search else None
	pa = page_args(start, page_length)
	rows = frappe.get_list(
		"Campus Event",
		filters=filters,
		or_filters=or_filters,
		fields=[*web.EVENT_LIST_FIELDS, "is_public", "attended_count"],
		order_by="start_datetime desc",
		limit_start=pa["start"],
		limit_page_length=pa["page_length"],
	)
	for r in rows:
		r["seats_left"] = max(cint(r.capacity) - cint(r.registered_count), 0) if cint(r.capacity) else None
	total = len(frappe.get_list("Campus Event", filters=filters, or_filters=or_filters, pluck="name"))
	return {"data": rows, "total": total}


@frappe.whitelist()
def get_event(name):
	require_roles(*EVENT_ROLES)
	doc = frappe.get_doc("Campus Event", name)
	doc.check_permission("read")
	out = {f: doc.get(f) for f in ("name", *EVENT_FIELDS, "registered_count", "attended_count", "modified")}
	out["registration"] = web.registration_state(doc.as_dict())
	return out


@frappe.whitelist(methods=["POST"])
def save_event(data):
	require_roles(*EVENT_ROLES)
	doc = _upsert("Campus Event", data, EVENT_FIELDS)
	return get_event(doc.name)


@frappe.whitelist(methods=["POST"])
def delete_event(name):
	"""Delete an event nobody has registered for; events with registrations must be cancelled instead."""
	require_roles(*EVENT_ROLES)
	frappe.get_doc("Campus Event", name).check_permission("delete")
	count = frappe.db.count("Event Registration", {"campus_event": name})
	if count:
		frappe.throw(
			_("This event has {0} registration(s). Cancel the event instead of deleting it.").format(count),
			title=_("Event has registrations"),
		)
	return _delete("Campus Event", name)


@frappe.whitelist()
def event_registrations(event, status=None, search=None):
	require_roles(*EVENT_ROLES)
	filters = {"campus_event": event}
	if status:
		filters["status"] = status
	or_filters = (
		[
			["full_name", "like", f"%{search}%"],
			["email", "like", f"%{search}%"],
			["phone", "like", f"%{search}%"],
			["name", "like", f"%{search}%"],
		]
		if search
		else None
	)
	rows = frappe.get_list(
		"Event Registration",
		filters=filters,
		or_filters=or_filters,
		fields=[
			"name",
			"full_name",
			"email",
			"phone",
			"status",
			"attendees",
			"church",
			"student",
			"user",
			"checked_in_on",
			"amount",
			"payment_status",
			"payment_reference",
			"answers",
			"creation",
		],
		order_by="creation asc",
		limit_page_length=0,
	)
	summary = {}
	for r in frappe.get_all(
		"Event Registration",
		filters={"campus_event": event},
		fields=["status", {"COUNT": "*", "as": "n"}, {"SUM": "attendees", "as": "people"}],
		group_by="status",
	):
		summary[r.status] = {"registrations": cint(r.n), "people": cint(r.people)}
	ev = frappe.db.get_value(
		"Campus Event",
		event,
		["title", "capacity", "registered_count", "attended_count", "fee"],
		as_dict=True,
	)
	return {"data": rows, "total": len(rows), "summary": summary, "event": ev}


@frappe.whitelist(methods=["POST"])
def check_in(registration, undo=0):
	require_roles(*EVENT_ROLES)
	doc = frappe.get_doc("Event Registration", registration)
	doc.check_permission("write")
	if cint(undo):
		if doc.status != "Attended":
			frappe.throw(_("{0} has not been checked in.").format(doc.full_name))
		doc.status = "Confirmed"
	else:
		if doc.status == "Attended":
			return _registration_dict(doc)
		if doc.status not in ("Registered", "Confirmed"):
			frappe.throw(
				_("Only registered or confirmed guests can be checked in (this one is {0}).").format(
					_(doc.status)
				)
			)
		doc.status = "Attended"
	doc.save()
	return _registration_dict(doc)


@frappe.whitelist(methods=["POST"])
def set_registration_status(registration, status):
	require_roles(*EVENT_ROLES)
	doc = frappe.get_doc("Event Registration", registration)
	doc.check_permission("write")
	doc.status = status
	doc.save()
	return _registration_dict(doc)


def _registration_dict(doc):
	return {
		f: doc.get(f)
		for f in (
			"name",
			"campus_event",
			"full_name",
			"email",
			"phone",
			"status",
			"attendees",
			"checked_in_on",
			"payment_status",
			"amount",
		)
	}


@frappe.whitelist()
def export_registrations(event):
	require_roles(*EVENT_ROLES)
	title = frappe.db.get_value("Campus Event", event, "title")
	if not title:
		frappe.throw(_("Event {0} was not found.").format(event), frappe.DoesNotExistError)
	rows = frappe.get_list(
		"Event Registration",
		filters={"campus_event": event},
		fields=[
			"name",
			"full_name",
			"email",
			"phone",
			"church",
			"attendees",
			"status",
			"checked_in_on",
			"payment_status",
			"amount",
			"payment_reference",
			"creation",
		],
		order_by="creation asc",
		limit_page_length=0,
	)
	buf = io.StringIO()
	writer = csv.writer(buf)
	headers = [
		"Reference",
		"Full Name",
		"Email",
		"Phone",
		"Church",
		"Attendees",
		"Status",
		"Checked In",
		"Payment",
		"Amount",
		"Payment Ref",
		"Registered On",
	]
	writer.writerow([_(h) for h in headers])
	for r in rows:
		writer.writerow(
			[
				r.name,
				r.full_name,
				r.email or "",
				r.phone or "",
				r.church or "",
				r.attendees,
				r.status,
				cstr(r.checked_in_on or ""),
				r.payment_status,
				flt(r.amount),
				r.payment_reference or "",
				cstr(r.creation)[:19],
			]
		)
	return {
		"filename": f"{web.slugify(title)}-registrations.csv",
		"content": buf.getvalue(),
		"mimetype": "text/csv",
		"rows": len(rows),
	}


@frappe.whitelist()
def list_enquiries(status=None, subject=None, assigned_to=None, search=None, start=0, page_length=20):
	require_roles(*ENQUIRY_ROLES)
	filters = {}
	if status:
		filters["status"] = status
	if subject:
		filters["subject"] = subject
	if assigned_to:
		filters["assigned_to"] = frappe.session.user if assigned_to == "me" else assigned_to
	or_filters = (
		[
			["full_name", "like", f"%{search}%"],
			["email", "like", f"%{search}%"],
			["message", "like", f"%{search}%"],
			["name", "like", f"%{search}%"],
		]
		if search
		else None
	)
	pa = page_args(start, page_length)
	rows = frappe.get_list(
		"Contact Enquiry",
		filters=filters,
		or_filters=or_filters,
		fields=[
			"name",
			"full_name",
			"email",
			"phone",
			"subject",
			"status",
			"assigned_to",
			"creation",
			"modified",
			"message",
		],
		order_by="creation desc",
		limit_start=pa["start"],
		limit_page_length=pa["page_length"],
	)
	for r in rows:
		r["preview"] = web.excerpt(r.pop("message"), 140)
	counts = {
		r.status: cint(r.n)
		for r in frappe.get_all(
			"Contact Enquiry", fields=["status", {"COUNT": "*", "as": "n"}], group_by="status"
		)
	}
	total = len(frappe.get_list("Contact Enquiry", filters=filters, or_filters=or_filters, pluck="name"))
	return {"data": rows, "total": total, "counts": counts}


@frappe.whitelist()
def get_enquiry(name):
	require_roles(*ENQUIRY_ROLES)
	doc = frappe.get_doc("Contact Enquiry", name)
	doc.check_permission("read")
	notes = frappe.get_all(
		"Comment",
		filters={"reference_doctype": "Contact Enquiry", "reference_name": name, "comment_type": "Comment"},
		fields=["name", "content", "comment_email", "creation"],
		order_by="creation asc",
	)
	return {
		**{
			f: doc.get(f)
			for f in (
				"name",
				"full_name",
				"email",
				"phone",
				"subject",
				"status",
				"assigned_to",
				"message",
				"response",
				"creation",
				"modified",
			)
		},
		"notes": notes,
	}


@frappe.whitelist(methods=["POST"])
def update_enquiry(name, status=None, notes=None, assign_to=None, response=None):
	"""Assign, respond to (emails the enquirer when status becomes Responded) or annotate an enquiry."""
	require_roles(*ENQUIRY_ROLES)
	doc = frappe.get_doc("Contact Enquiry", name)
	doc.check_permission("write")
	if assign_to is not None:
		doc.assigned_to = (frappe.session.user if assign_to == "me" else assign_to) or None
	if response is not None:
		doc.response = response
	if status:
		doc.status = status
	doc.save()
	if notes and cstr(notes).strip():
		doc.add_comment("Comment", frappe.utils.escape_html(cstr(notes).strip()))
	return get_enquiry(doc.name)


@frappe.whitelist()
def get_website_settings():
	require_roles(*CMS_ROLES)
	doc = frappe.get_doc("Campus Website Settings")
	doc.check_permission("read")
	return {f.fieldname: doc.get(f.fieldname) for f in doc.meta.fields if f.fieldtype not in no_value_fields}


@frappe.whitelist(methods=["POST"])
def update_website_settings(data):
	require_roles(*CMS_ROLES)
	doc = frappe.get_doc("Campus Website Settings")
	doc.check_permission("write")
	allowed = [
		f.fieldname
		for f in doc.meta.fields
		if f.fieldtype not in no_value_fields and f.fieldname not in SETTINGS_SKIP
	]
	doc.update(clean_payload(data, allowed))
	doc.save()
	return get_website_settings()


@frappe.whitelist()
def list_faqs(category=None):
	require_roles(*CMS_ROLES, *ENQUIRY_ROLES)
	filters = {"category": category} if category else {}
	rows = frappe.get_list(
		"FAQ",
		filters=filters,
		fields=["name", *FAQ_FIELDS, "modified"],
		order_by="category asc, sequence asc",
		limit_page_length=0,
	)
	return {"data": rows, "total": len(rows)}


@frappe.whitelist(methods=["POST"])
def save_faq(data):
	require_roles(*CMS_ROLES, *ENQUIRY_ROLES)
	doc = _upsert("FAQ", data, FAQ_FIELDS)
	return {f: doc.get(f) for f in ("name", *FAQ_FIELDS)}


@frappe.whitelist(methods=["POST"])
def delete_faq(name):
	require_roles(*CMS_ROLES, *ENQUIRY_ROLES)
	return _delete("FAQ", name)


@frappe.whitelist()
def list_testimonials():
	require_roles(*CMS_ROLES)
	rows = frappe.get_list(
		"Testimonial",
		fields=["name", *TESTIMONIAL_FIELDS, "modified"],
		order_by="sequence asc, creation asc",
		limit_page_length=0,
	)
	return {"data": rows, "total": len(rows)}


@frappe.whitelist(methods=["POST"])
def save_testimonial(data):
	require_roles(*CMS_ROLES)
	doc = _upsert("Testimonial", data, TESTIMONIAL_FIELDS)
	return {f: doc.get(f) for f in ("name", *TESTIMONIAL_FIELDS)}


@frappe.whitelist(methods=["POST"])
def delete_testimonial(name):
	require_roles(*CMS_ROLES)
	return _delete("Testimonial", name)
