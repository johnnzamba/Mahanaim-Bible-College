# Sponsor Portal API (`mahanaim.api.sponsor`)

Calls go to `/api/method/<dotted path>`. Reads use GET and writes use POST. JSON arguments (`data`, `rows`, `names`,
`filters`, `recipients`, `students`) may be sent as objects/lists or as JSON strings. Responses are wrapped in
`{"message": ...}`. A missing record raises `DoesNotExistError` (404), a failed guard raises `PermissionError` (403)
and validation failures raise `ValidationError` (417) with a translated message. Examples were captured from the
demo dataset (`docs/DEMO.md`); long lists are trimmed.

Self-service for church and individual sponsors (SOW 7.2 M18). Staff endpoints for sponsors are in
`docs/api/church.md`.

**Guards**
- **sponsor**: `require_sponsor()`. The session user must be linked to a Sponsor (`Sponsor.user`). Chaplain, Finance
  Officer, College Administrator and System Manager may pass `sponsor=<name>` to preview the portal as that sponsor.
- A sponsor only sees students with a sponsorship in status Active, Suspended or Completed.
  `student_progress` for any other student raises `PermissionError`.

**Data sources**
- CGPA comes from `Student.cgpa`. Attendance % is (Present + Late) over all Class Attendance rows except Excused.
- The fee balance comes from `services.fees.get_student_balance` (wrapped; `null` when unavailable).
- Results are published Course Results only (`is_published = 1`), grouped by term.
- Payments are Student Payments with `sponsor = me`, plus submitted Giving Records for the sponsor.
- `pay_for_student` and `give_online` call `services.mpesa.initiate_payment` with `sponsor=me`
  (purpose "Student Fees" / "Giving").

## Endpoints

### `my_sponsor_profile`
- **Path:** `mahanaim.api.sponsor.my_sponsor_profile`
- **Method:** GET
- **Guard:** sponsor

Args: `sponsor` (default `None`).

```json
{
  "message": {
    "profile": {
      "sponsor_name": "Harvest Fellowship Kasarani Missions Board",
      "sponsor_type": "Church",
      "partner_church": "Harvest Fellowship Kasarani",
      "status": "Active",
      "email": "sponsor@mahanaim.demo",
      "phone": "254722600700",
      "preferred_communication": "Email",
      "contact_person": "Elder Joseph Gitau",
      "country": "Kenya",
      "address": null,
      "total_committed": 167000.0,
      "total_disbursed": 187000.0,
      "active_sponsorships": 3,
      "user": "sponsor@mahanaim.demo",
      "name": "SPN-00002",
      "partner_church_name": "Harvest Fellowship Kasarani"
    },
    "summary": {
      "students": 3,
      "active_sponsorships": 3,
      "committed": 167000.0,
      "disbursed": 187000.0,
      "outstanding_for_students": 33500.0
    }
  }
}
```

### `update_my_sponsor_profile`
- **Path:** `mahanaim.api.sponsor.update_my_sponsor_profile`
- **Method:** POST
- **Guard:** sponsor

Args: `data` (required).

Example args: `{"data": {"phone": "0722000111", "preferred_communication": "SMS"}}`

```json
{
  "message": {
    "sponsor_name": "Harvest Fellowship Kasarani Missions Board",
    "sponsor_type": "Church",
    "partner_church": "Harvest Fellowship Kasarani",
    "status": "Active",
    "email": "sponsor@mahanaim.demo",
    "phone": "254722000111",
    "preferred_communication": "SMS",
    "contact_person": "Elder Joseph Gitau",
    "country": "Kenya",
    "address": null,
    "total_committed": 167000.0,
    "total_disbursed": 187000.0,
    "active_sponsorships": 3,
    "user": "sponsor@mahanaim.demo",
    "name": "SPN-00002",
    "partner_church_name": "Harvest Fellowship Kasarani"
  }
}
```

### `my_students`
- **Path:** `mahanaim.api.sponsor.my_students`
- **Method:** GET
- **Guard:** sponsor

Args: `sponsor` (default `None`).

```json
{
  "message": {
    "data": [
      {
        "student": "STU-2026-00017",
        "full_name": "Grace Wanjiku",
        "student_number": "MBC/DBS/2026/0001",
        "photo": null,
        "programme": "DBS",
        "programme_name": "Diploma in Biblical Studies",
        "year_of_study": 1,
        "campus": "Main Campus Nairobi",
        "campus_name": "Main Campus Nairobi",
        "status": "Active",
        "cgpa": 3.94,
        "academic_standing": "Dean's List",
        "attendance_pct": 100.0,
        "fee_balance": 18500.0,
        "sponsorship": {
          "name": "SPS-2026-00003",
          "status": "Active",
          "coverage": "Percentage",
          "amount": 0.0,
          "percentage": 50.0,
          "start_term": "2025-2026 Term 3",
          "end_term": null,
          "amount_disbursed": 0.0
        }
      },
      {
        "student": "STU-2026-00024",
        "full_name": "Joseph Kiplagat",
        "student_number": "MBC/DBS/2026/0004",
        "photo": null,
        "programme": "DBS",
        "programme_name": "Diploma in Biblical Studies",
        "year_of_study": 1,
        "campus": "Nakuru Campus",
        "campus_name": "Nakuru Campus",
        "status": "Active",
        "cgpa": 3.29,
        "academic_standing": "Good Standing",
        "attendance_pct": 100.0,
        "fee_balance": 0.0,
        "sponsorship": {
          "name": "SPS-2026-00004",
          "status": "Active",
          "coverage": "Full Fees",
          "amount": 0.0,
          "percentage": 0.0,
          "start_term": "2025-2026 Term 3",
          "end_term": null,
          "amount_disbursed": 0.0
        }
      }
    ],
    "total": 3
  }
}
```

### `student_progress`
- **Path:** `mahanaim.api.sponsor.student_progress`
- **Method:** GET
- **Guard:** sponsor

Args: `student` (required), `sponsor` (default `None`).

Example args: `{"student": "STU-2026-00017"}`

```json
{
  "message": {
    "student": {
      "name": "STU-2026-00017",
      "full_name": "Grace Wanjiku",
      "student_number": "MBC/DBS/2026/0001",
      "photo": null,
      "programme": "DBS",
      "programme_name": "Diploma in Biblical Studies",
      "year_of_study": 1,
      "campus": "Main Campus Nairobi",
      "status": "Active",
      "cgpa": 3.94,
      "credits_earned": 10.0,
      "academic_standing": "Dean's List",
      "current_term": "2026-2027 Term 1",
      "campus_name": "Main Campus Nairobi"
    },
    "terms": [
      {
        "academic_term": "2025-2026 Term 3",
        "term_label": "Term 3 2025-2026",
        "courses": [
          {
            "academic_term": "2025-2026 Term 3",
            "course": "BIB101",
            "course_title": "Old Testament Survey",
            "credits": 3.0,
            "grade": "A",
            "grade_points": 4.0,
            "result_status": "Pass"
          }
        ],
        "credits": 10.0,
        "gpa": 3.94,
        "passed": 4,
        "failed": 0
      }
    ],
    "attendance": {
      "overall": {"present": 8, "late": 4, "absent": 0, "excused": 0, "total": 12, "pct": 100.0},
      "current_term": {"present": 8, "late": 4, "absent": 0, "excused": 0, "total": 12, "pct": 100.0},
      "term": "2026-2027 Term 1"
    },
    "fees": {
      "balance": 18500.0,
      "invoices": [
        {
          "name": "INV-2026-00011",
          "academic_term": "2026-2027 Term 1",
          "posting_date": "2026-09-01",
          "due_date": "2026-11-11",
          "total_amount": 49000.0,
          "paid_amount": 30500.0,
          "outstanding_amount": 18500.0,
          "status": "Partly Paid"
        },
        {
          "name": "INV-2026-00010",
          "academic_term": "2025-2026 Term 3",
          "posting_date": "2026-05-04",
          "due_date": "2026-06-03",
          "total_amount": 49000.0,
          "paid_amount": 49000.0,
          "outstanding_amount": 0.0,
          "status": "Paid"
        }
      ]
    },
    "sponsorship": {
      "name": "SPS-2026-00003",
      "status": "Active",
      "coverage": "Percentage",
      "amount": 0.0,
      "percentage": 50.0,
      "amount_disbursed": 0.0
    }
  }
}
```

### `my_contributions`
- **Path:** `mahanaim.api.sponsor.my_contributions`
- **Method:** GET
- **Guard:** sponsor

Args: `sponsor` (default `None`).

```json
{
  "message": {
    "data": [
      {
        "type": "Giving",
        "name": "GIV-2026-00003",
        "giving_type": "Scholarship Fund",
        "amount": 25000.0,
        "date": "2026-10-22",
        "mode": "Bank",
        "reference": "EQB951A871",
        "purpose": "Scholarship Fund gift"
      },
      {
        "type": "Fee Payment",
        "name": "RCT-2026-00030",
        "student": "STU-2026-00024",
        "student_name": "Joseph Kiplagat",
        "amount": 49000.0,
        "date": "2026-09-22",
        "mode": "Sponsor Remittance",
        "reference": "SR-9B8405A0"
      }
    ],
    "total": 8,
    "totals": {"fees": 187000.0, "giving": 50000.0, "all": 237000.0, "by_year": [{"year": "2026", "amount": 237000.0}]}
  }
}
```

### `pay_for_student`
- **Path:** `mahanaim.api.sponsor.pay_for_student`
- **Method:** POST
- **Guard:** sponsor

STK push for a sponsored student's fees; the payment is recorded against the student with sponsor=me.

Args: `student` (required), `amount` (required), `phone` (default `None`).

Example args: `{"student": "STU-2026-00017", "amount": 5000, "phone": "0712345678"}`

```json
{"message": {"ok": true, "request": "STK-2026-000033", "checkout_request_id": "ws_CO_22102026101500789",
  "customer_message": "Success. Request accepted for processing"}}
```

### `give_online`
- **Path:** `mahanaim.api.sponsor.give_online`
- **Method:** POST
- **Guard:** sponsor

A sponsor's own gift (offering, project, scholarship fund) via M-Pesa — recorded when the payment completes.

Args: `amount` (required), `giving_type` (required), `phone` (default `None`), `purpose` (default `None`).

Example args: `{"amount": 2500, "giving_type": "Scholarship Fund", "phone": "0712345678"}`

```json
{"message": {"ok": true, "request": "STK-2026-000034", "checkout_request_id": "ws_CO_22102026101500999",
  "customer_message": "Success. Request accepted for processing"}}
```

### `sponsor_report`
- **Path:** `mahanaim.api.sponsor.sponsor_report`
- **Method:** GET
- **Guard:** sponsor

Printable summary: institution header, sponsor profile, each student's progress, and contributions.

Args: `sponsor` (default `None`).

```json
{
  "message": {
    "institution": {
      "name": "Mahanaim Bible College",
      "short_name": "MBC",
      "logo": null,
      "address": "Off Thika Road, Kasarani, P.O. Box 41230-00100, Nairobi",
      "email": "info@mahanaim.ac.ke",
      "phone": "0722 410 300",
      "currency": "KES"
    },
    "generated_on": "2026-10-22 00:09:12.446625",
    "sponsor": {
      "sponsor_name": "Harvest Fellowship Kasarani Missions Board",
      "sponsor_type": "Church",
      "partner_church": "Harvest Fellowship Kasarani",
      "status": "Active",
      "email": "sponsor@mahanaim.demo",
      "phone": "254722600700",
      "preferred_communication": "Email",
      "contact_person": "Elder Joseph Gitau",
      "country": "Kenya",
      "address": null,
      "total_committed": 167000.0,
      "total_disbursed": 187000.0,
      "active_sponsorships": 3,
      "user": "sponsor@mahanaim.demo",
      "name": "SPN-00002",
      "partner_church_name": "Harvest Fellowship Kasarani"
    },
    "students": [
      {
        "student": "STU-2026-00017",
        "full_name": "Grace Wanjiku",
        "student_number": "MBC/DBS/2026/0001",
        "photo": null,
        "programme": "DBS",
        "programme_name": "Diploma in Biblical Studies",
        "year_of_study": 1,
        "campus": "Main Campus Nairobi",
        "campus_name": "Main Campus Nairobi",
        "status": "Active",
        "cgpa": 3.94,
        "academic_standing": "Dean's List",
        "attendance_pct": 100.0,
        "fee_balance": 18500.0,
        "sponsorship": {
          "name": "SPS-2026-00003",
          "status": "Active",
          "coverage": "Percentage",
          "amount": 0.0,
          "percentage": 50.0,
          "start_term": "2025-2026 Term 3",
          "end_term": null,
          "amount_disbursed": 0.0
        }
      },
      {
        "student": "STU-2026-00024",
        "full_name": "Joseph Kiplagat",
        "student_number": "MBC/DBS/2026/0004",
        "photo": null,
        "programme": "DBS",
        "programme_name": "Diploma in Biblical Studies",
        "year_of_study": 1,
        "campus": "Nakuru Campus",
        "campus_name": "Nakuru Campus",
        "status": "Active",
        "cgpa": 3.29,
        "academic_standing": "Good Standing",
        "attendance_pct": 100.0,
        "fee_balance": 0.0,
        "sponsorship": {
          "name": "SPS-2026-00004",
          "status": "Active",
          "coverage": "Full Fees",
          "amount": 0.0,
          "percentage": 0.0,
          "start_term": "2025-2026 Term 3",
          "end_term": null,
          "amount_disbursed": 0.0
        }
      }
    ],
    "contributions": {
      "this_year": 237000.0,
      "all_time": 237000.0,
      "fees": 187000.0,
      "giving": 50000.0,
      "by_year": [{"year": "2026", "amount": 237000.0}],
      "recent": [
        {
          "type": "Giving",
          "name": "GIV-2026-00003",
          "giving_type": "Scholarship Fund",
          "amount": 25000.0,
          "date": "2026-10-22",
          "mode": "Bank",
          "reference": "EQB951A871",
          "purpose": "Scholarship Fund gift"
        },
        {
          "type": "Fee Payment",
          "name": "RCT-2026-00030",
          "student": "STU-2026-00024",
          "student_name": "Joseph Kiplagat",
          "amount": 49000.0,
          "date": "2026-09-22",
          "mode": "Sponsor Remittance",
          "reference": "SR-9B8405A0"
        }
      ]
    },
    "summary": {
      "students": 3,
      "average_cgpa": 3.53,
      "outstanding_for_students": 33500.0,
      "committed": 167000.0,
      "disbursed": 187000.0
    }
  }
}
```
