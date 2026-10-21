# M-Pesa API (`mahanaim.api.mpesa`)

Safaricom Daraja integration: STK push (Lipa na M-Pesa Online), C2B PayBill/Till confirmations and the finance
office's reconciliation tools. For setup (Daraja app, credentials, URL registration) see [../MPESA.md](../MPESA.md).

**Guards**
- **Callbacks** are `allow_guest` POST endpoints protected by `?token=<M-Pesa Settings.callback_token>`, compared
  in constant time.
  - A bad or missing token gets HTTP 403 `{"ResultCode": 1, "ResultDesc": "Rejected"}`, logged to the
    `mahanaim.mpesa` file logger and not to the Error Log.
  - With a valid token the answer is always HTTP 200 `{"ResultCode": 0, "ResultDesc": "Accepted"}`, even if
    processing fails. The failure is rolled back to a savepoint and written to the Error Log, and the transaction
    is left for manual reconciliation. Safaricom never sees a 500.
- **Finance** = Finance Officer; **finance read** = Finance Officer or Auditor. System Manager and College
  Administrator always pass.
- **Owner/staff** = staff, or the student/applicant/sponsor/user who started the request.

## Payment flow

```
initiate_payment ──► M-Pesa Request (Initiated → Pending) ──► customer enters PIN
        stk_callback ──► M-Pesa Transaction (name = M-Pesa receipt) ──► Student Payment (submitted)
                                       └─► Request Completed | Failed | Cancelled (1032) | Timeout (1037/1019)
expire_stale_requests (*/5) ──► STK Query once ──► Completed/Failed/… or Timeout
```

- **Idempotent.**
  - The transaction is named by the M-Pesa receipt, so the same receipt can never be recorded twice.
  - A repeated callback for a Completed or failed request is ignored.
  - A *late* success after a Timeout is still recorded.
- **Amounts.**
  - The amount actually paid (from the callback metadata) is recorded.
  - A difference from the requested amount is flagged in the request's and transaction's `remarks`.
- **Purposes.**
  - `Student Fees` creates a Student Payment, allocated to the chosen invoice first, then FIFO.
  - `Application Fee` creates a Student Payment and calls `admissions.mark_application_fee_paid`.
  - `Giving` calls `church.on_mpesa_success` (B4). `Event Fee` calls `website.mark_event_registration_paid` (B4).
    Neither creates a Student Payment. The transaction becomes `Allocated`, with the record in `remarks`. If the
    owner service fails, it stays `Matched` for staff to reconcile.
  - `Other` creates a Student Payment with `payment_for = Other`.
- **Secrets.** `request_payload` and `response_payload` never contain the passkey, password, token or consumer
  secret.
- **Rate limit.** One STK push per phone number every 30 s (`RateLimitExceededError`, HTTP 429).

M-Pesa Request status: `Initiated → Pending → Completed | Failed | Cancelled | Timeout`.
M-Pesa Transaction status: `Unmatched → Matched → Allocated` (`Reversed` is set manually).

---

## Safaricom callbacks (guest, POST, `?token=`)

| Endpoint | Body | Response |
| --- | --- | --- |
| `mahanaim.api.mpesa.stk_callback` | Daraja `{"Body": {"stkCallback": {…}}}` | `{"ResultCode": 0, "ResultDesc": "Accepted"}` |
| `mahanaim.api.mpesa.c2b_validation` | Daraja C2B validation JSON | `{"ResultCode": "0", "ResultDesc": "Accepted"}`. Rejects only `TransAmount ≤ 0` (`C2B00013`); unknown accounts are accepted, never bounced |
| `mahanaim.api.mpesa.c2b_confirmation` | Daraja C2B confirmation JSON | `{"ResultCode": 0, "ResultDesc": "Accepted"}` |
| `mahanaim.api.finance.paybill_validation` / `paybill_confirmation` | same | Aliases used for C2B RegisterURL, because Daraja rejects URLs containing "mpesa" |

**C2B matching.** `BillRefNumber` is matched after removing `/`, `-`, spaces and dots and ignoring case, with an
optional `account_reference_prefix`. It is tried in order against:
1. Student `student_number` or name.
2. Programme Application name.
3. Student Invoice name.

A matched transaction creates a Student Payment when `auto_allocate` is on. Otherwise, or when nothing matches,
the transaction stays `Matched`/`Unmatched` for `reconcile_transaction`.

## Staff and owner tools

| Endpoint | Method | Guard | Args | Returns |
| --- | --- | --- | --- | --- |
| `mahanaim.api.mpesa.register_c2b_urls` | POST | System Manager / College Administrator | none | `{ok, response, confirmation_url, validation_url}` (token masked) |
| `mahanaim.api.mpesa.query_stk_status` | POST | owner/staff | `request` | `{request, status, result_code, result_desc, http_status}` |
| `mahanaim.api.mpesa.simulate_callback` | POST | owner/staff; developer_mode only | `request` (a `SIM-` request), `success=1` | `{status: "Completed", request, transaction, payment}` or `{status: "Cancelled", request}` |
| `mahanaim.api.mpesa.list_transactions` | GET | finance read | `status?`, `source?` (STK Push \| C2B \| Manual Import \| Pull API), `search?` (receipt, phone, payer, account, student), `from_date?`, `to_date?`, `start`, `page_length` | `{data, total}`; rows: name, trans_id, source, trans_time, amount, msisdn, payer_name, bill_ref_number, business_shortcode, status, request, student, programme_application, payment, remarks |
| `mahanaim.api.mpesa.get_transaction` | GET | finance read | `name` | M-Pesa Transaction dict (includes `raw_payload`) |
| `mahanaim.api.mpesa.reconcile_transaction` | POST | finance | `trans_id`, `student?`, `application?` | `{transaction, payment, status: "Allocated"}`. For a Giving/Event Fee transaction with no student/application, the owner service is retried: `{transaction, payment: null, record, status}` |
| `mahanaim.api.mpesa.list_requests` | GET | finance read | `status?`, `purpose?`, `search?` (name, phone, student, receipt, account), `from_date?`, `to_date?`, `start`, `page_length` | `{data, total}`; rows: name, creation, phone_number, amount, status, purpose, student, programme_application, sponsor, account_reference, checkout_request_id, result_code, result_desc, mpesa_receipt_number, transaction, payment, initiated_by, remarks |
| `mahanaim.api.mpesa.mpesa_settings_status` | GET | finance read | none | See below (secrets masked) |
| `mahanaim.api.mpesa.test_connection` | POST | finance | none | `{ok: true, environment: "Sandbox", message: "Connected to Daraja successfully"}`. On failure: `ok: false` with the error |

Students and applicants poll `mahanaim.api.finance.payment_request_status` (see [finance.md](finance.md)).

**`mpesa_settings_status`**

```json
{"enabled": true, "configured": true, "simulation": false, "environment": "Sandbox",
 "transaction_type": "CustomerPayBillOnline", "business_shortcode": "174379", "till_number": null,
 "account_reference_prefix": "MBC", "callback_base_url": "https://campus.example.ac.ke",
 "stk_callback_url": "https://campus.example.ac.ke/api/method/mahanaim.api.mpesa.stk_callback?token=********a1b2",
 "c2b_confirmation_url": "https://campus.example.ac.ke/api/method/mahanaim.api.finance.paybill_confirmation?token=********a1b2",
 "c2b_validation_url": "https://campus.example.ac.ke/api/method/mahanaim.api.finance.paybill_validation?token=********a1b2",
 "stk_timeout_seconds": 120, "auto_allocate": true, "sms_receipt": true, "email_receipt": true,
 "has_consumer_key": true, "has_consumer_secret": true, "has_passkey": true, "has_callback_token": true}
```

## Contracts (Python, for other domains)

`mahanaim.services.mpesa`:

- **`initiate_payment(phone, amount, purpose, student=None, application=None, sponsor=None, invoice=None,
  initiated_by=None)`** returns `{request, checkout_request_id, customer_message}`.
  - `purpose` is one of `Student Fees`, `Application Fee`, `Event Fee`, `Giving` or `Other`. `Student Fees`
    needs `student`; `Application Fee` needs `application`.
  - The amount is rounded **up** to whole shillings and must be between 1 and 250,000.
  - The phone must be a Kenyan mobile number; it is normalised to `2547…`/`2541…`.
  - The account reference is the student number, the application name, or `<prefix>-<invoice|sponsor|purpose>`.
  - Raises `ValidationError` when the input is invalid or Daraja rejects the push (the request is then marked
    Failed). Raises `RateLimitExceededError` when the phone is rate-limited.
  - Simulation mode (M-Pesa Settings disabled and site `developer_mode` on) returns a fake `SIM-…` checkout id
    without calling Safaricom. Complete it with `simulate_callback`.
- **`expire_stale_requests()`**: scheduler, every 5 minutes. For Initiated/Pending requests older than
  `stk_timeout_seconds` (default 120) + 60 s, it runs one STK Query; if that doesn't resolve them, they become
  `Timeout`.
