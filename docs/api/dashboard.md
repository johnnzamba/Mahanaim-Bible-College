# Admin Dashboard & Reporting API (`mahanaim.api.dashboard`)

Calls go to `/api/method/<dotted path>`. Reads use GET and writes use POST. JSON arguments (`data`, `rows`, `names`,
`filters`, `recipients`, `students`) may be sent as objects/lists or as JSON strings. Responses are wrapped in
`{"message": ...}`. A missing record raises `DoesNotExistError` (404), a failed guard raises `PermissionError` (403)
and validation failures raise `ValidationError` (417) with a translated message. Examples were captured from the
demo dataset (`docs/DEMO.md`); long lists are trimmed.

Covers SOW 6.18 / M16 and the M20 campus comparison. Aggregates use grouped SQL (no per-row queries).

**Guards**
- **guest**: `allow_guest=True`. Anyone, including anonymous visitors.
- **guest · rate-limited**: as guest, plus a per-IP `rate_limit` (HTTP 429 when exceeded). Public forms also carry a
  honeypot argument `website` that must stay empty; when filled, the call quietly returns `{"ok": true}` and saves nothing.
- **login**: any signed-in user (`require_login`).
- **staff**: any staff role (`require_staff`).
- **roles: …**: `require_roles(...)`. System Manager, College Administrator and Administrator always pass.

**Section and report gating** (admins see everything)
- Overview sections:
  - admissions: Admissions Officer, Registrar, Academic Dean
  - students: Registrar, Academic Dean, Admissions Officer, Finance Officer
  - staff and academics: Registrar, Academic Dean
  - finance: Finance Officer, Auditor
  - communications: Communications Officer, Admissions Officer
  - library: Library Officer
  - church: Chaplain, Finance Officer
- Reports by category:
  - Finance (fee_collections, outstanding_balances, aging, payment_reconciliation): Finance Officer, Auditor
  - Academic (student_list, results_summary, pass_rates_by_course, attendance_summary, lms_engagement,
    lecturer_workload): Academic Dean, Registrar. `enrolment_by_programme` also allows the Admissions Officer.
  - credentials_issued (category Academic): Registrar, Academic Dean, Auditor (the same roles that can read
    credentials)
  - Admissions (admissions_funnel, applications_list): Admissions Officer, Registrar, Academic Dean
  - library_loans: Library Officer, Auditor
  - sponsorship_summary, giving_summary: Finance Officer, Auditor, Chaplain
  - message_delivery: Communications Officer, Auditor
- `run_report` / `export_report` for a report outside the caller's roles raise `PermissionError`.
  `reports_catalog` lists only allowed reports.
- `admin_overview` is cached for 60 s per role set. Reports return at most 5000 rows.

**Pinned contract**: `global_search(q, limit=8)` returns a flat list `[{type, title, subtitle, route, name,
doctype}]`. `limit` applies per type; `q` needs at least 2 characters. Types and routes:
- Student `/admin/students/<name>`
- Application `/admin/admissions/<name>`
- Staff `/admin/staff/<name>`
- Invoice `/admin/finance/invoices/<name>`
- Payment `/admin/finance/payments/<name>`
- Course `/admin/academics/courses/<code>`
- Offering `/admin/academics/offerings/<name>`
- Sponsor `/admin/church/sponsors/<name>`

Each type is only searched for roles allowed to see it.

## Endpoints

### `admin_overview`
- **Path:** `mahanaim.api.dashboard.admin_overview`
- **Method:** GET
- **Guard:** staff

Args: `refresh` (default `0`).

```json
{
  "message": {
    "sections": ["admissions", "students"],
    "generated_on": "2026-10-22 00:09:12.528130",
    "term": "2026-2027 Term 1",
    "admissions": {
      "intake": "January 2027",
      "applications_by_status": {
        "Accepted": 1,
        "Waitlisted": 1,
        "Admitted": 1,
        "Interview": 2,
        "Under Review": 2,
        "Draft": 1,
        "Rejected": 2,
        "Submitted": 2
      },
      "applications_total": 12,
      "new_applications_7d": 21,
      "submitted_7d": 13,
      "awaiting_review": 4,
      "funnel": [{"stage": "Started", "count": 12, "pct": 100.0}, {"stage": "Submitted", "count": 11, "pct": 91.67}]
    },
    "students": {
      "active_students": 40,
      "by_status": {"Deferred": 1, "Completed": 1, "Registered": 1, "Admitted": 1, "Alumni": 4, "Active": 39},
      "by_programme": [
        {"programme": "DBS", "label": "Diploma in Biblical Studies", "count": 11},
        {"programme": "DTH", "label": "Diploma in Theology", "count": 9}
      ],
      "by_campus": [
        {"campus": "Nakuru Campus", "label": "Nakuru Campus", "count": 9},
        {"campus": "Main Campus Nairobi", "label": "Main Campus Nairobi", "count": 18}
      ],
      "by_study_mode": [{"study_mode": "Weekend", "count": 4}, {"study_mode": "Part Time", "count": 1}],
      "enrolment_trend": [{"intake": "September 2025", "count": 12}, {"intake": "May 2026", "count": 12}]
    },
    "staff": {"staff": 17, "lecturers": 8, "by_type": {"Support": 1, "Administrative": 7, "Academic": 9}, "on_leave": 0},
    "finance": {
      "term": "2026-2027 Term 1",
      "billed_this_term": 1257000.0,
      "collected_this_term": 834200.0,
      "collection_rate": 66.36,
      "outstanding_this_term": 422800.0,
      "outstanding_total": 422800.0,
      "overdue_invoices": 6,
      "collections_today": 0.0,
      "collections_month": 8500.0,
      "unmatched_mpesa": 0,
      "collections_12m": [{"month": "2025-11", "amount": 0.0}, {"month": "2025-12", "amount": 0.0}]
    },
    "academics": {
      "term": "2026-2027 Term 1",
      "exams_this_week": 4,
      "exams_open_now": 2,
      "mark_sheets_pending_approval": 0,
      "mark_sheets_by_status": {"Draft": 2},
      "offerings_this_term": 25,
      "lms_sync": {"synced": 0, "not_synced": 25, "error": 0, "health_pct": 0.0},
      "pending_requests": 4
    },
    "communications": {
      "unread_enquiries": 1,
      "open_enquiries": 2,
      "messages_7d": {"Sent": 155, "Queued": 220},
      "failed_sms_7d": 0,
      "scheduled_announcements": 0,
      "upcoming_events": 2
    },
    "library": {"items": 34, "on_loan": 6, "overdue": 3, "requests": 1},
    "church": {"partner_churches": 4, "active_sponsorships": 9, "sponsored_students": 9, "giving_this_month": 35950.0},
    "kpis": [
      {
        "key": "applications",
        "label": "Applications this intake",
        "value": 12,
        "format": "number",
        "route": "/admin/admissions",
        "section": "admissions"
      },
      {
        "key": "new_applications_7d",
        "label": "New applications (7 days)",
        "value": 21,
        "format": "number",
        "route": "/admin/admissions",
        "section": "admissions"
      }
    ],
    "charts": {
      "enrolment_trend": {"type": "bar", "labels": ["September 2025"], "datasets": [{"name": "Students", "values": [12]}]},
      "collections": {"type": "line", "labels": ["2025-11"], "datasets": [{"name": "Collections", "values": [0.0]}]},
      "applications_funnel": {"type": "funnel", "labels": ["Started"], "datasets": [{"name": "Applications", "values": [12]}]}
    },
    "activity": [
      {
        "kind": "status",
        "doctype": "Student Request",
        "name": "SRQ-2026-00005",
        "title": "Student Request SRQ-2026-00005: Pending",
        "note": "Request submitted",
        "user": "student.gloria@example.com",
        "timestamp": "2026-10-22 00:05:49.323827",
        "route": "/admin/students/requests/SRQ-2026-00005"
      },
      {
        "kind": "status",
        "doctype": "Student Request",
        "name": "SRQ-2026-00003",
        "title": "Student Request SRQ-2026-00003: Pending",
        "note": "Request submitted",
        "user": "student.david@example.com",
        "timestamp": "2026-10-22 00:05:31.585319",
        "route": "/admin/students/requests/SRQ-2026-00003"
      }
    ]
  }
}
```

### `reports_catalog`
- **Path:** `mahanaim.api.dashboard.reports_catalog`
- **Method:** GET
- **Guard:** staff

Args: None.

Every filter carries `default`, the value `run_report` uses when the caller leaves that filter blank. It is resolved
per request, so it may be a dated or term value, and it is `null` when the filter has no default. Use it to prefill
the filter form.

| Report | Filter | Default |
| --- | --- | --- |
| `fee_collections`, `payment_reconciliation`, `message_delivery` | `from_date` | today − 30 days |
| `giving_summary` | `from_date` | first day of the month 11 months ago (a 12-month window) |
| `aging` | `as_of` | today |
| `attendance_summary`, `lms_engagement`, `lecturer_workload` | `academic_term` | the current Academic Term (if one is set) |

`student_list` with no `status` lists current students (Admitted, Registered, Active, Deferred and Suspended). That
is a set of statuses rather than one value, so it isn't declared as a default and doesn't appear in `applied_filters`.

```json
{
  "message": [
    {
      "key": "enrolment_by_programme",
      "label": "Enrolment by programme",
      "category": "Academic",
      "filters": [
        {"key": "campus", "label": "Campus", "type": "Link", "options": "Campus", "default": null},
        {"key": "study_mode", "label": "Study Mode", "type": "Link", "options": "Study Mode", "default": null}
      ]
    },
    {
      "key": "fee_collections",
      "label": "Fee collections",
      "category": "Finance",
      "filters": [
        {"key": "from_date", "label": "From Date", "type": "Date", "options": null, "default": "2026-09-21"},
        {"key": "to_date", "label": "To Date", "type": "Date", "options": null, "default": null},
        {"key": "mode_of_payment", "label": "Mode", "type": "Select", "options": "M-Pesa\nBank Deposit\n…", "default": null}
      ]
    }
  ]
}
```

### `run_report`
- **Path:** `mahanaim.api.dashboard.run_report`
- **Method:** GET
- **Guard:** staff

Args: `report` (required), `filters` (default `None`).

`filters` echoes the caller's filters unchanged. `applied_filters` is what the report actually ran with: the
catalogue defaults (see `reports_catalog`), overridden by any non-blank values the caller supplied. Blank values
(`""`, `null`, `[]`) fall back to the default. Show `applied_filters` as "Showing …" chips. `export_report` applies
the same defaults.

Example args: `{"report": "fee_collections"}`

```json
{
  "message": {
    "columns": [
      {"key": "name", "label": "Receipt", "type": "Link"},
      {"key": "posting_date", "label": "Date", "type": "Date"}
    ],
    "rows": [
      {
        "name": "RCT-2026-00001",
        "posting_date": "2026-10-21",
        "student": null,
        "payer_name": "Faith Njeri Wanjiru",
        "payment_for": "Application Fee",
        "mode_of_payment": "M-Pesa",
        "reference_no": "SIMOCRTJWU",
        "sponsor": null,
        "amount": 500.0
      },
      {
        "name": "RCT-2026-00067",
        "posting_date": "2026-10-19",
        "student": null,
        "payer_name": "George Nyaga",
        "payment_for": "Application Fee",
        "mode_of_payment": "M-Pesa",
        "reference_no": "SWRABNDTNT",
        "sponsor": null,
        "amount": 1000.0
      }
    ],
    "chart": {
      "type": "bar",
      "labels": ["2026-09-22", "2026-10-12"],
      "datasets": [{"name": "Collected", "values": [98000.0]}]
    },
    "summary": {
      "total": 106500.0,
      "count": 11,
      "by_mode": [{"mode": "Bank Deposit", "amount": 49000.0}, {"mode": "Sponsor Remittance", "amount": 49000.0}]
    },
    "report": "fee_collections",
    "label": "Fee collections",
    "filters": {},
    "applied_filters": {"from_date": "2026-09-21"}
  }
}
```

### `export_report`
- **Path:** `mahanaim.api.dashboard.export_report`
- **Method:** GET
- **Guard:** staff

CSV export of `run_report`: `{filename, content, mimetype, rows}` (the SPA turns `content` into a download).

Args: `report` (required), `filters` (default `None`).

Example args: `{"report": "student_list"}`

```json
{
  "message": {
    "filename": "student_list-2026-10-22.csv",
    "content": "Student No.,Name,Email,Phone,Programme,Campus,Mode,Year,Status,CGPA,Balance,Sponsor\r\nMB…",
    "mimetype": "text/csv",
    "rows": 42
  }
}
```

#### Reconciliation, workload and credentials reports

These three reports follow the same `run_report` shape (`columns`, `rows`, `chart`, `summary`, `report`, `label`,
`filters`), and `export_report` writes their columns to CSV. Rows may carry extra keys that are not columns (e.g.
`matched_route`).

**`payment_reconciliation`**: "M-Pesa payment reconciliation", category Finance.
- Filters: `from_date`, `to_date` (default: the last 30 days), `campus`, and `status`
  (`Unmatched|Matched|Allocated|Reversed|No Transaction`).
- Rows: one per M-Pesa Transaction, newest first. After them come confirmed Student Payments with mode M-Pesa that
  no transaction backs, with status `No Transaction`. A payment counts as backed when it has an `mpesa_transaction`
  link, a `reference_no` equal to a transaction's receipt, or a transaction whose `payment` points at it.
- Campus comes from the student, or from the application when there is no student.
- Phones are masked (`+2547*****678`).
- `matched_doctype`/`matched_name` is one of:
  - Student Payment (the transaction is allocated);
  - Giving Record or Event Registration (STK push for purpose Giving/Event Fee);
  - Programme Application or Student (identified but not yet allocated);
  - null.

```json
{
  "columns": [
    {"key": "receipt", "label": "Receipt", "type": "Data"},
    {"key": "trans_time", "label": "Date", "type": "Datetime"},
    {"key": "source", "label": "Source", "type": "Data"},
    {"key": "phone", "label": "Phone", "type": "Data"},
    {"key": "payer_name", "label": "Payer", "type": "Data"},
    {"key": "amount", "label": "Amount", "type": "Currency"},
    {"key": "bill_ref_number", "label": "Account / Bill ref", "type": "Data"},
    {"key": "purpose", "label": "Purpose", "type": "Data"},
    {"key": "matched_doctype", "label": "Matched to", "type": "Data"},
    {"key": "matched_name", "label": "Matched document", "type": "Data"},
    {"key": "student", "label": "Student", "type": "Link"},
    {"key": "campus", "label": "Campus", "type": "Link"},
    {"key": "payment", "label": "Payment", "type": "Link"},
    {"key": "status", "label": "Status", "type": "Data"}
  ],
  "rows": [
    {"receipt": "SIMOCRTJWU", "trans_time": "2026-10-21 21:13:58", "source": "STK Push", "phone": "+2547*****001",
     "payer_name": null, "amount": 500.0, "bill_ref_number": "APP-2026-00002", "purpose": "Application Fee",
     "matched_doctype": "Student Payment", "matched_name": "RCT-2026-00001",
     "matched_route": "/admin/finance/payments/RCT-2026-00001", "student": null, "campus": "Nairobi Main Campus",
     "payment": "RCT-2026-00001", "status": "Allocated"},
    {"receipt": "SVVDCERPKP", "trans_time": "2026-10-18", "source": null, "phone": "+2547*****201",
     "payer_name": "Lilian Auma", "amount": 1000.0, "bill_ref_number": null, "purpose": "Application Fee",
     "matched_doctype": "Student Payment", "matched_name": "RCT-2026-00009",
     "matched_route": "/admin/finance/payments/RCT-2026-00009", "student": null, "campus": "Main Campus Nairobi",
     "payment": "RCT-2026-00009", "status": "No Transaction"}
  ],
  "chart": {"type": "bar", "labels": ["2026-10-21"],
            "datasets": [{"name": "Matched amount", "values": [500.0]}, {"name": "Unmatched amount", "values": [0.0]}]},
  "summary": {
    "transactions": 1, "total_amount": 500.0, "allocated_amount": 500.0, "unmatched": 0, "unmatched_amount": 0.0,
    "payments_without_transaction": 8, "payments_without_transaction_amount": 8000.0,
    "by_status": {"Unmatched": 0, "Matched": 0, "Allocated": 1, "Reversed": 0, "No Transaction": 8},
    "amount_by_status": {"Unmatched": 0.0, "Matched": 0.0, "Allocated": 500.0, "Reversed": 0.0, "No Transaction": 8000.0}
  }
}
```

**`lecturer_workload`**: "Lecturer workload", category Academic.
- Filters: `academic_term` (default: the current term), `campus` (the offering's campus; for lecturers with no
  offerings, their home campus), `department` (Staff Member department).
- Rows: one per active lecturer (`is_lecturer`) plus anyone teaching or taking sessions that term, heaviest load
  first. Cancelled offerings are ignored.
- Offering metrics count towards every lecturer listed on the offering:
  - `students`: enrolments that are Enrolled, Completed or Failed;
  - `assignments_published`: assignments that are not Draft;
  - `submissions_to_grade`: submissions that are Submitted or Late;
  - `mark_sheets_pending`: offerings with no Submitted, Approved or Published mark sheet.
- `sessions_recorded` counts non-cancelled sessions that have attendance taken. Each goes to the session's lecturer,
  or to the offering's lecturers when the session has none.
- The summary totals are per offering, so co-taught offerings are not double counted.

```json
{
  "columns": [
    {"key": "staff_member", "label": "Staff ID", "type": "Data"},
    {"key": "lecturer_name", "label": "Lecturer", "type": "Data"},
    {"key": "department", "label": "Department", "type": "Link"},
    {"key": "campus", "label": "Campus", "type": "Link"},
    {"key": "offerings", "label": "Offerings", "type": "Int"},
    {"key": "courses", "label": "Courses", "type": "Data"},
    {"key": "credit_hours", "label": "Credit hours", "type": "Float"},
    {"key": "students", "label": "Students", "type": "Int"},
    {"key": "assignments_published", "label": "Assignments published", "type": "Int"},
    {"key": "submissions_to_grade", "label": "Submissions to grade", "type": "Int"},
    {"key": "mark_sheets_pending", "label": "Mark sheets pending", "type": "Int"},
    {"key": "sessions_recorded", "label": "Sessions recorded", "type": "Int"}
  ],
  "rows": [
    {"staff_member": "STF-00004", "lecturer_name": "Joseph Mwangi", "department": "Pastoral Ministry",
     "campus": "Main Campus Nairobi", "offerings": 4, "courses": "MIN120, MIS130, PAS201, PAS210",
     "credit_hours": 12.0, "students": 22, "assignments_published": 1, "submissions_to_grade": 0,
     "mark_sheets_pending": 4, "sessions_recorded": 12}
  ],
  "chart": {"type": "bar", "labels": ["Joseph Mwangi"],
            "datasets": [{"name": "Credit hours", "values": [12.0]}, {"name": "Offerings", "values": [4]}]},
  "summary": {"term": "2026-2027 Term 1", "lecturers": 9, "teaching": 9, "offerings": 27, "unassigned_offerings": 4,
              "credit_hours": 81.0, "submissions_to_grade": 9, "mark_sheets_pending": 25}
}
```

**`credentials_issued`**: "Transcripts & certificates", category Academic.
- Filters:
  - `from_date`, `to_date`: the issue date, or the creation date for drafts;
  - `credential_type`: `Transcript|Certificate`;
  - `programme`;
  - `status`: `Pending|Issued|Reissued|Revoked`.
- Statuses: `Pending` is a Draft. `Reissued` is an Issued credential created after the same student's earlier
  credential of the same kind was revoked. "Same kind" means the same programme and, for transcripts, the same
  transcript type.
- `verification_count` is the larger of the document's counter and its Verification Log rows. `last_verified` is
  the latest log entry.

```json
{
  "columns": [
    {"key": "name", "label": "Document", "type": "Data"},
    {"key": "credential_type", "label": "Type", "type": "Data"},
    {"key": "detail", "label": "Kind / award", "type": "Data"},
    {"key": "student", "label": "Student", "type": "Link"},
    {"key": "student_name", "label": "Name", "type": "Data"},
    {"key": "student_number", "label": "Student No.", "type": "Data"},
    {"key": "programme", "label": "Programme", "type": "Link"},
    {"key": "issue_date", "label": "Issued on", "type": "Date"},
    {"key": "status", "label": "Status", "type": "Data"},
    {"key": "verification_count", "label": "Verifications", "type": "Int"},
    {"key": "last_verified", "label": "Last verified", "type": "Datetime"},
    {"key": "revoked_reason", "label": "Revocation reason", "type": "Data"}
  ],
  "rows": [
    {"name": "TRN-2026-00002", "credential_type": "Transcript", "detail": "Official", "student": "MBC-2026-0001",
     "student_name": "Grace Wanjiku", "student_number": "MBC/2026/0001", "programme": "DBS",
     "issue_date": "2026-10-22", "status": "Reissued", "verification_count": 1,
     "last_verified": "2026-10-22 10:04:11", "revoked_reason": null}
  ],
  "chart": {"type": "bar", "labels": ["Pending", "Issued", "Reissued", "Revoked"],
            "datasets": [{"name": "Transcripts", "values": [0, 0, 1, 1]}, {"name": "Certificates", "values": [1, 0, 0, 0]}]},
  "summary": {"credentials": 3, "issued": 0, "reissued": 1, "pending": 1, "revoked": 1, "verifications": 1,
              "by_type": {"Transcript": 2, "Certificate": 1},
              "by_status": {"Pending": 1, "Issued": 0, "Reissued": 1, "Revoked": 1}}
}
```

### `global_search`
- **Path:** `mahanaim.api.dashboard.global_search`
- **Method:** GET
- **Guard:** staff

Pinned contract: flat list of `{type, title, subtitle, route}` (plus `name`, `doctype`), `limit` per type.

Args: `q` (default `None`), `limit` (default `8`).

Example args: `{"q": "wanjiku"}`

```json
{
  "message": [
    {
      "type": "Student",
      "title": "Grace Wanjiku",
      "subtitle": "MBC/DBS/2026/0001 · DBS · Active",
      "route": "/admin/students/STU-2026-00017",
      "name": "STU-2026-00017",
      "doctype": "Student"
    },
    {
      "type": "Invoice",
      "title": "INV-2026-00011",
      "subtitle": "Grace Wanjiku · Partly Paid",
      "route": "/admin/finance/invoices/INV-2026-00011",
      "name": "INV-2026-00011",
      "doctype": "Student Invoice"
    }
  ]
}
```

### `campus_comparison`
- **Path:** `mahanaim.api.dashboard.campus_comparison`
- **Method:** GET
- **Guard:** staff

Args: None.

```json
{
  "message": {
    "term": "2026-2027 Term 1",
    "intake": "January 2027",
    "campuses": [
      {
        "campus": "Main Campus Nairobi",
        "campus_name": "Main Campus Nairobi",
        "code": "MNC",
        "is_main_campus": 1,
        "is_active": 1,
        "town": "Kasarani",
        "active_students": 18,
        "alumni": 4,
        "applications": 8,
        "staff": 13,
        "lecturers": 5,
        "offerings": 15,
        "student_lecturer_ratio": 3.6,
        "billed": 716000.0,
        "collected": 398000.0,
        "outstanding": 318000.0,
        "collection_rate": 55.59,
        "average_cgpa": 3.31,
        "chapel_services_90d": 6,
        "chapel_average_attendance": 106.2,
        "library_items": 17
      },
      {
        "campus": "Nairobi Main Campus",
        "campus_name": "Nairobi Main Campus",
        "code": "NRB",
        "is_main_campus": 1,
        "is_active": 1,
        "town": "Nairobi",
        "active_students": 13,
        "alumni": 0,
        "applications": 0,
        "staff": 2,
        "lecturers": 2,
        "offerings": 5,
        "student_lecturer_ratio": 6.5,
        "billed": 115000.0,
        "collected": 44000.0,
        "outstanding": 71000.0,
        "collection_rate": 38.26,
        "average_cgpa": 3.17,
        "chapel_services_90d": 3,
        "chapel_average_attendance": 0.7,
        "library_items": 3
      }
    ],
    "totals": {
      "active_students": 40.0,
      "applications": 12.0,
      "staff": 17.0,
      "lecturers": 8.0,
      "offerings": 25.0,
      "billed": 1257000.0,
      "collected": 834200.0,
      "outstanding": 422800.0
    },
    "chart": {
      "type": "bar",
      "labels": ["Main Campus Nairobi", "Nairobi Main Campus"],
      "datasets": [{"name": "Active students", "values": [18]}, {"name": "Applications", "values": [8]}]
    }
  }
}
```
