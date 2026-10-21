"""Alumni endpoints (backend domain B4, optional module M19).

* Directory: any signed-in user; only alumni who opted in (`alumni_consent = 1`); public-safe fields only.
* Self-service: users with an Alumni (or graduated Student) record edit ministry details and consent.
* Staff (Registrar / Academic Dean): graduate Completed students → Alumni, statistics.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cint, getdate, nowdate

from mahanaim.api.utils import clean_payload, page_args, parse_json, require_login, require_roles
from mahanaim.utils import ROLE_ALUMNI, ROLE_DEAN, ROLE_REGISTRAR, normalize_phone

STAFF_ROLES = (ROLE_REGISTRAR, ROLE_DEAN)
DIRECTORY_FIELDS = [
	"name",
	"full_name",
	"photo",
	"programme",
	"programme_name",
	"campus",
	"graduation_date",
	"current_ministry",
	"current_position",
	"county",
	"home_church",
]
PROFILE_FIELDS = [
	*DIRECTORY_FIELDS,
	"student_number",
	"email",
	"phone",
	"alumni_consent",
	"status",
	"completion_date",
	"partner_church",
]
EDITABLE = ("current_ministry", "current_position", "phone", "alumni_consent")


def _campus_names(names) -> dict:
	names = [n for n in set(names) if n]
	return (
		dict(
			frappe.get_all(
				"Campus", filters={"name": ["in", names]}, fields=["name", "campus_name"], as_list=True
			)
		)
		if names
		else {}
	)


@frappe.whitelist()
def alumni_directory(search=None, programme=None, year=None, campus=None, start=0, page_length=24):
	require_login()
	filters = {"status": "Alumni", "alumni_consent": 1}
	if programme:
		filters["programme"] = programme
	if campus:
		filters["campus"] = campus
	if year and cint(year):
		filters["graduation_date"] = ["between", [f"{cint(year)}-01-01", f"{cint(year)}-12-31"]]
	or_filters = None
	if search and search.strip():
		like = f"%{search.strip()}%"
		or_filters = [
			[f, "like", like] for f in ("full_name", "current_ministry", "current_position", "county")
		]
	args = page_args(start, page_length, 100)
	rows = frappe.get_all(
		"Student",
		filters=filters,
		or_filters=or_filters,
		fields=DIRECTORY_FIELDS,
		order_by="graduation_date desc, full_name asc",
		limit_start=args["start"],
		limit_page_length=args["page_length"],
	)
	total = frappe.get_all(
		"Student", filters=filters, or_filters=or_filters, fields=[{"COUNT": "*", "as": "n"}]
	)[0].n
	campuses = _campus_names(r.campus for r in rows)
	for r in rows:
		r["campus_name"] = campuses.get(r.campus, r.campus)
		r["graduation_year"] = getdate(r.graduation_date).year if r.graduation_date else None
	years = frappe.get_all(
		"Student",
		filters={"status": "Alumni", "alumni_consent": 1, "graduation_date": ["is", "set"]},
		pluck="graduation_date",
		distinct=True,
	)
	return {
		"data": rows,
		"total": cint(total),
		"facets": {
			"years": sorted({getdate(d).year for d in years}, reverse=True),
			"programmes": frappe.get_all(
				"Student",
				filters={"status": "Alumni", "alumni_consent": 1},
				fields=["programme", "programme_name", {"COUNT": "*", "as": "count"}],
				group_by="programme, programme_name",
				order_by="count desc",
			),
		},
	}


def _my_alumni_record() -> str:
	user = require_login()
	name = frappe.db.get_value("Student", {"user": user, "status": ["in", ["Alumni", "Completed"]]}, "name")
	if not name:
		frappe.throw(_("No alumni record is linked to your account."), frappe.PermissionError)
	return name


@frappe.whitelist()
def my_alumni_profile():
	name = _my_alumni_record()
	row = frappe.get_all("Student", filters={"name": name}, fields=PROFILE_FIELDS)[0]
	row["campus_name"] = _campus_names([row.campus]).get(row.campus, row.campus)
	row["is_alumni"] = row.status == "Alumni"
	return row


@frappe.whitelist(methods=["POST"])
def update_my_alumni_profile(data):
	name = _my_alumni_record()
	values = clean_payload(data, EDITABLE)
	if not values:
		frappe.throw(_("Nothing to update."))
	for field in ("current_ministry", "current_position"):
		if field in values:
			values[field] = (values[field] or "").strip()[:140] or None
	if "phone" in values:
		values["phone"] = normalize_phone(values["phone"])
		if not values["phone"]:
			frappe.throw(_("Enter a valid phone number."))
	if "alumni_consent" in values:
		values["alumni_consent"] = 1 if cint(values["alumni_consent"]) else 0
	# Alumni have no write permission on Student; the whitelist above limits what can change.
	doc = frappe.get_doc("Student", name)
	doc.update(values)
	doc.flags.ignore_permissions = True
	doc.save()
	return my_alumni_profile()


@frappe.whitelist(methods=["POST"])
def graduate_students(students, graduation_date=None):
	"""Move Completed students to Alumni (B1's Student controller validates the transition) and grant the role."""
	require_roles(*STAFF_ROLES)
	students = parse_json(students, students)
	if isinstance(students, str):
		students = [s.strip() for s in students.split(",") if s.strip()]
	if not students:
		frappe.throw(_("Choose at least one student."))
	graduation_date = getdate(graduation_date or nowdate())
	if graduation_date > getdate(nowdate()):
		frappe.throw(_("The graduation date cannot be in the future."))
	done, failed = [], []
	for name in students:
		try:
			doc = frappe.get_doc("Student", name)
			if doc.status != "Completed":
				raise frappe.ValidationError(
					_("{0} is {1}, not Completed.").format(doc.full_name, _(doc.status))
				)
			doc.status = "Alumni"
			doc.graduation_date = graduation_date
			doc.flags.ignore_permissions = True
			doc.flags.status_note = _("Graduated on {0}").format(graduation_date)
			doc.save()
			_grant_alumni_role(doc)
			done.append(name)
		except Exception as e:
			frappe.clear_last_message()
			failed.append({"student": name, "error": str(e) or e.__class__.__name__})
	return {"graduated": done, "failed": failed, "count": len(done)}


def _grant_alumni_role(doc):
	if not doc.user:
		return
	try:
		from mahanaim.services.students import mark_alumni

		mark_alumni(doc)
	except (ImportError, AttributeError):
		user = frappe.get_doc("User", doc.user)
		if ROLE_ALUMNI not in {r.role for r in user.roles}:
			user.flags.ignore_permissions = True
			user.add_roles(ROLE_ALUMNI)


@frappe.whitelist()
def graduation_candidates(programme=None, campus=None):
	require_roles(*STAFF_ROLES)
	filters = {"status": "Completed"}
	if programme:
		filters["programme"] = programme
	if campus:
		filters["campus"] = campus
	return frappe.get_all(
		"Student",
		filters=filters,
		fields=[
			"name",
			"full_name",
			"student_number",
			"programme",
			"campus",
			"completion_date",
			"cgpa",
			"credits_earned",
		],
		order_by="programme asc, full_name asc",
	)


@frappe.whitelist()
def alumni_stats():
	require_roles(*STAFF_ROLES)
	from frappe.query_builder.functions import Count, Extract

	S = frappe.qb.DocType("Student")
	year = Extract("year", S.graduation_date)
	by_year = (
		frappe.qb.from_(S)
		.select(year.as_("year"), Count(S.name).as_("count"))
		.where((S.status == "Alumni") & S.graduation_date.isnotnull())
		.groupby(year)
		.orderby(year)
		.run(as_dict=True)
	)
	total = frappe.db.count("Student", {"status": "Alumni"})
	consent = frappe.db.count("Student", {"status": "Alumni", "alumni_consent": 1})
	in_ministry = frappe.db.count("Student", {"status": "Alumni", "current_ministry": ["is", "set"]})
	return {
		"total": total,
		"with_consent": consent,
		"consent_pct": round(consent * 100.0 / total, 1) if total else 0,
		"in_ministry": in_ministry,
		"in_ministry_pct": round(in_ministry * 100.0 / total, 1) if total else 0,
		"awaiting_graduation": frappe.db.count("Student", {"status": "Completed"}),
		"by_year": [{"year": cint(r.year), "count": cint(r.count)} for r in by_year],
		"by_programme": frappe.get_all(
			"Student",
			filters={"status": "Alumni"},
			fields=["programme", "programme_name", {"COUNT": "*", "as": "count"}],
			group_by="programme, programme_name",
			order_by="count desc",
		),
		"by_campus": frappe.get_all(
			"Student",
			filters={"status": "Alumni"},
			fields=["campus", {"COUNT": "*", "as": "count"}],
			group_by="campus",
			order_by="count desc",
		),
	}
