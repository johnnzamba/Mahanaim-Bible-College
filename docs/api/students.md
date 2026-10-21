# Students & Lifecycle API (`mahanaim.api.students`)

Calls go to `/api/method/<dotted path>`; GET for reads, POST for writes.

**Guards**
- Portal endpoints use `require_student()`: a signed-in user with the Student role and a linked Student record.
  - Guests get 401 / `AuthenticationError`.
  - Other users get 403 / `PermissionError`.
  - Records are always resolved from the session. Another student's registration or request gives 403 with
    "… not found."
- Staff endpoints use `require_roles(...)`. System Manager and College Administrator always pass.

| Role set | Roles |
| --- | --- |
| `STAFF_WRITE` | Registrar, Academic Dean |
| `STAFF_READ` | Registrar, Academic Dean, Finance Officer |
| `REQUEST_STAFF` | Registrar, Academic Dean, Finance Officer, Library Officer |

Staff lists use `frappe.get_list`, so campus User Permissions apply.

## Lifecycle rules

**Student status**

```
Applicant → Admitted
Admitted → Registered | Active | Withdrawn | Deferred
Registered → Active | Deferred | Suspended | Withdrawn
Active → Deferred | Suspended | Withdrawn | Completed
Deferred → Active | Withdrawn
Suspended → Active | Withdrawn
Completed → Alumni
```

- Every change is logged in `status_log`. A College Administrator may force any change with `force=1`; the log
  note is prefixed "Forced".
- Withdrawn disables the user account.
- Moving to Withdrawn or Deferred withdraws the current-term enrolments.
- Alumni keep their login and gain the **Alumni** role.

**Semester Registration**

```
Draft → Submitted → Approved | Rejected
Draft | Submitted → Cancelled
```

Validation rules, in order:
1. The student is Admitted, Registered or Active.
2. One open registration per student per term. A second one raises `DuplicateEntryError`.
3. Offerings must belong to the term and the student's campus, not be Cancelled, be in the programme curriculum,
   have free capacity and appear only once.
4. Prerequisites are passed, meaning a published Course Result with status Pass.
5. Total credits ≤ `Settings.max_credits_per_term`.
6. The registration window is open: `registration_start` ≤ today ≤ `late_registration_end` (or
   `registration_end` when there is no late window). Staff bypass this rule.
7. Fee clearance from the B3 contract `fees.fee_clearance(student, "registration")`. This applies to students on
   submit; staff bypass it.

On **Approved**:
- Course Enrolments are created (idempotent).
- The student gets `current_term` and becomes Active if they were Admitted or Registered.
- An invoice is created via `fees.create_invoice_for_registration` when `auto_invoice_on_registration` is on, and
  `fee_invoice` is stored.
- LMS enrolment is queued after commit.
- "Registration Approved" is sent. On Rejected, "Registration Rejected" is sent.

**Student Request**

```
Pending → Under Review | Approved | Rejected | Cancelled
Under Review → Approved | Rejected | Cancelled
Approved → Completed
```

**Request types and what approval does**

| Type | Required fields | Effect on approval |
| --- | --- | --- |
| Deferment | `reason`; `from_date`/`to_date` optional | Student → Deferred; current-term enrolments → Withdrawn |
| Withdrawal | `reason` | Student → Withdrawn (user disabled); enrolments → Withdrawn |
| Resumption | `reason` | Student → Active |
| Programme Transfer | `new_programme` | Student programme and programme_name change |
| Campus Transfer | `new_campus` | Student campus changes |
| Course Drop | `course_enrolment` (an Enrolled one of yours) | Enrolment → Dropped; LMS unenrol; registration row Dropped; credits recalculated |
| Transcript Request / Document Request | `document_type?`, `copies?`, `delivery_method?` | Draft **Transcript** created with `request` set (handled by B3's credentials desk) |
| Clearance | `reason` | None; it is a sign-off record |
| Other | `reason` | None |

**Clearance**
- Clearance requests get items for **Finance, Library, Academics and Dean of Students**.
- Finance is checked automatically: a `fees.get_student_balance` of 0 or less marks it Cleared; otherwise it is
  "Not Cleared".
- Who may sign off each item:

| Item | Roles |
| --- | --- |
| Finance | Finance Officer |
| Library | Library Officer |
| Academics | Registrar, Academic Dean |
| Dean of Students | Academic Dean, Chaplain |

- A Clearance request cannot be approved until every item is Cleared.

Every request status change sends "Student Request Update" (link `/student/requests`).

---

## Portal: profile & dashboard

### `my_profile`
- **Path:** `mahanaim.api.students.my_profile`
- **Method:** GET
- **Guard:** student

```json
{"message": {"name": "STU-2026-00031", "student_number": "MBC/DBS/2026/0001", "full_name": "Jane W Doe", "status": "Active",
  "email": "jane@example.com", "phone": "+254712345678", "programme": "DBS", "programme_name": "Diploma in Biblical Studies",
  "campus": "Main Campus", "campus_name": "Main Campus", "study_mode": "Full Time", "intake": "September 2026",
  "year_of_study": 1, "current_term": "2026-2027 Term 1", "term_label": "Term 1 2026-2027", "cgpa": 3.4,
  "home_church": "Grace Fellowship", "pastor_name": "Rev. John", "nok_name": "Peter", "…": "…",
  "status_log": [{"timestamp": "…", "from_status": "Admitted", "to_status": "Active"}],
  "editable_fields": ["phone", "postal_address", "county", "nok_name", "nok_relationship", "nok_phone",
                      "home_church", "pastor_name", "pastor_phone", "ministry_role", "photo"]}}
```

### `update_my_profile`
- **Path:** `mahanaim.api.students.update_my_profile`
- **Method:** POST
- **Guard:** student

Args: `data`, a JSON object. Only `editable_fields` are applied and everything else is ignored silently. `photo`
must be your own upload (`/api/method/upload_file`). Returns the profile.

### `my_dashboard`
- **Path:** `mahanaim.api.students.my_dashboard`
- **Method:** GET
- **Guard:** student

`fee_balance` is `null` if the finance service is unavailable. `registration_term` is set only when a different
term's registration window is open.

```json
{"message": {
  "student": {"name": "STU-2026-00031", "student_number": "MBC/DBS/2026/0001", "full_name": "Jane W Doe", "status": "Active",
              "programme": "DBS", "programme_name": "…", "campus": "Main Campus", "year_of_study": 1, "current_term": "…",
              "cgpa": 3.4, "credits_earned": 30, "academic_standing": "Good Standing", "photo": null, "…": "…"},
  "term": {"name": "2026-2027 Term 1", "term_label": "Term 1 2026-2027", "start_date": "…", "end_date": "…",
           "window": {"state": "open", "is_open": true, "is_late": false, "registration_start": "…", "registration_end": "…", "late_registration_end": null}},
  "registration_term": null,
  "registration": {"name": "SREG-0004", "status": "Approved", "total_credits": 6},
  "courses": [{"name": "ENR-0009", "course_offering": "OFF-0003", "course": "DBS101", "academic_term": "…", "status": "Enrolled",
               "course_title": "Old Testament Survey", "credits": 3, "lecturers": [{"staff_member": "STF-0002", "full_name": "Grace L", "role": "Lead"}]}],
  "credits_this_term": 6, "cgpa": 3.4, "credits_earned": 30, "academic_standing": "Good Standing",
  "fee_balance": 2500.0, "currency": "KES",
  "upcoming_assignments": [{"name": "ASG-0001", "title": "Essay 1", "course_offering": "OFF-0003", "course_title": "…",
                            "due_date": "2026-03-10 23:59:00", "max_score": 20, "submitted": false}],
  "upcoming_exams": [{"name": "EXM-0001", "title": "CAT 1", "exam_type": "CAT", "course_offering": "OFF-0003",
                      "delivery_mode": "Online", "status": "Scheduled", "start_datetime": "…", "end_datetime": "…", "venue": null}],
  "unread_notifications": 3,
  "announcements": [{"name": "ANN-0001", "title": "Chapel week", "audience": "All Students", "is_pinned": 1, "sent_on": "…",
                     "body": "…", "summary": "…", "posted_by_name": "…", "course_title": null, "…": "…"}],
  "open_requests": 1,
  "today_classes": [{"name": "CS-0012", "offering": "OFF-0003", "course_offering": "OFF-0003", "course_title": "Old Testament Survey",
                     "session_date": "2026-10-21", "start_time": "08:00:00", "end_time": "10:00:00", "venue": "Hall A",
                     "mode": "Online", "meeting_link": "https://…", "status": "Scheduled", "topic": "…", "lecturer_name": "Grace L"}],
  "attendance_summary": {"term": "2026-2027 Term 1", "percent": 66.67, "sessions": 4, "present": 1, "late": 1, "absent": 1, "excused": 1},
  "clearance": {"exam": {"cleared": false, "message": "Fee clearance for exams requires 100% …", "paid_percent": 80.0, "required_percent": 100.0},
                "transcript": {"cleared": true, "message": "…", "paid_percent": 100.0, "required_percent": 100.0}}}}
```

Block notes:
- `announcements`: the latest 5 announcements visible to the student, pinned first and then newest. Visibility
  uses the communication domain's audience rules (`services.messaging.visible_announcements`), so the items are
  the same as in `mahanaim.api.communication.my_announcements`.
- `today_classes`: today's Class Sessions for your enrolled offerings, from the academics timetable
  (`api.academics.my_timetable`). Cancelled sessions are included with `status: "Cancelled"` and no
  `meeting_link`.
- `attendance_summary`: covers the current term. It counts held sessions with attendance taken.
  - `percent = (present + late) / (sessions − excused) × 100`.
  - `percent` is `null` when nothing countable has been held yet.
- `clearance`: comes from `fees.fee_clearance(student, "exam" | "transcript")`.
- `today_classes`, `attendance_summary` and `clearance` are each `null` if the underlying service is unavailable.
  The rest of the dashboard still loads.

## Portal: registration

### `registration_options`
- **Path:** `mahanaim.api.students.registration_options`
- **Method:** GET
- **Guard:** student

Args: `term?`. It defaults to the term whose window is open now, otherwise the current term.

Returns the offerings for your programme curriculum in that term at your campus.

```json
{"message": {
  "term": {"name": "…", "term_label": "…", "window": {"state": "open", "is_open": true, "is_late": false, "…": "…"}, "…": "…"},
  "window": {"state": "open", "is_open": true, "is_late": false, "registration_start": "…", "registration_end": "…", "late_registration_end": "…"},
  "student": {"name": "…", "status": "Admitted", "…": "…"},
  "eligible": true, "can_register": true, "max_credits": 24,
  "registration": null,
  "fee_clearance": {"cleared": true, "balance": 0, "message": ""},
  "offerings": [{"name": "OFF-0003", "course": "DBS101", "course_code": "DBS101", "course_title": "Old Testament Survey",
                 "credits": 3, "section": "A", "study_mode": "Full Time", "status": "Open", "capacity": 40, "enrolled_count": 12,
                 "lecturers": [{"staff_member": "STF-0002", "full_name": "Grace L", "role": "Lead"}],
                 "prerequisites": [{"course": "DBS100", "course_title": "Intro", "satisfied": true}],
                 "prerequisites_met": true, "already_passed": false, "is_retake": false,
                 "year_of_study": 1, "term_number": 1, "course_type": "Core", "recommended": true, "matches_study_mode": true,
                 "seats_left": 28, "is_full": false, "registered": false, "enrolled": false}]}}
```

Field notes:
- `window.state` is one of `upcoming`, `open`, `late` or `closed`.
- `registration` holds your existing open or approved registration for the term, or null.
- `can_register` is false when you are not eligible, the window is closed, or the registration is already
  approved.

### `submit_registration`
- **Path:** `mahanaim.api.students.submit_registration`
- **Method:** POST
- **Guard:** student

| Arg | Notes |
| --- | --- |
| `term` | Academic term |
| `offerings` | JSON list of Course Offering names, or of `{course_offering}` objects |
| `submit` | `1` (default) to submit; `0` to keep a Draft |
| `remarks` | Optional |

- Creates your registration for the term, or **replaces the courses** of your Draft/Submitted one.
- Fails if the term's registration is already approved. To change it later, use a Course Drop request or contact
  the Registrar.

Validation messages:
- "Registration for X is closed."
- "Registration for X opens on <date>."
- "You selected N credits; the maximum per term is M."
- "X requires Y …" (prerequisites)
- "… is listed more than once."
- "… is offered at A, not your campus (B)."
- "… is not part of your programme's curriculum."
- "… is full"
- The fee-clearance message.

```json
{"message": {"name": "SREG-0004", "student": "STU-2026-00031", "student_name": "Jane W Doe", "academic_term": "…",
  "term_label": "Term 1 2026-2027", "status": "Submitted", "total_credits": 6, "fee_invoice": null, "approved_by": null,
  "approved_on": null, "remarks": null, "can_cancel": true,
  "courses": [{"name": "row1", "course_offering": "OFF-0003", "course": "DBS101", "course_title": "…", "credits": 3,
               "course_type": "Core", "status": "Registered"}], "…": "…"}}
```

### `cancel_registration`
- **Path:** `mahanaim.api.students.cancel_registration`
- **Method:** POST
- **Guard:** student (owner)

Args: `name`. Only Draft or Submitted registrations can be cancelled. Returns the registration object.

### `my_registrations`
- **Path:** `mahanaim.api.students.my_registrations`
- **Method:** GET
- **Guard:** student

Returns `{data: [registration (+courses, can_cancel, term_label)], total}`.

### `my_courses`
- **Path:** `mahanaim.api.students.my_courses`
- **Method:** GET
- **Guard:** student

Args: `term?`. Returns all your enrolments, newest first.

```json
{"message": {"data": [{"name": "ENR-0009", "course_offering": "OFF-0003", "course": "DBS101", "course_code": "DBS101",
  "course_title": "Old Testament Survey", "credits": 3, "section": "A", "academic_term": "…", "term_label": "…",
  "status": "Enrolled", "enrolled_on": "…", "offering_status": "Open", "start_date": "…", "end_date": "…",
  "lecturers": [{"staff_member": "STF-0002", "full_name": "Grace L", "role": "Lead"}],
  "lms_enrollment": "…", "lms_url": "/lms/courses/old-testament-survey",
  "result": {"grade": "A", "total_score": 78, "grade_points": 4.0, "result_status": "Pass"}}], "total": 1}}
```

`result` only appears for published results.

## Portal: requests

### `my_requests`
- **Path:** `mahanaim.api.students.my_requests`
- **Method:** GET
- **Guard:** student

Returns `{data: [request (+clearance rows, status_log, can_cancel)], total}`. `status_log` is
`[{timestamp, from_status, to_status}]` in order, as in the request object below.

### `create_request`
- **Path:** `mahanaim.api.students.create_request`
- **Method:** POST
- **Guard:** student

Args: `data`, a JSON object with these fields:
- `request_type` (required)
- `reason` (required)
- `academic_term`, `from_date`, `to_date`
- `attachment`: your own upload
- `new_programme`, `new_campus`
- `course_enrolment`
- `document_type`, `copies`, `delivery_method`

The request starts as Pending. There can be only one open request of the same type at a time (one per
enrolment for a Course Drop).

### `cancel_request`
- **Path:** `mahanaim.api.students.cancel_request`
- **Method:** POST
- **Guard:** student (owner)

Args: `name`. Only Pending or Under Review requests can be cancelled.

Request object returned by these endpoints:

```json
{"message": {"name": "SREQ-0007", "student": "STU-2026-00031", "student_name": "Jane W Doe", "request_type": "Clearance",
  "status": "Pending", "academic_term": null, "reason": "Completing studies", "decision_date": null, "review_notes": null,
  "clearance": [{"name": "c1", "department": "Finance", "status": "Cleared", "cleared_by": "Administrator", "cleared_on": "…", "remarks": "Auto-checked: no balance"},
                {"name": "c2", "department": "Library", "status": "Pending", "cleared_by": null, "cleared_on": null, "remarks": null}],
  "status_log": [{"timestamp": "…", "from_status": null, "to_status": "Pending"}], "can_cancel": true,
  "course": null, "transcript": null, "…": "…"}}
```

- `course` is `{course, course_offering, academic_term, status}` for Course Drop requests.
- `transcript` is `{name, status}` once a transcript or document request is approved.

## Staff: students

### `list_students`
- **Path:** `mahanaim.api.students.list_students`
- **Method:** GET
- **Guard:** `STAFF_READ`

Args:
- Filters: `status`, `programme`, `campus`, `intake`, `study_mode`, `year_of_study`, `gender`,
  `academic_standing`, `current_term`. A filter value may be a JSON list.
- `search`: matched against name, student_number, full_name, email, phone and national_id.
- `start`, `page_length` (default 20).
- `order_by`: `full_name asc`, `student_number asc`, `modified desc`, `creation desc` or `cgpa desc`.

```json
{"message": {"data": [{"name": "STU-2026-00031", "student_number": "MBC/DBS/2026/0001", "full_name": "Jane W Doe",
  "email": "…", "phone": "…", "gender": "Female", "status": "Active", "programme": "DBS", "programme_name": "…",
  "campus": "Main Campus", "study_mode": "Full Time", "intake": "…", "year_of_study": 1, "current_term": "…",
  "cgpa": 3.4, "academic_standing": "Good Standing", "fee_balance": 2500.0, "photo": null, "user": "jane@example.com"}],
  "total": 214, "counts_by_status": {"Active": 180, "Admitted": 20, "Deferred": 4, "Alumni": 10}}}
```

### `student_360`
- **Path:** `mahanaim.api.students.student_360`
- **Method:** GET
- **Guard:** `STAFF_READ`

Args: `name`.

```json
{"message": {
  "profile": {"…profile fields…": "…", "status_log": [{"timestamp": "…", "from_status": "…", "to_status": "…", "note": "…", "user": "…"}],
              "editable_fields": ["…staff editable…"], "allowed_transitions": ["Deferred", "Suspended", "Withdrawn", "Completed"]},
  "user": {"name": "jane@example.com", "enabled": 1, "last_login": "…", "mobile_no": "…"},
  "application": {"name": "APP-2026-00012", "status": "Accepted", "submitted_on": "…", "accepted_on": "…"},
  "registrations": [{"name": "SREG-0004", "status": "Approved", "academic_term": "…", "total_credits": 6, "courses": ["…"]}],
  "enrolments": [{"name": "ENR-0009", "course_offering": "…", "course": "DBS101", "course_title": "…", "academic_term": "…",
                  "status": "Enrolled", "enrolled_on": "…", "final_grade": null, "semester_registration": "SREG-0004"}],
  "results": {"rows": [{"course": "DBS100", "course_title": "…", "academic_term": "…", "credits": 3, "total_score": 72, "grade": "A",
                        "grade_points": 4.0, "result_status": "Pass", "attempt": 1}],
              "cgpa": 3.4, "credits_earned": 30, "academic_standing": "Good Standing", "passed": 10, "failed": 0},
  "finance": {"balance": 2500.0, "totals": {"…": "…"}, "registration_clearance": {"cleared": true, "…": "…"},
              "invoices": [{"name": "…", "posting_date": "…", "status": "Unpaid", "total_amount": 30000, "outstanding_amount": 2500}],
              "payments": [{"name": "…", "posting_date": "…", "amount": 27500, "mode_of_payment": "M-Pesa", "reference_no": "…"}], "currency": "KES"},
  "requests": [{"name": "SREQ-0007", "request_type": "Clearance", "status": "Pending", "academic_term": null, "creation": "…", "decision_date": null}],
  "sponsor": {"name": "SPN-0001", "sponsor_name": "Grace Church", "sponsor_type": "Church", "email": "…", "phone": "…"},
  "sponsorships": [{"name": "…", "sponsor": "SPN-0001", "status": "Active", "coverage": "Percentage", "percentage": 50, "…": "…"}],
  "status_log": ["…"]}}
```

Any finance value is `null` if the B3 service is unavailable.

### `create_student`
- **Path:** `mahanaim.api.students.create_student`
- **Method:** POST
- **Guard:** `STAFF_WRITE`

Args: `data`, a JSON object of staff-editable fields plus optional `status` (default Admitted) and `create_user`
(0 or 1; by default a user is created when an email exists). Assigns the student number. Returns the staff
profile.

### `update_student`
- **Path:** `mahanaim.api.students.update_student`
- **Method:** POST
- **Guard:** `STAFF_WRITE`

Args: `name`, `data`. Applies staff-editable fields only; status cannot be changed here. Returns the staff
profile.

### `change_student_status`
- **Path:** `mahanaim.api.students.change_student_status`
- **Method:** POST
- **Guard:** `STAFF_WRITE`; `force=1` needs a College Administrator

Args: `name`, `status`, `note?`, `force=0`. Returns the staff profile.

A change outside the status machine fails with "Student cannot move from X to Y" unless forced.

### `student_stats`
- **Path:** `mahanaim.api.students.student_stats`
- **Method:** GET
- **Guard:** `STAFF_READ`

```json
{"message": {"total": 214, "active": 180, "by_status": {"Active": 175, "Registered": 5, "…": "…"},
  "by_programme": [{"key": "DBS", "label": "Diploma in Biblical Studies", "count": 120}],
  "by_campus": [{"key": "Main Campus", "count": 150}], "by_intake": [{"key": "September 2026", "count": 60}],
  "by_gender": [{"key": "Female", "count": 101}], "by_year_of_study": [{"key": 1, "count": 80}]}}
```

## Staff: registrations

### `list_registrations`
- **Path:** `mahanaim.api.students.list_registrations`
- **Method:** GET
- **Guard:** `STAFF_READ`

Args:
- Filters: `term`, `status`, `programme`, `campus`, `study_mode`, `year_of_study`, `student`.
- `search`: matched against name, student and student_name.
- `start`, `page_length`.

Returns `{data: [registration + courses], total, counts_by_status}`.

### `get_registration`
- **Path:** `mahanaim.api.students.get_registration`
- **Method:** GET
- **Guard:** `STAFF_READ`

Args: `name`. Returns the registration object, plus:
- `student_info`
- `fee_clearance`
- `missing_prerequisites`: `{course: [{course, course_title}]}`
- `max_credits`

### `approve_registration`
- **Path:** `mahanaim.api.students.approve_registration`
- **Method:** POST
- **Guard:** `STAFF_WRITE`

Args: `name`, plus optional overrides `ignore_capacity`, `ignore_prerequisites`, `ignore_credit_limit` (each 0
or 1). Only Submitted registrations can be approved. The side effects are listed under Lifecycle rules. Returns
the registration object.

### `reject_registration`
- **Path:** `mahanaim.api.students.reject_registration`
- **Method:** POST
- **Guard:** `STAFF_WRITE`

Args: `name`, `reason` (required). Only Submitted registrations can be rejected. Notifies the student; the student
may submit again.

### `bulk_approve_registrations`
- **Path:** `mahanaim.api.students.bulk_approve_registrations`
- **Method:** POST
- **Guard:** `STAFF_WRITE`

Args: `names` (JSON list, at most 200). Each registration is approved in its own savepoint.

```json
{"message": {"ok": false, "updated": ["SREG-0004"], "failed": [{"name": "SREG-0005", "error": "Registration SREG-0005 is Draft; only submitted registrations can be approved."}]}}
```

## Staff: requests

### `list_requests`
- **Path:** `mahanaim.api.students.list_requests`
- **Method:** GET
- **Guard:** `REQUEST_STAFF`

Args:
- Filters: `status`, `request_type` (or `type`), `student`, `academic_term`.
- `search`.
- `start`, `page_length`.

Each row also has `clearance: [{department, status}]` and `clearance_progress: {cleared, total}`; both are
filled for Clearance requests only. Returns `{data, total, counts_by_status}`.

### `get_request`
- **Path:** `mahanaim.api.students.get_request`
- **Method:** GET
- **Guard:** `REQUEST_STAFF`

Args: `name`. Returns the request object in its staff form:
- the status log includes `note` and `user`;
- each clearance row has `can_clear` for the current user;
- `student_info`;
- `allowed_transitions`.

### `decide_request`
- **Path:** `mahanaim.api.students.decide_request`
- **Method:** POST
- **Guard:** `STAFF_WRITE`

Args: `name`, `decision` (Under Review, Approved, Rejected or Completed), `notes?`. Approval checks the effect
first and then applies it (see the table above). Returns the request object.

Approval errors:
- "This deferment request cannot be approved while the student is Withdrawn."
- "Clearance is still pending for: Library, Academics"

### `update_clearance_item`
- **Path:** `mahanaim.api.students.update_clearance_item`
- **Method:** POST
- **Guard:** signed in, with the department's clearance role

| Arg | Notes |
| --- | --- |
| `request` | Student Request name |
| `row` | Clearance Item name, or the department name |
| `status` | Pending, Cleared or Not Cleared |
| `notes` | Optional |

- Without the department's role you get 403 "You cannot sign off Library clearance."
- The first sign-off moves the request from Pending to Under Review.
- Returns the staff request object.

## Contracts & hooks implemented in `mahanaim.services.students`

| Function | Purpose |
| --- | --- |
| `ensure_user(email, first_name, last_name=None, phone=None, roles=(), user_type="Website User")` | Get or create a User, add roles, return the user name |
| `create_student_from_application(application)` | See admissions.md |
| `sync_user_profile_link(doc, method)` | `User.on_update` hook: links Student, Staff Member or Sponsor records with the same email and no user |
| `on_registration_approved(reg)` | Approval side effects (idempotent) |
| `enqueue_lms(enrolment, action)` | Queues `lms_bridge.enrol`/`unenrol` after commit |
