# Finance API (`mahanaim.api.finance`)

Calls go to `/api/method/<dotted path>`; GET for reads, POST for writes (POST-only endpoints are marked).
All money values are rounded to 2 dp (`flt(x, 2)`); currency is `Mahanaim Settings.currency` (default KES).

**Guards**
- **Student**: `require_student()`. Only the signed-in student's own records are returned.
- **Applicant**: `require_applicant()` + ownership through `Programme Application.user`.
- **Finance**: `require_finance()` = **Finance Officer** (System Manager / College Administrator always pass).
- **Finance read**: `require_finance_read()` = Finance Officer or **Auditor** (read-only).
- **Owner/staff**: signed in, and either staff or the student/applicant/sponsor/initiator of the record.
- Guests get 401 (`AuthenticationError`); wrong roles get 403 (`PermissionError`).

**Ledger model.** Every submitted Student Invoice / Fee Adjustment (debit types) posts a **debit**, every
Student Payment / credit-type Fee Adjustment posts a **credit** to `Student Ledger Entry`. Balance =
Σ(debit − credit) over non-cancelled entries; a negative balance is a credit in the student's favour. Cancelling
a document flags its entries `is_cancelled` and reverses invoice paid/outstanding amounts. `Student.fee_balance`
is refreshed after every posting.

Invoice status: `Draft → Unpaid | Partly Paid | Paid | Overdue → Cancelled`. Payment status:
`Draft → Confirmed → Cancelled`. Refund status: `Pending → Approved | Rejected`, `Approved → Paid`.

## Shared objects

**Clearance** (`fees.fee_clearance(student, purpose)`; purposes `exam`, `lms`, `transcript`, `certificate`,
`registration`):

```json
{"cleared": false, "balance": 12000.0, "paid_percent": 40.0, "required_percent": 60.0, "purpose": "exam",
 "sponsored": false,
 "message": "Fee clearance for exams requires 60% of fees to be paid; you have paid 40%. Outstanding balance: KES 12,000.00"}
```

**Statement** (`my_statement`, `student_statement`):

```json
{"student": "STU-0001", "from_date": "2026-01-01", "to_date": null, "opening_balance": 0.0,
 "total_debit": 30000.0, "total_credit": 18000.0, "closing_balance": 12000.0,
 "lines": [{"date": "2026-01-10", "voucher_type": "Student Invoice", "voucher_no": "INV-2026-00004",
   "description": "Invoice", "academic_term": "2025/2026 Term 2", "debit": 30000.0, "credit": 0.0, "balance": 30000.0}]}
```

**List envelope** (every `list_*`): `{"data": [row, …], "total": 42}`; paging with `start` and `page_length`
(max 200 unless noted).

---

## Student

| Endpoint | Method | Args | Returns |
| --- | --- | --- | --- |
| `mahanaim.api.finance.my_fees` | GET | none | Account summary (below) |
| `mahanaim.api.finance.my_statement` | GET | `from_date?`, `to_date?` | Statement |
| `mahanaim.api.finance.pay_fees` | POST | `amount`, `phone?` (defaults to the student's phone), `invoice?` (must be theirs) | `{request, checkout_request_id, customer_message}` |
| `mahanaim.api.finance.payment_request_status` | GET | `request` | Request status (below). Guard: owner/staff |
| `mahanaim.api.finance.download` | GET | `doctype` = `invoice` \| `receipt` \| `statement`, `name` (not needed for the own statement), `format` = `pdf` \| `html`, `from_date?`, `to_date?` | PDF / HTML file. Guard: owner/staff |
| `mahanaim.api.finance.request_refund` | POST | `amount`, `reason`, `refund_mode` = M-Pesa \| Bank Transfer \| Cheque \| Cash, `account_details?` | Refund Request dict (status Pending). See the rules below |
| `mahanaim.api.finance.my_refunds` | GET | none | The student's own refund requests, newest first (rows below) |

**`request_refund` rules.** Each rule failure raises `ValidationError` with a student-friendly message.

- The amount must be greater than zero.
- The amount must be no more than the refundable credit: the credit balance (`-get_student_balance`) less
  any open refund requests.
- A student can have only one open (Pending or Approved) request at a time; a new one is rejected until the
  open one is decided.
- Concurrent requests are serialised with a lock on the student row.
- The Refund Request controller enforces the same credit check for staff-created requests.

**`my_refunds` row:**

```json
{"name": "RFD-2026-00003", "amount": 2000.0, "status": "Paid", "reason": "Overpaid", "refund_mode": "M-Pesa",
 "creation": "2026-10-20 09:12:44", "decided_on": "2026-10-20 15:01:02", "paid_on": "2026-10-21",
 "reference_no": "SJK81HQ2PA"}
```

- `decided_on` is the approval or rejection time.
- `reference_no` is the payout reference and appears only when the status is Paid.
- Staff remarks are not included.

**`my_fees`**

```json
{"student": {"name": "STU-0001", "full_name": "Jane Doe", "student_number": "MBC/DBS/2026/0001", "programme": "DBS",
   "programme_name": "Diploma in Biblical Studies", "phone": "254712345678"},
 "balance": 12000.0, "total_billed": 30000.0, "total_paid": 18000.0, "currency": "KES",
 "clearance": {"exam": {"cleared": true, "…": "…"}, "lms": {"cleared": true, "…": "…"}},
 "invoices": [{"name": "INV-2026-00004", "academic_term": "2025/2026 Term 2", "posting_date": "2026-01-10",
   "due_date": "2026-02-09", "status": "Partly Paid", "total_amount": 30000.0, "paid_amount": 18000.0,
   "credit_applied": 0.0, "outstanding_amount": 12000.0, "fee_structure": "DBS FT T2",
   "items": [{"fee_component": "Tuition", "description": null, "amount": 25000.0}],
   "installments": [{"label": "Second half", "due_date": "2026-03-01", "amount": 15000.0, "paid_amount": 3000.0, "status": "Partly Paid"}]}],
 "payments": [{"name": "PAY-2026-00011", "posting_date": "2026-01-12", "mode_of_payment": "M-Pesa", "amount": 18000.0,
   "allocated_amount": 18000.0, "unallocated_amount": 0.0, "reference_no": "SAB12CD34E", "status": "Confirmed",
   "allocations": [{"invoice": "INV-2026-00004", "academic_term": "2025/2026 Term 2", "allocated_amount": 18000.0}]}],
 "installments": [{"invoice": "INV-2026-00004", "label": "Second half", "due_date": "2026-03-01", "amount": 15000.0, "paid_amount": 3000.0, "status": "Partly Paid"}],
 "pending_requests": [{"name": "MPR-2026-00031", "amount": 5000.0, "phone_number": "254712345678", "status": "Pending", "creation": "…", "checkout_request_id": "ws_CO_…"}],
 "refunds": [{"name": "RFD-2026-00003", "amount": 2000.0, "status": "Pending", "…": "…"}],
 "refund_available": 0.0,
 "mpesa": {"enabled": true, "simulation": false, "paybill": "174379", "till": null, "account": "MBC/DBS/2026/0001"}}
```

- `refunds` holds the latest 10 refund requests, in the `my_refunds` row shape.
- `refund_available` is the credit that can still be requested: credit less open requests, never negative.

**`payment_request_status`** (poll every 3–5 s after `pay_fees` until `done`):

```json
{"name": "MPR-2026-00031", "status": "Completed", "amount": 5000.0, "phone_number": "254712345678",
 "purpose": "Student Fees", "student": "STU-0001", "programme_application": null, "result_code": "0",
 "result_desc": "The service request is processed successfully.", "mpesa_receipt_number": "SAB12CD34E",
 "payment": "PAY-2026-00012", "creation": "…", "remarks": null, "done": true}
```

## Applicant

| Endpoint | Method | Args | Returns |
| --- | --- | --- | --- |
| `mahanaim.api.finance.application_fee_status` | GET | `application` | See below. Other users' applications → `DoesNotExistError` |

```json
{"application": "APP-2026-00012", "programme_name": "Diploma in Biblical Studies", "application_fee": 1000.0,
 "required": true, "fee_status": "Paid", "paid": true,
 "payment": {"name": "PAY-2026-00009", "amount": 1000.0, "posting_date": "2026-03-02", "mode_of_payment": "M-Pesa",
   "reference_no": "SAB12CD34F", "status": "Confirmed", "docstatus": 1},
 "pending_requests": [], "phone": "+254712345678",
 "mpesa": {"enabled": true, "simulation": false, "paybill": "174379", "account": "APP-2026-00012"}}
```

The fee itself is paid through `mahanaim.api.admissions.pay_application_fee` (B1), which calls
`mahanaim.services.mpesa.initiate_payment(purpose="Application Fee")`.

## Finance office

### Dashboard

`mahanaim.api.finance.finance_dashboard`: GET, finance read, no args.

```json
{"currency": "KES", "collected": {"today": 15000.0, "week": 82000.0, "month": 410000.0},
 "term": {"academic_term": "2025/2026 Term 2", "billed": 1200000.0, "collected": 800000.0, "outstanding": 400000.0, "collection_rate": 66.67},
 "total_outstanding": 455000.0, "total_credit": 12000.0, "students_owing": 37,
 "aging": [{"bucket": "0-30", "amount": 300000.0, "invoices": 30, "students": 28}, {"bucket": "31-60", "…": "…"},
   {"bucket": "61-90", "…": "…"}, {"bucket": "90+", "…": "…"}],
 "collections_by_mode": [{"mode": "M-Pesa", "amount": 350000.0, "count": 61}],
 "top_programmes": [{"programme": "DBS", "programme_name": "Diploma in Biblical Studies", "outstanding": 250000.0, "students": 20}],
 "unmatched_mpesa": 2, "matched_unallocated_mpesa": 1, "pending_refunds": 1, "overdue_invoices": 9,
 "trend": [{"month": "2025-03", "billed": 0.0, "collected": 12000.0}, "… 12 months, oldest first"]}
```

Aging is by days past `due_date` (or `posting_date`); not-yet-due balances count as 0-30. Every figure is a
single SQL aggregate, so there are no per-student queries.

### Invoices

| Endpoint | Method | Guard | Args | Returns |
| --- | --- | --- | --- | --- |
| `mahanaim.api.finance.list_invoices` | GET | finance read | `filters?` (JSON on list fields), `status?`, `student?`, `academic_term?`, `programme?`, `campus?`, `search?` (name / student / student name), `from_date?`, `to_date?`, `start`, `page_length` | List envelope; rows: name, student, student_name, programme, campus, academic_term, posting_date, due_date, status, total_amount, paid_amount, credit_applied, outstanding_amount, fee_structure, docstatus. Cancelled are hidden unless `status=Cancelled` |
| `mahanaim.api.finance.get_invoice` | GET | finance read | `name` | Invoice detail: the full doc (items, installments) + `student_number`, `payments` (allocations to this invoice), `adjustments`, `balance` |
| `mahanaim.api.finance.create_invoice` | POST | finance | `data` = `{student, fee_structure?, academic_term?, posting_date?, due_date?, remarks?, items?: [{fee_component, description?, amount}], submit?: 1}` | Invoice detail. With a `fee_structure` and no items, items come from the structure |
| `mahanaim.api.finance.submit_invoice` | POST | finance | `name` | Invoice detail |
| `mahanaim.api.finance.cancel_invoice` | POST | finance | `name`, `reason?` | Invoice detail. Fails while submitted payments/adjustments are allocated to it |
| `mahanaim.api.finance.bulk_invoice` | POST | finance | `term`, `programme?`, `campus?`, `study_mode?` | See below |

**`bulk_invoice`** invoices every Registered/Active student matching the filters who has no fee-structure invoice
for `term` yet (idempotent per student + term). Up to 50 students run synchronously; more are enqueued on the
`long` queue and the summary is sent to the user when the job ends.

```json
{"queued": false, "term": "2025/2026 Term 2", "created": ["INV-2026-00040", "INV-2026-00041"], "skipped_existing": 3,
 "no_structure": ["STU-0107"], "errors": [{"student": "STU-0110", "error": "…"}]}
```
```json
{"queued": true, "term": "2025/2026 Term 2", "count": 240}
```

### Payments

| Endpoint | Method | Guard | Args | Returns |
| --- | --- | --- | --- | --- |
| `mahanaim.api.finance.list_payments` | GET | finance read | `filters?`, `student?`, `mode_of_payment?`, `payment_for?`, `status?`, `search?`, `from_date?`, `to_date?`, `start`, `page_length` | List envelope; rows: name, student, payer_name, programme_application, sponsor, payment_for, posting_date, mode_of_payment, amount, allocated_amount, unallocated_amount, reference_no, status, docstatus, mpesa_transaction |
| `mahanaim.api.finance.get_payment` | GET | finance read | `name` | Full payment doc (allocations) + `student_number`, `balance`, `receipt_url` (submitted only) |
| `mahanaim.api.finance.record_payment` | POST | finance | `data` = `{student \| programme_application, payment_for?: "Student Fees", mode_of_payment, amount, reference_no?, reference_date?, posting_date?, payer_name?, sponsor?, msisdn?, remarks?, allocations?: [{invoice, allocated_amount}]}` | Payment detail (submitted, status Confirmed) |
| `mahanaim.api.finance.cancel_payment` | POST | finance | `name`, `reason` (required) | Payment detail (Cancelled) |

`record_payment` rules:
- `amount > 0`.
- `reference_no` must be unique per mode of payment, so the same bank slip or M-Pesa code cannot be entered twice.
- With no `allocations`, the amount is allocated FIFO to the oldest outstanding invoices. Any surplus stays as
  `unallocated_amount` (credit) and is applied automatically to the student's next invoice.
- An allocation may not exceed the invoice's outstanding amount, and allocations may not exceed the payment.

On submit:
- The ledger is credited and invoices are updated.
- For an Application Fee, `admissions.mark_application_fee_paid` is called.
- "Payment Received" is notified.

Cancelling reverses everything.

### Statements and accounts

| Endpoint | Method | Guard | Args | Returns |
| --- | --- | --- | --- | --- |
| `mahanaim.api.finance.student_statement` | GET | finance read | `student`, `from_date?`, `to_date?` | Statement |
| `mahanaim.api.finance.student_account` | GET | finance read | `student` | Same shape as `my_fees` |

### Adjustments and refunds

| Endpoint | Method | Guard | Args | Returns |
| --- | --- | --- | --- | --- |
| `mahanaim.api.finance.list_adjustments` | GET | finance read | `student?`, `adjustment_type?`, `docstatus?`, `from_date?`, `to_date?`, `start`, `page_length` | List envelope |
| `mahanaim.api.finance.save_adjustment` | POST | finance | `data` = `{name?, student, adjustment_type, amount, posting_date?, invoice?, academic_term?, scholarship?, sponsor?, reason}` | Fee Adjustment dict (Draft; only drafts are editable) |
| `mahanaim.api.finance.submit_adjustment` | POST | finance | `name` | Fee Adjustment dict |
| `mahanaim.api.finance.cancel_adjustment` | POST | finance | `name`, `reason?` | Fee Adjustment dict |
| `mahanaim.api.finance.list_refunds` | GET | finance read | `status?`, `student?`, `start`, `page_length` | List envelope |
| `mahanaim.api.finance.save_refund` | POST | finance | `data` = `{name?, student, amount, reason, refund_mode, account_details?}` | Refund Request dict (Pending only) |
| `mahanaim.api.finance.decide_refund` | POST | finance | `name`, `decision` = Approved \| Rejected \| Paid, `remarks?`, `reference_no?`, `paid_on?` | Refund Request dict. Paid posts a ledger debit |

Adjustment types:
- **Credit types:** Scholarship, Bursary, Waiver, Discount, Sponsor Credit, Write-off, Correction Credit. These
  credit the ledger and reduce `invoice` when one is given.
- **Debit types:** Penalty, Correction Debit. These debit the ledger.

### Fee structures and masters

The read endpoints below also allow the Registrar and the Admissions Officer.

| Endpoint | Method | Guard | Args | Returns |
| --- | --- | --- | --- | --- |
| `mahanaim.api.finance.list_fee_structures` | GET | finance read + Registrar/Admissions | `programme?`, `academic_term?`, `academic_year?`, `is_active?`, `search?`, `start`, `page_length` (50) | List envelope |
| `mahanaim.api.finance.get_fee_structure` | GET | same | `name` | Fee Structure dict (items, installments) |
| `mahanaim.api.finance.save_fee_structure` | POST | finance | `data` = `{name?, structure_name, programme?, campus?, study_mode?, academic_year?, academic_term?, year_of_study?, fee_category?, is_active, allow_installments, items: [{fee_component, description?, amount, is_mandatory}], installments?: [{label, percent?, amount?, due_date?, due_days?}]}` | Fee Structure dict |
| `mahanaim.api.finance.list_fee_components` | GET | same as list | `include_inactive?` | `{data, total}` |
| `mahanaim.api.finance.save_fee_component` | POST | finance | `data` = `{name?, component_name, code?, component_type, default_amount?, is_refundable?, is_active?, description?, income_account?}` | Fee Component dict |
| `mahanaim.api.finance.list_scholarships` | GET | same as list | `is_active?`, `start`, `page_length` | List envelope |
| `mahanaim.api.finance.save_scholarship` | POST | finance | `data` = Scholarship fields (`amount_type` Fixed Amount needs `amount`; Percentage needs `percentage` 0–100) | Scholarship dict |

**Structure matching.** Empty applicability fields are wildcards. `find_fee_structure(student, term)` returns
the active structure that matches on the most non-empty fields. A component may appear only once. Installments
must add up to the total.

### Reports and reminders

| Endpoint | Method | Guard | Args | Returns |
| --- | --- | --- | --- | --- |
| `mahanaim.api.finance.defaulters` | GET | finance read | `threshold=0`, `programme?`, `campus?`, `overdue_only=0`, `start`, `page_length` (≤ 1000) | `{data: [{student, student_number, full_name, programme, programme_name, campus, phone, email, status, balance, oldest_due, days_overdue, last_payment}], total, total_balance}` |
| `mahanaim.api.finance.send_reminders` | POST | finance | `students?` (JSON list) | `{ok: true, sent: 12}`. Without `students` this is the daily run, throttled to one reminder per `overdue_reminder_days` per student. With a list, it is forced |
| `mahanaim.api.finance.collections_report` | GET | finance read | `from_date?` (default: first of month), `to_date?` (today), `group_by` = day \| month \| mode \| programme \| payment_for | `{from_date, to_date, group_by, data: [{key, amount, count}], total, count}` |
| `mahanaim.api.finance.aging_report` | GET | finance read | `programme?`, `campus?`, `start`, `page_length` (≤ 1000) | `{summary: [aging buckets], data: [{student, student_name, student_number, programme, b0_30, b31_60, b61_90, b90, total}], total}` |

### M-Pesa C2B aliases (guest)

| Endpoint | Method | Guard |
| --- | --- | --- |
| `mahanaim.api.finance.paybill_validation` | POST | `?token=` |
| `mahanaim.api.finance.paybill_confirmation` | POST | `?token=` |

These are identical to `mahanaim.api.mpesa.c2b_validation` / `c2b_confirmation`. They exist because Daraja's
RegisterURL rejects URLs that contain the word "mpesa". See [mpesa.md](mpesa.md).

## Contracts (Python, for other domains)

`mahanaim.services.fees`:
- **`create_invoice_for_registration(registration) -> str | None`**
  - Idempotent: it returns the existing `fee_invoice` if there is one.
  - Otherwise it matches a fee structure, then creates and submits the invoice. `due_date` is
    `posting_date + payment_terms_days`, and `registration.fee_invoice` is set.
  - Returns None when no structure matches.
- **`get_student_balance(student) -> float`**: positive means the student owes; negative means credit.
- **`fee_clearance(student, purpose) -> dict`**: the Clearance object above.
  - `required_percent` comes from settings: `exam_fee_clearance_percent` for exam and
    `lms_fee_clearance_percent` for lms.
  - It is 100 for transcript (when `transcript_requires_fee_clearance` is set) and for certificate.
  - It is 100 for registration when a previous-term balance exists, otherwise 0.
  - An active Full Fees sponsorship always clears.
- **`mark_overdue_invoices()`** and **`send_fee_reminders()`**: daily scheduler jobs.
