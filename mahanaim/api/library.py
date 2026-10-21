"""Digital library endpoints (backend domain B4).

Public catalogue (guest-readable, filtered by access level), borrower self-service (students/staff) and the
Library Officer desk. Access levels: guests see Public items; students/alumni Public + Students; staff, lecturers and
library officers see all. Private digital files are served via a 10-minute, user-bound token
(`access_digital` → `download_digital?token=…`) because borrowers have no read permission on Library Item.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.rate_limiter import rate_limit
from frappe.utils import add_days, cint, flt, getdate, nowdate

from mahanaim.api.utils import clean_payload, page_args, parse_json, require_login, require_roles
from mahanaim.services import library as lib
from mahanaim.utils import ROLE_AUDITOR, ROLE_FINANCE, ROLE_LIBRARY, ROLE_REGISTRAR

LIBRARY_ROLES = (ROLE_LIBRARY,)
READ_ROLES = (ROLE_LIBRARY, ROLE_REGISTRAR, ROLE_AUDITOR, ROLE_FINANCE)
ITEM_FIELDS = (
	"title",
	"item_type",
	"authors",
	"subject",
	"isbn",
	"publisher",
	"publication_year",
	"edition",
	"call_number",
	"cover_image",
	"description",
	"access_level",
	"is_active",
	"digital_file",
	"external_url",
	"campus",
	"location",
	"total_copies",
)
CATALOGUE_FIELDS = [
	"name",
	"title",
	"item_type",
	"authors",
	"subject",
	"publisher",
	"publication_year",
	"edition",
	"cover_image",
	"description",
	"access_level",
	"digital_file",
	"external_url",
	"total_copies",
	"available_copies",
	"call_number",
	"campus",
	"location",
	"downloads",
	"loans_count",
]
LOAN_FIELDS = [
	"name",
	"library_item",
	"item_title",
	"borrower_type",
	"student",
	"staff_member",
	"borrower_name",
	"issue_date",
	"due_date",
	"return_date",
	"status",
	"fine_amount",
	"fine_paid",
	"remarks",
]


def _public_item(r: dict, levels) -> dict:
	"""Catalogue row without file URLs (those come only from access_digital)."""
	return {
		"name": r.name,
		"title": r.title,
		"item_type": r.item_type,
		"authors": r.authors,
		"subject": r.subject,
		"publisher": r.publisher,
		"publication_year": r.publication_year,
		"edition": r.edition,
		"cover_image": r.cover_image,
		"description": r.description,
		"access_level": r.access_level,
		"is_digital": lib.is_digital(r),
		"is_physical": cint(r.total_copies) > 0,
		"total_copies": cint(r.total_copies),
		"available_copies": cint(r.available_copies),
		"call_number": r.call_number,
		"location": r.location,
		"campus": r.campus,
		"downloads": cint(r.downloads),
		"can_access": (r.access_level or "Students") in levels,
	}


def _catalogue_filters(levels, search=None, extra=None):
	filters = {"is_active": 1, "access_level": ["in", list(levels)], **(extra or {})}
	or_filters = None
	if search and search.strip():
		like = f"%{search.strip()}%"
		or_filters = [
			[f, "like", like] for f in ("title", "authors", "isbn", "subject", "publisher", "call_number")
		]
	return filters, or_filters


# ---------------------------------------------------------------------------------- public catalogue
@frappe.whitelist(allow_guest=True)
def catalogue(
	search=None,
	subject=None,
	item_type=None,
	access=None,
	digital=None,
	available=None,
	start=0,
	page_length=24,
	sort="title",
):
	levels = lib.access_levels()
	if access:
		levels = tuple(level for level in levels if level == access) or ("__none__",)
	extra = {k: v for k, v in {"subject": subject, "item_type": item_type}.items() if v}
	if cint(available):
		extra["available_copies"] = [">", 0]
	filters, or_filters = _catalogue_filters(levels, search, extra)
	if digital not in (None, ""):
		if cint(digital):
			or_digital = [["digital_file", "is", "set"], ["external_url", "is", "set"]]
			if or_filters:  # both groups are ORs: fetch ids of digital items and AND them in
				ids = frappe.get_all("Library Item", filters=filters, or_filters=or_digital, pluck="name")
				filters["name"] = ["in", ids or ["__none__"]]
			else:
				or_filters = or_digital
		else:
			filters["digital_file"] = ["is", "not set"]
			filters["external_url"] = ["is", "not set"]
	order_by = {
		"title": "title asc",
		"newest": "creation desc",
		"popular": "downloads desc, loans_count desc",
		"year": "publication_year desc",
	}.get(sort, "title asc")
	args = page_args(start, page_length, 100)
	rows = frappe.get_all(
		"Library Item",
		filters=filters,
		or_filters=or_filters,
		fields=CATALOGUE_FIELDS,
		order_by=order_by,
		limit_start=args["start"],
		limit_page_length=args["page_length"],
	)
	total = frappe.get_all(
		"Library Item", filters=filters, or_filters=or_filters, fields=[{"COUNT": "*", "as": "n"}]
	)[0].n
	base_filters, base_or = _catalogue_filters(lib.access_levels(), search)
	facets = {}
	for field in ("subject", "item_type", "access_level"):
		facets[field] = [
			{"value": r.get(field), "count": cint(r.n)}
			for r in frappe.get_all(
				"Library Item",
				filters=base_filters,
				or_filters=base_or,
				fields=[field, {"COUNT": "*", "as": "n"}],
				group_by=field,
				order_by="n desc",
			)
			if r.get(field)
		]
	levels_all = lib.access_levels()
	return {
		"data": [_public_item(r, levels_all) for r in rows],
		"total": cint(total),
		"facets": facets,
		"access_levels": list(levels_all),
	}


def _get_visible_item(name: str):
	item = frappe.db.get_value("Library Item", name, [*CATALOGUE_FIELDS, "isbn", "is_active"], as_dict=True)
	if not item or (not item.is_active and lib.access_levels() != lib.ACCESS_LEVELS):
		frappe.throw(_("This item was not found."), frappe.DoesNotExistError)
	if not lib.can_access(item.access_level):
		if frappe.session.user == "Guest":
			frappe.throw(_("Please sign in to view this item."), frappe.AuthenticationError)
		frappe.throw(_("This item is reserved for {0}.").format(_(item.access_level)), frappe.PermissionError)
	return item


@frappe.whitelist(allow_guest=True)
def item(name: str):
	it = _get_visible_item(name)
	levels = lib.access_levels()
	out = _public_item(it, levels)
	out["isbn"] = it.isbn
	out["is_active"] = it.is_active
	borrower = lib.borrower_for_user()
	out["can_borrow"] = bool(borrower) and out["is_physical"] and bool(it.is_active)
	out["my_loan"] = None
	if borrower:
		field = "student" if borrower["borrower_type"] == "Student" else "staff_member"
		out["my_loan"] = frappe.db.get_value(
			"Library Loan",
			{"library_item": name, field: borrower[field], "status": ["in", lib.OPEN_STATUSES]},
			["name", "status", "issue_date", "due_date", "fine_amount"],
			as_dict=True,
		)
	out["related"] = (
		[
			_public_item(r, levels)
			for r in frappe.get_all(
				"Library Item",
				filters={
					"is_active": 1,
					"subject": it.subject,
					"name": ["!=", name],
					"access_level": ["in", list(levels)],
				},
				fields=CATALOGUE_FIELDS,
				order_by="downloads desc, loans_count desc",
				limit_page_length=4,
			)
		]
		if it.subject
		else []
	)
	return out


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=60, seconds=60 * 60)
def access_digital(name: str):
	"""Count a download/view and return where to get it.

	Public files (`/files/...`) and external links are returned as-is; private files (`/private/files/...`) get a
	10-minute token URL bound to the caller: `/api/method/mahanaim.api.library.download_digital?token=…`.
	"""
	it = _get_visible_item(name)
	if not lib.is_digital(it):
		frappe.throw(_("This item has no digital copy. Visit the library to borrow it."))
	lib.increment_downloads(name)
	if it.digital_file:
		if it.digital_file.startswith("/private/"):
			token = lib.make_download_token(name, it.digital_file)
			return {
				"kind": "file",
				"url": f"/api/method/mahanaim.api.library.download_digital?token={token}",
				"expires_in": lib.DOWNLOAD_TOKEN_TTL,
				"title": it.title,
			}
		return {"kind": "file", "url": it.digital_file, "expires_in": None, "title": it.title}
	return {"kind": "external", "url": it.external_url, "expires_in": None, "title": it.title}


@frappe.whitelist(allow_guest=True, methods=["GET"])
def download_digital(token: str):
	data = lib.resolve_download_token(token)
	if not data:
		frappe.throw(
			_("This download link has expired. Open the item again to get a new link."),
			frappe.PermissionError,
		)
	if data.get("user") != frappe.session.user:
		frappe.throw(_("This download link belongs to another user."), frappe.PermissionError)
	file_name = frappe.db.get_value("File", {"file_url": data["file_url"]}, "name")
	if not file_name:
		frappe.throw(_("The file is no longer available."), frappe.DoesNotExistError)
	file = frappe.get_doc("File", file_name)
	frappe.local.response.filename = file.file_name
	frappe.local.response.filecontent = file.get_content()
	frappe.local.response.type = "download"
	frappe.local.response.display_content_as = "inline"


# ---------------------------------------------------------------------------------- borrowers
def _require_borrower():
	require_login()
	borrower = lib.borrower_for_user()
	if not borrower:
		frappe.throw(_("Only students and staff can borrow library items."), frappe.PermissionError)
	return borrower


@frappe.whitelist()
def my_loans(include_history=1):
	require_login()
	borrower = lib.borrower_for_user()
	if not borrower:
		return {"active": [], "history": [], "fines_due": 0, "limit": lib.MAX_ACTIVE_LOANS}
	field = "student" if borrower["borrower_type"] == "Student" else "staff_member"
	rows = frappe.get_all(
		"Library Loan",
		filters={field: borrower[field]},
		fields=LOAN_FIELDS,
		order_by="creation desc",
		limit_page_length=200 if cint(include_history) else 50,
	)
	today = getdate(nowdate())
	active, history = [], []
	for r in rows:
		if r.status in lib.ACTIVE_STATUSES and not r.fine_paid:
			r.fine_amount = max(flt(r.fine_amount), lib.compute_fine(r.due_date))
		r.days_left = (
			(getdate(r.due_date) - today).days if r.due_date and r.status in lib.ACTIVE_STATUSES else None
		)
		(active if r.status in lib.OPEN_STATUSES else history).append(r)
	return {
		"active": active,
		"history": history if cint(include_history) else [],
		"fines_due": sum(flt(r.fine_amount) for r in rows if not r.fine_paid and r.status != "Cancelled"),
		"limit": lib.MAX_ACTIVE_LOANS,
		"borrower": {k: borrower.get(k) for k in ("borrower_type", "borrower_name")},
	}


@frappe.whitelist(methods=["POST"])
def request_loan(item: str, remarks: str | None = None):
	"""Reserve a physical copy: creates a Library Loan with status "Requested" for the librarian to issue."""
	borrower = _require_borrower()
	it = _get_visible_item(item)
	if not it.is_active or cint(it.total_copies) <= 0:
		frappe.throw(_("{0} cannot be borrowed.").format(it.title))
	field = "student" if borrower["borrower_type"] == "Student" else "staff_member"
	pending = frappe.db.count("Library Loan", {field: borrower[field], "status": "Requested"})
	if pending >= lib.MAX_ACTIVE_LOANS:
		frappe.throw(_("You already have {0} pending requests.").format(pending))
	loan = frappe.get_doc(
		{
			"doctype": "Library Loan",
			"library_item": item,
			"borrower_type": borrower["borrower_type"],
			field: borrower[field],
			"status": "Requested",
			"issue_date": nowdate(),
			"remarks": (remarks or "").strip()[:500] or None,
		}
	)
	loan.flags.ignore_permissions = True
	loan.insert()
	lib.notify_library_officers(
		_("Loan request: {0}").format(it.title),
		_("{0} asked to borrow {1}.").format(loan.borrower_name, it.title),
		link=f"/admin/library/loans?loan={loan.name}",
		doc=loan,
	)
	return {"name": loan.name, "status": loan.status, "available_copies": cint(it.available_copies)}


@frappe.whitelist(methods=["POST"])
def cancel_loan_request(loan: str):
	borrower = _require_borrower()
	doc = frappe.get_doc("Library Loan", loan)
	field = "student" if borrower["borrower_type"] == "Student" else "staff_member"
	if doc.get(field) != borrower[field]:
		frappe.throw(_("This is not your request."), frappe.PermissionError)
	if doc.status != "Requested":
		frappe.throw(_("Only pending requests can be cancelled."))
	doc.status = "Cancelled"
	doc.flags.ignore_permissions = True
	doc.save()
	return {"name": doc.name, "status": doc.status}


# ---------------------------------------------------------------------------------- library officer
@frappe.whitelist()
def library_dashboard():
	require_roles(*READ_ROLES)
	from frappe.query_builder.functions import Count, DateFormat

	from mahanaim.services.church import month_keys

	items = frappe.get_all(
		"Library Item",
		filters={"is_active": 1},
		fields=[
			{"COUNT": "*", "as": "n"},
			{"SUM": "total_copies", "as": "copies"},
			{"SUM": "available_copies", "as": "available"},
			{"SUM": "downloads", "as": "dl"},
		],
	)[0]
	digital = frappe.get_all(
		"Library Item",
		filters={"is_active": 1},
		or_filters=[["digital_file", "is", "set"], ["external_url", "is", "set"]],
		fields=[{"COUNT": "*", "as": "n"}],
	)[0].n
	loans = {
		r.status: cint(r.n)
		for r in frappe.get_all(
			"Library Loan", fields=["status", {"COUNT": "*", "as": "n"}], group_by="status"
		)
	}
	fines = frappe.get_all(
		"Library Loan",
		filters={"fine_paid": 0, "fine_amount": [">", 0], "status": ["!=", "Cancelled"]},
		fields=[{"SUM": "fine_amount", "as": "total"}],
	)[0].total
	months = month_keys(12)
	LL = frappe.qb.DocType("Library Loan")
	month = DateFormat(LL.issue_date, "%Y-%m")
	per_month = {
		r.month: cint(r.n)
		for r in frappe.qb.from_(LL)
		.select(month.as_("month"), Count(LL.name).as_("n"))
		.where(LL.status.isin(list(lib.CIRCULATED_STATUSES)) & (LL.issue_date >= f"{months[0]}-01"))
		.groupby(month)
		.run(as_dict=True)
	}
	top = [
		"name",
		"title",
		"item_type",
		"subject",
		"loans_count",
		"downloads",
		"available_copies",
		"total_copies",
	]
	return {
		"kpis": {
			"items": cint(items.n),
			"copies": cint(items.copies),
			"available_copies": cint(items.available),
			"digital_items": cint(digital),
			"downloads": cint(items.dl),
			"on_loan": loans.get("Issued", 0) + loans.get("Overdue", 0),
			"overdue": loans.get("Overdue", 0),
			"requests": loans.get("Requested", 0),
			"lost": loans.get("Lost", 0),
			"fines_outstanding": flt(fines),
		},
		"loans_by_status": loans,
		"by_subject": frappe.get_all(
			"Library Item",
			filters={"is_active": 1},
			fields=["subject", {"COUNT": "*", "as": "count"}],
			group_by="subject",
			order_by="count desc",
		),
		"by_type": frappe.get_all(
			"Library Item",
			filters={"is_active": 1},
			fields=["item_type", {"COUNT": "*", "as": "count"}],
			group_by="item_type",
			order_by="count desc",
		),
		"top_borrowed": frappe.get_all(
			"Library Item",
			filters={"loans_count": [">", 0]},
			fields=top,
			order_by="loans_count desc",
			limit_page_length=5,
		),
		"top_downloaded": frappe.get_all(
			"Library Item",
			filters={"downloads": [">", 0]},
			fields=top,
			order_by="downloads desc",
			limit_page_length=5,
		),
		"requests": frappe.get_all(
			"Library Loan",
			filters={"status": "Requested"},
			fields=LOAN_FIELDS,
			order_by="creation asc",
			limit_page_length=10,
		),
		"overdue": frappe.get_all(
			"Library Loan",
			filters={"status": "Overdue"},
			fields=LOAN_FIELDS,
			order_by="due_date asc",
			limit_page_length=10,
		),
		"recent": frappe.get_all(
			"Library Loan",
			filters={"status": ["in", list(lib.CIRCULATED_STATUSES)]},
			fields=LOAN_FIELDS,
			order_by="modified desc",
			limit_page_length=10,
		),
		"loans_per_month": [{"month": m, "loans": per_month.get(m, 0)} for m in months],
		"settings": {
			"fine_per_day": lib.fine_per_day(),
			"loan_days": lib.loan_days(),
			"max_active_loans": lib.MAX_ACTIVE_LOANS,
		},
	}


@frappe.whitelist()
def list_loans(
	status=None, search=None, borrower_type=None, library_item=None, student=None, start=0, page_length=20
):
	require_roles(*READ_ROLES)
	filters = {
		k: v
		for k, v in {"borrower_type": borrower_type, "library_item": library_item, "student": student}.items()
		if v
	}
	if status:
		statuses = parse_json(status, status) if str(status).startswith("[") else status
		filters["status"] = ["in", statuses] if isinstance(statuses, list) else statuses
	or_filters = None
	if search and search.strip():
		like = f"%{search.strip()}%"
		or_filters = [
			[f, "like", like] for f in ("item_title", "borrower_name", "name", "student", "staff_member")
		]
	args = page_args(start, page_length)
	data = frappe.get_list(
		"Library Loan",
		filters=filters,
		or_filters=or_filters,
		fields=LOAN_FIELDS,
		order_by="modified desc",
		limit_start=args["start"],
		limit_page_length=args["page_length"],
	)
	total = frappe.get_list(
		"Library Loan", filters=filters, or_filters=or_filters, fields=[{"COUNT": "*", "as": "n"}]
	)[0].n
	for r in data:
		if r.status in lib.ACTIVE_STATUSES and not r.fine_paid:
			r.fine_amount = max(flt(r.fine_amount), lib.compute_fine(r.due_date))
	return {"data": data, "total": cint(total)}


@frappe.whitelist()
def list_items(
	search=None, subject=None, item_type=None, access_level=None, is_active=None, start=0, page_length=20
):
	require_roles(*READ_ROLES)
	filters = {
		k: v
		for k, v in {"subject": subject, "item_type": item_type, "access_level": access_level}.items()
		if v
	}
	if is_active not in (None, ""):
		filters["is_active"] = cint(is_active)
	or_filters = None
	if search and search.strip():
		like = f"%{search.strip()}%"
		or_filters = [[f, "like", like] for f in ("title", "authors", "isbn", "call_number", "name")]
	args = page_args(start, page_length)
	data = frappe.get_list(
		"Library Item",
		filters=filters,
		or_filters=or_filters,
		fields=[*CATALOGUE_FIELDS, "isbn", "is_active", "modified"],
		order_by="title asc",
		limit_start=args["start"],
		limit_page_length=args["page_length"],
	)
	total = frappe.get_list(
		"Library Item", filters=filters, or_filters=or_filters, fields=[{"COUNT": "*", "as": "n"}]
	)[0].n
	return {"data": data, "total": cint(total)}


@frappe.whitelist()
def get_item(name: str):
	require_roles(*READ_ROLES)
	doc = frappe.get_doc("Library Item", name)
	doc.check_permission("read")
	out = doc.as_dict()
	out["loans"] = frappe.get_all(
		"Library Loan",
		filters={"library_item": name},
		fields=LOAN_FIELDS,
		order_by="creation desc",
		limit_page_length=50,
	)
	return out


@frappe.whitelist(methods=["POST"])
def save_item(data):
	require_roles(*LIBRARY_ROLES)
	data = parse_json(data, {}) or {}
	values = clean_payload(data, ITEM_FIELDS)
	if data.get("name"):
		doc = frappe.get_doc("Library Item", data["name"])
		doc.check_permission("write")
	else:
		doc = frappe.new_doc("Library Item")
		doc.check_permission("create")
	doc.update(values)
	doc.save()
	return doc.as_dict()


def _loan_for_desk(loan: str):
	require_roles(*LIBRARY_ROLES)
	doc = frappe.get_doc("Library Loan", loan)
	doc.check_permission("write")
	return doc


@frappe.whitelist(methods=["POST"])
def issue_loan(
	item: str | None = None,
	student: str | None = None,
	staff_member: str | None = None,
	due_date: str | None = None,
	loan: str | None = None,
	remarks: str | None = None,
):
	"""Issue a copy — either fulfil a pending request (`loan`) or lend directly to a student/staff member."""
	require_roles(*LIBRARY_ROLES)
	if loan:
		doc = _loan_for_desk(loan)
		if doc.status != "Requested":
			frappe.throw(_("Only requested loans can be issued."))
		doc.status = "Issued"
	else:
		if not item or not (student or staff_member):
			frappe.throw(_("Choose the item and the borrower."))
		doc = frappe.new_doc("Library Loan")
		doc.check_permission("create")
		doc.update(
			{
				"library_item": item,
				"borrower_type": "Student" if student else "Staff",
				"student": student,
				"staff_member": None if student else staff_member,
				"status": "Issued",
				"issue_date": nowdate(),
			}
		)
	if due_date:
		if getdate(due_date) < getdate(nowdate()):
			frappe.throw(_("The due date cannot be in the past."))
		doc.due_date = due_date
	if remarks:
		doc.remarks = remarks
	doc.save()
	return doc.as_dict()


@frappe.whitelist(methods=["POST"])
def return_loan(loan: str, condition_notes: str | None = None, fine_paid=0, return_date=None):
	doc = _loan_for_desk(loan)
	if doc.status not in ("Issued", "Overdue", "Lost"):
		frappe.throw(_("This loan is not out on loan."))
	doc.status = "Returned"
	doc.return_date = return_date or nowdate()
	if condition_notes:
		note = _("Returned {0}: {1}").format(doc.return_date, condition_notes.strip())
		doc.remarks = f"{doc.remarks}\n{note}" if doc.remarks else note
	doc.save()
	if cint(fine_paid) and flt(doc.fine_amount) > 0:
		doc.db_set("fine_paid", 1)
	return doc.as_dict()


@frappe.whitelist(methods=["POST"])
def renew_loan(loan: str, due_date: str | None = None):
	doc = _loan_for_desk(loan)
	if doc.status not in ("Issued", "Overdue"):
		frappe.throw(_("Only items on loan can be renewed."))
	new_due = (
		getdate(due_date)
		if due_date
		else add_days(max(getdate(doc.due_date), getdate(nowdate())), lib.loan_days())
	)
	if new_due <= getdate(nowdate()):
		frappe.throw(_("The new due date must be in the future."))
	doc.due_date = new_due
	doc.status = "Issued"
	doc.save()
	return doc.as_dict()


@frappe.whitelist(methods=["POST"])
def mark_lost(loan: str, notes: str | None = None, replacement_fee=None):
	doc = _loan_for_desk(loan)
	if doc.status not in ("Issued", "Overdue"):
		frappe.throw(_("Only items on loan can be marked lost."))
	doc.status = "Lost"
	if flt(replacement_fee) > 0:
		doc.fine_amount = flt(doc.fine_amount) + flt(replacement_fee)
	if notes:
		note = _("Lost {0}: {1}").format(nowdate(), notes.strip())
		doc.remarks = f"{doc.remarks}\n{note}" if doc.remarks else note
	doc.save()
	return doc.as_dict()


@frappe.whitelist(methods=["POST"])
def record_fine_payment(loan: str):
	doc = _loan_for_desk(loan)
	if flt(doc.fine_amount) <= 0:
		frappe.throw(_("There is no fine on this loan."))
	if doc.status in lib.ACTIVE_STATUSES:
		doc.fine_amount = max(flt(doc.fine_amount), lib.compute_fine(doc.due_date))
	doc.fine_paid = 1
	doc.save()
	return doc.as_dict()


@frappe.whitelist(methods=["POST"])
def reject_loan_request(loan: str, reason: str | None = None):
	doc = _loan_for_desk(loan)
	if doc.status != "Requested":
		frappe.throw(_("Only pending requests can be rejected."))
	doc.status = "Cancelled"
	if reason:
		doc.remarks = f"{doc.remarks}\n{reason}" if doc.remarks else reason
	doc.save()
	recipient = lib.loan_recipient(doc)
	if recipient and recipient.get("user"):
		from mahanaim.services.communication import push_portal_notification

		push_portal_notification(
			recipient["user"],
			_("Library request declined"),
			_("Your request for {0} was declined. {1}").format(doc.item_title, reason or ""),
			link="/student/library",
			category="Library",
			doc=doc,
		)
	return doc.as_dict()


@frappe.whitelist()
def borrower_lookup(q: str):
	"""Students and staff matching `q` for the issue desk (5 each)."""
	require_roles(*LIBRARY_ROLES)
	if not q or len(q.strip()) < 2:
		return []
	like = f"%{q.strip()}%"
	students = frappe.get_all(
		"Student",
		or_filters=[["full_name", "like", like], ["student_number", "like", like], ["name", "like", like]],
		fields=["name", "full_name", "student_number", "status"],
		limit_page_length=5,
	)
	staff = frappe.get_all(
		"Staff Member",
		or_filters=[["full_name", "like", like], ["name", "like", like], ["email", "like", like]],
		fields=["name", "full_name", "designation", "status"],
		limit_page_length=5,
	)
	return [
		{
			"borrower_type": "Student",
			"value": s.name,
			"label": s.full_name,
			"description": f"{s.student_number or ''} · {s.status}",
		}
		for s in students
	] + [
		{
			"borrower_type": "Staff",
			"value": m.name,
			"label": m.full_name,
			"description": m.designation or m.status,
		}
		for m in staff
	]
