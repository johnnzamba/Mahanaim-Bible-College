"""Online admissions endpoints (M05). See docs/api/admissions.md.

Applicant endpoints resolve ownership from the session (`Programme Application.user == session.user`).
Staff endpoints are for Admissions Officers, Registrars and Academic Deans (plus admins); reads honour campus
User Permissions via frappe.get_list / has_permission.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import add_days, cint, flt, get_datetime, getdate, now_datetime, today

from mahanaim.api.utils import (
	clean_payload,
	page_args,
	parse_json,
	require_applicant,
	require_roles,
	search_filters,
)
from mahanaim.services import admissions as svc
from mahanaim.services.students import local_file_url
from mahanaim.utils import (
	ROLE_ADMISSIONS,
	ROLE_DEAN,
	ROLE_FINANCE,
	ROLE_REGISTRAR,
	is_staff,
	log_status,
	setting,
)

STAFF = (ROLE_ADMISSIONS, ROLE_REGISTRAR, ROLE_DEAN)
DOCTYPE = "Programme Application"
EDITABLE_DOC_STATUSES = ("Draft", "Submitted", "Under Review", "Interview")
LIST_FIELDS = [
	"name",
	"full_name",
	"email",
	"phone",
	"programme",
	"programme_name",
	"campus",
	"study_mode",
	"intake",
	"status",
	"fee_status",
	"application_fee",
	"submitted_on",
	"decision_date",
	"offer_expiry",
	"student",
	"sponsorship_type",
	"creation",
	"modified",
]
INTERNAL_FIELDS = ("reviewer", "review_notes")


# ---------------------------------------------------------------------------------- serialisers
def _as_dict(doc, staff: bool = False) -> dict:
	data = doc.as_dict(no_default_fields=True, convert_dates_to_str=True)
	for key in ("doctype", "docstatus", "idx", "_user_tags", "_comments", "_assign", "_liked_by"):
		data.pop(key, None)
	data["name"] = doc.name
	data["creation"] = str(doc.creation) if doc.creation else None
	data["modified"] = str(doc.modified) if doc.modified else None
	child = lambda rows, fields: [{f: r.get(f) for f in ("name", *fields)} for r in rows or []]  # noqa: E731
	data["academic_records"] = child(
		doc.academic_records, ("institution", "qualification", "year_completed", "grade")
	)
	data["documents"] = child(doc.documents, ("document_type", "file", "verified", "remarks"))
	if staff:
		data["status_log"] = child(doc.status_log, ("timestamp", "from_status", "to_status", "note", "user"))
	else:
		for key in INTERNAL_FIELDS:
			data.pop(key, None)
		data["status_log"] = child(doc.status_log, ("timestamp", "from_status", "to_status"))
	data["awaiting_fee"] = svc.awaiting_fee(doc)
	data["next_action"] = svc.next_action(doc)
	data["missing"] = svc.missing_for_submission(doc) if doc.status == "Draft" else []
	data["can_edit"] = doc.status == "Draft"
	data["can_withdraw"] = (
		doc.status in svc.APPLICATION_TRANSITIONS and "Withdrawn" in svc.APPLICATION_TRANSITIONS[doc.status]
	)
	data["letter_available"] = doc.status in ("Admitted", "Accepted")
	data["student_number"] = (
		frappe.db.get_value("Student", doc.student, "student_number") if doc.student else None
	)
	return data


def _row_dict(row) -> dict:
	row = dict(row)
	row["awaiting_fee"] = svc.awaiting_fee(row)
	for key in ("submitted_on", "decision_date", "offer_expiry", "creation", "modified"):
		if row.get(key):
			row[key] = str(row[key])
	return row


# ---------------------------------------------------------------------------------- ownership
def _my_application(name: str, for_update: bool = False):
	user = require_applicant()
	owner = frappe.db.get_value(DOCTYPE, name, "user")
	if not owner or owner != user:
		frappe.throw(_("Application not found."), frappe.PermissionError)
	doc = frappe.get_doc(DOCTYPE, name)
	if for_update:
		doc.flags.ignore_permissions = True
	return doc


def _staff_application(name: str, roles=STAFF):
	require_roles(*roles)
	if not frappe.db.exists(DOCTYPE, name):
		frappe.throw(_("Application {0} not found.").format(name), frappe.DoesNotExistError)
	doc = frappe.get_doc(DOCTYPE, name)
	frappe.has_permission(DOCTYPE, "read", doc, throw=True)
	doc.flags.ignore_permissions = True
	return doc


def _validate_file(file_url: str, user: str, application: str | None = None, label: str | None = None) -> str:
	"""`file_url` must be a site file path whose File is attached to this application or uploaded by `user`."""
	file_url = local_file_url(file_url, label)
	if not file_url:
		frappe.throw(_("Upload the file first."))
	rows = frappe.get_all(
		"File",
		filters={"file_url": file_url},
		fields=["name", "owner", "attached_to_doctype", "attached_to_name"],
		order_by="creation desc",
	)
	if not rows:
		frappe.throw(_("The uploaded file was not found. Please upload it again."))
	for f in rows:
		if application and f.attached_to_doctype == DOCTYPE and f.attached_to_name == application:
			return f.name
	own = [f for f in rows if f.owner == user]
	if own:
		return next((f.name for f in own if not f.attached_to_name), own[0].name)
	frappe.throw(_("You can only attach files you uploaded."), frappe.PermissionError)


def _attach_fields() -> tuple[str, ...]:
	"""Applicant-settable Attach / Attach Image fields of the application."""
	meta = frappe.get_meta(DOCTYPE)
	return tuple(
		f
		for f in svc.APPLICANT_FIELDS
		if (df := meta.get_field(f)) and df.fieldtype in ("Attach", "Attach Image")
	)


def _check_attach_values(values: dict, user: str, doc=None):
	"""Validate (in place) every attach value in `values`; unchanged values skip the ownership check."""
	meta = frappe.get_meta(DOCTYPE)
	existing = doc if doc is not None and not doc.is_new() else None
	for field in _attach_fields():
		if field not in values:
			continue
		label = _(meta.get_label(field))
		value = local_file_url(values[field], label)
		if value and not (existing and value == existing.get(field)):
			_validate_file(value, user, existing.name if existing else None, label)
		values[field] = value


def _attach_files(doc):
	"""Link the applicant's uploads to the application so private-file access follows the application."""
	pairs = [(row.file, "documents") for row in doc.documents or [] if row.file]
	pairs += [(doc.get(f), f) for f in _attach_fields() if doc.get(f)]
	for file_url, field in pairs:
		if frappe.db.exists(
			"File", {"file_url": file_url, "attached_to_doctype": DOCTYPE, "attached_to_name": doc.name}
		):
			continue
		name = frappe.db.get_value(
			"File", {"file_url": file_url, "owner": doc.user, "attached_to_name": ["is", "not set"]}, "name"
		)
		if name:
			frappe.db.set_value(
				"File",
				name,
				{
					"attached_to_doctype": DOCTYPE,
					"attached_to_name": doc.name,
					"attached_to_field": field,
				},
			)


def _document_types() -> list[str]:
	options = frappe.get_meta("Application Document").get_field("document_type").options or ""
	return [o for o in options.split("\n") if o]


# ---------------------------------------------------------------------------------- public
@frappe.whitelist(allow_guest=True)
def application_options():
	"""Everything the apply form needs: programmes (with campuses/modes/fees), intakes, required items."""
	programmes = frappe.get_all(
		"Programme",
		filters={"status": "Active", "is_published": 1},
		fields=[
			"name",
			"code",
			"programme_name",
			"level",
			"duration_years",
			"application_fee",
			"minimum_entry",
		],
		order_by="programme_name asc",
	)
	names = [p.name for p in programmes] or [""]
	campuses_by = {}
	for r in frappe.get_all(
		"Programme Campus",
		filters={"parent": ["in", names], "parenttype": "Programme"},
		fields=["parent", "campus"],
	):
		campuses_by.setdefault(r.parent, []).append(r.campus)
	modes_by = {}
	for r in frappe.get_all(
		"Programme Study Mode",
		filters={"parent": ["in", names], "parenttype": "Programme"},
		fields=["parent", "study_mode"],
	):
		modes_by.setdefault(r.parent, []).append(r.study_mode)
	default_fee = flt(setting("application_fee", 0)) if svc.fee_required() else 0
	for p in programmes:
		p["campuses"] = campuses_by.get(p.name, [])
		p["study_modes"] = modes_by.get(p.name, [])
		p["application_fee"] = (flt(p.application_fee) or default_fee) if svc.fee_required() else 0
	intakes = frappe.get_all(
		"Intake",
		filters={"applications_open": 1},
		fields=[
			"name",
			"intake_name",
			"academic_year",
			"start_date",
			"application_open_date",
			"application_close_date",
		],
		order_by="start_date asc",
	)
	day = getdate(today())
	intakes = [
		i
		for i in intakes
		if (not i.application_open_date or getdate(i.application_open_date) <= day)
		and (not i.application_close_date or getdate(i.application_close_date) >= day)
	]
	return {
		"programmes": programmes,
		"intakes": intakes,
		"campuses": frappe.get_all(
			"Campus",
			filters={"is_active": 1},
			fields=["name", "campus_name", "code", "town"],
			order_by="is_main_campus desc, campus_name asc",
		),
		"study_modes": frappe.get_all(
			"Study Mode", filters={"is_active": 1}, fields=["name", "study_mode_name", "code", "is_online"]
		),
		"document_types": _document_types(),
		"required_documents": [list(o) for o in svc.REQUIRED_DOCUMENTS],
		"required_fields": list(svc.REQUIRED_ON_SUBMIT),
		"application_fee_required": svc.fee_required(),
		"default_application_fee": default_fee,
		"currency": setting("currency", "KES"),
	}


# ---------------------------------------------------------------------------------- applicant
@frappe.whitelist()
def my_applications():
	user = require_applicant()
	rows = frappe.get_all(DOCTYPE, filters={"user": user}, fields=LIST_FIELDS, order_by="creation desc")
	data = []
	for r in rows:
		d = _row_dict(r)
		d["next_action"] = svc.next_action(r)
		data.append(d)
	return {"data": data, "total": len(data)}


@frappe.whitelist()
def get_my_application(name: str):
	return _as_dict(_my_application(name))


@frappe.whitelist(methods=["POST"])
def save_application(data, name: str | None = None):
	"""Create or update a Draft application. `data` may include academic_records and documents rows."""
	user = require_applicant()
	payload = parse_json(data, {}) or {}
	values = clean_payload(payload, svc.APPLICANT_FIELDS)
	if name:
		doc = _my_application(name, for_update=True)
		if doc.status != "Draft":
			frappe.throw(_("A submitted application can no longer be edited."))
		_check_attach_values(values, user, doc)
		doc.update(values)
	else:
		_check_attach_values(values, user)
		u = frappe.db.get_value("User", user, ["email", "first_name", "last_name", "mobile_no"], as_dict=True)
		values.setdefault("email", u.email)
		values.setdefault("first_name", u.first_name)
		values.setdefault("last_name", u.last_name)
		values.setdefault("phone", u.mobile_no)
		doc = frappe.get_doc({"doctype": DOCTYPE, **values, "user": user, "status": "Draft"})
		doc.flags.ignore_permissions = True
	if "academic_records" in payload:
		doc.set("academic_records", [])
		for row in payload.get("academic_records") or []:
			doc.append(
				"academic_records",
				clean_payload(row, ("institution", "qualification", "year_completed", "grade")),
			)
	if "documents" in payload:
		keep = {r.name: r for r in doc.documents}
		doc.set("documents", [])
		for row in payload.get("documents") or []:
			row = parse_json(row, {}) or {}
			old = keep.get(row.get("name"))
			if old and old.file == row.get("file"):
				doc.append(
					"documents",
					{
						"document_type": row.get("document_type") or old.document_type,
						"file": old.file,
						"verified": old.verified,
						"remarks": old.remarks,
					},
				)
				continue
			label = _("The {0} document").format(_(row.get("document_type") or ""))
			file_url = local_file_url(row.get("file"), label)
			_validate_file(file_url, user, doc.name if not doc.is_new() else None, label)
			doc.append("documents", {"document_type": row.get("document_type"), "file": file_url})
	doc.save() if not doc.is_new() else doc.insert()
	_attach_files(doc)
	return _as_dict(doc)


@frappe.whitelist(methods=["POST"])
def upload_application_document(name: str, document_type: str, file_url: str):
	"""Attach a file uploaded via /api/method/upload_file (is_private=1) to the application."""
	user = require_applicant()
	doc = _my_application(name, for_update=True)
	if doc.status not in EDITABLE_DOC_STATUSES:
		frappe.throw(_("Documents can no longer be added to this application."))
	if document_type not in _document_types():
		frappe.throw(_("Unknown document type {0}.").format(document_type))
	label = _("The {0} document").format(_(document_type))
	file_url = local_file_url(file_url, label)
	_validate_file(file_url, user, doc.name, label)
	row = None
	if document_type not in ("Other", "Recommendation Letter", "Academic Certificate"):
		row = next((r for r in doc.documents if r.document_type == document_type), None)
	if row and cint(row.verified):
		frappe.throw(_("This document has already been verified and cannot be replaced."))
	if row:
		row.file, row.remarks = file_url, None
	else:
		doc.append("documents", {"document_type": document_type, "file": file_url})
	doc.save()
	_attach_files(doc)
	return _as_dict(doc)


@frappe.whitelist(methods=["POST"])
def remove_application_document(name: str, row: str):
	doc = _my_application(name, for_update=True)
	if doc.status != "Draft":
		frappe.throw(_("Documents can only be removed while the application is a draft."))
	target = next((r for r in doc.documents if r.name == row), None)
	if not target:
		frappe.throw(_("Document not found."))
	doc.remove(target)
	doc.save()
	return _as_dict(doc)


@frappe.whitelist(methods=["POST"])
def submit_application(name: str, declaration_accepted=1):
	"""Submit a Draft. If the fee is unpaid it is Submitted with `awaiting_fee: true` (next_action "pay_fee")."""
	doc = _my_application(name, for_update=True)
	if doc.status != "Draft":
		frappe.throw(_("This application has already been submitted."))
	if not cint(declaration_accepted):
		frappe.throw(_("Please confirm the declaration before submitting."))
	doc.declaration_accepted = 1
	doc.status = "Submitted"
	doc.save()
	return _as_dict(doc)


@frappe.whitelist(methods=["POST"])
def pay_application_fee(name: str, phone: str | None = None):
	"""Start an M-Pesa STK push for the application fee."""
	doc = _my_application(name, for_update=True)
	if doc.status not in ("Draft", "Submitted"):
		frappe.throw(_("The application fee can no longer be paid for this application."))
	if doc.fee_status in svc.FEE_SETTLED:
		frappe.throw(_("The application fee is already {0}.").format(_(doc.fee_status).lower()))
	if flt(doc.application_fee) <= 0:
		frappe.throw(_("No application fee is due."))
	from mahanaim.services import mpesa

	try:
		result = mpesa.initiate_payment(
			phone or doc.phone,
			doc.application_fee,
			"Application Fee",
			application=doc.name,
			initiated_by=frappe.session.user,
		)
	except NotImplementedError:
		frappe.throw(_("Online payment is not available yet. Please pay at the college office."))
	if doc.fee_status == "Unpaid":
		doc.db_set("fee_status", "Pending", update_modified=False)
	return {"ok": True, **(result or {}), "application": doc.name, "fee_status": doc.fee_status}


def _applicant_transition(name: str, status: str, note: str | None = None, **values):
	doc = _my_application(name, for_update=True)
	allowed = svc.APPLICATION_TRANSITIONS.get(doc.status, ())
	if status not in allowed:
		frappe.throw(
			_("You cannot change this application from {0} to {1}.").format(_(doc.status), _(status))
		)
	doc.update(values)
	doc.status = status
	doc.flags.status_note = note
	doc.save()
	return _as_dict(doc)


@frappe.whitelist(methods=["POST"])
def accept_offer(name: str):
	return _applicant_transition(name, "Accepted", _("Offer accepted by the applicant"))


@frappe.whitelist(methods=["POST"])
def decline_offer(name: str, reason: str | None = None):
	return _applicant_transition(name, "Declined", reason or _("Offer declined by the applicant"))


@frappe.whitelist(methods=["POST"])
def withdraw_application(name: str, reason: str | None = None):
	return _applicant_transition(name, "Withdrawn", reason or _("Withdrawn by the applicant"))


@frappe.whitelist()
def admission_letter(name: str, format: str = "html"):
	"""Admission letter for an Admitted/Accepted application. format=pdf streams a download."""
	user = frappe.session.user
	if user != "Guest" and is_staff(user):
		_staff_application(name, roles=(*STAFF, ROLE_FINANCE))
	else:
		_my_application(name)
	fmt = "pdf" if (format or "").lower() == "pdf" else "html"
	output = svc.render_admission_letter(name, fmt)
	if fmt == "pdf":
		frappe.local.response.filename = f"Admission-Letter-{name}.pdf"
		frappe.local.response.filecontent = output
		frappe.local.response.type = "pdf"
		return None
	return {"html": output, "name": name}


# ---------------------------------------------------------------------------------- staff
def _list_filters(
	status=None,
	programme=None,
	campus=None,
	intake=None,
	study_mode=None,
	awaiting_fee=None,
	from_date=None,
	to_date=None,
) -> list:
	filters = []
	for field, value in (
		("status", status),
		("programme", programme),
		("campus", campus),
		("intake", intake),
		("study_mode", study_mode),
	):
		if value:
			values = parse_json(value) if isinstance(value, str) and value.startswith("[") else value
			filters.append([field, "in" if isinstance(values, list) else "=", values])
	if cint(awaiting_fee):
		filters += [
			["status", "=", "Submitted"],
			["fee_status", "not in", list(svc.FEE_SETTLED)],
			["application_fee", ">", 0],
		]
	if from_date:
		filters.append(["creation", ">=", get_datetime(from_date)])
	if to_date:
		filters.append(["creation", "<", add_days(getdate(to_date), 1)])
	return filters


@frappe.whitelist()
def list_applications(
	status=None,
	programme=None,
	campus=None,
	intake=None,
	search=None,
	start=0,
	page_length=20,
	study_mode=None,
	awaiting_fee=None,
	from_date=None,
	to_date=None,
	order_by=None,
):
	require_roles(*STAFF, ROLE_FINANCE)
	base = _list_filters(None, programme, campus, intake, study_mode, None, from_date, to_date)
	filters = _list_filters(status, programme, campus, intake, study_mode, awaiting_fee, from_date, to_date)
	or_filters = search_filters(search, ("name", "full_name", "email", "phone", "national_id"))
	order = (
		order_by
		if order_by
		in ("creation desc", "creation asc", "submitted_on desc", "full_name asc", "modified desc")
		else "creation desc"
	)
	rows = frappe.get_list(
		DOCTYPE,
		filters=filters,
		or_filters=or_filters,
		fields=LIST_FIELDS,
		order_by=order,
		**page_args(start, page_length),
	)
	total = frappe.get_list(
		DOCTYPE, filters=filters, or_filters=or_filters, fields=[{"COUNT": "*", "as": "total"}]
	)
	counts = frappe.get_list(
		DOCTYPE,
		filters=base,
		or_filters=or_filters,
		fields=["status", {"COUNT": "*", "as": "count"}],
		group_by="status",
		order_by=None,
	)
	awaiting = frappe.get_list(
		DOCTYPE,
		filters=base + _list_filters(awaiting_fee=1),
		or_filters=or_filters,
		fields=[{"COUNT": "*", "as": "total"}],
	)
	return {
		"data": [_row_dict(r) for r in rows],
		"total": cint(total[0].total) if total else 0,
		"counts_by_status": {c.status: cint(c.count) for c in counts},
		"awaiting_fee_count": cint(awaiting[0].total) if awaiting else 0,
	}


@frappe.whitelist()
def get_application(name: str):
	doc = _staff_application(name, roles=(*STAFF, ROLE_FINANCE))
	data = _as_dict(doc, staff=True)
	data["duplicates"] = svc.duplicate_hints(doc)
	data["programme_info"] = frappe.db.get_value(
		"Programme", doc.programme, ["programme_name", "code", "level", "minimum_entry"], as_dict=True
	)
	data["fee_payment_info"] = (
		frappe.db.get_value(
			"Student Payment",
			doc.fee_payment,
			["name", "amount", "mode_of_payment", "reference_no", "posting_date", "status"],
			as_dict=True,
		)
		if doc.fee_payment
		else None
	)
	data["reviewer_name"] = frappe.db.get_value("User", doc.reviewer, "full_name") if doc.reviewer else None
	data["allowed_transitions"] = list(svc.APPLICATION_TRANSITIONS.get(doc.status, ()))
	return data


def _staff_transition(doc, status: str, note: str | None = None, **flags):
	if status not in svc.APPLICATION_TRANSITIONS.get(doc.status, ()):
		frappe.throw(
			_("Application {0} is {1} and cannot be moved to {2}.").format(doc.name, _(doc.status), _(status))
		)
	doc.status = status
	doc.flags.status_note = note
	for key, value in flags.items():
		doc.flags[key] = value
	doc.save()
	return doc


@frappe.whitelist(methods=["POST"])
def start_review(name: str, notes: str | None = None):
	doc = _staff_application(name)
	if notes:
		doc.review_notes = notes
	doc.reviewer = frappe.session.user
	return _as_dict(_staff_transition(doc, "Under Review", notes), staff=True)


@frappe.whitelist(methods=["POST"])
def schedule_interview(name: str, interview_date: str, notes: str | None = None):
	doc = _staff_application(name)
	when = get_datetime(interview_date) if interview_date else None
	if not when:
		frappe.throw(_("Choose the interview date and time."))
	if when < now_datetime():
		frappe.throw(_("The interview must be scheduled in the future."))
	doc.interview_date = when
	if notes:
		doc.review_notes = notes
	if doc.status == "Interview":  # reschedule
		doc.flags.status_note = notes
		log_status(
			doc,
			doc.status,
			_("Interview rescheduled to {0}").format(frappe.utils.format_datetime(when)),
			doc.status,
		)
		doc.save()
		from mahanaim.services.admissions import after_status_change

		after_status_change(doc, doc.status)
		return _as_dict(doc, staff=True)
	return _as_dict(_staff_transition(doc, "Interview", notes), staff=True)


def _decide(doc, decision: str, notes=None, rejection_reason=None, offer_expiry=None):
	if decision not in svc.DECISIONS:
		frappe.throw(_("Decision must be one of: {0}").format(", ".join(svc.DECISIONS)))
	if notes:
		doc.review_notes = notes
	flags = {}
	if decision == "Rejected":
		doc.rejection_reason = rejection_reason or doc.rejection_reason
	if decision == "Admitted" and offer_expiry:
		if getdate(offer_expiry) < getdate(today()):
			frappe.throw(_("The offer expiry date must be in the future."))
		doc.offer_expiry = getdate(offer_expiry)
		flags["keep_offer_expiry"] = True
	return _staff_transition(doc, decision, notes or rejection_reason, **flags)


@frappe.whitelist(methods=["POST"])
def decide(
	name: str,
	decision: str,
	notes: str | None = None,
	rejection_reason: str | None = None,
	offer_expiry: str | None = None,
):
	doc = _staff_application(name)
	return _as_dict(_decide(doc, decision, notes, rejection_reason, offer_expiry), staff=True)


@frappe.whitelist(methods=["POST"])
def bulk_decide(names, decision: str, notes: str | None = None, rejection_reason: str | None = None):
	require_roles(*STAFF)
	names = parse_json(names, []) if isinstance(names, str) else (names or [])
	if not names:
		frappe.throw(_("Select at least one application."))
	if len(names) > 200:
		frappe.throw(_("Decide at most 200 applications at a time."))
	updated, failed = [], []
	for name in names:
		savepoint = f"bulk_{frappe.generate_hash(length=6)}"
		frappe.db.savepoint(savepoint)
		try:
			doc = _staff_application(name)
			_decide(doc, decision, notes, rejection_reason)
			updated.append(name)
		except Exception as e:
			frappe.db.rollback(save_point=savepoint)
			failed.append({"name": name, "error": frappe.utils.strip_html(str(e)) or e.__class__.__name__})
			frappe.clear_messages()
	return {"ok": not failed, "updated": updated, "failed": failed}


@frappe.whitelist(methods=["POST"])
def waive_application_fee(name: str, reason: str):
	doc = _staff_application(name, roles=(ROLE_ADMISSIONS, ROLE_REGISTRAR, ROLE_FINANCE))
	if not (reason or "").strip():
		frappe.throw(_("Give a reason for waiving the fee."))
	if doc.fee_status == "Paid":
		frappe.throw(_("The fee has already been paid."))
	if doc.fee_status == "Waived":
		return _as_dict(doc, staff=True)
	doc.fee_status = "Waived"
	log_status(doc, doc.status, _("Application fee waived: {0}").format(reason.strip()), doc.status)
	doc.save()
	return _as_dict(doc, staff=True)


@frappe.whitelist(methods=["POST"])
def convert_to_student(name: str):
	doc = _staff_application(name, roles=(ROLE_ADMISSIONS, ROLE_REGISTRAR))
	if doc.status not in ("Admitted", "Accepted"):
		frappe.throw(_("Only admitted applicants can be converted to students."))
	from mahanaim.services.students import create_student_from_application

	student = create_student_from_application(doc.name)
	return {
		"ok": True,
		"student": student,
		"student_number": frappe.db.get_value("Student", student, "student_number"),
		"application": doc.name,
	}


@frappe.whitelist()
def admissions_stats(intake: str | None = None):
	"""Funnel + breakdowns for the admissions dashboard."""
	require_roles(*STAFF, ROLE_FINANCE)
	filters = [["intake", "=", intake]] if intake else []
	by_status = frappe.get_list(
		DOCTYPE,
		filters=filters,
		fields=["status", {"COUNT": "*", "as": "count"}],
		group_by="status",
		order_by=None,
	)
	status_counts = {r.status: cint(r.count) for r in by_status}
	total = sum(status_counts.values())
	submitted = total - status_counts.get("Draft", 0)
	decided = sum(
		status_counts.get(s, 0) for s in ("Admitted", "Accepted", "Declined", "Rejected", "Waitlisted")
	)
	admitted = sum(status_counts.get(s, 0) for s in ("Admitted", "Accepted", "Declined"))
	accepted = status_counts.get("Accepted", 0)
	by_programme = frappe.get_list(
		DOCTYPE,
		filters=filters,
		fields=["programme", "programme_name", {"COUNT": "*", "as": "count"}],
		group_by="programme, programme_name",
		order_by=None,
	)
	by_campus = frappe.get_list(
		DOCTYPE,
		filters=filters,
		fields=["campus", {"COUNT": "*", "as": "count"}],
		group_by="campus",
		order_by=None,
	)
	by_fee = frappe.get_list(
		DOCTYPE,
		filters=filters,
		fields=["fee_status", {"COUNT": "*", "as": "count"}],
		group_by="fee_status",
		order_by=None,
	)
	since = add_days(getdate(today()), -29)
	recent = frappe.get_list(
		DOCTYPE, filters=[*filters, ["creation", ">=", since]], pluck="creation", limit_page_length=0
	)
	days = {str(add_days(since, i)): 0 for i in range(30)}
	for created in recent:
		key = str(getdate(created))
		if key in days:
			days[key] += 1
	pct = lambda a, b: round(a * 100.0 / b, 1) if b else 0.0  # noqa: E731
	return {
		"total": total,
		"by_status": status_counts,
		"funnel": [
			{"stage": "Started", "count": total},
			{"stage": "Submitted", "count": submitted},
			{"stage": "Decided", "count": decided},
			{"stage": "Admitted", "count": admitted},
			{"stage": "Accepted", "count": accepted},
		],
		"conversion": {
			"submission_rate": pct(submitted, total),
			"admission_rate": pct(admitted, decided),
			"acceptance_rate": pct(accepted, admitted),
		},
		"by_programme": sorted(
			[
				{"programme": r.programme, "programme_name": r.programme_name, "count": cint(r.count)}
				for r in by_programme
			],
			key=lambda r: -r["count"],
		),
		"by_campus": sorted(
			[{"campus": r.campus, "count": cint(r.count)} for r in by_campus], key=lambda r: -r["count"]
		),
		"by_fee_status": {r.fee_status: cint(r.count) for r in by_fee},
		"by_day": [{"date": d, "count": c} for d, c in days.items()],
		"intake": intake,
	}
