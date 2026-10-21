"""M-Pesa Daraja integration (owned by backend domain B3).

CONTRACT:
	initiate_payment(phone, amount, purpose, student=None, application=None, sponsor=None, invoice=None,
	                 initiated_by=None) -> dict {"request": name, "checkout_request_id": str, "customer_message": str}
		purpose in {"Student Fees", "Application Fee", "Event Fee", "Giving", "Other"} (sponsor= marks a sponsor paying for a student)
	expire_stale_requests()  # cron */5

Flow: initiate_payment -> STK push (M-Pesa Request: Initiated -> Pending) -> Safaricom calls
`mahanaim.api.mpesa.stk_callback?token=...` -> handle_stk_callback creates the M-Pesa Transaction (named by
the M-Pesa receipt, so a receipt can never be recorded twice) and a submitted Student Payment.
"Giving" and "Event Fee" requests do not create a Student Payment: the callback hands them to B4's
`services.church.on_mpesa_success` / `services.website.mark_event_registration_paid` instead.
PayBill/Till payments made directly from the phone arrive through the C2B confirmation URL and are matched
on the account number (BillRefNumber).

SIMULATION: when M-Pesa Settings is disabled and the site runs in developer_mode, initiate_payment returns a
fake `SIM-...` checkout id and staff can call `mahanaim.api.mpesa.simulate_callback` to complete it.
"""

from __future__ import annotations

import base64
import hmac
import json
import math
import re
from datetime import datetime
from zoneinfo import ZoneInfo

import frappe
import requests
from frappe import _
from frappe.utils import add_to_date, cint, flt, get_datetime, getdate, now_datetime, random_string, today

from mahanaim.utils import normalize_phone

SANDBOX_URL = "https://sandbox.safaricom.co.ke"
PRODUCTION_URL = "https://api.safaricom.co.ke"
PURPOSES = ("Student Fees", "Application Fee", "Event Fee", "Giving", "Other")
# purposes recorded by another domain's service (B4) instead of a Student Payment -> record doctype
EXTERNAL_PURPOSES = {"Giving": "Giving Record", "Event Fee": "Event Registration"}
HTTP_TIMEOUT = 30
RATE_LIMIT_SECONDS = 30
EXPIRY_MARGIN_SECONDS = 60
MAX_STK_AMOUNT = 250000
CANCELLED_CODES = {"1032"}
TIMEOUT_CODES = {"1037", "1019"}
OPEN_STATUSES = ("Initiated", "Pending")
FAILURE_STATUSES = ("Failed", "Cancelled", "Timeout")
ACCEPTED = {"ResultCode": 0, "ResultDesc": "Accepted"}
EAT = ZoneInfo("Africa/Nairobi")


class DarajaError(frappe.ValidationError):
	pass


# ---------------------------------------------------------------------------------- settings / client
def get_settings():
	return frappe.get_cached_doc("M-Pesa Settings")


def is_simulation(settings=None) -> bool:
	settings = settings or get_settings()
	return not cint(settings.enabled) and bool(cint(frappe.conf.get("developer_mode")))


def base_url(settings=None) -> str:
	settings = settings or get_settings()
	return PRODUCTION_URL if settings.environment == "Production" else SANDBOX_URL


def _secret(settings, field) -> str | None:
	return settings.get_password(field, raise_exception=False) if settings.get(field) else None


def _token_cache_key(settings) -> str:
	return f"mahanaim:mpesa:token:{settings.environment}:{settings.business_shortcode}"


def clear_token_cache():
	frappe.cache.delete_keys("mahanaim:mpesa:token:")
	frappe.clear_document_cache("M-Pesa Settings", "M-Pesa Settings")


def get_access_token(settings=None, force: bool = False) -> str:
	"""OAuth client-credentials token, cached just under its lifetime."""
	settings = settings or get_settings()
	key = _token_cache_key(settings)
	if not force:
		cached = frappe.cache.get_value(key)
		if cached:
			return cached
	consumer_key, consumer_secret = _secret(settings, "consumer_key"), _secret(settings, "consumer_secret")
	if not consumer_key or not consumer_secret:
		raise DarajaError(_("M-Pesa consumer key and secret are not configured"))
	r = requests.get(
		f"{base_url(settings)}/oauth/v1/generate",
		params={"grant_type": "client_credentials"},
		auth=(consumer_key, consumer_secret),
		timeout=HTTP_TIMEOUT,
	)
	if r.status_code != 200:
		raise DarajaError(_("M-Pesa authentication failed (HTTP {0})").format(r.status_code))
	data = r.json()
	token = data.get("access_token")
	if not token:
		raise DarajaError(_("M-Pesa did not return an access token"))
	expires = cint(data.get("expires_in")) or 3599
	frappe.cache.set_value(key, token, expires_in_sec=max(expires - 60, 30))
	return token


def daraja_post(settings, path: str, payload: dict) -> tuple[int, dict]:
	"""POST to Daraja with a bearer token (refreshes once on 401). Returns (status_code, json)."""
	for attempt in (0, 1):
		token = get_access_token(settings, force=bool(attempt))
		r = requests.post(
			f"{base_url(settings)}{path}",
			json=payload,
			headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
			timeout=HTTP_TIMEOUT,
		)
		if r.status_code != 401:
			break
	try:
		data = r.json()
	except ValueError:
		data = {"raw": (r.text or "")[:500]}
	return r.status_code, data if isinstance(data, dict) else {"raw": data}


def timestamp() -> str:
	return datetime.now(EAT).strftime("%Y%m%d%H%M%S")


def stk_password(shortcode: str, passkey: str, ts: str) -> str:
	return base64.b64encode(f"{shortcode}{passkey}{ts}".encode()).decode()


def callback_url(method: str, settings=None, module: str = "mahanaim.api.mpesa") -> str:
	settings = settings or get_settings()
	base = (settings.callback_base_url or frappe.utils.get_url()).rstrip("/")
	token = _secret(settings, "callback_token") or ""
	return f"{base}/api/method/{module}.{method}?token={token}"


def mask_url(url: str) -> str:
	return re.sub(r"token=([^&]+)", lambda m: "token=" + "*" * 8 + m.group(1)[-4:], url or "")


def verify_token(token) -> bool:
	"""Constant-time comparison of the callback ?token= with M-Pesa Settings.callback_token."""
	expected = _secret(get_settings(), "callback_token")
	if not expected or not token:
		return False
	return hmac.compare_digest(str(token).encode(), str(expected).encode())


def _dump(data) -> str:
	return json.dumps(data, indent=1, default=str)[:60000]


def _parse_time(value):
	try:
		return datetime.strptime(str(value), "%Y%m%d%H%M%S")
	except (TypeError, ValueError):
		return now_datetime()


# ---------------------------------------------------------------------------------- STK push
def _rate_limit_key(msisdn: str) -> str:
	return f"mahanaim:mpesa:stk:{msisdn}"


def _account_reference(settings, purpose, student, application, sponsor, invoice) -> str:
	if student:
		number = frappe.db.get_value("Student", student, "student_number")
		if number:
			return number
	if application:
		return application
	prefix = (settings.account_reference_prefix or "").strip()
	ref = invoice or sponsor or student or purpose
	return f"{prefix}-{ref}" if prefix else ref


def initiate_payment(
	phone, amount, purpose, student=None, application=None, sponsor=None, invoice=None, initiated_by=None
) -> dict:
	settings = get_settings()
	simulate = is_simulation(settings)
	if not cint(settings.enabled) and not simulate:
		frappe.throw(_("M-Pesa payments are not available right now. Please contact the finance office."))
	purpose = purpose or "Student Fees"
	if purpose not in PURPOSES:
		frappe.throw(_("Unknown payment purpose {0}").format(purpose))
	msisdn = normalize_phone(phone)
	if not msisdn or not re.fullmatch(r"254[17]\d{8}", msisdn):
		frappe.throw(_("Enter a valid Safaricom number, e.g. 0712 345 678"))
	whole = math.ceil(flt(amount, 2))
	if whole < 1:
		frappe.throw(_("The amount must be at least KES 1"))
	if whole > MAX_STK_AMOUNT:
		frappe.throw(_("M-Pesa allows at most KES {0:,} per transaction").format(MAX_STK_AMOUNT))
	if invoice:
		inv = frappe.db.get_value("Student Invoice", invoice, ["student", "docstatus"], as_dict=True)
		if not inv or inv.docstatus != 1:
			frappe.throw(_("Invoice {0} is not payable").format(invoice))
		if student and inv.student != student:
			frappe.throw(_("Invoice {0} belongs to another student").format(invoice))
		student = student or inv.student
	if student and not frappe.db.exists("Student", student):
		frappe.throw(_("Student {0} not found").format(student), frappe.DoesNotExistError)
	if application and not frappe.db.exists("Programme Application", application):
		frappe.throw(_("Application {0} not found").format(application), frappe.DoesNotExistError)
	if sponsor and not frappe.db.exists("Sponsor", sponsor):
		frappe.throw(_("Sponsor {0} not found").format(sponsor), frappe.DoesNotExistError)
	if purpose == "Student Fees" and not student:
		frappe.throw(_("Select the student whose fees are being paid"))
	if purpose == "Application Fee" and not application:
		frappe.throw(_("Select the application being paid for"))

	key = _rate_limit_key(msisdn)
	if frappe.cache.get_value(key):
		frappe.throw(
			_(
				"A payment prompt was just sent to this number. Please wait {0} seconds before trying again."
			).format(RATE_LIMIT_SECONDS),
			frappe.RateLimitExceededError,
		)
	frappe.cache.set_value(key, 1, expires_in_sec=RATE_LIMIT_SECONDS)

	account_reference = _account_reference(settings, purpose, student, application, sponsor, invoice)
	req = frappe.get_doc(
		{
			"doctype": "M-Pesa Request",
			"phone_number": msisdn,
			"amount": whole,
			"status": "Initiated",
			"purpose": purpose,
			"student": student,
			"programme_application": application,
			"sponsor": sponsor,
			"reference_doctype": "Student Invoice" if invoice else ("Sponsor" if sponsor else None),
			"reference_name": invoice or sponsor,
			"account_reference": account_reference,
			"initiated_by": initiated_by or frappe.session.user,
		}
	)
	req.insert(ignore_permissions=True)

	if simulate:
		checkout = f"SIM-{random_string(20)}"
		message = _("SIMULATION: no prompt was sent. Use simulate_callback to complete request {0}.").format(
			req.name
		)
		req.db_set(
			{
				"status": "Pending",
				"checkout_request_id": checkout,
				"merchant_request_id": f"SIM-{random_string(12)}",
				"request_payload": _dump(
					{
						"simulation": True,
						"Amount": whole,
						"PhoneNumber": msisdn,
						"AccountReference": account_reference,
					}
				),
				"response_payload": _dump({"ResponseCode": "0", "CustomerMessage": message}),
			}
		)
		return {
			"request": req.name,
			"checkout_request_id": checkout,
			"customer_message": message,
			"simulation": True,
		}

	shortcode = settings.business_shortcode
	party_b = settings.till_number if settings.transaction_type == "CustomerBuyGoodsOnline" else shortcode
	ts = timestamp()
	payload = {
		"BusinessShortCode": shortcode,
		"Password": stk_password(shortcode, _secret(settings, "passkey") or "", ts),
		"Timestamp": ts,
		"TransactionType": settings.transaction_type or "CustomerPayBillOnline",
		"Amount": whole,
		"PartyA": msisdn,
		"PartyB": party_b,
		"PhoneNumber": msisdn,
		"CallBackURL": callback_url("stk_callback", settings),
		"AccountReference": account_reference,
		"TransactionDesc": purpose[:13],
	}
	masked = {**payload, "Password": "********", "CallBackURL": mask_url(payload["CallBackURL"])}
	try:
		status_code, data = daraja_post(settings, "/mpesa/stkpush/v1/processrequest", payload)
	except (requests.RequestException, DarajaError) as e:
		frappe.cache.delete_value(key)
		frappe.log_error(title="M-Pesa STK push failed", message=f"{e}\n{_dump(masked)}", defer_insert=True)
		frappe.throw(_("We could not reach M-Pesa. Please try again in a moment."))
	ok = status_code == 200 and str(data.get("ResponseCode")) == "0"
	req.db_set(
		{
			"status": "Pending" if ok else "Failed",
			"merchant_request_id": data.get("MerchantRequestID"),
			"checkout_request_id": data.get("CheckoutRequestID") or None,
			"result_code": str(data.get("ResponseCode") or data.get("errorCode") or ""),
			"result_desc": data.get("ResponseDescription") or data.get("errorMessage"),
			"request_payload": _dump(masked),
			"response_payload": _dump(data),
		}
	)
	if not ok:
		frappe.cache.delete_value(key)
		frappe.log_error(
			title="M-Pesa STK push rejected", message=f"{_dump(masked)}\n{_dump(data)}", defer_insert=True
		)
		frappe.throw(
			_("M-Pesa could not start the payment: {0}").format(
				data.get("errorMessage") or data.get("ResponseDescription") or _("unknown error")
			)
		)
	return {
		"request": req.name,
		"checkout_request_id": data.get("CheckoutRequestID"),
		"customer_message": data.get("CustomerMessage") or _("Check your phone and enter your M-Pesa PIN."),
	}


# ---------------------------------------------------------------------------------- callbacks
def handle_stk_callback(payload: dict) -> dict:
	"""Process a Daraja STK callback. Idempotent; safe to call any number of times."""
	cb = ((payload or {}).get("Body") or {}).get("stkCallback") or {}
	checkout = cb.get("CheckoutRequestID")
	name = checkout and frappe.db.get_value("M-Pesa Request", {"checkout_request_id": checkout}, "name")
	if not name:
		frappe.log_error(title="M-Pesa callback for unknown CheckoutRequestID", message=_dump(payload))
		return {"status": "ignored"}
	req = frappe.get_doc("M-Pesa Request", name, for_update=True)
	code = str(cb.get("ResultCode", "")).strip()
	if req.status == "Completed":
		return {"status": "duplicate", "request": name, "payment": req.payment}
	if code != "0":
		if req.status in FAILURE_STATUSES:
			return {"status": "duplicate", "request": name}
		status = (
			"Cancelled" if code in CANCELLED_CODES else ("Timeout" if code in TIMEOUT_CODES else "Failed")
		)
		req.db_set(
			{
				"status": status,
				"result_code": code,
				"result_desc": cb.get("ResultDesc"),
				"callback_payload": _dump(payload),
			}
		)
		return {"status": status, "request": name}

	items = {
		i.get("Name"): i.get("Value")
		for i in ((cb.get("CallbackMetadata") or {}).get("Item") or [])
		if isinstance(i, dict)
	}
	receipt = str(items.get("MpesaReceiptNumber") or "").strip().upper()
	if not receipt:
		frappe.log_error(title=f"M-Pesa success callback without receipt for {name}", message=_dump(payload))
		req.db_set(
			{"callback_payload": _dump(payload), "result_desc": "Success callback without receipt number"}
		)
		return {"status": "ignored", "request": name}
	amount = flt(items.get("Amount"), 2)
	msisdn = normalize_phone(str(items.get("PhoneNumber") or "")) or req.phone_number
	remarks = None
	if flt(amount, 2) != flt(req.amount, 2):
		remarks = _(
			"Amount mismatch: requested {0}, paid {1}. The amount actually paid was recorded."
		).format(flt(req.amount, 2), amount)
	external = req.purpose in EXTERNAL_PURPOSES
	trans = get_or_create_transaction(
		receipt,
		source="STK Push",
		amount=amount,
		msisdn=msisdn,
		trans_time=_parse_time(items.get("TransactionDate")),
		bill_ref_number=req.account_reference,
		business_shortcode=get_settings().business_shortcode,
		request=req.name,
		student=req.student,
		programme_application=req.programme_application,
		remarks=remarks,
		raw_payload=payload,
		**({"status": "Matched"} if external else {}),
	)
	payment = None if external else (trans.payment or create_payment_safely(trans, request=req))
	req.db_set(
		{
			"status": "Completed",
			"result_code": code,
			"result_desc": cb.get("ResultDesc"),
			"mpesa_receipt_number": receipt,
			"transaction": trans.name,
			"payment": payment,
			"callback_payload": _dump(payload),
			"remarks": remarks,
		}
	)
	out = {"status": "Completed", "request": name, "transaction": trans.name, "payment": payment}
	if external:
		out["record"] = complete_external_purpose(req, trans)
	return out


def complete_external_purpose(req, trans) -> str | None:
	"""Giving / Event Fee payments are recorded by B4's services (Giving Record / Event Registration), not as
	Student Payments. Never raises: on failure the transaction stays Matched for staff follow-up."""
	label = EXTERNAL_PURPOSES[req.purpose]
	record = None
	frappe.db.savepoint("mbc_mpesa_external")
	try:
		if req.purpose == "Giving":
			from mahanaim.services.church import on_mpesa_success

			record = on_mpesa_success(req.name, trans.name)
		else:
			from mahanaim.services.website import mark_event_registration_paid

			record = mark_event_registration_paid(request=req.name, reference=trans.name)
	except Exception:
		frappe.db.rollback(save_point="mbc_mpesa_external")
		frappe.log_error(title=f"M-Pesa {req.purpose} could not be recorded for {req.name}")
	if record:
		note = _("Recorded as {0} {1}").format(_(label), record)
		trans.db_set({"status": "Allocated", "remarks": _append_line(trans.remarks, note)})
	else:
		note = _("{0} could not be recorded automatically; reconcile this transaction.").format(_(label))
		trans.db_set({"status": "Matched", "remarks": _append_line(trans.remarks, note)})
	return record


def _append_line(text: str | None, line: str) -> str:
	return "\n".join(x for x in ((text or "").strip(), line) if x)


def get_or_create_transaction(trans_id: str, **values):
	if frappe.db.exists("M-Pesa Transaction", trans_id):
		trans = frappe.get_doc("M-Pesa Transaction", trans_id, for_update=True)
		updates = {
			k: values[k]
			for k in ("request", "student", "programme_application")
			if values.get(k) and not trans.get(k)
		}
		if updates:
			trans.db_set(updates)
		return trans
	raw = values.pop("raw_payload", None)
	trans = frappe.get_doc(
		{
			"doctype": "M-Pesa Transaction",
			"trans_id": trans_id,
			"status": "Matched"
			if values.get("student") or values.get("programme_application")
			else "Unmatched",
			"raw_payload": _dump(raw) if raw is not None else None,
			**values,
		}
	)
	trans.insert(ignore_permissions=True)
	return trans


def _resolve_payment_for(request, student, application) -> str:
	purpose = request.purpose if request else None
	if purpose == "Application Fee" and application:
		return "Application Fee"
	if purpose in (None, "Student Fees") and student:
		return "Student Fees"
	if purpose is None and application:
		return "Application Fee"
	return "Other"


def create_payment_from_transaction(trans, request=None, student=None, application=None) -> str:
	"""Create and submit the Student Payment for an M-Pesa transaction (returns its name)."""
	existing = frappe.db.get_value(
		"Student Payment", {"mode_of_payment": "M-Pesa", "reference_no": trans.name, "docstatus": 1}, "name"
	)
	if existing:
		trans.db_set({"payment": existing, "status": "Allocated"})
		return existing
	student = student or trans.student or (request.student if request else None)
	application = (
		application or trans.programme_application or (request.programme_application if request else None)
	)
	if application and not student and not request:
		app = (
			frappe.db.get_value("Programme Application", application, ["student", "fee_status"], as_dict=True)
			or {}
		)
		if app.get("student") and app.get("fee_status") in ("Paid", "Waived"):
			student, application = app["student"], None
	payment_for = _resolve_payment_for(request, student, application)
	payment = frappe.get_doc(
		{
			"doctype": "Student Payment",
			"payment_for": payment_for,
			"student": student,
			"programme_application": application,
			"sponsor": request.get("sponsor") if request else None,
			"posting_date": getdate(trans.trans_time) if trans.trans_time else today(),
			"mode_of_payment": "M-Pesa",
			"amount": flt(trans.amount, 2),
			"reference_no": trans.name,
			"reference_date": getdate(trans.trans_time) if trans.trans_time else today(),
			"msisdn": trans.msisdn,
			"mpesa_transaction": trans.name,
			"payer_name": trans.payer_name,
			"remarks": trans.remarks,
		}
	)
	if request and request.reference_doctype == "Student Invoice":
		payment.flags.preferred_invoice = request.reference_name
	payment.insert(ignore_permissions=True)
	payment.submit()
	trans.db_set(
		{
			"payment": payment.name,
			"status": "Allocated",
			"student": student,
			"programme_application": application,
		}
	)
	return payment.name


def create_payment_safely(trans, request=None, student=None, application=None) -> str | None:
	"""Like create_payment_from_transaction but never raises: failures leave the transaction for manual
	reconciliation (status Matched/Unmatched with the error in remarks)."""
	frappe.db.savepoint("mbc_mpesa_payment")
	try:
		return create_payment_from_transaction(
			trans, request=request, student=student, application=application
		)
	except Exception as e:
		frappe.db.rollback(save_point="mbc_mpesa_payment")
		frappe.log_error(title=f"M-Pesa payment creation failed for {trans.name}")
		matched = student or application or trans.student or trans.programme_application
		trans.db_set(
			{
				"status": "Matched" if matched else "Unmatched",
				"remarks": (
					(trans.remarks or "") + "\n" + _("Auto-allocation failed: {0}").format(str(e)[:200])
				).strip(),
			}
		)
		return None


# ---------------------------------------------------------------------------------- C2B
def _norm(value) -> str:
	return re.sub(r"[^A-Z0-9]", "", str(value or "").upper())


def match_bill_ref(bill_ref) -> tuple[str | None, str | None]:
	"""Match a PayBill account number to (student, application). Case/slash/dash insensitive."""
	key = _norm(bill_ref)
	if not key:
		return None, None
	keys = [key]
	prefix = _norm(get_settings().account_reference_prefix)
	if prefix and key.startswith(prefix) and len(key) > len(prefix):
		keys.append(key[len(prefix) :])
	norm_sql = "upper(replace(replace(replace(replace({0}, '/', ''), '-', ''), ' ', ''), '.', ''))"
	rows = frappe.db.sql(
		f"select name from `tabStudent` where {norm_sql.format('student_number')} in %(keys)s "
		f"or {norm_sql.format('name')} in %(keys)s limit 2",
		{"keys": tuple(keys)},
	)
	if len(rows) == 1:
		return rows[0][0], None
	rows = frappe.db.sql(
		f"select name from `tabProgramme Application` where {norm_sql.format('name')} in %(keys)s limit 2",
		{"keys": tuple(keys)},
	)
	if len(rows) == 1:
		return None, rows[0][0]
	rows = frappe.db.sql(
		f"select student from `tabStudent Invoice` where {norm_sql.format('name')} in %(keys)s limit 1",
		{"keys": tuple(keys)},
	)
	if rows:
		return rows[0][0], None
	return None, None


def handle_c2b_validation(payload: dict) -> dict:
	"""Accept every payment; unmatched ones are reconciled manually (never bounce a payer's money)."""
	if flt((payload or {}).get("TransAmount")) <= 0:
		return {"ResultCode": "C2B00013", "ResultDesc": "Rejected"}
	return {"ResultCode": "0", "ResultDesc": "Accepted"}


def handle_c2b_confirmation(payload: dict) -> dict:
	payload = payload or {}
	trans_id = str(payload.get("TransID") or "").strip().upper()
	amount = flt(payload.get("TransAmount"), 2)
	if not trans_id or amount <= 0:
		frappe.log_error(title="M-Pesa C2B confirmation without TransID/amount", message=_dump(payload))
		return {"status": "ignored"}
	if frappe.db.exists("M-Pesa Transaction", trans_id):
		return {"status": "duplicate", "transaction": trans_id}
	bill_ref = str(payload.get("BillRefNumber") or "").strip()
	student, application = match_bill_ref(bill_ref)
	payer = " ".join(
		p for p in (payload.get("FirstName"), payload.get("MiddleName"), payload.get("LastName")) if p
	)
	trans = get_or_create_transaction(
		trans_id,
		source="C2B",
		amount=amount,
		msisdn=str(payload.get("MSISDN") or "")[:140],
		payer_name=payer or None,
		trans_time=_parse_time(payload.get("TransTime")),
		bill_ref_number=bill_ref,
		business_shortcode=str(payload.get("BusinessShortCode") or ""),
		student=student,
		programme_application=application,
		remarks=None
		if (student or application)
		else _("No student or application matches account {0}").format(bill_ref or "-"),
		raw_payload=payload,
	)
	payment = None
	if (student or application) and cint(get_settings().auto_allocate):
		payment = create_payment_safely(trans)
	return {"status": "Allocated" if payment else trans.status, "transaction": trans.name, "payment": payment}


def reconcile_transaction(trans_id: str, student=None, application=None) -> dict:
	"""Staff: attach an unmatched/matched transaction to a student or application and create the payment."""
	trans = frappe.get_doc("M-Pesa Transaction", trans_id, for_update=True)
	if trans.payment and frappe.db.get_value("Student Payment", trans.payment, "docstatus") == 1:
		frappe.throw(_("Transaction {0} is already allocated to {1}").format(trans.name, trans.payment))
	if trans.status == "Reversed":
		frappe.throw(_("Transaction {0} was reversed").format(trans.name))
	purpose = trans.request and frappe.db.get_value("M-Pesa Request", trans.request, "purpose")
	if purpose in EXTERNAL_PURPOSES and not (student or application):
		if trans.status == "Allocated":
			frappe.throw(_("Transaction {0} is already recorded").format(trans.name))
		record = complete_external_purpose(frappe.get_doc("M-Pesa Request", trans.request), trans)
		if not record:
			frappe.throw(
				_("The {0} for transaction {1} could not be recorded; see the Error Log").format(
					_(EXTERNAL_PURPOSES[purpose]), trans.name
				)
			)
		return {"transaction": trans.name, "payment": None, "record": record, "status": "Allocated"}
	student = student or trans.student
	application = application or (None if student else trans.programme_application)
	if not student and not application:
		frappe.throw(_("Select the student or application this payment belongs to"))
	if student and not frappe.db.exists("Student", student):
		frappe.throw(_("Student {0} not found").format(student), frappe.DoesNotExistError)
	if application and not frappe.db.exists("Programme Application", application):
		frappe.throw(_("Application {0} not found").format(application), frappe.DoesNotExistError)
	trans.db_set(
		{"student": student, "programme_application": application, "payment": None, "status": "Matched"}
	)
	payment = create_payment_from_transaction(trans, student=student, application=application)
	frappe.get_doc("M-Pesa Transaction", trans.name).add_comment(
		"Info", _("Reconciled by {0} to {1}").format(frappe.session.user, student or application)
	)
	return {"transaction": trans.name, "payment": payment, "status": "Allocated"}


def register_c2b_urls() -> dict:
	settings = get_settings()
	if not cint(settings.enabled):
		frappe.throw(_("Enable M-Pesa Settings first"))
	# Daraja rejects C2B URLs containing "mpesa"/"safaricom", so the C2B handlers are aliased in api.finance.
	confirmation = callback_url("paybill_confirmation", settings, module="mahanaim.api.finance")
	validation = callback_url("paybill_validation", settings, module="mahanaim.api.finance")
	shortcode = (
		settings.till_number
		if settings.transaction_type == "CustomerBuyGoodsOnline"
		else settings.business_shortcode
	)
	payload = {
		"ShortCode": shortcode,
		"ResponseType": "Completed",
		"ConfirmationURL": confirmation,
		"ValidationURL": validation,
	}
	try:
		status_code, data = daraja_post(settings, "/mpesa/c2b/v1/registerurl", payload)
	except (requests.RequestException, DarajaError) as e:
		frappe.throw(_("Could not reach M-Pesa: {0}").format(str(e)[:200]))
	ok = status_code == 200 and str(data.get("ResponseCode", "0")).strip("0") == ""
	return {
		"ok": ok,
		"response": data,
		"confirmation_url": mask_url(confirmation),
		"validation_url": mask_url(validation),
	}


# ---------------------------------------------------------------------------------- status / expiry
def query_stk_status(request_name: str) -> dict:
	"""Ask Daraja for the outcome of a pending STK push and update the request."""
	req = frappe.get_doc("M-Pesa Request", request_name)
	result = {
		"request": req.name,
		"status": req.status,
		"result_code": req.result_code,
		"result_desc": req.result_desc,
	}
	checkout = req.checkout_request_id or ""
	if req.status not in OPEN_STATUSES or not checkout or checkout.startswith("SIM-"):
		return result
	settings = get_settings()
	if not cint(settings.enabled):
		return result
	ts = timestamp()
	payload = {
		"BusinessShortCode": settings.business_shortcode,
		"Password": stk_password(settings.business_shortcode, _secret(settings, "passkey") or "", ts),
		"Timestamp": ts,
		"CheckoutRequestID": checkout,
	}
	status_code, data = daraja_post(settings, "/mpesa/stkpushquery/v1/query", payload)
	code = str(data.get("ResultCode", "")).strip()
	if code == "0":
		req.db_set(
			{
				"result_code": "0",
				"result_desc": _("Paid (confirmed by status query); awaiting M-Pesa receipt"),
			}
		)
	elif code:
		status = (
			"Cancelled" if code in CANCELLED_CODES else ("Timeout" if code in TIMEOUT_CODES else "Failed")
		)
		req.db_set({"status": status, "result_code": code, "result_desc": data.get("ResultDesc")})
	# errorCode 500.001.1001 = still being processed: leave as is
	return {
		"request": req.name,
		"status": req.status,
		"result_code": req.result_code,
		"result_desc": req.result_desc,
		"http_status": status_code,
	}


def expire_stale_requests(limit: int = 20) -> int:
	"""Cron */5: resolve Initiated/Pending requests older than the STK timeout (+ margin)."""
	settings = get_settings()
	timeout = cint(settings.stk_timeout_seconds) or 120
	cutoff = add_to_date(now_datetime(), seconds=-(timeout + EXPIRY_MARGIN_SECONDS))
	day_ago = add_to_date(now_datetime(), days=-1)
	rows = frappe.get_all(
		"M-Pesa Request",
		filters={"status": ["in", list(OPEN_STATUSES)], "creation": ["<", cutoff]},
		fields=["name", "checkout_request_id", "result_code", "creation"],
		order_by="creation asc",
		limit=limit * 5,
	)
	can_query = cint(settings.enabled)
	processed = 0
	for r in rows:
		if processed >= limit:
			break
		paid_awaiting_receipt = r.result_code == "0"
		if paid_awaiting_receipt and get_datetime(r.creation) > day_ago:
			continue
		processed += 1
		try:
			outcome = None
			if (
				not paid_awaiting_receipt
				and can_query
				and r.checkout_request_id
				and not str(r.checkout_request_id).startswith("SIM-")
			):
				try:
					outcome = query_stk_status(r.name)
				except Exception:
					frappe.log_error(title=f"M-Pesa status query failed for {r.name}")
			if not outcome or outcome.get("status") in OPEN_STATUSES:
				frappe.db.set_value(
					"M-Pesa Request",
					r.name,
					{
						"status": "Timeout",
						"result_desc": _(
							"Customer paid per status query but no receipt arrived; reconcile manually"
						)
						if paid_awaiting_receipt
						else _("No response from M-Pesa within the time limit"),
					},
				)
		except Exception:
			frappe.log_error(title=f"M-Pesa expiry failed for {r.name}")
		if not frappe.flags.in_test:
			frappe.db.commit()
	return processed


def simulate_callback(request_name: str, success: bool = True) -> dict:
	"""developer_mode only: complete a SIM- request as if Safaricom had called back."""
	if not cint(frappe.conf.get("developer_mode")):
		frappe.throw(_("Simulation is only available in developer mode"), frappe.PermissionError)
	req = frappe.get_doc("M-Pesa Request", request_name)
	if not str(req.checkout_request_id or "").startswith("SIM-"):
		frappe.throw(_("Only simulated requests can be completed this way"))
	cb = {
		"MerchantRequestID": req.merchant_request_id,
		"CheckoutRequestID": req.checkout_request_id,
		"ResultCode": 0 if cint(success) else 1032,
		"ResultDesc": "The service request is processed successfully."
		if cint(success)
		else "Request cancelled by user",
	}
	if cint(success):
		cb["CallbackMetadata"] = {
			"Item": [
				{"Name": "Amount", "Value": flt(req.amount)},
				{"Name": "MpesaReceiptNumber", "Value": "SIM" + random_string(7).upper()},
				{"Name": "TransactionDate", "Value": int(timestamp())},
				{"Name": "PhoneNumber", "Value": int(req.phone_number)},
			]
		}
	return handle_stk_callback({"Body": {"stkCallback": cb}})


def settings_status() -> dict:
	s = frappe.get_single("M-Pesa Settings")
	has = {f: bool(_secret(s, f)) for f in ("consumer_key", "consumer_secret", "passkey", "callback_token")}
	configured = bool(s.business_shortcode and s.callback_base_url and all(has.values()))
	return {
		"enabled": bool(cint(s.enabled)),
		"configured": configured,
		"simulation": is_simulation(s),
		"environment": s.environment,
		"transaction_type": s.transaction_type,
		"business_shortcode": s.business_shortcode,
		"till_number": s.till_number,
		"account_reference_prefix": s.account_reference_prefix,
		"callback_base_url": s.callback_base_url,
		"stk_callback_url": mask_url(callback_url("stk_callback", s)),
		"c2b_confirmation_url": mask_url(
			callback_url("paybill_confirmation", s, module="mahanaim.api.finance")
		),
		"c2b_validation_url": mask_url(callback_url("paybill_validation", s, module="mahanaim.api.finance")),
		"stk_timeout_seconds": cint(s.stk_timeout_seconds) or 120,
		"auto_allocate": bool(cint(s.auto_allocate)),
		"sms_receipt": bool(cint(s.sms_receipt)),
		"email_receipt": bool(cint(s.email_receipt)),
		**{f"has_{k}": v for k, v in has.items()},
	}


def test_connection() -> dict:
	settings = get_settings()
	try:
		get_access_token(settings, force=True)
		return {
			"ok": True,
			"environment": settings.environment,
			"message": _("Connected to Daraja successfully"),
		}
	except Exception as e:
		return {"ok": False, "environment": settings.environment, "message": str(e)[:300]}
