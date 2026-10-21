# Credentials API (`mahanaim.api.credentials`)

Transcripts, certificates, document printing (also for finance documents) and public verification.
Calls go to `/api/method/<dotted path>`; GET for reads, POST for writes.

**Guards**
- **Guest**: `verify` only, rate-limited to **10 requests per minute per IP**. Every call, including unknown codes,
  writes a Verification Log entry.
- **Student**: `require_student()`. Only the student's own documents, and only once they are **Issued**.
- **Registrar**: `require_registrar()` = Registrar (System Manager / College Administrator always pass).
- **Registry read**: Registrar, Academic Dean or Auditor.
- **Print**: signed in, and either a staff role for that doctype or the owning student (below).

## Lifecycles

```
Transcript   Draft → Issued → Revoked       (types: Provisional, Official, Final)
Certificate  Draft → Issued → Revoked
```

**Issuing a transcript**
- **Fee clearance.** When `Settings.transcript_requires_fee_clearance` is on, the transcript needs
  `fees.fee_clearance(student, "transcript")`. Otherwise it fails with the clearance message. Only the
  Registrar (or an administrator) may set `override_fee_check=1`.
- **Snapshot.** `results.transcript_data(student, as_of_term, published_only=True)` is stored in `snapshot` (JSON),
  together with `cgpa`, `total_credits` and `classification`. Issuing needs at least one published result.
- **Codes.** The transcript gets a `verification_code` (10 characters, unique), plus `issue_date` and
  `issued_by`. "Transcript Ready" is notified.

**Issuing a certificate**
- **Eligibility.** All of the following must hold:
  - The student's status is Completed or Alumni, or every curriculum credit is earned with a CGPA of at least
    `Programme.min_cgpa_to_graduate`.
  - No core course is failed.
  - Fees are cleared, unless `override_fee_check`.
  - No certificate has been issued before.
- **Award.** `certificate_serial` is `<short name>/<programme code>/<year>/<NNNN>` (for example
  `MBC/DBS/2026/0007`; the short name comes from Mahanaim Settings). There is also a unique `verification_code`.
  `award_title` comes from `Programme.award_title`, and the classification from `grading.classification_for(cgpa)`.
  "Certificate Ready" is notified.

**Revoking.** Issued documents are immutable. Only `status` → Revoked, with a `revoked_reason`, is allowed;
verification then reports `revoked`.

---

## Public verification

### `verify`
- **Path:** `mahanaim.api.credentials.verify`
- **Method:** GET or POST
- **Guard:** guest, 10/min per IP
- **Args:** `code`, `requester_name?`, `requester_organisation?`

The endpoint accepts a transcript or certificate verification code, or the signed code printed on a
receipt, invoice, giving receipt or statement QR. It returns minimal, non-sensitive data. The student number is masked
(`MBC/DBS/2024/****`); there are no grades, balances or contact details. Each call increments
`verification_count` and logs IP, user agent and result in **Verification Log**.

Certificate:

```json
{"message": {"valid": true, "status": "valid", "document_type": "Certificate", "student_name": "Jane Wanjiru Doe",
  "student_number": "MBC/DBS/2024/****", "programme": "Diploma in Biblical Studies", "classification": "Credit",
  "issue_date": "2026-11-20", "institution": "Mahanaim Bible College", "award": "Diploma in Biblical Studies",
  "certificate_serial": "MBC/DBS/2026/0007", "graduation_date": "2026-11-28"}}
```

Transcript: the same base keys plus `"transcript_type": "Official", "award": null`.

Revoked document: `"valid": false, "status": "revoked"`, plus a `message`.

Receipt or invoice: `{valid, status: "valid" | "cancelled", document_type: "Receipt" | "Invoice", document_number,
student_name, student_number (masked), date, amount, currency, institution}`.

Giving receipt: `{valid, status: "valid" | "cancelled", document_type: "Giving Receipt", document_number,
student_name (the giver, or "Anonymous giver"), student_number: null, giving_type, date, amount, currency,
institution}`. It is logged as document type "Receipt".

Statement: `{valid, status, document_type: "Statement", student_name, student_number (masked), date, institution,
message}`. The balance is deliberately left out.

Unknown code:

```json
{"message": {"valid": false, "status": "not_found", "institution": "Mahanaim Bible College"}}
```

The verification page URL printed in QR codes is `verification_url(code)`: `<Settings.verification_base_url or
site>/verify/<code>`. The SPA page calls this endpoint.

| Endpoint | Method | Guard | Args | Returns |
| --- | --- | --- | --- | --- |
| `mahanaim.api.credentials.verification_logs` | GET | registry read | `code?` (case-insensitive partial match), `document_type?`, `result?` (Valid \| Revoked \| Not Found), `start`, `page_length` | `{data: [{name, verification_code, document_type, document_name, result, verified_on, ip_address, requester_name, requester_organisation}], total}` |

## Student

| Endpoint | Method | Args | Returns |
| --- | --- | --- | --- |
| `mahanaim.api.credentials.my_documents` | GET | none | See below |
| `mahanaim.api.credentials.request_transcript` | POST | `type` = Provisional \| Official \| Final, `copies` (1–10), `delivery_method` = Collect \| Email \| Courier, `reason?` | `{name, status: "Pending", document_type, copies, delivery_method}`. Creates a **Student Request** (`request_type` "Transcript Request"). Only one open request per type |

```json
{"transcripts": [{"name": "TR-2026-00003", "transcript_type": "Official", "issue_date": "2026-11-20",
   "as_of_term": null, "cgpa": 3.42, "total_credits": 96, "classification": "Credit",
   "verification_code": "K7Q2M9X4TB", "verification_url": "https://campus.example.ac.ke/verify/K7Q2M9X4TB"}],
 "certificates": [{"name": "CERT-2026-00007", "award_title": "Diploma in Biblical Studies", "certificate_serial": "MBC/DBS/2026/0007",
   "classification": "Credit", "graduation_date": "2026-11-28", "issue_date": "2026-11-20", "verification_code": "P3W8…",
   "verification_url": "…"}],
 "requests": [{"name": "SR-0042", "status": "Pending", "document_type": "Official", "copies": 2,
   "delivery_method": "Collect", "creation": "…", "review_notes": null}]}
```

Students download their issued documents through `print_view` and `download_pdf`.

## Registrar: transcripts

| Endpoint | Method | Guard | Args | Returns |
| --- | --- | --- | --- | --- |
| `mahanaim.api.credentials.list_transcripts` | GET | registry read | `status?`, `student?`, `transcript_type?`, `request?` (Student Request name), `search?` (name, student name, student number), `start`, `page_length` | `{data, total, counts_by_status: {Draft, Issued, Revoked}}` (counts use the same filters except `status`); rows: name, student, student_name, student_number, programme, transcript_type, status, issue_date, as_of_term, cgpa, total_credits, classification, verification_code, issued_by, request, verification_count, override_fee_check, creation |
| `mahanaim.api.credentials.get_transcript` | GET | registry read | `name` | Transcript dict, with `snapshot` parsed into `{terms: [{term, label, courses: [{code, title, credits, total, grade, grade_points, status}], gpa, credits}], cgpa, total_credits, classification}` |
| `mahanaim.api.credentials.generate_transcript` | POST | Registrar | `student`, `type="Official"`, `as_of_term?`, `request?` (Student Request; must be a Transcript/Document Request of the same student) | Draft transcript (snapshot taken) |
| `mahanaim.api.credentials.refresh_transcript` | POST | Registrar | `name` | Re-snapshots a Draft from the current published results |
| `mahanaim.api.credentials.issue_transcript` | POST | Registrar | `name`, `override_fee_check=0` | Issued transcript. Fails with the clearance message when fees aren't cleared. If the transcript has a linked `request` (Transcript/Document Request of the same student) that is still open, the request is moved to Completed in the same transaction (Pending/Under Review requests are first logged as Approved), with a status-log note naming the transcript; request notifications are muted because "Transcript Ready" already notifies the student. Closed requests (Completed/Rejected/Cancelled) are left untouched |
| `mahanaim.api.credentials.revoke_document` | POST | Registrar | `doctype` = Transcript \| Certificate, `name`, `reason` (required) | `{ok: true, doctype, name, status: "Revoked"}` |

## Registrar: certificates

| Endpoint | Method | Guard | Args | Returns |
| --- | --- | --- | --- | --- |
| `mahanaim.api.credentials.eligible_graduates` | GET | registry read | `programme`, `intake?`, `include_ineligible=0` | `{data: [eligibility row], total, eligible}` |
| `mahanaim.api.credentials.certificate_eligibility` | GET | registry read | `student` | Eligibility row |
| `mahanaim.api.credentials.issue_certificates` | POST | Registrar | `students` (JSON list or a single name), `graduation_date?`, `override_fee_check=0` | See below |
| `mahanaim.api.credentials.list_certificates` | GET | registry read | `status?`, `programme?`, `student?`, `search?` (name, student name, serial, student number), `start`, `page_length` | `{data, total, counts_by_status: {Draft, Issued, Revoked}}` (counts use the same filters except `status`); rows: name, student, student_name, student_number, programme, award_title, status, certificate_serial, verification_code, classification, completion_date, graduation_date, cgpa, issue_date, issued_by, verification_count, override_fee_check, creation |
| `mahanaim.api.credentials.get_certificate` | GET | registry read | `name` | Certificate dict |

**Eligibility row**

```json
{"student": "STU-0001", "student_name": "Jane Doe", "student_number": "MBC/DBS/2024/0001", "status": "Completed",
 "intake": "September 2024", "programme": "DBS", "programme_name": "Diploma in Biblical Studies",
 "award_title": "Diploma in Biblical Studies", "cgpa": 3.42, "credits_earned": 96, "classification": "Credit",
 "balance": 0.0, "fee_cleared": true, "failed_core": [], "eligible": true, "reasons": []}
```

`reasons` lists human-readable blockers, for example "Outstanding fee balance of KES 4,000.00" or
"Failed core course(s): BIB101".

**`issue_certificates`**
- Up to 20 students are issued synchronously; more are enqueued on the `long` queue.
- Students who are ineligible or already certified are skipped with a reason, and the batch carries on.

```json
{"queued": false, "issued": [{"student": "STU-0001", "certificate": "CERT-2026-00007", "serial": "MBC/DBS/2026/0007"}],
 "skipped": [{"student": "STU-0002", "reason": "Outstanding fee balance of KES 4,000.00"}],
 "issued_count": 1, "skipped_count": 1}
```
```json
{"queued": true, "count": 140, "job": "…"}
```

## Printing (credentials and finance documents)

| Endpoint | Method | Guard | Args | Returns |
| --- | --- | --- | --- | --- |
| `mahanaim.api.credentials.print_view` | GET | print | `doctype`, `name` | Inline `text/html` print view |
| `mahanaim.api.credentials.download_pdf` | GET | print | `doctype`, `name` | `application/pdf` attachment (A4; the certificate is A4 landscape) |

Supported `doctype` values are Transcript, Certificate, Student Invoice, Student Payment (receipt), Giving
Record (giving receipt) and Fee Statement. For Fee Statement, `name` is the Student.

**Who may print**
- **Staff:** Registrar, Academic Dean and Auditor for credentials; Finance Officer and Auditor for invoices and
  receipts; Finance Officer, Auditor and Registrar for statements; Finance Officer, Chaplain and Auditor for giving
  receipts. Administrators may print anything.
- **Owners:** the student for their own Issued credentials and submitted invoices/receipts. Applicants and
  sponsors may print receipts for their own payments.
- **Sponsors:** submitted invoices and receipts of the students they sponsor (see `finance.download`).
- **Givers:** their own submitted giving receipts (see `finance.download`).
- Anyone else gets 403 ("You are not allowed to view this document.").

**Template contents**
- Every template (`mahanaim/templates/print/*.html`) carries the logo from Mahanaim Settings.
- Each also has a QR code that links to `/verify/<code>`, the signatures and the seal.
- Finance documents use a signed code: the document name + HMAC.
- Documents are self-contained so wkhtmltopdf never makes a network request: inline CSS, system fonts (Libre
  Baskerville is used only if installed, else Georgia / DejaVu Serif), and images embedded as data URIs.
  Settings images on this site's own URL are read from disk. A foreign image URL is fetched once by the server
  (4 s timeout, 2 MB cap) and cached for a day. A failed fetch is cached for 10 minutes and the image is left out.

**PDF settings**
- PDFs are rendered with wkhtmltopdf.
- On builds without patched Qt, content is zoomed by 1.3 to cancel wkhtmltopdf's shrink. Override this with
  `mahanaim_pdf_zoom` in site_config.
