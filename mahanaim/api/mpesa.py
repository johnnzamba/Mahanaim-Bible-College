"""M-Pesa API (B3): Safaricom callbacks (guest, token-protected) and finance-office tools.

Callback URLs (registered/used automatically, see docs/MPESA.md):
	STK:  /api/method/mahanaim.api.mpesa.stk_callback?token=<M-Pesa Settings.callback_token>
	C2B:  /api/method/mahanaim.api.finance.paybill_confirmation?token=...  (Daraja rejects URLs containing "mpesa")
	      /api/method/mahanaim.api.finance.paybill_validation?token=...
Callbacks always answer {"ResultCode": 0, "ResultDesc": "Accepted"} (HTTP 200) once the token is valid, even when
processing fails internally (the error is logged and the transaction is left for manual reconciliation).
"""

from __future__ import annotations

import json

import frappe
from frappe import _
from frappe.utils import cint

from mahanaim.api.finance import (
	_date_filters,
	_list,
	_request_owner_ok,
	require_finance,
	require_finance_read,
)
from mahanaim.api.utils import parse_json, require_login, require_roles
from mahanaim.services import mpesa as svc

REJECTED = {"ResultCode": 1, "ResultDesc": "Rejected"}
TRANSACTION_FIELDS = [
	"name",
	"trans_id",
	"source",
	"trans_time",
	"amount",
	"msisdn",
	"payer_name",
	"bill_ref_number",
	"business_shortcode",
	"status",
	"request",
	"student",
	"programme_application",
	"payment",
	"remarks",
]
REQUEST_FIELDS = [
	"name",
	"creation",
	"phone_number",
	"amount",
	"status",
	"purpose",
	"student",
	"programme_application",
	"sponsor",
	"account_reference",
	"checkout_request_id",
	"result_code",
	"result_desc",
	"mpesa_receipt_number",
	"transaction",
	"payment",
	"initiated_by",
	"remarks",
]


def _respond(body: dict, status: int = 200):
	frappe.local.response.update(body)
	frappe.local.response["http_status_code"] = status


def _payload() -> dict:
	request = getattr(frappe.local, "request", None)
	if request is not None:
		try:
			data = json.loads(request.get_data(as_text=True) or "{}")
			if isinstance(data, dict) and data:
				return data
		except ValueError:
			pass
	data = dict(frappe.local.form_dict or {})
	for key in ("cmd", "token"):
		data.pop(key, None)
	return data


def _token() -> str | None:
	request = getattr(frappe.local, "request", None)
	if request is not None and getattr(request, "args", None) is not None and request.args.get("token"):
		return request.args.get("token")
	return frappe.local.form_dict.get("token")


def _callback(handler, success_body: dict, label: str):
	if not svc.verify_token(_token()):
		# logged to file, not Error Log, so a flood of forged calls cannot fill the database
		frappe.logger("mahanaim.mpesa").warning(
			f"{label} rejected (bad token) from {getattr(frappe.local, 'request_ip', None)}"
		)
		_respond(REJECTED, 403)
		return
	payload = _payload()
	frappe.db.savepoint("mbc_mpesa_callback")
	try:
		result = handler(payload)
		if isinstance(result, dict) and "ResultCode" in result:
			success_body = result
	except Exception:
		frappe.db.rollback(save_point="mbc_mpesa_callback")
		frappe.log_error(
			title=f"M-Pesa {label} processing failed",
			message=frappe.get_traceback() + "\n\n" + frappe.as_json(payload)[:20000],
		)
	_respond(success_body)


# ---------------------------------------------------------------------------------- Safaricom callbacks
@frappe.whitelist(allow_guest=True, methods=["POST"])
def stk_callback(**kwargs):
	_callback(svc.handle_stk_callback, svc.ACCEPTED, "STK callback")


@frappe.whitelist(allow_guest=True, methods=["POST"])
def c2b_validation(**kwargs):
	_callback(svc.handle_c2b_validation, {"ResultCode": "0", "ResultDesc": "Accepted"}, "C2B validation")


@frappe.whitelist(allow_guest=True, methods=["POST"])
def c2b_confirmation(**kwargs):
	_callback(svc.handle_c2b_confirmation, svc.ACCEPTED, "C2B confirmation")


# ---------------------------------------------------------------------------------- staff / owner tools
@frappe.whitelist(methods=["POST"])
def register_c2b_urls():
	require_roles()  # College Administrator / System Manager only
	return svc.register_c2b_urls()


@frappe.whitelist(methods=["POST"])
def query_stk_status(request):
	require_login()
	req = frappe.db.get_value(
		"M-Pesa Request",
		request,
		["name", "student", "programme_application", "sponsor", "initiated_by"],
		as_dict=True,
	)
	if not req or not _request_owner_ok(req):
		frappe.throw(_("Payment request not found"), frappe.DoesNotExistError)
	return svc.query_stk_status(request)


@frappe.whitelist(methods=["POST"])
def simulate_callback(request, success=1):
	"""developer_mode demos only: complete a simulated (SIM-) STK request. Staff or the request owner."""
	require_login()
	req = frappe.db.get_value(
		"M-Pesa Request",
		request,
		["name", "student", "programme_application", "sponsor", "initiated_by"],
		as_dict=True,
	)
	if not req or not _request_owner_ok(req):
		frappe.throw(_("Payment request not found"), frappe.DoesNotExistError)
	return svc.simulate_callback(request, success=bool(cint(success)))


@frappe.whitelist()
def list_transactions(
	status=None, search=None, from_date=None, to_date=None, source=None, start=0, page_length=20
):
	require_finance_read()
	f = {}
	if status:
		f["status"] = status
	if source:
		f["source"] = source
	_date_filters(f, "trans_time", from_date, f"{to_date} 23:59:59" if to_date else None)
	or_filters = None
	if search:
		like = f"%{search.strip()}%"
		or_filters = [
			["trans_id", "like", like],
			["msisdn", "like", like],
			["payer_name", "like", like],
			["bill_ref_number", "like", like],
			["student", "like", like],
		]
	return _list(
		"M-Pesa Transaction",
		f,
		TRANSACTION_FIELDS,
		start,
		page_length,
		"trans_time desc, creation desc",
		or_filters,
	)


@frappe.whitelist()
def get_transaction(name):
	require_finance_read()
	frappe.has_permission("M-Pesa Transaction", "read", name, throw=True)
	return frappe.get_doc("M-Pesa Transaction", name).as_dict()


@frappe.whitelist(methods=["POST"])
def reconcile_transaction(trans_id, student=None, application=None):
	require_finance()
	frappe.has_permission("M-Pesa Transaction", "write", trans_id, throw=True)
	return svc.reconcile_transaction(trans_id, student=student or None, application=application or None)


@frappe.whitelist()
def list_requests(
	status=None, search=None, purpose=None, from_date=None, to_date=None, start=0, page_length=20
):
	require_finance_read()
	f = {}
	if status:
		f["status"] = status
	if purpose:
		f["purpose"] = purpose
	_date_filters(f, "creation", from_date, f"{to_date} 23:59:59" if to_date else None)
	or_filters = None
	if search:
		like = f"%{search.strip()}%"
		or_filters = [
			["name", "like", like],
			["phone_number", "like", like],
			["student", "like", like],
			["mpesa_receipt_number", "like", like],
			["account_reference", "like", like],
		]
	return _list("M-Pesa Request", f, REQUEST_FIELDS, start, page_length, "creation desc", or_filters)


@frappe.whitelist()
def mpesa_settings_status():
	require_finance_read()
	return svc.settings_status()


@frappe.whitelist(methods=["POST"])
def test_connection():
	require_finance()
	return svc.test_connection()


# ---------------------------------------------------------------------------------- admin settings screen
@frappe.whitelist()
def mpesa_settings(reveal=0):
	"""M-Pesa Settings for the admin Settings screen (College Administrator / System Manager).

	Password fields come back as "********" (or null when unset). `reveal=1` returns the callback URLs with the
	full ?token= so they can be copied into the Daraja portal.
	"""
	require_roles()
	return svc.admin_settings(reveal=bool(cint(reveal)))


@frappe.whitelist(methods=["POST"])
def update_mpesa_settings(data):
	"""Validate + save; an empty or all-`*` Password value keeps the stored secret. Returns mpesa_settings()."""
	require_roles()
	return svc.update_admin_settings(parse_json(data, {}) or {})


@frappe.whitelist(methods=["POST"])
def test_mpesa_connection():
	"""Fetch an OAuth token -> {ok, simulation, environment, message}. Simulation mode makes no network call."""
	require_roles()
	return svc.test_connection()
