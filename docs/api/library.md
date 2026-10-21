# Digital Library API (`mahanaim.api.library`)

Calls go to `/api/method/<dotted path>`. Reads use GET and writes use POST. JSON arguments (`data`, `rows`, `names`,
`filters`, `recipients`, `students`) may be sent as objects/lists or as JSON strings. Responses are wrapped in
`{"message": ...}`. A missing record raises `DoesNotExistError` (404), a failed guard raises `PermissionError` (403)
and validation failures raise `ValidationError` (417) with a translated message. Examples were captured from the
demo dataset (`docs/DEMO.md`); long lists are trimmed.

Covers SOW 7.2 M17: catalogue, digital access, loans and the library desk.

**Guards**
- **guest**: `allow_guest=True`. Anyone, including anonymous visitors.
- **guest · rate-limited**: as guest, plus a per-IP `rate_limit` (HTTP 429 when exceeded). Public forms also carry a
  honeypot argument `website` that must stay empty; when filled, the call quietly returns `{"ok": true}` and saves nothing.
- **login**: any signed-in user (`require_login`).
- **staff**: any staff role (`require_staff`).
- **roles: …**: `require_roles(...)`. System Manager, College Administrator and Administrator always pass.
- **borrower**: signed in and linked to an active Student or Staff Member.
- **Library Officer** endpoints for one loan (`return_loan`, `renew_loan`, `mark_lost`, `record_fine_payment`,
  `reject_loan_request`) require the Library Officer role (admins pass).

**Access levels**: guests see `Public` items, students and alumni see `Public` + `Students`, staff see everything.
Hidden items return 404.

**Digital files**: `access_digital(name)` increments `downloads` and returns `{kind, url, expires_in, title}`.
- Public files (`/files/...`) and external links are returned as-is.
- Private files (`/private/files/...`) are never exposed directly. The caller gets a 10-minute token URL bound to
  their session: `/api/method/mahanaim.api.library.download_digital?token=…`. It streams the file inline after
  re-checking the token and user.

**Loan requests**: `request_loan(item)` creates a **Library Loan** with status `Requested` (the doctype supports it).
It is not a Student Request. The Library Officer then issues it with `issue_loan(loan=…)` or rejects it.

## Rules enforced by the controllers

- **Library Item**
  - `available_copies` is between 0 and `total_copies`. Total copies cannot drop below the copies on loan.
  - A physical item needs at least one copy. E-Book/Audio/Video items need `digital_file` or an `http(s)`
    `external_url`.
  - The publication year must be valid. Items with loan history cannot be deleted; deactivate them instead.
- **Library Loan**
  - Status machine: `Requested → Issued | Cancelled`, `Issued → Returned | Overdue | Lost`,
    `Overdue → Returned | Lost | Issued`, `Lost → Returned`, `Cancelled → Requested`.
  - Issuing locks the item row and blocks when no copies are available. A borrower may not hold the same item twice,
    may hold at most 5 active loans, and must be an active student/staff member.
  - `due_date` defaults to 14 days after issue.
  - `available_copies` is recomputed on issue, return, loss and cancellation.
  - The fine is `library_fine_per_day` from Mahanaim Settings when that field exists, else **10 KES/day** overdue
    (`services.library.FINE_PER_DAY`). A renewal keeps the fine already accrued.
  - Marking a loan Lost writes the copy off (`total_copies − 1`); returning a lost item restores it.
  - `services.library.mark_overdue_loans()` (daily cron) flips past-due Issued loans to Overdue, updates fines and
    notifies borrowers. Only Requested loans can be deleted.

## Endpoints

### `catalogue`
- **Path:** `mahanaim.api.library.catalogue`
- **Method:** GET
- **Guard:** guest

Args: `search` (default `None`), `subject` (default `None`), `item_type` (default `None`), `access` (default `None`), `digital` (default `None`), `available` (default `None`), `start` (default `0`), `page_length` (default `24`), `sort` (default `'title'`).

Example args: `{"page_length": 2}`

```json
{
  "message": {
    "data": [
      {
        "name": "LIB-000007",
        "title": "Africa Bible Commentary",
        "item_type": "Commentary",
        "authors": "Tokunboh Adeyemo (ed.)",
        "subject": "Biblical Studies",
        "publisher": null,
        "publication_year": 2006,
        "edition": null,
        "cover_image": null,
        "description": null,
        "access_level": "Students",
        "is_digital": false,
        "is_physical": true,
        "total_copies": 3,
        "available_copies": 3,
        "call_number": "BIB 624.84",
        "location": "Shelf E9",
        "campus": "Main Campus Nairobi",
        "downloads": 0,
        "can_access": true
      },
      {
        "name": "LIB-000025",
        "title": "Africa Journal of Evangelical Theology (selected issues)",
        "item_type": "Journal",
        "authors": "Various",
        "subject": "Theology",
        "publisher": null,
        "publication_year": 2020,
        "edition": null,
        "cover_image": null,
        "description": null,
        "access_level": "Students",
        "is_digital": false,
        "is_physical": true,
        "total_copies": 1,
        "available_copies": 1,
        "call_number": "THE 166.76",
        "location": "Shelf G7",
        "campus": "Main Campus Nairobi",
        "downloads": 0,
        "can_access": true
      }
    ],
    "total": 32,
    "facets": {
      "subject": [{"value": "Theology", "count": 9}, {"value": "Pastoral Ministry", "count": 7}],
      "item_type": [{"value": "Book", "count": 19}, {"value": "E-Book", "count": 5}],
      "access_level": [{"value": "Students", "count": 26}, {"value": "Public", "count": 6}]
    },
    "access_levels": ["Public", "Students"]
  }
}
```

### `item`
- **Path:** `mahanaim.api.library.item`
- **Method:** GET
- **Guard:** guest

Args: `name` (required).

Example args: `{"name": "LIB-000009"}`

```json
{
  "message": {
    "name": "LIB-000009",
    "title": "Mere Christianity",
    "item_type": "Book",
    "authors": "C. S. Lewis",
    "subject": "Theology",
    "publisher": null,
    "publication_year": 1952,
    "edition": null,
    "cover_image": null,
    "description": null,
    "access_level": "Students",
    "is_digital": false,
    "is_physical": true,
    "total_copies": 2,
    "available_copies": 2,
    "call_number": "THE 731.11",
    "location": "Shelf D8",
    "campus": "Main Campus Nairobi",
    "downloads": 0,
    "can_access": true,
    "isbn": null,
    "is_active": 1,
    "can_borrow": true,
    "my_loan": null,
    "related": [
      {
        "name": "LIB-000005",
        "title": "Knowing God",
        "item_type": "Book",
        "authors": "J. I. Packer",
        "subject": "Theology",
        "publisher": null,
        "publication_year": 1973,
        "edition": null,
        "cover_image": null,
        "description": null,
        "access_level": "Students",
        "is_digital": false,
        "is_physical": true,
        "total_copies": 4,
        "available_copies": 3,
        "call_number": "THE 610.70",
        "location": "Shelf G7",
        "campus": "Main Campus Nairobi",
        "downloads": 0,
        "can_access": true
      },
      {
        "name": "LIB-000001",
        "title": "Systematic Theology",
        "item_type": "Book",
        "authors": "Wayne Grudem",
        "subject": "Theology",
        "publisher": "Zondervan",
        "publication_year": 1994,
        "edition": null,
        "cover_image": null,
        "description": "An introduction to biblical doctrine.",
        "access_level": "Students",
        "is_digital": false,
        "is_physical": true,
        "total_copies": 3,
        "available_copies": 3,
        "call_number": "230 GRU",
        "location": "Shelf B2",
        "campus": "Nairobi Main Campus",
        "downloads": 0,
        "can_access": true
      }
    ]
  }
}
```

### `access_digital`
- **Path:** `mahanaim.api.library.access_digital`
- **Method:** POST
- **Guard:** guest · rate-limited

Count a download/view and return where to get it.

Args: `name` (required).

Example args: `{"name": "LIB-000024"}`

```json
{
  "message": {
    "kind": "external",
    "url": "https://www.ccel.org/ccel/henry/mhc.html",
    "expires_in": null,
    "title": "Commentary on the Whole Bible"
  }
}
```

### `download_digital`
- **Path:** `mahanaim.api.library.download_digital`
- **Method:** GET
- **Guard:** guest

Args: `token` (required).

Example args: `{"token": "<token returned by access_digital>"}`

Streams the private file inline (`response.type = "download"`). Errors: expired token or token issued to another user → 403.

### `my_loans`
- **Path:** `mahanaim.api.library.my_loans`
- **Method:** GET
- **Guard:** login

Args: `include_history` (default `1`).

```json
{
  "message": {
    "active": [
      {
        "name": "LN-2026-000004",
        "library_item": "LIB-000005",
        "item_title": "Knowing God",
        "borrower_type": "Student",
        "student": "STU-2026-00017",
        "staff_member": null,
        "borrower_name": "Grace Wanjiku",
        "issue_date": "2026-09-27",
        "due_date": "2026-10-11",
        "return_date": null,
        "status": "Overdue",
        "fine_amount": 110.0,
        "fine_paid": 0,
        "remarks": null,
        "days_left": -11
      },
      {
        "name": "LN-2026-000003",
        "library_item": "LIB-000006",
        "item_title": "How to Read the Bible for All Its Worth",
        "borrower_type": "Student",
        "student": "STU-2026-00017",
        "staff_member": null,
        "borrower_name": "Grace Wanjiku",
        "issue_date": "2026-10-17",
        "due_date": "2026-10-31",
        "return_date": null,
        "status": "Issued",
        "fine_amount": 0.0,
        "fine_paid": 0,
        "remarks": null,
        "days_left": 9
      }
    ],
    "history": [],
    "fines_due": 110.0,
    "limit": 5,
    "borrower": {"borrower_type": "Student", "borrower_name": "Grace Wanjiku"}
  }
}
```

### `request_loan`
- **Path:** `mahanaim.api.library.request_loan`
- **Method:** POST
- **Guard:** borrower

Reserve a physical copy: creates a Library Loan with status "Requested" for the librarian to issue.

Args: `item` (required), `remarks` (default `None`).

Example args: `{"item": "LIB-000009"}`

```json
{"message": {"name": "LN-2026-000009", "status": "Requested", "available_copies": 2}}
```

### `cancel_loan_request`
- **Path:** `mahanaim.api.library.cancel_loan_request`
- **Method:** POST
- **Guard:** borrower

Args: `loan` (required).

Example args: `{"loan": "LN-2026-000012"}`

```json
{"message": {"name": "LN-2026-000012", "status": "Cancelled"}}
```

### `library_dashboard`
- **Path:** `mahanaim.api.library.library_dashboard`
- **Method:** GET
- **Guard:** roles: Library Officer, Registrar, Auditor, Finance Officer

Args: None.

```json
{
  "message": {
    "kpis": {
      "items": 34,
      "copies": 62,
      "available_copies": 56,
      "digital_items": 9,
      "downloads": 0,
      "on_loan": 6,
      "overdue": 3,
      "requests": 1,
      "lost": 0,
      "fines_outstanding": 230.0
    },
    "loans_by_status": {"Requested": 1, "Issued": 3, "Overdue": 3, "Returned": 1},
    "by_subject": [{"subject": "Theology", "count": 9}, {"subject": "Pastoral Ministry", "count": 8}],
    "by_type": [{"item_type": "Book", "count": 19}, {"item_type": "E-Book", "count": 5}],
    "top_borrowed": [
      {
        "name": "LIB-000004",
        "title": "Preaching and Preachers",
        "item_type": "Book",
        "subject": "Pastoral Ministry",
        "loans_count": 1,
        "downloads": 0,
        "available_copies": 0,
        "total_copies": 1
      },
      {
        "name": "LIB-000005",
        "title": "Knowing God",
        "item_type": "Book",
        "subject": "Theology",
        "loans_count": 1,
        "downloads": 0,
        "available_copies": 3,
        "total_copies": 4
      }
    ],
    "top_downloaded": [],
    "requests": [
      {
        "name": "LN-2026-000008",
        "library_item": "LIB-000012",
        "item_title": "Celebration of Discipline",
        "borrower_type": "Student",
        "student": "STU-2026-00021",
        "staff_member": null,
        "borrower_name": "Mercy Njeri",
        "issue_date": "2026-10-22",
        "due_date": "2026-11-05",
        "return_date": null,
        "status": "Requested",
        "fine_amount": 0.0,
        "fine_paid": 0,
        "remarks": null
      }
    ],
    "overdue": [
      {
        "name": "LN-2026-000004",
        "library_item": "LIB-000005",
        "item_title": "Knowing God",
        "borrower_type": "Student",
        "student": "STU-2026-00017",
        "staff_member": null,
        "borrower_name": "Grace Wanjiku",
        "issue_date": "2026-09-27",
        "due_date": "2026-10-11",
        "return_date": null,
        "status": "Overdue",
        "fine_amount": 110.0,
        "fine_paid": 0,
        "remarks": null
      },
      {
        "name": "LN-2026-000007",
        "library_item": "LIB-000030",
        "item_title": "Spiritual Leadership",
        "borrower_type": "Student",
        "student": "STU-2026-00023",
        "staff_member": null,
        "borrower_name": "Ann Wairimu",
        "issue_date": "2026-10-02",
        "due_date": "2026-10-16",
        "return_date": null,
        "status": "Overdue",
        "fine_amount": 60.0,
        "fine_paid": 0,
        "remarks": null
      }
    ],
    "recent": [
      {
        "name": "LN-2026-000004",
        "library_item": "LIB-000005",
        "item_title": "Knowing God",
        "borrower_type": "Student",
        "student": "STU-2026-00017",
        "staff_member": null,
        "borrower_name": "Grace Wanjiku",
        "issue_date": "2026-09-27",
        "due_date": "2026-10-11",
        "return_date": null,
        "status": "Overdue",
        "fine_amount": 110.0,
        "fine_paid": 0,
        "remarks": null
      },
      {
        "name": "LN-2026-000007",
        "library_item": "LIB-000030",
        "item_title": "Spiritual Leadership",
        "borrower_type": "Student",
        "student": "STU-2026-00023",
        "staff_member": null,
        "borrower_name": "Ann Wairimu",
        "issue_date": "2026-10-02",
        "due_date": "2026-10-16",
        "return_date": null,
        "status": "Overdue",
        "fine_amount": 60.0,
        "fine_paid": 0,
        "remarks": null
      }
    ],
    "loans_per_month": [{"month": "2025-11", "loans": 0}, {"month": "2025-12", "loans": 0}],
    "settings": {"fine_per_day": 10.0, "loan_days": 14, "max_active_loans": 5}
  }
}
```

### `list_loans`
- **Path:** `mahanaim.api.library.list_loans`
- **Method:** GET
- **Guard:** roles: Library Officer, Registrar, Auditor, Finance Officer

Args: `status` (default `None`), `search` (default `None`), `borrower_type` (default `None`), `library_item` (default `None`), `student` (default `None`), `start` (default `0`), `page_length` (default `20`).

Example args: `{"page_length": 2}`

```json
{
  "message": {
    "data": [
      {
        "name": "LN-2026-000004",
        "library_item": "LIB-000005",
        "item_title": "Knowing God",
        "borrower_type": "Student",
        "student": "STU-2026-00017",
        "staff_member": null,
        "borrower_name": "Grace Wanjiku",
        "issue_date": "2026-09-27",
        "due_date": "2026-10-11",
        "return_date": null,
        "status": "Overdue",
        "fine_amount": 110.0,
        "fine_paid": 0,
        "remarks": null
      },
      {
        "name": "LN-2026-000007",
        "library_item": "LIB-000030",
        "item_title": "Spiritual Leadership",
        "borrower_type": "Student",
        "student": "STU-2026-00023",
        "staff_member": null,
        "borrower_name": "Ann Wairimu",
        "issue_date": "2026-10-02",
        "due_date": "2026-10-16",
        "return_date": null,
        "status": "Overdue",
        "fine_amount": 60.0,
        "fine_paid": 0,
        "remarks": null
      }
    ],
    "total": 8
  }
}
```

### `list_items`
- **Path:** `mahanaim.api.library.list_items`
- **Method:** GET
- **Guard:** roles: Library Officer, Registrar, Auditor, Finance Officer

Args: `search` (default `None`), `subject` (default `None`), `item_type` (default `None`), `access_level` (default `None`), `is_active` (default `None`), `start` (default `0`), `page_length` (default `20`).

Example args: `{"page_length": 2}`

```json
{
  "message": {
    "data": [
      {
        "name": "LIB-000007",
        "title": "Africa Bible Commentary",
        "item_type": "Commentary",
        "authors": "Tokunboh Adeyemo (ed.)",
        "subject": "Biblical Studies",
        "publisher": null,
        "publication_year": 2006,
        "edition": null,
        "cover_image": null,
        "description": null,
        "access_level": "Students",
        "digital_file": null,
        "external_url": null,
        "total_copies": 3,
        "available_copies": 3,
        "call_number": "BIB 624.84",
        "campus": "Main Campus Nairobi",
        "location": "Shelf E9",
        "downloads": 0,
        "loans_count": 1,
        "isbn": null,
        "is_active": 1,
        "modified": "2026-10-22 00:00:28.003992"
      },
      {
        "name": "LIB-000025",
        "title": "Africa Journal of Evangelical Theology (selected issues)",
        "item_type": "Journal",
        "authors": "Various",
        "subject": "Theology",
        "publisher": null,
        "publication_year": 2020,
        "edition": null,
        "cover_image": null,
        "description": null,
        "access_level": "Students",
        "digital_file": null,
        "external_url": null,
        "total_copies": 1,
        "available_copies": 1,
        "call_number": "THE 166.76",
        "campus": "Main Campus Nairobi",
        "location": "Shelf G7",
        "downloads": 0,
        "loans_count": 0,
        "isbn": null,
        "is_active": 1,
        "modified": "2026-10-22 00:00:28.047121"
      }
    ],
    "total": 34
  }
}
```

### `get_item`
- **Path:** `mahanaim.api.library.get_item`
- **Method:** GET
- **Guard:** roles: Library Officer, Registrar, Auditor, Finance Officer

Args: `name` (required).

Example args: `{"name": "LIB-000009"}`

```json
{
  "message": {
    "name": "LIB-000009",
    "owner": "Administrator",
    "creation": "2026-10-22 00:00:28.007108",
    "modified": "2026-10-22 00:00:28.007108",
    "modified_by": "Administrator",
    "docstatus": 0,
    "idx": 0,
    "title": "Mere Christianity",
    "item_type": "Book",
    "authors": "C. S. Lewis",
    "subject": "Theology",
    "isbn": null,
    "publisher": null,
    "publication_year": 1952,
    "edition": null,
    "call_number": "THE 731.11",
    "cover_image": null,
    "description": null,
    "access_level": "Students",
    "is_active": 1,
    "digital_file": null,
    "external_url": null,
    "campus": "Main Campus Nairobi",
    "location": "Shelf D8",
    "total_copies": 2,
    "available_copies": 2,
    "downloads": 0,
    "loans_count": 0,
    "doctype": "Library Item",
    "loans": []
  }
}
```

### `save_item`
- **Path:** `mahanaim.api.library.save_item`
- **Method:** POST
- **Guard:** roles: Library Officer

Args: `data` (required).

Example args: `{"data": {"title": "Africa Bible Commentary", "item_type": "Commentary", "subject": "Biblical Studies", "total_copies": 3, "access_level": "Students"}}`

```json
{
  "message": {
    "name": "LIB-000035",
    "owner": "admin@mahanaim.demo",
    "creation": "2026-10-22 00:09:12.495188",
    "modified": "2026-10-22 00:09:12.495188",
    "modified_by": "admin@mahanaim.demo",
    "docstatus": 0,
    "idx": 0,
    "title": "Africa Bible Commentary",
    "item_type": "Commentary",
    "authors": null,
    "subject": "Biblical Studies",
    "isbn": null,
    "publisher": null,
    "publication_year": 0,
    "edition": null,
    "call_number": null,
    "cover_image": null,
    "description": null,
    "access_level": "Students",
    "is_active": 1,
    "digital_file": null,
    "external_url": null,
    "campus": null,
    "location": null,
    "total_copies": 3,
    "available_copies": 3,
    "downloads": 0,
    "loans_count": 0,
    "doctype": "Library Item"
  }
}
```

### `issue_loan`
- **Path:** `mahanaim.api.library.issue_loan`
- **Method:** POST
- **Guard:** roles: Library Officer

Issue a copy — either fulfil a pending request (`loan`) or lend directly to a student/staff member.

Args: `item` (default `None`), `student` (default `None`), `staff_member` (default `None`), `due_date` (default `None`), `loan` (default `None`), `remarks` (default `None`).

Example args: `{"item": "LIB-000009", "student": "STU-2026-00026"}`

```json
{
  "message": {
    "name": "LN-2026-000009",
    "owner": "admin@mahanaim.demo",
    "creation": "2026-10-22 00:09:12.501274",
    "modified": "2026-10-22 00:09:12.501274",
    "modified_by": "admin@mahanaim.demo",
    "docstatus": 0,
    "idx": 0,
    "library_item": "LIB-000009",
    "item_title": "Mere Christianity",
    "borrower_type": "Student",
    "student": "STU-2026-00026",
    "staff_member": null,
    "borrower_name": "Timothy Kibet",
    "issue_date": "2026-10-22",
    "due_date": "2026-11-05",
    "return_date": null,
    "status": "Issued",
    "fine_amount": 0.0,
    "fine_paid": 0,
    "issued_by": "admin@mahanaim.demo",
    "remarks": null,
    "doctype": "Library Loan"
  }
}
```

### `return_loan`
- **Path:** `mahanaim.api.library.return_loan`
- **Method:** POST
- **Guard:** roles: Library Officer

Args: `loan` (required), `condition_notes` (default `None`), `fine_paid` (default `0`), `return_date` (default `None`).

Example args: `{"loan": "LN-2026-000007", "condition_notes": "Good"}`

```json
{
  "message": {
    "name": "LN-2026-000007",
    "owner": "Administrator",
    "creation": "2026-10-22 00:01:08.590725",
    "modified": "2026-10-22 00:09:12.508454",
    "modified_by": "admin@mahanaim.demo",
    "docstatus": 0,
    "idx": 0,
    "library_item": "LIB-000030",
    "item_title": "Spiritual Leadership",
    "borrower_type": "Student",
    "student": "STU-2026-00023",
    "staff_member": null,
    "borrower_name": "Ann Wairimu",
    "issue_date": "2026-10-02",
    "due_date": "2026-10-16",
    "return_date": "2026-10-22",
    "status": "Returned",
    "fine_amount": 60.0,
    "fine_paid": 0,
    "issued_by": "Administrator",
    "remarks": "Returned 2026-10-22: Good",
    "doctype": "Library Loan"
  }
}
```

### `renew_loan`
- **Path:** `mahanaim.api.library.renew_loan`
- **Method:** POST
- **Guard:** roles: Library Officer

Args: `loan` (required), `due_date` (default `None`).

Example args: `{"loan": "LN-2026-000006"}`

```json
{
  "message": {
    "name": "LN-2026-000006",
    "owner": "Administrator",
    "creation": "2026-10-22 00:01:08.584931",
    "modified": "2026-10-22 00:09:12.513912",
    "modified_by": "admin@mahanaim.demo",
    "docstatus": 0,
    "idx": 0,
    "library_item": "LIB-000011",
    "item_title": "Between Two Worlds: The Art of Preaching in the Twentieth Century",
    "borrower_type": "Student",
    "student": "STU-2026-00020",
    "staff_member": null,
    "borrower_name": "Daniel Omondi",
    "issue_date": "2026-10-14",
    "due_date": "2026-11-11",
    "return_date": null,
    "status": "Issued",
    "fine_amount": 0.0,
    "fine_paid": 0,
    "issued_by": "Administrator",
    "remarks": null,
    "doctype": "Library Loan"
  }
}
```

### `mark_lost`
- **Path:** `mahanaim.api.library.mark_lost`
- **Method:** POST
- **Guard:** roles: Library Officer

Args: `loan` (required), `notes` (default `None`), `replacement_fee` (default `None`).

Example args: `{"loan": "LN-2026-000006", "replacement_fee": 2500}`

```json
{
  "message": {
    "name": "LN-2026-000006",
    "owner": "Administrator",
    "creation": "2026-10-22 00:01:08.584931",
    "modified": "2026-10-22 00:09:12.518766",
    "modified_by": "admin@mahanaim.demo",
    "docstatus": 0,
    "idx": 0,
    "library_item": "LIB-000011",
    "item_title": "Between Two Worlds: The Art of Preaching in the Twentieth Century",
    "borrower_type": "Student",
    "student": "STU-2026-00020",
    "staff_member": null,
    "borrower_name": "Daniel Omondi",
    "issue_date": "2026-10-14",
    "due_date": "2026-10-28",
    "return_date": null,
    "status": "Lost",
    "fine_amount": 2500.0,
    "fine_paid": 0,
    "issued_by": "Administrator",
    "remarks": null,
    "doctype": "Library Loan"
  }
}
```

### `record_fine_payment`
- **Path:** `mahanaim.api.library.record_fine_payment`
- **Method:** POST
- **Guard:** roles: Library Officer

Args: `loan` (required).

Example args: `{"loan": "LN-2026-000004"}`

```json
{"message": {"name": "LN-2026-000004", "doctype": "Library Loan", "status": "Returned", "fine_amount": 110.0, "fine_paid": 1, "...": "…"}}
```

### `reject_loan_request`
- **Path:** `mahanaim.api.library.reject_loan_request`
- **Method:** POST
- **Guard:** roles: Library Officer

Args: `loan` (required), `reason` (default `None`).

Example args: `{"loan": "LN-2026-000012", "reason": "Reference copy only"}`

```json
{"message": {"name": "LN-2026-000012", "doctype": "Library Loan", "status": "Cancelled", "remarks": "Rejected: Reference copy only", "...": "…"}}
```

### `borrower_lookup`
- **Path:** `mahanaim.api.library.borrower_lookup`
- **Method:** GET
- **Guard:** roles: Library Officer

Students and staff matching `q` for the issue desk (5 each).

Args: `q` (required).

Example args: `{"q": "grace"}`

```json
{
  "message": [
    {
      "borrower_type": "Student",
      "value": "STU-2026-00017",
      "label": "Grace Wanjiku",
      "description": "MBC/DBS/2026/0001 · Active"
    },
    {
      "borrower_type": "Student",
      "value": "STU-2026-00002",
      "label": "Grace Achieng",
      "description": "MBC/BTH/2026/0001 · Active"
    }
  ]
}
```
