# Church Partners, Sponsors & Giving API (`mahanaim.api.church`)

Calls go to `/api/method/<dotted path>`. Reads use GET and writes use POST. JSON arguments (`data`, `rows`, `names`,
`filters`, `recipients`, `students`) may be sent as objects/lists or as JSON strings. Responses are wrapped in
`{"message": ...}`. A missing record raises `DoesNotExistError` (404), a failed guard raises `PermissionError` (403)
and validation failures raise `ValidationError` (417) with a translated message. Examples were captured from the
demo dataset (`docs/DEMO.md`); long lists are trimmed.

Covers SOW 7.2 M18 (ported from cfms_plus): partner churches, sponsors and sponsorships, giving, chapel and ministry
groups, plus the public `/give` page. The sponsor self-service portal is in `docs/api/sponsor.md`.

**Guards**
- **guest**: `allow_guest=True`. Anyone, including anonymous visitors.
- **guest · rate-limited**: as guest, plus a per-IP `rate_limit` (HTTP 429 when exceeded). Public forms also carry a
  honeypot argument `website` that must stay empty; when filled, the call quietly returns `{"ok": true}` and saves nothing.
- **login**: any signed-in user (`require_login`).
- **staff**: any staff role (`require_staff`).
- **roles: …**: `require_roles(...)`. System Manager, College Administrator and Administrator always pass.

Every role a read guard admits also holds a read-only DocPerm on the doctypes that endpoint reads, so the
permission-aware lists and `check_permission("read")` never return 403 for an admitted role. For example, Registrar
reads Giving Record and Giving Type, Finance Officer reads Library Item, and chapel and ministry reads are limited to
Chaplain, Registrar, Academic Dean and Auditor. `test_church.test_read_gates_match_doctype_permissions` enforces this.

**Public giving flow (`/give`)**
1. `giving_options()` lists active Giving Types with `allow_online = 1` (all active types when none are flagged), the
   PayBill details and the currency.
2. `give(...)` validates the type, the amount (`0 < amount ≤ 250,000`) and a Kenyan mobile number, then calls
   `services.mpesa.initiate_payment(phone, amount, "Giving", ...)`. The giver details are kept as a 24-hour intent
   keyed by the request.
3. The frontend polls `giving_status(request, checkout_request_id)`, which returns `{status, done, receipt, message}`.
   Only "Giving" requests are visible, and the receipt is only returned to the initiator.
4. On a successful callback, `services.church.on_mpesa_success(request, transaction)` creates and submits the
   **Giving Record** (idempotent per request). `giving_status` and the hourly `reconcile_online_giving` also create
   it if the callback hook did not.

## Rules enforced by the controllers

- **Partner Church**: a NestedSet tree (`parent_partner_church`). The parent must be a group and a church cannot be
  its own parent. `church_code` is unique. A church with branches must stay a group. Churches linked to students or
  sponsors cannot be deleted.
- **Sponsor**
  - The phone is normalised to `2547…`. The email is unique among sponsors.
  - When there is an email and `flags.create_user` is not False, a portal user with the Sponsor role is created via
    `services.students.ensure_user`. Failures are logged, never raised.
  - `total_committed`, `total_disbursed` (Student Payments with `sponsor` plus submitted Giving Records) and
    `active_sponsorships` are rolled up from sponsorships and payments.
- **Sponsorship**
  - Status machine: `Proposed → Active | Cancelled`, `Active → Suspended | Completed | Cancelled`,
    `Suspended → Active | Completed | Cancelled`, `Completed → Active`, `Cancelled → Proposed | Active`.
  - Coverage: Percentage needs `0 < percentage ≤ 100`. Fixed Amount / Per Term / Per Year need `amount > 0`.
  - One open (Proposed/Active/Suspended) sponsorship per sponsor + student. Only one Full Fees sponsorship per
    student, and Percentage sponsorships may not add up to more than 100%.
  - The sponsor must be active. The end term cannot be before the start term.
  - On Active, `Student.primary_sponsor` is set when empty and `fee_category` becomes "Sponsored".
  - Sponsorships cannot be deleted; cancel them instead.
- **Giving Record** (submittable)
  - `amount > 0`, the posting date cannot be in the future and the giving type must be active.
  - The giver link must match `giver_type` (Sponsor/Partner Church/Student); otherwise a giver name is required
    (or Anonymous).
  - Non-cash modes need a reference number, which must be unique.
  - When `has_app("erpnext")` and the `post_to_erpnext` setting are on, a Journal Entry is attempted on submit.
    Failures are logged, never raised.
- **Giving Type**: a type with giving records cannot be deleted; deactivate it instead.
- **Chapel Service**: a future service cannot be marked Held. Headcounts and the offering total cannot be negative.
  `total_attendance` is the larger of the headcount sum and the Present attendance rows.
- **Ministry Group**: members are unique, and the patron must be an active staff member.

## Endpoints

### `church_dashboard`
- **Path:** `mahanaim.api.church.church_dashboard`
- **Method:** GET
- **Guard:** roles: Chaplain, Finance Officer, Auditor, Registrar

Args: None.

```json
{
  "message": {
    "kpis": {
      "partner_churches": 4,
      "active_churches": 4,
      "sponsors": 5,
      "active_sponsors": 5,
      "active_sponsorships": 9,
      "committed": 550250.0,
      "disbursed": 541250.0,
      "disbursed_pct": 98.4,
      "giving_12m": 280950.0,
      "giving_this_month": 35950.0
    },
    "churches_by_status": {"Active": 4},
    "sponsorships_by_status": {"Proposed": 1, "Active": 9},
    "students_per_church": [
      {
        "church": "Harvest Fellowship Nakuru Town",
        "church_name": "Harvest Fellowship Nakuru Town",
        "students": 6
      },
      {"church": "Harvest Fellowship Kasarani", "church_name": "Harvest Fellowship Kasarani", "students": 6}
    ],
    "giving_by_type": [
      {"giving_type": "Scholarship Fund", "total": 125000.0},
      {"giving_type": "Building Fund", "total": 105000.0}
    ],
    "giving_by_month": [{"month": "2025-11", "total": 30000.0}, {"month": "2025-12", "total": 15000.0}],
    "chapel_trend": [
      {"month": "2025-11", "services": 0, "attendance": 0, "average": 0},
      {"month": "2025-12", "services": 0, "attendance": 0, "average": 0}
    ],
    "chart": {"labels": ["2025-11", "2025-12"], "datasets": [{"name": "Giving", "values": [30000.0]}]},
    "recent_giving": [
      {
        "name": "GIV-2026-00003",
        "giving_type": "Scholarship Fund",
        "giver_name": "Harvest Fellowship Kasarani Missions Board",
        "amount": 25000.0,
        "posting_date": "2026-10-22",
        "mode_of_payment": "Bank"
      },
      {
        "name": "GIV-2026-00012",
        "giving_type": "Offering",
        "giver_name": "Anonymous",
        "amount": 8450.0,
        "posting_date": "2026-10-21",
        "mode_of_payment": "Cash"
      }
    ],
    "upcoming_chapel": [
      {
        "name": "CHP-2026-00010",
        "service_date": "2026-10-28",
        "service_type": "Chapel",
        "campus": "Main Campus Nairobi",
        "theme": "Faithful in Little Things",
        "preacher": null
      }
    ]
  }
}
```

### `list_churches`
- **Path:** `mahanaim.api.church.list_churches`
- **Method:** GET
- **Guard:** roles: Chaplain, Finance Officer, Admissions Officer, Communications Officer, Auditor, Registrar

Args: `tree` (default `1`), `search` (default `None`), `status` (default `None`), `start` (default `0`), `page_length` (default `50`).

```json
{
  "message": {
    "data": [
      {
        "name": "Harvest Fellowship Churches",
        "church_name": "Harvest Fellowship Churches",
        "church_code": "HFC",
        "denomination": "Harvest Fellowship Churches",
        "church_type": "Headquarters",
        "partnership_status": "Active",
        "town": "Nairobi",
        "county": "Nairobi",
        "senior_pastor": "Bishop Samuel Gitonga",
        "phone": "254720111222",
        "email": "office@harvestfellowship.example",
        "is_group": 1,
        "parent_partner_church": null,
        "lft": 1,
        "rgt": 8,
        "students": 0,
        "children": [
          {
            "name": "Harvest Fellowship Kasarani",
            "church_name": "Harvest Fellowship Kasarani",
            "church_code": "HFC-KSR",
            "denomination": "Harvest Fellowship Churches",
            "church_type": "Local Church",
            "partnership_status": "Active",
            "town": "Kasarani",
            "county": "Nairobi",
            "senior_pastor": "Rev. Joseph Gitau",
            "phone": "254720333444",
            "email": null,
            "is_group": 0,
            "parent_partner_church": "Harvest Fellowship Churches",
            "lft": 2,
            "rgt": 3,
            "students": 6,
            "children": [],
            "students_total": 6
          }
        ],
        "students_total": 16
      },
      {
        "name": "Grace Chapel Kitengela",
        "church_name": "Grace Chapel Kitengela",
        "church_code": "GCK",
        "denomination": "Independent",
        "church_type": "Local Church",
        "partnership_status": "Active",
        "town": "Kitengela",
        "county": "Kajiado",
        "senior_pastor": "Pastor Moses Lekishon",
        "phone": "254711909808",
        "email": null,
        "is_group": 0,
        "parent_partner_church": null,
        "lft": 9,
        "rgt": 10,
        "students": 3,
        "children": [],
        "students_total": 3
      }
    ],
    "total": 5
  }
}
```

### `get_church`
- **Path:** `mahanaim.api.church.get_church`
- **Method:** GET
- **Guard:** roles: Chaplain, Finance Officer, Admissions Officer, Communications Officer, Auditor, Registrar

Args: `name` (required).

Example args: `{"name": "Grace Chapel Kitengela"}`

```json
{
  "message": {
    "name": "Grace Chapel Kitengela",
    "owner": "Administrator",
    "creation": "2026-10-22 00:00:25.299024",
    "modified": "2026-10-22 00:00:25.299024",
    "modified_by": "Administrator",
    "docstatus": 0,
    "idx": 0,
    "church_name": "Grace Chapel Kitengela",
    "church_code": "GCK",
    "denomination": "Independent",
    "church_type": "Local Church",
    "partnership_status": "Active",
    "partnership_since": "2016-07-01",
    "sponsor": null,
    "senior_pastor": "Pastor Moses Lekishon",
    "contact_person": null,
    "phone": "254711909808",
    "email": null,
    "website": null,
    "county": "Kajiado",
    "town": "Kitengela",
    "address": null,
    "mou_document": null,
    "notes": null,
    "is_group": 0,
    "parent_partner_church": null,
    "lft": 9,
    "rgt": 10,
    "old_parent": "",
    "doctype": "Partner Church",
    "branches": [],
    "students": [
      {
        "name": "STU-2026-00013",
        "full_name": "Esther Nyambura",
        "student_number": "MBC/CTH/2026/0002",
        "programme": "CTH",
        "status": "Active",
        "year_of_study": 1
      },
      {
        "name": "STU-2026-00019",
        "full_name": "Joy Chebet",
        "student_number": "MBC/DBS/2026/0003",
        "programme": "DBS",
        "status": "Active",
        "year_of_study": 1
      }
    ],
    "sponsors": [],
    "giving_total": 50000.0
  }
}
```

### `save_church`
- **Path:** `mahanaim.api.church.save_church`
- **Method:** POST
- **Guard:** roles: Chaplain, Finance Officer, Admissions Officer, Communications Officer

Args: `data` (required).

Example args: `{"data": {"name": "Grace Chapel Kitengela", "county": "Nairobi"}}`

```json
{
  "message": {
    "name": "Grace Chapel Kitengela",
    "owner": "Administrator",
    "creation": "2026-10-22 00:00:25.299024",
    "modified": "2026-10-22 00:09:12.222431",
    "modified_by": "admin@mahanaim.demo",
    "docstatus": 0,
    "idx": 0,
    "church_name": "Grace Chapel Kitengela",
    "church_code": "GCK",
    "denomination": "Independent",
    "church_type": "Local Church",
    "partnership_status": "Active",
    "partnership_since": "2016-07-01",
    "sponsor": null,
    "senior_pastor": "Pastor Moses Lekishon",
    "contact_person": null,
    "phone": "254711909808",
    "email": null,
    "website": null,
    "county": "Nairobi",
    "town": "Kitengela",
    "address": null,
    "mou_document": null,
    "notes": null,
    "is_group": 0,
    "parent_partner_church": null,
    "lft": 9,
    "rgt": 10,
    "old_parent": "",
    "doctype": "Partner Church"
  }
}
```

### `list_sponsors`
- **Path:** `mahanaim.api.church.list_sponsors`
- **Method:** GET
- **Guard:** roles: Chaplain, Finance Officer, Auditor, Registrar, Admissions Officer

Args: `search` (default `None`), `status` (default `None`), `sponsor_type` (default `None`), `partner_church` (default `None`), `start` (default `0`), `page_length` (default `20`).

Example args: `{"page_length": 2}`

```json
{
  "message": {
    "data": [
      {
        "name": "SPN-00001",
        "sponsor_name": "Grace Community Church",
        "sponsor_type": "Church",
        "partner_church": null,
        "status": "Active",
        "email": "sponsor@example.com",
        "phone": "254722000111",
        "user": "sponsor@example.com",
        "country": "Kenya",
        "total_committed": 44000.0,
        "total_disbursed": 0.0,
        "active_sponsorships": 2
      },
      {
        "name": "SPN-00002",
        "sponsor_name": "Harvest Fellowship Kasarani Missions Board",
        "sponsor_type": "Church",
        "partner_church": "Harvest Fellowship Kasarani",
        "status": "Active",
        "email": "sponsor@mahanaim.demo",
        "phone": "254722600700",
        "user": "sponsor@mahanaim.demo",
        "country": "Kenya",
        "total_committed": 167000.0,
        "total_disbursed": 187000.0,
        "active_sponsorships": 3
      }
    ],
    "total": 5
  }
}
```

### `save_sponsor`
- **Path:** `mahanaim.api.church.save_sponsor`
- **Method:** POST
- **Guard:** roles: Chaplain, Finance Officer

Args: `data` (required), `create_user` (default `1`).

Example args: `{"data": {"name": "SPN-00002", "phone": "0722410300"}}`

```json
{
  "message": {
    "name": "SPN-00002",
    "owner": "Administrator",
    "creation": "2026-10-22 00:00:26.259503",
    "modified": "2026-10-22 00:09:12.234375",
    "modified_by": "admin@mahanaim.demo",
    "docstatus": 0,
    "idx": 0,
    "sponsor_name": "Harvest Fellowship Kasarani Missions Board",
    "sponsor_type": "Church",
    "partner_church": "Harvest Fellowship Kasarani",
    "status": "Active",
    "email": "sponsor@mahanaim.demo",
    "phone": "254722410300",
    "user": "sponsor@mahanaim.demo",
    "preferred_communication": "Email",
    "contact_person": "Elder Joseph Gitau",
    "country": "Kenya",
    "address": null,
    "total_committed": 167000.0,
    "total_disbursed": 187000.0,
    "active_sponsorships": 3,
    "notes": null,
    "doctype": "Sponsor"
  }
}
```

### `refresh_sponsor`
- **Path:** `mahanaim.api.church.refresh_sponsor`
- **Method:** POST
- **Guard:** roles: Chaplain, Finance Officer

Args: `name` (required).

Example args: `{"name": "SPN-00002"}`

```json
{
  "message": {
    "name": "SPN-00002",
    "owner": "Administrator",
    "creation": "2026-10-22 00:00:26.259503",
    "modified": "2026-10-22 00:00:26.259503",
    "modified_by": "Administrator",
    "docstatus": 0,
    "idx": 0,
    "sponsor_name": "Harvest Fellowship Kasarani Missions Board",
    "sponsor_type": "Church",
    "partner_church": "Harvest Fellowship Kasarani",
    "status": "Active",
    "email": "sponsor@mahanaim.demo",
    "phone": "254722600700",
    "user": "sponsor@mahanaim.demo",
    "preferred_communication": "Email",
    "contact_person": "Elder Joseph Gitau",
    "country": "Kenya",
    "address": null,
    "total_committed": 167000.0,
    "total_disbursed": 187000.0,
    "active_sponsorships": 3,
    "notes": null,
    "doctype": "Sponsor"
  }
}
```

### `send_sponsor_reports`
- **Path:** `mahanaim.api.church.send_sponsor_reports`
- **Method:** POST
- **Guard:** roles: Chaplain, Finance Officer

Sends the "Sponsor Report" notification (Message Template event `Sponsor Report`, link `/sponsor`) through
`services.church.send_sponsor_reports(sponsor=None)`.
- With `sponsor`, it sends at once and returns the result.
- Without it, every active sponsor is sent a report by a background job on the `long` queue, and the call returns
  `{queued: true, job}`.

Who receives it:
- Recipients: the sponsor's portal user (in-app), email and phone, following the template's channels.
- Skipped: sponsors that are inactive, have no Active/Suspended sponsorship, or have no contact details.
- When no template is active, a literal fallback (subject, email and in-app text) is used.

Template context: the standard keys (`doc` = the Sponsor, `settings`, `college`, `site_url`, `recipient`) plus:
- `students` (int): currently sponsored students;
- `outstanding` (str): their combined positive fee balance, e.g. `"KES 12,500.00"`.

Args: `sponsor` (default `None` = all active sponsors).

Example args: `{"sponsor": "SPN-00002"}`

```json
{
  "message": {
    "queued": false,
    "sent": 1,
    "skipped": 0,
    "sponsors": ["SPN-00002"],
    "message": "Sponsor report sent."
  }
}
```

Without `sponsor`:

```json
{"message": {"queued": true, "job": "mahanaim.localhost||3b1f…", "message": "Sponsor reports are being sent to all active sponsors."}}
```

`services.church.send_termly_sponsor_reports(days_after=14)` is a daily-cron helper. It sends every report once,
14 days after an Academic Term's `end_date`, and only once the lead wires it into `hooks.py`.

### `sponsor_360`
- **Path:** `mahanaim.api.church.sponsor_360`
- **Method:** GET
- **Guard:** roles: Chaplain, Finance Officer, Auditor, Registrar, Admissions Officer

Everything about a sponsor in one call: profile, sponsorships with student balances, payments, giving.

Args: `name` (required).

Example args: `{"name": "SPN-00002"}`

```json
{
  "message": {
    "sponsor": {
      "name": "SPN-00002",
      "owner": "Administrator",
      "creation": "2026-10-22 00:00:26.259503",
      "modified": "2026-10-22 00:00:26.259503",
      "modified_by": "Administrator",
      "docstatus": 0,
      "idx": 0,
      "sponsor_name": "Harvest Fellowship Kasarani Missions Board",
      "sponsor_type": "Church",
      "partner_church": "Harvest Fellowship Kasarani",
      "status": "Active",
      "email": "sponsor@mahanaim.demo",
      "phone": "254722600700",
      "user": "sponsor@mahanaim.demo",
      "preferred_communication": "Email",
      "contact_person": "Elder Joseph Gitau",
      "country": "Kenya",
      "address": null,
      "total_committed": 167000.0,
      "total_disbursed": 187000.0,
      "active_sponsorships": 3,
      "notes": null,
      "doctype": "Sponsor"
    },
    "sponsorships": [
      {
        "name": "SPS-2026-00003",
        "student": "STU-2026-00017",
        "student_name": "Grace Wanjiku",
        "programme": "DBS",
        "status": "Active",
        "coverage": "Percentage",
        "amount": 0.0,
        "percentage": 50.0,
        "start_term": "2025-2026 Term 3",
        "end_term": null,
        "amount_disbursed": 0.0,
        "reporting_frequency": "Termly",
        "student_number": "MBC/DBS/2026/0001",
        "photo": null,
        "student_status": "Active",
        "campus": "Main Campus Nairobi",
        "year_of_study": 1,
        "cgpa": 3.94,
        "balance": 18500.0
      },
      {
        "name": "SPS-2026-00004",
        "student": "STU-2026-00024",
        "student_name": "Joseph Kiplagat",
        "programme": "DBS",
        "status": "Active",
        "coverage": "Full Fees",
        "amount": 0.0,
        "percentage": 0.0,
        "start_term": "2025-2026 Term 3",
        "end_term": null,
        "amount_disbursed": 0.0,
        "reporting_frequency": "Termly",
        "student_number": "MBC/DBS/2026/0004",
        "photo": null,
        "student_status": "Active",
        "campus": "Nakuru Campus",
        "year_of_study": 1,
        "cgpa": 3.29,
        "balance": 0.0
      }
    ],
    "payments": [
      {
        "name": "RCT-2026-00030",
        "student": "STU-2026-00024",
        "amount": 49000.0,
        "posting_date": "2026-09-22",
        "mode_of_payment": "Sponsor Remittance",
        "reference_no": "SR-9B8405A0"
      },
      {
        "name": "RCT-2026-00023",
        "student": "STU-2026-00021",
        "amount": 20000.0,
        "posting_date": "2026-09-14",
        "mode_of_payment": "Sponsor Remittance",
        "reference_no": "SR-4C4A7021"
      }
    ],
    "giving": [
      {
        "name": "GIV-2026-00003",
        "giving_type": "Scholarship Fund",
        "amount": 25000.0,
        "posting_date": "2026-10-22",
        "mode_of_payment": "Bank",
        "reference_no": "EQB951A871",
        "purpose": "Scholarship Fund gift"
      },
      {
        "name": "GIV-2026-00004",
        "giving_type": "Scholarship Fund",
        "amount": 25000.0,
        "posting_date": "2026-07-22",
        "mode_of_payment": "Bank",
        "reference_no": "EQBCECC090",
        "purpose": "Scholarship Fund gift"
      }
    ],
    "summary": {
      "committed": 167000.0,
      "disbursed": 187000.0,
      "active_sponsorships": 3,
      "students": 3,
      "outstanding_for_students": 33500.0,
      "giving_total": 50000.0
    }
  }
}
```

### `list_sponsorships`
- **Path:** `mahanaim.api.church.list_sponsorships`
- **Method:** GET
- **Guard:** roles: Chaplain, Finance Officer, Auditor, Registrar

Args: `sponsor` (default `None`), `student` (default `None`), `status` (default `None`), `coverage` (default `None`), `search` (default `None`), `start` (default `0`), `page_length` (default `20`).

Example args: `{"page_length": 2}`

```json
{
  "message": {
    "data": [
      {
        "name": "SPS-2026-00010",
        "sponsor": "SPN-00004",
        "sponsor_name": "Living Hope Foundation",
        "student": "STU-2026-00031",
        "student_name": "Elijah Kirui",
        "programme": "DPM",
        "status": "Proposed",
        "coverage": "Percentage",
        "amount": 0.0,
        "percentage": 40.0,
        "start_term": "2026-2027 Term 1",
        "end_term": null,
        "amount_disbursed": 0.0,
        "modified": "2026-10-22 00:01:06.021584"
      },
      {
        "name": "SPS-2026-00009",
        "sponsor": "SPN-00005",
        "sponsor_name": "MBC Alumni Association",
        "student": "STU-2026-00027",
        "student_name": "Ruth Moraa",
        "programme": "DBS",
        "status": "Active",
        "coverage": "Percentage",
        "amount": 0.0,
        "percentage": 25.0,
        "start_term": "2026-2027 Term 1",
        "end_term": null,
        "amount_disbursed": 0.0,
        "modified": "2026-10-22 00:01:06.011478"
      }
    ],
    "total": 10
  }
}
```

### `save_sponsorship`
- **Path:** `mahanaim.api.church.save_sponsorship`
- **Method:** POST
- **Guard:** roles: Chaplain, Finance Officer

Args: `data` (required).

Example args: `{"data": {"name": "SPS-2026-00005", "notes": "Reviewed"}}`

```json
{
  "message": {
    "name": "SPS-2026-00005",
    "owner": "Administrator",
    "creation": "2026-10-22 00:01:05.967546",
    "modified": "2026-10-22 00:09:12.275988",
    "modified_by": "admin@mahanaim.demo",
    "docstatus": 0,
    "idx": 0,
    "sponsor": "SPN-00002",
    "sponsor_name": "Harvest Fellowship Kasarani Missions Board",
    "student": "STU-2026-00021",
    "student_name": "Mercy Njeri",
    "programme": "DPM",
    "status": "Active",
    "coverage": "Fixed Amount",
    "amount": 20000.0,
    "percentage": 0.0,
    "start_term": "2025-2026 Term 3",
    "end_term": null,
    "scholarship": null,
    "reporting_frequency": "Termly",
    "amount_disbursed": 0.0,
    "notes": "Reviewed",
    "doctype": "Sponsorship"
  }
}
```

### `set_sponsorship_status`
- **Path:** `mahanaim.api.church.set_sponsorship_status`
- **Method:** POST
- **Guard:** roles: Chaplain, Finance Officer

Args: `name` (required), `status` (required), `notes` (default `None`).

Example args: `{"name": "SPS-2026-00005", "status": "Suspended", "notes": "Awaiting remittance"}`

```json
{
  "message": {
    "name": "SPS-2026-00005",
    "owner": "Administrator",
    "creation": "2026-10-22 00:01:05.967546",
    "modified": "2026-10-22 00:09:12.292137",
    "modified_by": "admin@mahanaim.demo",
    "docstatus": 0,
    "idx": 0,
    "sponsor": "SPN-00002",
    "sponsor_name": "Harvest Fellowship Kasarani Missions Board",
    "student": "STU-2026-00021",
    "student_name": "Mercy Njeri",
    "programme": "DPM",
    "status": "Suspended",
    "coverage": "Fixed Amount",
    "amount": 20000.0,
    "percentage": 0.0,
    "start_term": "2025-2026 Term 3",
    "end_term": null,
    "scholarship": null,
    "reporting_frequency": "Termly",
    "amount_disbursed": 0.0,
    "notes": "[2026-10-22 admin@mahanaim.demo] Awaiting remittance",
    "doctype": "Sponsorship"
  }
}
```

### `list_giving_types`
- **Path:** `mahanaim.api.church.list_giving_types`
- **Method:** GET
- **Guard:** roles: Chaplain, Finance Officer, Auditor, Registrar

Args: `include_inactive` (default `0`).

```json
{
  "message": [
    {
      "name": "Building Fund",
      "giving_type_name": "Building Fund",
      "is_active": 1,
      "allow_online": 1,
      "suggested_amounts": "1000, 5000, 10000",
      "income_account": null,
      "description": null
    },
    {
      "name": "Missions",
      "giving_type_name": "Missions",
      "is_active": 1,
      "allow_online": 1,
      "suggested_amounts": "1000, 2500, 5000",
      "income_account": null,
      "description": null
    }
  ]
}
```

### `save_giving_type`
- **Path:** `mahanaim.api.church.save_giving_type`
- **Method:** POST
- **Guard:** roles: Chaplain, Finance Officer

Args: `data` (required).

Example args: `{"data": {"name": "Missions", "allow_online": 1, "suggested_amounts": "1000, 2500, 5000"}}`

```json
{
  "message": {
    "name": "Missions",
    "owner": "Administrator",
    "creation": "2026-10-21 22:36:59.647233",
    "modified": "2026-10-22 00:09:12.309580",
    "modified_by": "admin@mahanaim.demo",
    "docstatus": 0,
    "idx": 0,
    "giving_type_name": "Missions",
    "is_active": 1,
    "allow_online": 1,
    "income_account": null,
    "suggested_amounts": "1000, 2500, 5000",
    "description": null,
    "doctype": "Giving Type"
  }
}
```

### `list_giving`
- **Path:** `mahanaim.api.church.list_giving`
- **Method:** GET
- **Guard:** roles: Chaplain, Finance Officer, Auditor, Registrar

Args: `giving_type` (default `None`), `giver_type` (default `None`), `sponsor` (default `None`), `partner_church` (default `None`), `chapel_service` (default `None`), `from_date` (default `None`), `to_date` (default `None`), `search` (default `None`), `include_cancelled` (default `0`), `start` (default `0`), `page_length` (default `20`).

`search` matches giver name, giver email, reference, record name and purpose. Each row includes `giver_email`.

Example args: `{"page_length": 2}`

```json
{
  "message": {
    "data": [
      {
        "name": "GIV-2026-00003",
        "giving_type": "Scholarship Fund",
        "giver_type": "Sponsor",
        "giver_name": "Harvest Fellowship Kasarani Missions Board",
        "giver_email": null,
        "sponsor": "SPN-00002",
        "partner_church": null,
        "student": null,
        "posting_date": "2026-10-22",
        "amount": 25000.0,
        "mode_of_payment": "Bank",
        "reference_no": "EQB951A871",
        "docstatus": 1,
        "receipt_sent": 1,
        "chapel_service": null
      },
      {
        "name": "GIV-2026-00012",
        "giving_type": "Offering",
        "giver_type": "Anonymous",
        "giver_name": "Anonymous",
        "giver_email": null,
        "sponsor": null,
        "partner_church": null,
        "student": null,
        "posting_date": "2026-10-21",
        "amount": 8450.0,
        "mode_of_payment": "Cash",
        "reference_no": "CASH-6E38A5",
        "docstatus": 1,
        "receipt_sent": 0,
        "chapel_service": "CHP-2026-00004"
      }
    ],
    "total": 16,
    "totals": {
      "amount": 280950.0,
      "count": 16,
      "by_type": [
        {"giving_type": "Thanksgiving", "total": 3500.0, "count": 2},
        {"giving_type": "Offering", "total": 8450.0, "count": 1}
      ]
    }
  }
}
```

### `record_giving`
- **Path:** `mahanaim.api.church.record_giving`
- **Method:** POST
- **Guard:** roles: Chaplain, Finance Officer

Create a Giving Record and (by default) submit it — which posts the journal and sends the receipt.

Args: `data` (required), `submit` (default `1`).

`data` accepts `giving_type`, `giver_type`, `sponsor`, `partner_church`, `student`, `giver_name`, `giver_email`,
`posting_date`, `amount`, `mode_of_payment`, `reference_no`, `msisdn`, `chapel_service` and `purpose`.
`giver_email` is optional. It is trimmed, lower-cased and validated (an invalid address raises `ValidationError`).
For a walk-in giver (no sponsor, student or church), it is where the receipt email is sent.

Example args: `{"data": {"giving_type": "Missions", "giver_type": "Other", "giver_name": "Jane Wanjiku", "giver_email": "jane.wanjiku@example.com", "amount": 2500, "mode_of_payment": "Cash"}}`

```json
{
  "message": {
    "name": "GIV-2026-00017",
    "owner": "admin@mahanaim.demo",
    "creation": "2026-10-22 00:09:12.316816",
    "modified": "2026-10-22 00:09:12.321511",
    "modified_by": "admin@mahanaim.demo",
    "docstatus": 1,
    "idx": 0,
    "giving_type": "Missions",
    "giver_type": "Other",
    "sponsor": null,
    "partner_church": null,
    "student": null,
    "giver_name": "Jane Wanjiku",
    "giver_email": "jane.wanjiku@example.com",
    "posting_date": "2026-10-22",
    "amount": 2500.0,
    "mode_of_payment": "Cash",
    "reference_no": null,
    "msisdn": null,
    "mpesa_request": null,
    "chapel_service": null,
    "purpose": null,
    "receipt_sent": 0,
    "journal_entry": null,
    "amended_from": null,
    "doctype": "Giving Record"
  }
}
```

### `cancel_giving`
- **Path:** `mahanaim.api.church.cancel_giving`
- **Method:** POST
- **Guard:** roles: Chaplain, Finance Officer

Args: `name` (required), `reason` (default `None`).

Example args: `{"name": "GIV-2026-00016", "reason": "Duplicate entry"}`

```json
{"message": {"ok": true, "name": "GIV-2026-00016"}}
```

### `list_chapel_services`
- **Path:** `mahanaim.api.church.list_chapel_services`
- **Method:** GET
- **Guard:** roles: Chaplain, Registrar, Academic Dean, Auditor (Finance Officer is not admitted)

Args: `status` (default `None`), `campus` (default `None`), `from_date` (default `None`), `to_date` (default `None`), `start` (default `0`), `page_length` (default `20`).

Ordered by `service_date desc, start_time desc`. Chapel Service has optional `start_time` (Time) and `venue` (Data, e.g.
"Main Chapel"; blank means the campus chapel) fields, which `get_chapel_service`/`save_chapel_service` also read and write.

Example args: `{"page_length": 2}`

```json
{
  "message": {
    "data": [
      {
        "name": "CHP-2026-00010",
        "service_date": "2026-10-28",
        "start_time": "10:00:00",
        "service_type": "Chapel",
        "campus": "Main Campus Nairobi",
        "venue": "Main Chapel",
        "status": "Scheduled",
        "theme": "Faithful in Little Things",
        "scripture": "Luke 16:10",
        "preacher": null,
        "men": 0,
        "women": 0,
        "children": 0,
        "visitors": 0,
        "total_attendance": 0,
        "offering_total": 0.0
      },
      {
        "name": "CHP-2026-00004",
        "service_date": "2026-10-21",
        "start_time": null,
        "service_type": "Chapel",
        "campus": "Main Campus Nairobi",
        "venue": null,
        "status": "Held",
        "theme": "Two Camps: God With Us on the Journey",
        "scripture": "Genesis 32:1–2",
        "preacher": "Stephen Mutua",
        "men": 38,
        "women": 57,
        "children": 0,
        "visitors": 3,
        "total_attendance": 98,
        "offering_total": 8450.0
      }
    ],
    "total": 10
  }
}
```

### `get_chapel_service`
- **Path:** `mahanaim.api.church.get_chapel_service`
- **Method:** GET
- **Guard:** roles: Chaplain, Registrar, Academic Dean, Auditor (Finance Officer is not admitted)

Args: `name` (required).

Example args: `{"name": "CHP-2026-00010"}`

```json
{
  "message": {
    "name": "CHP-2026-00010",
    "owner": "Administrator",
    "creation": "2026-10-22 00:00:27.768732",
    "modified": "2026-10-22 00:00:27.768732",
    "modified_by": "Administrator",
    "docstatus": 0,
    "idx": 0,
    "service_date": "2026-10-28",
    "service_type": "Chapel",
    "campus": "Main Campus Nairobi",
    "status": "Scheduled",
    "theme": "Faithful in Little Things",
    "scripture": "Luke 16:10",
    "preacher": null,
    "preacher_staff": null,
    "men": 0,
    "women": 0,
    "children": 0,
    "visitors": 0,
    "total_attendance": 0,
    "offering_total": 0.0,
    "notes": null,
    "sermon_media_url": null,
    "doctype": "Chapel Service",
    "attendance": [],
    "present_count": 0,
    "giving": []
  }
}
```

### `save_chapel_service`
- **Path:** `mahanaim.api.church.save_chapel_service`
- **Method:** POST
- **Guard:** roles: Chaplain

Args: `data` (required).

Example args: `{"data": {"name": "CHP-2026-00010", "theme": "Faithful in Little Things"}}`

```json
{
  "message": {
    "name": "CHP-2026-00010",
    "owner": "Administrator",
    "creation": "2026-10-22 00:00:27.768732",
    "modified": "2026-10-22 00:09:12.354784",
    "modified_by": "admin@mahanaim.demo",
    "docstatus": 0,
    "idx": 0,
    "service_date": "2026-10-28",
    "service_type": "Chapel",
    "campus": "Main Campus Nairobi",
    "status": "Scheduled",
    "theme": "Faithful in Little Things",
    "scripture": "Luke 16:10",
    "preacher": null,
    "preacher_staff": null,
    "men": 0,
    "women": 0,
    "children": 0,
    "visitors": 0,
    "total_attendance": 0,
    "offering_total": 0.0,
    "notes": null,
    "sermon_media_url": null,
    "doctype": "Chapel Service",
    "attendance": []
  }
}
```

### `record_chapel_attendance`
- **Path:** `mahanaim.api.church.record_chapel_attendance`
- **Method:** POST
- **Guard:** roles: Chaplain

Replace the roll for a service. rows = [{student, status}]; headcounts = {men, women, children, visitors}.

Args: `service` (required), `rows` (default `None`), `headcounts` (default `None`), `mark_held` (default `1`).

Example args: `{"service": "CHP-2026-00009", "headcounts": {"visitors": 9}, "rows": [{"student": "STU-2026-00017", "status": "Present"}]}`

```json
{"message": {"name": "CHP-2026-00009", "total_attendance": 113, "present": 1, "rows": 1, "status": "Held"}}
```

### `my_chapel`
- **Path:** `mahanaim.api.church.my_chapel`
- **Method:** GET
- **Guard:** login, and the session user must be linked to a Student (`Student.user`); otherwise `PermissionError`
  "No student record is linked to your account."

The student portal's chapel page. Everything is scoped to the caller's own Student record. No args.

- `upcoming`: Scheduled services from today to today + 14 days at the student's campus (or with no campus), soonest
  first. `title` is the theme, falling back to the service type. `venue` falls back to the campus. `speaker` is the
  preacher.
- `attendance`: Held services in the current academic term (`term.start_date` to the earlier of `term.end_date` and
  today), or the last 120 days when no term is current. A service counts when it is at the student's campus or the
  student is on its roll, and it has a roll call. A student missing from the roll counts as Absent.
  `percent = attended / (held - excused) × 100`, rounded to 1 dp; `null` when nothing counts yet.
- `required_percent`: the `chapel_attendance_percent` field on Mahanaim Settings when it exists, else `null`.
  `meets_requirement` is `null` when either value is `null`.
- `ministries`: the student's memberships in active Ministry Groups.
- `practicum`: the student's enrolments (excluding Dropped/Withdrawn) in courses whose Programme Course `course_type` is
  "Practicum". There is no separate placement doctype.

```json
{
  "message": {
    "student": {"name": "STU-2026-00011", "full_name": "Joseph Kamau", "campus": "Nairobi Main Campus"},
    "term": {"name": "2026-2027 Term 1", "term_name": "Term 1", "start_date": "2026-09-07", "end_date": "2026-12-11"},
    "upcoming": [
      {
        "name": "CHP-2026-00012", "title": "Faithful in Little Things", "theme": "Faithful in Little Things",
        "service_type": "Chapel", "date": "2026-10-28", "start_time": "10:00:00", "venue": "Main Chapel",
        "campus": "Nairobi Main Campus", "speaker": "Rev. Peter Mwangi", "scripture": "Luke 16:10", "status": "Scheduled"
      }
    ],
    "attendance": {
      "from_date": "2026-09-07",
      "to_date": "2026-10-21",
      "records": [
        {
          "name": "CHP-2026-00011", "title": "Walking in the Spirit", "theme": "Walking in the Spirit",
          "service_type": "Chapel", "date": "2026-10-21", "start_time": null, "venue": "Nairobi Main Campus",
          "campus": "Nairobi Main Campus", "speaker": "Rev. Dr. Grace Wanjiru", "scripture": "Galatians 5:16-26",
          "status": "Held", "attendance": "Present"
        }
      ],
      "attended": 3, "excused": 0, "absent": 1, "held": 4, "percent": 75.0
    },
    "required_percent": null,
    "meets_requirement": null,
    "ministries": [
      {
        "group": "MIN-0003", "group_name": "Chapel Choir", "group_type": "Choir", "role": "Member",
        "joined_on": "2026-09-14", "campus": "Nairobi Main Campus", "meeting_day": "Wednesday",
        "meeting_time": "17:00:00", "patron_name": "Rev. Peter Mwangi"
      }
    ],
    "practicum": [
      {
        "course_offering": "PMN201-2026-T1", "course": "PMN201", "academic_term": "2026-2027 Term 1",
        "status": "Enrolled", "final_grade": null, "course_title": "Ministry Practicum I"
      }
    ]
  }
}
```

### `list_ministry_groups`
- **Path:** `mahanaim.api.church.list_ministry_groups`
- **Method:** GET
- **Guard:** roles: Chaplain, Registrar, Academic Dean, Auditor (Finance Officer is not admitted)

Args: `search` (default `None`), `group_type` (default `None`), `campus` (default `None`), `is_active` (default `None`), `start` (default `0`), `page_length` (default `50`).

```json
{
  "message": {
    "data": [
      {
        "name": "MBC Worship Team",
        "group_name": "MBC Worship Team",
        "group_type": "Worship Team",
        "campus": "Main Campus Nairobi",
        "is_active": 1,
        "patron": "STF-00004",
        "leader": null,
        "meeting_day": "Thursday",
        "meeting_time": "16:00:00",
        "members": 0,
        "leader_name": null,
        "patron_name": "Joseph Mwangi"
      },
      {
        "name": "Missions & Evangelism Team",
        "group_name": "Missions & Evangelism Team",
        "group_type": "Missions Team",
        "campus": "Main Campus Nairobi",
        "is_active": 1,
        "patron": null,
        "leader": "STU-2026-00013",
        "meeting_day": "Saturday",
        "meeting_time": "9:00:00",
        "members": 1,
        "leader_name": "Esther Nyambura",
        "patron_name": null
      }
    ],
    "total": 2
  }
}
```

### `get_ministry_group`
- **Path:** `mahanaim.api.church.get_ministry_group`
- **Method:** GET
- **Guard:** roles: Chaplain, Registrar, Academic Dean, Auditor (Finance Officer is not admitted)

Args: `name` (required).

Example args: `{"name": "Missions & Evangelism Team"}`

```json
{
  "message": {
    "name": "Missions & Evangelism Team",
    "owner": "Administrator",
    "creation": "2026-10-22 00:00:27.973107",
    "modified": "2026-10-22 00:00:27.973107",
    "modified_by": "Administrator",
    "docstatus": 0,
    "idx": 0,
    "group_name": "Missions & Evangelism Team",
    "group_type": "Missions Team",
    "campus": "Main Campus Nairobi",
    "is_active": 1,
    "patron": null,
    "leader": "STU-2026-00013",
    "meeting_day": "Saturday",
    "meeting_time": "9:00:00",
    "description": "Plans Missions Week and weekend outreach with partner churches.",
    "doctype": "Ministry Group",
    "members": [
      {
        "name": "bt70j9fh6a",
        "owner": "Administrator",
        "creation": "2026-10-22 00:00:27.973107",
        "modified": "2026-10-22 00:00:27.973107",
        "modified_by": "Administrator",
        "docstatus": 0,
        "idx": 1,
        "student": "STU-2026-00013",
        "student_name": "Esther Nyambura",
        "role": "Leader",
        "joined_on": "2026-09-01",
        "parent": "Missions & Evangelism Team",
        "parentfield": "members",
        "parenttype": "Ministry Group",
        "doctype": "Ministry Group Member"
      }
    ]
  }
}
```

### `save_ministry_group`
- **Path:** `mahanaim.api.church.save_ministry_group`
- **Method:** POST
- **Guard:** roles: Chaplain

Args: `data` (required).

Example args: `{"data": {"name": "Missions & Evangelism Team", "meeting_day": "Thursday"}}`

```json
{
  "message": {
    "name": "Missions & Evangelism Team",
    "owner": "Administrator",
    "creation": "2026-10-22 00:00:27.973107",
    "modified": "2026-10-22 00:09:12.378918",
    "modified_by": "admin@mahanaim.demo",
    "docstatus": 0,
    "idx": 0,
    "group_name": "Missions & Evangelism Team",
    "group_type": "Missions Team",
    "campus": "Main Campus Nairobi",
    "is_active": 1,
    "patron": null,
    "leader": "STU-2026-00013",
    "meeting_day": "Thursday",
    "meeting_time": "9:00:00",
    "description": "Plans Missions Week and weekend outreach with partner churches.",
    "doctype": "Ministry Group",
    "members": [
      {
        "name": "bt70j9fh6a",
        "owner": "Administrator",
        "creation": "2026-10-22 00:00:27.973107",
        "modified": "2026-10-22 00:09:12.378918",
        "modified_by": "admin@mahanaim.demo",
        "docstatus": 0,
        "idx": 1,
        "student": "STU-2026-00013",
        "student_name": "Esther Nyambura",
        "role": "Leader",
        "joined_on": "2026-09-01",
        "parent": "Missions & Evangelism Team",
        "parentfield": "members",
        "parenttype": "Ministry Group",
        "doctype": "Ministry Group Member"
      }
    ]
  }
}
```

### `partner_churches`
- **Path:** `mahanaim.api.church.partner_churches`
- **Method:** GET or POST
- **Guard:** guest · rate-limited (120 per 10 minutes per IP)

Public church pick-list, used for example by the applicant wizard's church step. It returns Active, non-group Partner
Churches with public fields only (no contacts, notes, MOU or sponsor), ordered by name. `search` matches the name,
town, county, denomination or church code. `website.apply_lookups().partner_churches` returns the full unsearched
list, without `county`.

Args: `search` (default `None`), `limit` (default `20`, clamped to 1–50).

Example args: `{"search": "kasarani", "limit": 10}`

```json
{"message": [
  {"name": "Harvest Fellowship Kasarani", "church_name": "Harvest Fellowship Kasarani", "denomination": "Pentecostal",
   "town": "Kasarani", "county": "Nairobi"}
]}
```

### `giving_options`
- **Path:** `mahanaim.api.church.giving_options`
- **Method:** GET or POST
- **Guard:** guest

Giving types offered online (+ quick amounts), PayBill details and currency for the public /give page.

Args: None.

```json
{
  "message": {
    "types": [
      {
        "name": "Building Fund",
        "giving_type_name": "Building Fund",
        "description": null,
        "suggested_amounts": [1000.0]
      },
      {"name": "Missions", "giving_type_name": "Missions", "description": null, "suggested_amounts": [1000.0]}
    ],
    "paybill": null,
    "currency": "KES"
  }
}
```

### `give`
- **Path:** `mahanaim.api.church.give`
- **Method:** POST
- **Guard:** guest · rate-limited

Start an M-Pesa STK push for a gift. The Giving Record (and receipt) follows when the payment completes.

Args: `giving_type` (required), `amount` (required), `phone` (required), `full_name` (default `None`), `email` (default `None`), `anonymous` (default `0`), `sponsor` (default `None`), `note` (default `None`), `website` (default `None`).

Example args: `{"giving_type": "Missions", "amount": 1000, "phone": "0712345678", "full_name": "Ruth Wairimu", "anonymous": 0}`

```json
{"message": {"request": "STK-2026-000032", "checkout_request_id": "ws_CO_22102026101500456",
  "message": "Success. Request accepted for processing", "simulation": false}}
```

### `giving_status`
- **Path:** `mahanaim.api.church.giving_status`
- **Method:** GET or POST (the shared MpesaPay poller may use either)
- **Guard:** guest · rate-limited

Guest-safe poll for a gift started with `give`: `{status, done, receipt, message}`.

Args: `request` (required), `checkout_request_id` (default `None`).

Example args: `{"request": "STK-2026-000032", "checkout_request_id": "ws_CO_22102026101500456"}`

```json
{"message": {"status": "Completed", "done": true, "receipt": "SJK4H2L9QX", "message": "Thank you! Your gift has been received."}}
```
