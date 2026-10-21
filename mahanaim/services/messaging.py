"""Messaging helpers on top of services.communication (owned by backend domain B4).

- Who may post which announcement (lecturers: only to offerings they teach).
- Which announcements a portal user can see (audience rules for `my_announcements`).
- Resolving ad-hoc recipients and delivering direct messages (synchronously or as a background job).
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.query_builder import Order
from frappe.utils import cstr, strip_html, today

from mahanaim.services.communication import push_portal_notification, send_email, send_sms
from mahanaim.utils import (
	ROLE_ADMIN,
	ROLE_ALUMNI,
	ROLE_APPLICANT,
	ROLE_CHAPLAIN,
	ROLE_COMMS,
	ROLE_DEAN,
	ROLE_FINANCE,
	ROLE_LECTURER,
	ROLE_REGISTRAR,
	ROLE_SPONSOR,
	ROLE_STUDENT,
	is_staff,
	user_roles,
)

# Roles that may post announcements to any audience (System Manager / College Administrator always may).
ANNOUNCER_ROLES = (ROLE_COMMS, ROLE_REGISTRAR, ROLE_DEAN, ROLE_FINANCE, ROLE_CHAPLAIN)
CHANNELS = ("Email", "SMS", "In-App")
DIRECT_SYNC_LIMIT = 50
DIRECT_MAX_RECIPIENTS = 2000
ACTIVE_STUDENT = ("Admitted", "Registered", "Active", "Deferred")


def is_lecturer_only(user: str | None = None) -> bool:
	"""A Lecturer without any announcer/admin role (restricted to their own course offerings)."""
	user = user or frappe.session.user
	if user == "Administrator":
		return False
	roles = user_roles(user)
	return ROLE_LECTURER in roles and not roles & {"System Manager", ROLE_ADMIN, *ANNOUNCER_ROLES}


def teaches(user: str, offering: str | None) -> bool:
	return bool(offering) and bool(
		frappe.db.exists(
			"Course Offering Lecturer", {"parenttype": "Course Offering", "parent": offering, "user": user}
		)
	)


# ---------------------------------------------------------------------------------- portal visibility
def audience_context(user: str) -> dict:
	"""Everything that decides which announcements `user` may see."""
	roles = user_roles(user)
	ctx = {"audiences": {"Everyone"}, "programme": None, "campus": None, "offerings": set()}
	student = frappe.db.get_value(
		"Student", {"user": user}, ["name", "status", "programme", "campus"], as_dict=True
	)
	if student:
		if student.status == "Alumni":
			ctx["audiences"].add("Alumni")
		elif student.status not in ("Withdrawn", "Applicant"):
			ctx["audiences"].add("All Students")
			ctx["programme"], ctx["campus"] = student.programme, student.campus
			ctx["offerings"].update(
				frappe.get_all(
					"Course Enrolment",
					filters={"student": student.name, "status": "Enrolled"},
					pluck="course_offering",
				)
			)
	if ROLE_STUDENT in roles and not student:
		ctx["audiences"].add("All Students")
	if ROLE_ALUMNI in roles:
		ctx["audiences"].add("Alumni")
	if ROLE_APPLICANT in roles:
		ctx["audiences"].add("Applicants")
	if ROLE_SPONSOR in roles:
		ctx["audiences"].add("Sponsors")
	if ROLE_LECTURER in roles:
		ctx["audiences"].update({"Lecturers", "All Staff"})
		from mahanaim.permissions import taught_offerings

		ctx["offerings"].update(taught_offerings(user))
	if is_staff(user):
		ctx["audiences"].add("All Staff")
	return ctx


def _visible_filter(A, ctx: dict):
	"""Portal visibility: published (Sent, shown in the portal, not expired) and addressed to the user."""
	crit = A.audience.isin(sorted(ctx["audiences"]))
	if ctx["programme"]:
		crit = crit | ((A.audience == "Programme") & (A.programme == ctx["programme"]))
	if ctx["campus"]:
		crit = crit | ((A.audience == "Campus") & (A.campus == ctx["campus"]))
	if ctx["offerings"]:
		crit = crit | ((A.audience == "Course Offering") & A.course_offering.isin(sorted(ctx["offerings"])))
	# expires_on is a Date: the announcement stays visible through the whole expiry day.
	return (
		(A.show_in_portal == 1)
		& (A.status == "Sent")
		& (A.expires_on.isnull() | (A.expires_on >= today()))
		& crit
	)


def count_visible_announcements(user: str, ctx: dict | None = None) -> int:
	from frappe.query_builder.functions import Count

	A = frappe.qb.DocType("Announcement")
	ctx = ctx or audience_context(user)
	row = frappe.qb.from_(A).select(Count(A.name)).where(_visible_filter(A, ctx)).run()
	return int(row[0][0] or 0) if row else 0


def visible_announcements(user: str, limit: int = 20, start: int = 0, ctx: dict | None = None) -> list[dict]:
	A = frappe.qb.DocType("Announcement")
	ctx = ctx or audience_context(user)
	rows = (
		frappe.qb.from_(A)
		.select(
			A.name,
			A.title,
			A.body,
			A.audience,
			A.programme,
			A.campus,
			A.course_offering,
			A.is_pinned,
			A.sent_on,
			A.publish_on,
			A.expires_on,
			A.attachment,
			A.posted_by,
		)
		.where(_visible_filter(A, ctx))
		.orderby(A.is_pinned, order=Order.desc)
		.orderby(A.sent_on, order=Order.desc)
		.limit(limit)
		.offset(start)
		.run(as_dict=True)
	)
	authors = {}
	posters = list({r.posted_by for r in rows if r.posted_by})
	if posters:
		authors = dict(
			frappe.get_all(
				"User", filters={"name": ["in", posters]}, fields=["name", "full_name"], as_list=True
			)
		)
	offering_titles = {}
	offerings = list({r.course_offering for r in rows if r.course_offering})
	if offerings:
		offering_titles = dict(
			frappe.get_all(
				"Course Offering",
				filters={"name": ["in", offerings]},
				fields=["name", "course_title"],
				as_list=True,
			)
		)
	for r in rows:
		r["posted_by_name"] = authors.get(r.posted_by)
		r["course_title"] = offering_titles.get(r.course_offering)
		r["is_pinned"] = int(r.is_pinned or 0)
		r["summary"] = strip_html(r.body or "")[:240]
	return rows


# ---------------------------------------------------------------------------------- direct messages
LECTURER_DIRECT_PER_HOUR = 20  # direct sends per lecturer-only user per hour (staff are not limited)


def class_students(offerings) -> list[str]:
	"""Students actively enrolled (Course Enrolment "Enrolled") in any of `offerings`."""
	offerings = [o for o in (offerings or []) if o]
	if not offerings:
		return []
	return frappe.get_all(
		"Course Enrolment",
		filters={"course_offering": ["in", offerings], "status": "Enrolled"},
		pluck="student",
		distinct=True,
	)


def students_for_specs(specs: list) -> list[str | None]:
	"""Map each recipient spec to the Student it addresses (by student, user or email), batched."""
	keyed = []
	users, emails = set(), set()
	for spec in specs:
		if isinstance(spec, str):
			spec = {"email": spec} if "@" in spec else {"phone": spec}
		spec = spec if isinstance(spec, dict) else {}
		if spec.get("student"):
			keyed.append(("student", cstr(spec["student"])))
		elif spec.get("user"):
			keyed.append(("user", cstr(spec["user"])))
			users.add(cstr(spec["user"]))
		elif spec.get("email"):
			email = cstr(spec["email"]).strip().lower()
			keyed.append(("email", email))
			emails.add(email)
		else:
			keyed.append((None, None))
	by_user, by_email = {}, {}
	if users or emails:
		or_filters = []
		if users:
			or_filters.append(["user", "in", sorted(users)])
		if emails:
			or_filters += [["user", "in", sorted(emails)], ["email", "in", sorted(emails)]]
		for r in frappe.get_all("Student", or_filters=or_filters, fields=["name", "user", "email"]):
			if r.user:
				by_user[r.user] = r.name
				by_email.setdefault(r.user.lower(), r.name)
			if r.email:
				by_email.setdefault(r.email.lower(), r.name)
	out = []
	for kind, value in keyed:
		if kind == "student":
			out.append(value)
		elif kind == "user":
			out.append(by_user.get(value))
		elif kind == "email":
			out.append(by_email.get(value))
		else:
			out.append(None)
	return out


def check_lecturer_direct_quota(user: str) -> None:
	key = frappe.cache.make_key(f"mbc:direct-message:{user}")
	sent = frappe.cache.incrby(key, 1)
	if sent == 1:
		frappe.cache.expire(key, 60 * 60)
	if sent > LECTURER_DIRECT_PER_HOUR:
		frappe.throw(
			_("You have sent {0} messages in the last hour. Please try again later.").format(
				LECTURER_DIRECT_PER_HOUR
			),
			frappe.RateLimitExceededError,
		)


def resolve_students(names) -> list[dict]:
	"""Batch form of resolve_recipient for students (keeps the order of `names`, drops unknown ones)."""
	names = list(dict.fromkeys(n for n in (names or []) if n))
	if not names:
		return []
	rows = {
		r.name: r
		for r in frappe.get_all(
			"Student",
			filters={"name": ["in", names]},
			fields=["name", "user", "email", "phone", "full_name"],
		)
	}
	return [
		{
			"user": rows[n].user,
			"email": rows[n].email,
			"phone": rows[n].phone,
			"name": rows[n].full_name,
			"student": n,
		}
		for n in names
		if n in rows
	]


def resolve_recipient(spec) -> dict | None:
	"""{user|student|staff_member|sponsor|email|phone[, name]} -> {user, email, phone, name}."""
	if isinstance(spec, str):
		spec = {"email": spec} if "@" in spec else {"phone": spec}
	if not isinstance(spec, dict):
		return None
	if spec.get("student"):
		r = frappe.db.get_value(
			"Student", spec["student"], ["user", "email", "phone", "full_name"], as_dict=True
		)
		return r and {"user": r.user, "email": r.email, "phone": r.phone, "name": r.full_name}
	if spec.get("staff_member"):
		r = frappe.db.get_value(
			"Staff Member", spec["staff_member"], ["user", "email", "phone", "full_name"], as_dict=True
		)
		return r and {"user": r.user, "email": r.email, "phone": r.phone, "name": r.full_name}
	if spec.get("sponsor"):
		r = frappe.db.get_value(
			"Sponsor", spec["sponsor"], ["user", "email", "phone", "sponsor_name"], as_dict=True
		)
		return r and {"user": r.user, "email": r.email, "phone": r.phone, "name": r.sponsor_name}
	if spec.get("user"):
		r = frappe.db.get_value(
			"User", spec["user"], ["name", "email", "mobile_no", "full_name", "enabled"], as_dict=True
		)
		return (
			r and r.enabled and {"user": r.name, "email": r.email, "phone": r.mobile_no, "name": r.full_name}
		)
	if spec.get("email") or spec.get("phone"):
		email = cstr(spec.get("email")).strip().lower() or None
		if email and not frappe.utils.validate_email_address(email):
			return None
		user = frappe.db.get_value("User", {"email": email, "enabled": 1}, "name") if email else None
		return {"user": user, "email": email, "phone": spec.get("phone"), "name": spec.get("name")}
	return None


def deliver_direct(
	recipients: list[dict], subject: str, message: str, channels, sender: str | None = None
) -> dict:
	"""Send one ad-hoc message to resolved recipients. Never raises per-recipient errors."""
	channels = [c for c in (channels or []) if c in CHANNELS]
	plain = strip_html(message or "")
	sms_text = plain[:459]
	stats = {"Email": 0, "SMS": 0, "In-App": 0, "failed": 0}
	for r in recipients:
		try:
			if "Email" in channels and r.get("email"):
				send_email(r["email"], subject, message, event="Direct Message", user=r.get("user"))
				stats["Email"] += 1
			if "SMS" in channels and r.get("phone"):
				send_sms(r["phone"], sms_text, event="Direct Message", user=r.get("user"))
				stats["SMS"] += 1
			if "In-App" in channels and r.get("user"):
				push_portal_notification(r["user"], subject, plain[:500], category="Info")
				stats["In-App"] += 1
		except Exception:
			stats["failed"] += 1
			frappe.log_error(title="Mahanaim direct message failed")
	return stats


def deliver_direct_job(
	recipients: list[dict], subject: str, message: str, channels, sender: str | None = None
):
	"""Background entry point (large direct messages)."""
	stats = deliver_direct(recipients, subject, message, channels, sender)
	if sender:
		push_portal_notification(
			sender,
			_("Message sent: {0}").format(subject),
			_("Email {0} · SMS {1} · In-app {2} · Failed {3}").format(
				stats["Email"], stats["SMS"], stats["In-App"], stats["failed"]
			),
			category="System",
		)
	return stats
