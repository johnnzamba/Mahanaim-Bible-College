# Setup & Master Data API (`mahanaim.api.setup`)

Calls go to `/api/method/<dotted path>`; GET for reads, POST for writes.

**Guards**
- `staff`: any of System Manager, College Administrator, Registrar, Admissions Officer, Finance Officer,
  Academic Dean, Library Officer, Auditor, Communications Officer or Chaplain. A user who only has the Lecturer
  role is not "staff" here.
- `admin`: System Manager or College Administrator only.
- Every write also runs the normal DocType permission check (`check_permission("write")` or
  `has_permission(..., "create")`), so desk role permissions still apply.

## Master-data rules (controllers)

| DocType | Rules |
| --- | --- |
| Campus | `code` is upper-cased and must be unique |
| Academic Year | start < end. Only one is `is_current`; setting it updates `Mahanaim Settings.current_academic_year` |
| Academic Term | Dates must fall within the academic year. `registration_start ≤ registration_end ≤ late_registration_end`. `term_label` is set automatically. Only one is `is_current`; setting it updates Settings `current_academic_term` and `current_academic_year` |
| Department / Study Mode | `code` is upper-cased and unique; Study Mode requires a code |
| Intake | Applications open ≤ close. Capacity ≥ 0. The start date must fall within the academic year |
| Mahanaim Settings | Percentages are 0–100. OTP length is 4–8. `student_number_format` must contain a `{#…}` token, e.g. `MBC/{programme_code}/{year}/{####}` (tokens: `programme_code`, `campus_code`, `year`, `yy`, `short_name`) |
| Staff Member | Details below |

**Staff Member**
- `full_name` is computed.
- `staff_number` comes from a series when left blank.
- A login is created when an email exists and no user is linked, unless `create_user=0`.
- `is_lecturer` grants the **Lecturer** role.
- Campus User Permissions are kept for `campus` plus `additional_campuses`; stale ones are removed. Admins are
  skipped.
- The user's `enabled` flag follows status: Inactive disables it.

## `lookups`
- **Path:** `mahanaim.api.setup.lookups`
- **Method:** GET
- **Guard:** staff

Returns all admin-SPA dropdown data in one call.

```json
{"message": {
  "campuses": [{"name": "Main Campus", "campus_name": "Main Campus", "code": "MAIN", "is_main_campus": 1, "is_active": 1, "town": "Nairobi"}],
  "departments": [{"name": "Theology", "department_name": "Theology", "code": "THE", "is_active": 1}],
  "programmes": [{"name": "DBS", "code": "DBS", "programme_name": "Diploma in Biblical Studies", "level": "Diploma", "status": "Active",
                  "department": "Theology", "duration_years": 2}],
  "study_modes": [{"name": "Full Time", "study_mode_name": "Full Time", "code": "FT", "is_online": 0, "is_active": 1}],
  "intakes": [{"name": "September 2026", "intake_name": "September 2026", "academic_year": "2026-2027", "start_date": "2026-09-01", "applications_open": 1}],
  "academic_years": [{"name": "2026-2027", "year_name": "2026-2027", "is_current": 1, "start_date": "…", "end_date": "…"}],
  "terms": [{"name": "2026-2027 Term 1", "term_label": "Term 1 2026-2027", "term_name": "Term 1", "term_number": 1,
             "academic_year": "2026-2027", "status": "Registration Open", "is_current": 1, "start_date": "…", "end_date": "…"}],
  "lecturers": [{"name": "STF-0002", "full_name": "Grace L", "salutation": "Dr", "user": "grace@…", "department": "Theology", "campus": "Main Campus"}],
  "current_term": "2026-2027 Term 1", "current_year": "2026-2027",
  "options": {"student_status": ["Applicant", "Admitted", "…"], "application_status": ["Draft", "…"],
              "registration_status": ["…"], "request_type": ["…"], "request_status": ["…"], "gender": ["…"],
              "fee_category": ["…"], "staff_type": ["…"], "staff_status": ["Active", "On Leave", "Inactive"],
              "term_status": ["…"], "programme_level": ["…"]}}}
```

- `terms[].is_current` is 1 for the term that is current in Settings.
- `lecturers` lists `is_lecturer` staff who are not Inactive.
- `options` carries the Select options straight from the DocType JSON.

## `academic_calendar`
- **Path:** `mahanaim.api.setup.academic_calendar`
- **Method:** GET
- **Guard:** signed in (any role)

Args: `academic_year?`. Without it, returns the latest 6 years.

```json
{"message": {"years": [{"name": "2026-2027", "year_name": "2026-2027", "is_current": 1, "start_date": "…", "end_date": "…",
  "terms": [{"name": "2026-2027 Term 1", "term_label": "…", "term_name": "Term 1", "term_number": 1, "academic_year": "2026-2027",
             "status": "Registration Open", "is_current": 1, "start_date": "…", "end_date": "…",
             "registration_start": "…", "registration_end": "…", "late_registration_end": "…",
             "exam_start": "…", "exam_end": "…", "results_release_date": "…",
             "registration_window": {"state": "open", "is_open": true, "is_late": false,
                                     "registration_start": "…", "registration_end": "…", "late_registration_end": "…"}}]}],
  "current_term": "2026-2027 Term 1", "current_year": "2026-2027"}}
```

`registration_window.state` is one of `upcoming`, `open`, `late` or `closed`. A term without registration dates
follows its status ("Registration Open" means open).

## `set_current_term`
- **Path:** `mahanaim.api.setup.set_current_term`
- **Method:** POST
- **Guard:** Registrar, Academic Dean or admin

Args: `term`. Marks the term current and un-flags the others. Settings `current_academic_term` and
`current_academic_year` are updated.

```json
{"message": {"current_term": "2026-2027 Term 2", "current_year": "2026-2027"}}
```

## `save_master`
- **Path:** `mahanaim.api.setup.save_master`
- **Method:** POST
- **Guard:** staff, plus DocType create/write permission

| Arg | Notes |
| --- | --- |
| `doctype` | One of `Campus`, `Department`, `Academic Year`, `Academic Term`, `Intake`, `Study Mode`. Anything else gives 403 |
| `data` | JSON object. Only editable (non-read-only, non-table) fields are applied |
| `name` | Optional. Updates when given, creates when omitted |

Returns the saved document as a dict.

```json
{"message": {"name": "Nakuru", "campus_name": "Nakuru", "code": "NKR", "is_active": 1, "…": "…"}}
```

Validation messages from the controllers come back as normal `frappe.throw` errors (HTTP 417), for example
"Campus code NKR is already used by Nakuru." or "Late registration cannot end before normal registration closes."

## `list_staff`
- **Path:** `mahanaim.api.setup.list_staff`
- **Method:** GET
- **Guard:** staff

Args:
- Filters: `status`, `staff_type`, `department`, `campus`, `is_lecturer` (0 or 1).
- `search`: matched against name, staff_number, full_name, email, phone and designation.
- `start`, `page_length` (default 20).

Results are permission-aware through `frappe.get_list`.

```json
{"message": {"data": [{"name": "STF-0002", "staff_number": "STF-0002", "salutation": "Dr", "full_name": "Grace L",
  "email": "grace@…", "phone": "+2547…", "status": "Active", "staff_type": "Academic", "designation": "Lecturer",
  "is_lecturer": 1, "department": "Theology", "campus": "Main Campus", "user": "grace@…", "photo": null, "date_joined": "…"}],
  "total": 18}}
```

## `get_staff`
- **Path:** `mahanaim.api.setup.get_staff`
- **Method:** GET
- **Guard:** staff, plus read permission

Args: `name`.

```json
{"message": {"name": "STF-0002", "salutation": "Dr", "first_name": "Grace", "last_name": "L", "staff_number": "STF-0002",
  "photo": null, "status": "Active", "date_joined": "…", "email": "grace@…", "phone": "…", "staff_type": "Academic",
  "designation": "Lecturer", "is_lecturer": 1, "department": "Theology", "campus": "Main Campus",
  "show_on_website": 1, "website_sequence": 2, "specialisation": "…", "qualifications": "…", "bio": "…",
  "full_name": "Grace L", "user": "grace@…", "additional_campuses": ["Nakuru"],
  "user_info": {"enabled": 1, "last_login": "…", "user_type": "System User", "roles": ["Lecturer"]},
  "teaching": [{"name": "OFF-0003", "course": "DBS101", "course_title": "…", "campus": "Main Campus", "enrolled_count": 12, "role": "Lead"}]}}
```

- `user_info` appears only when a user is linked.
- `teaching` lists the current term's offerings.

## `save_staff`
- **Path:** `mahanaim.api.setup.save_staff`
- **Method:** POST
- **Guard:** Registrar or admin, plus DocType permission

| Arg | Notes |
| --- | --- |
| `data` | JSON object (fields below) |
| `name` | Optional. Updates when given, creates when omitted |

`data` fields:
- `salutation`, `first_name`, `last_name`, `staff_number`, `photo`, `status`, `date_joined`
- `email`, `phone`, `staff_type`, `designation`, `is_lecturer`, `department`, `campus`
- `show_on_website`, `website_sequence`, `specialisation`, `qualifications`, `bio`
- `additional_campuses`: a list of campus names or `{campus}` objects; replaces the existing list.
- `create_user`: 0 or 1.

Returns the `get_staff` shape. Roles other than Lecturer are assigned in desk.

## `set_staff_status`
- **Path:** `mahanaim.api.setup.set_staff_status`
- **Method:** POST
- **Guard:** Registrar or admin

Args: `name`, `status` (Active, On Leave or Inactive). Inactive disables the login; Active re-enables it.
Returns the `get_staff` shape.

## `get_settings`
- **Path:** `mahanaim.api.setup.get_settings`
- **Method:** GET
- **Guard:** admin

Returns every value field of Mahanaim Settings.

```json
{"message": {"institution_name": "Mahanaim Bible College", "current_academic_year": "2026-2027", "current_academic_term": "…",
  "otp_length": 6, "otp_expiry_minutes": 10, "otp_max_attempts": 5, "otp_resend_cooldown_seconds": 60, "admin_mfa_required": 1,
  "application_fee_required": 1, "application_fee": 1000, "offer_expiry_days": 30, "auto_create_student_on_acceptance": 1,
  "max_credits_per_term": 24, "auto_invoice_on_registration": 1, "student_number_format": "MBC/{programme_code}/{year}/{####}",
  "sms_api_key": "********", "…": "…",
  "password_fields": ["sms_api_key"], "modified": "…"}}
```

**Password fields are never returned.** A field shows `"********"` when it is set and `null` when it is empty.

## `update_settings`
- **Path:** `mahanaim.api.setup.update_settings`
- **Method:** POST
- **Guard:** admin

Args: `data`, a JSON object with any subset of the editable settings fields.
- For password fields, sending `""`, `null` or the mask `"********"` keeps the stored secret. Any other value
  replaces it.
- The controller validations listed above apply.

Returns the same shape as `get_settings`.
