# Admissions API (`mahanaim.api.admissions`)

Calls go to `/api/method/<dotted path>`; GET for reads, POST for writes.

**Guards**
- Applicant endpoints use `require_applicant()`: a signed-in user with the Applicant or Student role (staff
  pass too). Ownership is `Programme Application.user == session user`; anyone else gets `PermissionError` (403)
  with "Application not found.".
- Staff endpoints need **Admissions Officer**, **Registrar** or **Academic Dean** (System Manager and College
  Administrator always pass). Finance Officer may read. Campus User Permissions apply to lists and reads.
- Guests get 401 / `AuthenticationError`.

**Notifications.** Every status change is logged in `status_log` and notifies the applicant. The events are
"Application Submitted", "Application Under Review", "Interview Scheduled", "Application Admitted",
"Application Waitlisted", "Application Rejected", "Offer Accepted", "Application Fee Paid" and "Student Created".
A flagged document (see [`verify_application_document`](#verify_application_document)) sends
"Application Document Flagged". Applicant links point to `/applicant`; student links point to `/student`.

## Status machine

```
Draft → Submitted | Withdrawn
Submitted → Under Review | Withdrawn
Under Review → Interview | Admitted | Waitlisted | Rejected
Interview → Admitted | Waitlisted | Rejected
Waitlisted → Admitted | Rejected
Admitted → Accepted | Declined
```

Fields set along the way:
- `submitted_on`.
- `decision_date`.
- `offer_expiry`: today + `Settings.offer_expiry_days`, unless staff pass one.
- `accepted_on`.

An applicant may have only **one active** application per email + programme + intake. "Active" means any status
other than Withdrawn, Rejected or Declined.

## Application fee (awaiting-fee UX)

`application_fee` comes from `Programme.application_fee`, or else `Settings.application_fee`. It is 0 when
`Settings.application_fee_required` is off.

**If the fee is unpaid at submission**
- The application still becomes **Submitted**. Its payload then has `awaiting_fee: true` and
  `next_action: "pay_fee"`.
- Show a "Pay application fee" call to action. It calls `pay_application_fee`, which starts an M-Pesa STK push and
  sets `fee_status` to `Pending`.
- Staff cannot `start_review` until `fee_status` is **Paid** or **Waived**; they get an error saying the fee is
  outstanding. Staff lists can filter on `awaiting_fee=1` and show `awaiting_fee_count`.

**When payment arrives**
- B3 calls the contract `mahanaim.services.admissions.mark_application_fee_paid(application, payment)`.
- This sets `fee_status=Paid` and `fee_payment`, and notifies "Application Fee Paid". It is idempotent.
- If the applicant paid before submitting a complete draft, the draft is submitted automatically.

`waive_application_fee` marks the fee Waived instead.

**`next_action` values** (drive the applicant dashboard)

| Value | Meaning |
| --- | --- |
| `complete_application` | Draft still being filled in |
| `pay_fee` | Submitted but the fee is outstanding |
| `await_review` | Submitted, fee settled |
| `await_decision` | Under Review or Waitlisted |
| `attend_interview` | Interview scheduled |
| `accept_offer` | Admitted, offer still open |
| `offer_expired` | Admitted, offer past `offer_expiry` |
| `await_student_number` | Accepted, student not yet created |
| `go_to_student_portal` | Accepted and the student record exists |
| `null` | Terminal status |

## Application object

Returned by most applicant endpoints, abbreviated here:

```json
{
  "name": "APP-2026-00012", "status": "Submitted", "full_name": "Jane W Doe", "first_name": "Jane",
  "email": "jane@example.com", "phone": "+254712345678", "programme": "DBS", "programme_name": "Diploma in Biblical Studies",
  "campus": "Main Campus", "study_mode": "Full Time", "intake": "September 2026", "gender": "Female",
  "home_church": "Grace Fellowship", "pastor_name": "Rev. John", "declaration_accepted": 1,
  "application_fee": 1000.0, "fee_status": "Unpaid", "submitted_on": "2026-03-02 10:11:12", "offer_expiry": null,
  "student": null, "student_number": null,
  "academic_records": [{"name": "r1", "institution": "Alliance High", "qualification": "KCSE", "year_completed": "2015", "grade": "B"}],
  "documents": [{"name": "d1", "document_type": "National ID", "file": "/private/files/id.pdf", "verified": 0, "remarks": null,
                 "needs_reupload": false}],
  "documents_total": 3, "documents_verified": 1, "documents_flagged": 0,
  "status_log": [{"timestamp": "2026-03-02 10:11:12", "from_status": "Draft", "to_status": "Submitted"}],
  "awaiting_fee": true, "next_action": "pay_fee", "missing": [], "can_edit": false, "can_withdraw": true,
  "letter_available": false
}
```

Notes:
- `missing` lists the human labels still required before a Draft can be submitted (fields and documents).
- `needs_reupload` is true when staff flagged the document (`verified=0` with `remarks`); show the remark and a
  re-upload button. `documents_flagged` counts those rows.
- The applicant `status_log` lists status changes only. Same-status rows (staff notes such as document checks,
  fee waivers and interview reschedules) are left out because their notes are internal.
- Staff views add `note`/`user` to `status_log` (all rows), plus `reviewer`, `review_notes`, `duplicates`,
  `programme_info`, `fee_payment_info`, `reviewer_name` and `allowed_transitions`.

---

## Public

### `application_options`
- **Path:** `mahanaim.api.admissions.application_options`
- **Method:** GET
- **Guard:** guest

Returns everything the apply form needs: published active programmes with their campuses, study modes and fee;
intakes open now; campuses; study modes; document types; required documents and fields; and fee settings.

```json
{"message": {"programmes": [{"name": "DBS", "code": "DBS", "programme_name": "Diploma in Biblical Studies", "level": "Diploma",
  "duration_years": 2, "application_fee": 1000.0, "minimum_entry": "KCSE C-", "campuses": ["Main Campus"], "study_modes": ["Full Time"]}],
  "intakes": [{"name": "September 2026", "intake_name": "September 2026", "start_date": "2026-09-01", "application_close_date": "2026-08-15"}],
  "campuses": [{"name": "Main Campus", "campus_name": "Main Campus", "code": "MAIN", "town": "Nairobi"}],
  "study_modes": [{"name": "Full Time", "study_mode_name": "Full Time", "code": "FT", "is_online": 0}],
  "document_types": ["National ID", "Passport Photo", "KCSE Certificate", "…"],
  "required_documents": [["National ID"], ["Passport Photo"], ["KCSE Certificate", "Academic Certificate"]],
  "required_fields": ["gender", "date_of_birth", "…"], "application_fee_required": true, "default_application_fee": 1000.0, "currency": "KES"}}
```

## Applicant

All of these use the `require_applicant` guard.

| Endpoint | Method | Args | Returns |
| --- | --- | --- | --- |
| `mahanaim.api.admissions.my_applications` | GET | none | `{data: [row], total}`. Each row has the list fields plus `awaiting_fee` and `next_action` |
| `mahanaim.api.admissions.get_my_application` | GET | `name` | Application object |
| `mahanaim.api.admissions.save_application` | POST | `data` (JSON), `name?` | Application object |
| `mahanaim.api.admissions.upload_application_document` | POST | `name`, `document_type`, `file_url`, `row?` | Application object |
| `mahanaim.api.admissions.remove_application_document` | POST | `name`, `row` (child row name) | Application object |
| `mahanaim.api.admissions.submit_application` | POST | `name`, `declaration_accepted=1` | Application object |
| `mahanaim.api.admissions.pay_application_fee` | POST | `name`, `phone?` | See below |
| `mahanaim.api.admissions.accept_offer` | POST | `name` | Application object |
| `mahanaim.api.admissions.decline_offer` | POST | `name`, `reason?` | Application object |
| `mahanaim.api.admissions.withdraw_application` | POST | `name`, `reason?` | Application object |
| `mahanaim.api.admissions.admission_letter` | GET | `name`, `format=html\|pdf` | See below |

**`save_application`**
- Without `name` it creates a Draft. Email, names and phone default from the user account.
- With `name` it updates the Draft. Any status other than Draft is rejected.
- Only applicant fields are accepted; anything else (status, fee, reviewer…) is ignored. The accepted fields are
  personal, next-of-kin, church/pastor, ministry, programme/campus/study_mode/intake, sponsorship and
  `declaration_accepted`.
- `academic_records`: `[{institution, qualification, year_completed, grade}]` replaces all rows.
- `documents`: `[{name?, document_type, file}]` replaces all rows. Each `file` must be the applicant's own
  upload; verified rows are kept unchanged.
- `photo` and every `documents[].file` follow the [file rules](#file-values) below. A valid `photo` upload is
  attached to the application (`attached_to_field=photo`). Send `""` or `null` to clear the photo.

<a id="file-values"></a>**File values (photo, documents, upload_application_document)**
- Allowed: empty, or a site path that starts with `/files/` or `/private/files/` and whose File record is
  already attached to this application or was uploaded by you (via `/api/method/upload_file`). Surrounding
  spaces are trimmed.
- External URLs (`https://…`, `//…`), `javascript:`/`data:` values, `/api/method/…` links and paths that
  contain `..` or a backslash fail with `ValidationError` (title "Invalid file"):
  "Photo must be a file uploaded through the portal, not a link." (or "The National ID document must be…").
- Another user's file fails with `PermissionError`: "You can only attach files you uploaded."
- A path with no File record fails with "The uploaded file was not found. Please upload it again."
- An unchanged `photo` value can be sent back as-is.

**`upload_application_document`**
1. Upload first with `POST /api/method/upload_file` (`is_private=1`, no doctype).
2. Pass the returned `file_url` here. The File must belong to you (see [file rules](#file-values)), and it is
   then attached to the application.
- Single-instance types (for example National ID) replace the existing row unless it is verified.
- Optional `row`: replace that document row instead (it must have the same `document_type` and must not be
  verified). Use it to re-upload a flagged multi-instance document (Academic Certificate, Recommendation Letter,
  Other); without `row` those types add a new row.
- Replacing a row clears its `remarks`, so `needs_reupload` becomes false. After submission, staff also get a
  "… re-uploaded by the applicant" note in `status_log`.
- Allowed while the application is Draft, Submitted, Under Review or Interview.

**`submit_application`** fails with a list of missing items if the draft is incomplete or the intake is closed.

**`pay_application_fee`**
- Calls `mahanaim.services.mpesa.initiate_payment(phone, amount, "Application Fee", application=name)` and sets
  `fee_status=Pending`.
- If online payment isn't available, it fails with "Online payment is not available yet…".

```json
{"message": {"ok": true, "request": "MPESA-REQ-0001", "checkout_request_id": "ws_CO_…",
  "customer_message": "Check your phone and enter your M-Pesa PIN.", "application": "APP-2026-00012", "fee_status": "Pending"}}
```

**`accept_offer`** moves the application to Accepted. When `Settings.auto_create_student_on_acceptance` is on, the
Student is created immediately, so `student` and `student_number` are filled and `next_action` is
`go_to_student_portal`.

**`admission_letter`**
- Only available when the application is Admitted or Accepted.
- HTML format returns `{html, name}`. The `pdf` format streams `Admission-Letter-<name>.pdf`, so link to it
  directly: `/api/method/mahanaim.api.admissions.admission_letter?name=…&format=pdf`.
- Staff with a staff role, or Finance Officer, may also download it.
- The HTML is responsive: it includes a viewport meta tag and screen-only (`@media screen`) rules that stack the
  header, details and signature tables below 480px. The PDF uses print media, so it is unaffected.

## Staff

These endpoints need **Admissions Officer, Registrar or Academic Dean**. Finance Officer may use the read
endpoints marked "+ Finance".

### `list_applications`
- **Path:** `mahanaim.api.admissions.list_applications`
- **Method:** GET
- **Guard:** staff + Finance

Args:
- Filters: `status`, `programme`, `campus`, `intake`, `study_mode`, `awaiting_fee` (1), `from_date`, `to_date`.
  A filter value may also be a JSON list.
- `search`: matched against name, full_name, email, phone and national_id.
- `start`, `page_length` (default 20).
- `order_by`: one of `creation desc|asc`, `submitted_on desc`, `full_name asc` or `modified desc`.

The status counts ignore the `status` filter so you can build tabs from them. Each row also carries
`documents_total`, `documents_verified` and `documents_flagged` (one extra query per page). `my_applications`
rows carry the same counts.

```json
{"message": {"data": [{"name": "APP-2026-00012", "full_name": "Jane W Doe", "email": "jane@example.com", "programme": "DBS",
  "programme_name": "Diploma in Biblical Studies", "campus": "Main Campus", "intake": "September 2026", "status": "Submitted",
  "fee_status": "Unpaid", "application_fee": 1000.0, "submitted_on": "2026-03-02 10:11:12", "awaiting_fee": true,
  "documents_total": 3, "documents_verified": 2, "documents_flagged": 1, "…": "…"}],
  "total": 37, "counts_by_status": {"Draft": 9, "Submitted": 14, "Under Review": 6, "Admitted": 8}, "awaiting_fee_count": 5}}
```

### `get_application`
- **Path:** `mahanaim.api.admissions.get_application`
- **Method:** GET
- **Guard:** staff + Finance

Args: `name`. Returns the staff Application object, including:

```json
{"duplicates": [{"doctype": "Programme Application", "name": "APP-2025-00102", "full_name": "Jane Doe", "programme_name": "…",
                 "intake": "…", "status": "Rejected", "email": "jane@example.com", "phone": "+254712345678",
                 "national_id": "12345678", "creation": "…", "match": ["email", "national_id"]},
                {"doctype": "Student", "name": "STU-0007", "student_number": "MBC/CERT/2023/0004", "full_name": "Jane Doe",
                 "status": "Alumni", "…": "…", "match": ["phone"]}],
 "programme_info": {"programme_name": "…", "code": "DBS", "level": "Diploma", "minimum_entry": "…"},
 "fee_payment_info": null, "reviewer_name": "Mary Officer", "allowed_transitions": ["Interview", "Admitted", "Waitlisted", "Rejected"]}
```

### `start_review`
- **Path:** `mahanaim.api.admissions.start_review`
- **Method:** POST
- **Guard:** staff

Args: `name`, `notes?`. Moves Submitted → Under Review and sets you as the reviewer. Blocked while the
application is awaiting its fee.

### `schedule_interview`
- **Path:** `mahanaim.api.admissions.schedule_interview`
- **Method:** POST
- **Guard:** staff

Args: `name`, `interview_date` (a future datetime), `notes?`. Moves the application to Interview, or reschedules
one already in Interview. Notifies "Interview Scheduled".

### `decide`
- **Path:** `mahanaim.api.admissions.decide`
- **Method:** POST
- **Guard:** staff

Args:
- `name`
- `decision`: one of Admitted, Waitlisted or Rejected
- `notes?`
- `rejection_reason?`
- `offer_expiry?`: a date; only used when the decision is Admitted.

Returns the staff Application object.

### `bulk_decide`
- **Path:** `mahanaim.api.admissions.bulk_decide`
- **Method:** POST
- **Guard:** staff

Args: `names` (JSON list, at most 200), `decision`, `notes?`, `rejection_reason?`. Each application is decided in
its own savepoint, so one failure does not undo the others. `error` is plain text; when a failure carries several
messages they are separated by `\n` (render with `white-space: pre-line`).

```json
{"message": {"ok": false, "updated": ["APP-2026-00012"], "failed": [{"name": "APP-2026-00013", "error": "Application APP-2026-00013 is Draft and cannot be moved to Admitted."}]}}
```

### `waive_application_fee`
- **Path:** `mahanaim.api.admissions.waive_application_fee`
- **Method:** POST
- **Guard:** Admissions Officer, Registrar, Finance Officer

Args: `name`, `reason` (required). Sets `fee_status=Waived` and records the reason in `status_log`.

### `verify_application_document`
- **Path:** `mahanaim.api.admissions.verify_application_document`
- **Method:** POST
- **Guard:** Admissions Officer, Registrar (plus System Manager / College Administrator); also needs write
  permission on the application, so campus User Permissions apply.

Args:
- `name`: the application.
- `row`: the document row `name` (from `documents[].name`).
- `verified`: `1`/`0` (`true`/`false` also accepted).
- `remarks?`: at most 140 characters.

Effects:

| `verified` | `remarks` | Meaning | Applicant notified |
| --- | --- | --- | --- |
| 1 | optional | Verified (the remark is an internal note, e.g. "certified copy") | no |
| 0 | empty | Verification cleared (unverify) | no |
| 0 | set | Flagged: needs re-upload (`needs_reupload: true`) | yes, "Application Document Flagged" |

- Only allowed while the application is Submitted, Under Review or Interview; otherwise it fails with
  "Documents can only be verified while the application is Submitted, Under Review or at Interview."
- `verified=1` needs an uploaded file.
- Each change adds a same-status `status_log` row with a note: "National ID verified", "Passport Photo needs
  re-upload: Blurry scan" or "National ID verification cleared".
- Repeating the same values is a no-op: no log row and no second notification.
- The notification uses the Message Template for event **Application Document Flagged** when one is active.
  Its context adds `document_type`, `remarks` and `application`. Otherwise it falls back to "Please re-upload your
  {document_type}: {remarks}" (email + in-app, link `/applicant`).
- Unknown `row`: `DoesNotExistError`. Other roles, including Academic Dean and Finance Officer: `PermissionError`.

Returns the full staff Application object (the same shape as `get_application`), including the
`documents_total`/`documents_verified`/`documents_flagged` counts.

```json
{"message": {"name": "APP-2026-00012", "status": "Under Review",
  "documents": [{"name": "d1", "document_type": "National ID", "file": "/private/files/id.pdf", "verified": 1, "remarks": null, "needs_reupload": false},
                {"name": "d2", "document_type": "Passport Photo", "file": "/private/files/p.jpg", "verified": 0, "remarks": "Blurry scan", "needs_reupload": true}],
  "documents_total": 2, "documents_verified": 1, "documents_flagged": 1,
  "status_log": [{"timestamp": "…", "from_status": "Under Review", "to_status": "Under Review",
                  "note": "Passport Photo needs re-upload: Blurry scan", "user": "officer@example.com", "name": "…"}],
  "duplicates": [], "allowed_transitions": ["Interview", "Admitted", "Waitlisted", "Rejected"], "…": "…"}}
```

### `convert_to_student`
- **Path:** `mahanaim.api.admissions.convert_to_student`
- **Method:** POST
- **Guard:** Admissions Officer, Registrar

Args: `name`. The application must be Admitted or Accepted. This call is idempotent.

```json
{"message": {"ok": true, "student": "STU-2026-00031", "student_number": "MBC/DBS/2026/0001", "application": "APP-2026-00012"}}
```

### `admissions_stats`
- **Path:** `mahanaim.api.admissions.admissions_stats`
- **Method:** GET
- **Guard:** staff + Finance

Args: `intake?`.

```json
{"message": {"total": 120, "by_status": {"Draft": 20, "Submitted": 30, "Admitted": 40, "Accepted": 30},
  "funnel": [{"stage": "Started", "count": 120}, {"stage": "Submitted", "count": 100}, {"stage": "Decided", "count": 70},
             {"stage": "Admitted", "count": 70}, {"stage": "Accepted", "count": 30}],
  "conversion": {"submission_rate": 83.3, "admission_rate": 100.0, "acceptance_rate": 42.9},
  "by_programme": [{"programme": "DBS", "programme_name": "Diploma in Biblical Studies", "count": 64}],
  "by_campus": [{"campus": "Main Campus", "count": 90}], "by_fee_status": {"Paid": 80, "Unpaid": 40},
  "by_day": [{"date": "2026-02-01", "count": 3}, "… 30 entries …"], "intake": null}}
```

## Contracts implemented in `mahanaim.services`

| Function | Called by | Effect |
| --- | --- | --- |
| `admissions.mark_application_fee_paid(application, payment=None)` | B3 (M-Pesa / payments) | Sets `fee_status` Paid and `fee_payment`, notifies the applicant, and auto-submits a complete draft. Idempotent |
| `students.create_student_from_application(application)` | Acceptance hook, `convert_to_student` | Returns the Student name. Idempotent |

`create_student_from_application` copies the personal, next-of-kin and church fields, plus programme, campus,
study_mode and intake. It sets the status to Admitted and reuses the applicant's user, adding the Student role
while keeping Applicant. The student number comes from `next_student_number` (`MBC/<CODE>/<YEAR>/0001`). It then
sets `application.student` and notifies "Student Created".
