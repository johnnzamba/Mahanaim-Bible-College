# Academics API (`mahanaim.api.academics`)

Programmes, courses, course offerings, timetable (class sessions) and class attendance: SOW M07 and M21.
Calls go to `/api/method/<dotted path>`. Reads use GET and writes use POST. JSON arguments (`data`, `rows`,
`staff_members`) may be sent as objects or JSON strings.

**Guards**
- **admin**: `require_roles("Academic Dean", "Registrar")`. System Manager and College Administrator always pass.
- **lecturer**: the Lecturer role or any staff role.
- **teaching**: `require_lecturer_of(offering)`. The caller must be one of the offering's lecturers (by `user`) or an
  academic admin. Other lecturers get `PermissionError` with "You are not assigned to teach this course.".
- **offering reader**: teaching, plus other staff with read permission on the offering (campus-scoped).
- **student**: a signed-in user linked to a Student record.
- **staff**: any staff role.
- A missing record raises `DoesNotExistError` (404). Validation failures raise `ValidationError` (417) with a
  translated message.

## Rules enforced by the controllers

- **Programme**
  - The code is upper-cased.
  - Curriculum rows must not repeat a course. `course_title` and `credits` are fetched from the course.
  - `1 ≤ year_of_study ≤ duration_years` and `term_number ≥ 1`.
  - `total_credits` is the sum of curriculum credits.
  - `application_fee` falls back to Settings when empty.
- **Course**
  - `course_code` is upper-cased and `credits > 0`.
  - A course may not be its own prerequisite, and prerequisite cycles are rejected (A → B → A).
  - Assessment weights, when present, must total 100.
- **Course Offering**
  - `course_title` and `credits` are fetched from the course. Lecturer rows fetch `user` and `staff_name`.
  - The combination course + term + campus + section + study_mode must be unique.
  - Assessment weights are copied from the course when empty.
  - Status machine: `Planned → Open | In Progress | Cancelled`,
    `Open → Planned | In Progress | Completed | Cancelled`, `In Progress → Open | Completed | Cancelled`,
    `Completed → In Progress`, `Cancelled → Planned`.
  - On update, if LMS Bridge Settings has `enabled` + `auto_create_courses`, `lms_bridge.sync_offering` is enqueued.
- **Class Session**
  - `start < end`. The offering must not be Cancelled.
  - No overlapping non-cancelled session for the same offering, the same physical venue, or the same lecturer.
  - `Online` sessions need `meeting_link`, and any link must start with `http(s)://`.
  - Status machine: `Scheduled → Held | Cancelled | Rescheduled`, `Rescheduled → Scheduled | Held | Cancelled`.
    A session that has been held cannot be cancelled or moved.

## Programmes

### `list_programmes`
- **Path:** `mahanaim.api.academics.list_programmes`
- **Method:** GET
- **Guard:** lecturer

Args (all optional): `search` (name or code), `status`, `level`, `department`, `start`, `page_length` (default 50).

```json
{"message": {"data": [{"name": "DBS", "code": "DBS", "programme_name": "Diploma in Biblical Studies", "level": "Diploma",
  "department": null, "status": "Active", "is_published": 1, "duration_years": 2.0, "terms_per_year": 2,
  "total_credits": 60.0, "application_fee": 1000.0, "image": null, "course_count": 18}], "total": 1}}
```

### `get_programme`
- **Path:** `mahanaim.api.academics.get_programme`
- **Method:** GET
- **Guard:** lecturer

Args: `code`. Returns the full programme document, the curriculum grouped by year and term, and `student_count`.

```json
{"message": {"name": "DBS", "code": "DBS", "programme_name": "Diploma in Biblical Studies", "level": "Diploma",
  "status": "Active", "duration_years": 2.0, "terms_per_year": 2, "total_credits": 7.0, "min_credits_to_graduate": 0.0,
  "min_cgpa_to_graduate": 2.0, "application_fee": 1000.0, "overview": null, "campuses": [], "study_modes": [], "…": "…",
  "curriculum": [{"name": "95408lin4s", "course": "OTS101", "course_title": "Old Testament Survey", "credits": 3.0,
                  "year_of_study": 1, "term_number": 1, "course_type": "Core"}],
  "curriculum_by_year": [{"year": 1, "credits": 7.0, "terms": [{"term_number": 1, "credits": 7.0, "courses": ["…curriculum rows…"]}]}],
  "student_count": 0}}
```

### `save_programme`
- **Path:** `mahanaim.api.academics.save_programme`
- **Method:** POST
- **Guard:** admin

Args:
- `data`: programme fields plus optional child tables `curriculum`
  (`[{course, year_of_study, term_number, course_type?}]`), `campuses` and `study_modes`. A child table that is sent
  replaces the stored one.
- `name`: optional; omit it to create.

Returns the same shape as `get_programme`.

## Courses

### `list_courses`
- **Path:** `mahanaim.api.academics.list_courses`
- **Method:** GET
- **Guard:** lecturer

Args: `search`, `department`, `is_active`, `start`, `page_length`.

```json
{"message": {"data": [{"name": "OTS101", "course_code": "OTS101", "course_title": "Old Testament Survey", "department": null,
  "credits": 3.0, "contact_hours": 0, "pass_mark": 40.0, "is_active": 1, "prerequisites": []}], "total": 1}}
```

### `get_course`
- **Path:** `mahanaim.api.academics.get_course`
- **Method:** GET
- **Guard:** lecturer

Args: `code`.

```json
{"message": {"name": "OTS101", "course_code": "OTS101", "course_title": "Old Testament Survey", "credits": 3.0, "pass_mark": 40.0,
  "is_active": 1, "description": null, "learning_outcomes": null, "prerequisites": [{"prerequisite": "BIB100", "…": "…"}],
  "assessment_weights": [{"component": "CAT", "weight": 30.0, "label": null}, {"component": "Exam", "weight": 70.0, "label": null}],
  "programmes": [{"programme": "DBS", "year_of_study": 1, "term_number": 1, "course_type": "Core"}], "offering_count": 1}}
```

### `save_course`
- **Path:** `mahanaim.api.academics.save_course`
- **Method:** POST
- **Guard:** admin

Args:
- `data`: course fields plus optional `prerequisites` and `assessment_weights` (`[{component, weight, label?}]`).
- `name`: optional.

Returns the same shape as `get_course`. A prerequisite cycle, or weights that don't total 100, raise `ValidationError`.

## Course offerings

### `list_offerings`
- **Path:** `mahanaim.api.academics.list_offerings`
- **Method:** GET
- **Guard:** lecturer

Args (all optional): `term`, `campus`, `programme` (courses in its curriculum), `lecturer` (Staff Member), `status`,
`search` (course code or title), `start`, `page_length`.

```json
{"message": {"data": [{"name": "OFF-2026-00014", "course": "OTS101", "course_title": "Old Testament Survey", "credits": 3.0,
  "academic_term": "2026-2027 Term 1", "academic_year": "2026-2027", "campus": "Main Campus", "study_mode": "Full Time",
  "section": "A", "status": "Open", "capacity": 0, "start_date": "2026-10-21", "end_date": "2027-02-08",
  "results_status": "Not Started", "lms_sync_status": "Not Synced", "enrolled_count": 2,
  "lecturers": [{"staff_member": "STF-00003", "staff_name": "Rev. Peter Otieno", "user": "p.otieno@mbc.ac.ke", "role": "Lead"}]}],
  "total": 1}}
```

### `get_offering`
- **Path:** `mahanaim.api.academics.get_offering`
- **Method:** GET
- **Guard:** offering reader

Args: `offering`.

```json
{"message": {"name": "OFF-2026-00014", "course": "OTS101", "course_title": "Old Testament Survey", "credits": 3.0,
  "academic_term": "2026-2027 Term 1", "campus": "Main Campus", "study_mode": "Full Time", "section": "A", "status": "Open",
  "capacity": 0, "start_date": "2026-10-21", "end_date": "2027-02-08", "grading_scale": null, "results_status": "Not Started",
  "require_fee_clearance": 0, "lms_course": null, "lms_sync_status": "Not Synced", "lms_last_synced": null, "lms_sync_error": null,
  "enrolled_count": 2, "lecturers": ["…"], "assessment_weights": [], "lms_url": null, "mark_sheet": null,
  "counts": {"assignments": 0, "exams": 0, "sessions": 0, "modules": 0, "resources": 0}}}
```

### `save_offering`
- **Path:** `mahanaim.api.academics.save_offering`
- **Method:** POST
- **Guard:** admin

Args:
- `data`: `course`, `academic_term`, `campus`, `study_mode`, `section`, `status`, `capacity`, `start_date`,
  `end_date`, `grading_scale`, `description`, `require_fee_clearance`, plus optional `lecturers`
  (`[{staff_member, role}]`) and `assessment_weights`.
- `name`: optional.

Returns the same shape as `get_offering`. A duplicate offering raises `DuplicateEntryError`.

### `assign_lecturers`
- **Path:** `mahanaim.api.academics.assign_lecturers`
- **Method:** POST
- **Guard:** admin

Args:
- `offering`.
- `staff_members`: a list of Staff Member names (the first becomes `Lead` and the rest `Assistant`), or
  `[{staff_member, role}]` (role defaults to `Lead`). The list replaces the current lecturers.

```json
{"message": {"ok": true, "offering": "OFF-2026-00014",
  "lecturers": [{"staff_member": "STF-00003", "staff_name": "Rev. Peter Otieno", "user": "p.otieno@mbc.ac.ke", "role": "Lead"}]}}
```

### `generate_offerings`
- **Path:** `mahanaim.api.academics.generate_offerings`
- **Method:** POST
- **Guard:** admin

Args:
- `term`, `campus`.
- `programme` (optional): default is every Active programme offered at the campus (and in the study mode, if given).
- `study_mode` (optional).

Creates `Planned` offerings (section A) for every curriculum course whose `term_number` equals the term's
`term_number`. It is idempotent: a course that already has a non-cancelled offering in that term + campus (and study
mode, if given) is skipped with reason "Already offered". Inactive courses are skipped with "Course is inactive".

```json
{"message": {"term": "2026-2027 Term 1", "term_number": 1, "programmes": ["DBS"], "created": 1, "skipped": 1,
  "offerings": ["OFF-2026-00015"], "skipped_courses": [{"course": "OTS101", "reason": "Already offered"}]}}
```

### `academics_stats`
- **Path:** `mahanaim.api.academics.academics_stats`
- **Method:** GET
- **Guard:** staff

Args: `term` (optional; default: the current term).

```json
{"message": {"term": "2026-2027 Term 1", "programmes": {"active": 6, "total": 6}, "courses": {"active": 24, "total": 24},
  "offerings": {"total": 2, "by_status": {"Planned": 1, "Open": 1}, "without_lecturer": 1}, "enrolments": 2,
  "sessions_this_week": 0, "results_status": {"Not Started": 2}}}
```

## Timetable: class sessions (M21)

Session `status` is one of `Scheduled`, `Held`, `Cancelled` or `Rescheduled`, and `mode` is one of `In Person`,
`Online` or `Hybrid`. Times are `HH:MM[:SS]`.

### `list_sessions`
- **Path:** `mahanaim.api.academics.list_sessions`
- **Method:** GET
- **Guard:** offering reader

Args: `offering`, `from_date`, `to_date`, `status`.

```json
{"message": {"data": [{"name": "CS-2026-000048", "course_offering": "OFF-2026-00014", "course_title": "Old Testament Survey",
  "session_date": "2026-10-21", "start_time": "8:00:00", "end_time": "10:00:00", "lecturer": "STF-00003", "venue": "Room 4",
  "mode": "In Person", "meeting_link": null, "status": "Scheduled", "topic": "Torah", "notes": null, "attendance_taken": 0,
  "present_count": 0, "absent_count": 0}], "total": 1}}
```

### `create_session`
- **Path:** `mahanaim.api.academics.create_session`
- **Method:** POST
- **Guard:** teaching

Args:
- Required: `offering`, `date`, `start`, `end`.
- Optional: `venue`, `topic`, `mode` (default `In Person`), `meeting_url` (required for Online),
  `lecturer` (Staff Member; default: the caller or the lead lecturer), `notes`.
- `repeat_weeks` (0–20): also creates the same slot weekly for N more weeks.

The response is the session plus `lecturer_name` and `series` (all created names).

```json
{"message": {"name": "CS-2026-000048", "course_offering": "OFF-2026-00014", "session_date": "2026-10-21", "start_time": "8:00:00",
  "end_time": "10:00:00", "venue": "Room 4", "mode": "In Person", "status": "Scheduled", "topic": "Torah", "…": "…",
  "lecturer_name": "Rev. Peter Otieno", "series": ["CS-2026-000048"]}}
```

### `update_session`
- **Path:** `mahanaim.api.academics.update_session`
- **Method:** POST
- **Guard:** teaching (of the session's offering)

Args:
- `session`.
- `data`: any of `session_date`, `start_time`, `end_time`, `venue`, `topic`, `mode`, `meeting_link`, `notes`,
  `lecturer`.

`meeting_url` is accepted as an alias of `meeting_link`. Moving the date or time of a Scheduled session marks it
`Rescheduled`; a Held session cannot be moved. Returns the session.

### `cancel_session`
- **Path:** `mahanaim.api.academics.cancel_session`
- **Method:** POST
- **Guard:** teaching

Args: `session`, `reason`. Returns the session. A session that has been held cannot be cancelled.

## Attendance (M21)

### `session_roster`
- **Path:** `mahanaim.api.academics.session_roster`
- **Method:** GET
- **Guard:** teaching

Args: `session`. Returns the attendance sheet pre-filled with enrolled students. Existing marks are kept; everyone
else defaults to `Present` with `marked: false`.

```json
{"message": {"session": {"name": "CS-2026-000048", "session_date": "2026-10-21", "status": "Scheduled", "…": "…"},
  "rows": [{"student": "STU-2026-00012", "student_name": "Jane Doe", "student_number": "MBC/DBS/2026/0001", "photo": null,
            "status": "Present", "remarks": null, "marked": false}]}}
```

### `take_attendance`
- **Path:** `mahanaim.api.academics.take_attendance`
- **Method:** POST
- **Guard:** teaching

Args:
- `session`.
- `rows`: `[{student, status: Present|Absent|Late|Excused, remarks?}]`. It must not be empty. Enrolled students who
  are not listed are recorded as Present.

Students not enrolled in the offering are rejected. The session becomes `Held`, with
`attendance_taken`, `present_count` and `absent_count` set. Present and Late count as present.

```json
{"message": {"ok": true, "session": {"name": "CS-2026-000048", "status": "Held", "attendance_taken": 1, "present_count": 1,
  "absent_count": 1, "…": "…"}}}
```

### `attendance_report`
- **Path:** `mahanaim.api.academics.attendance_report`
- **Method:** GET
- **Guard:** offering reader

Args: `offering`. `percentage` = (present + late) / held sessions × 100.

```json
{"message": {"offering": "OFF-2026-00014", "held": 1,
  "sessions": [{"name": "CS-2026-000048", "session_date": "2026-10-21", "start_time": "8:00:00", "topic": "Torah", "status": "Held",
                "attendance_taken": 1, "present_count": 1, "absent_count": 1}],
  "students": [{"student": "STU-2026-00012", "student_name": "Jane Doe", "student_number": "MBC/DBS/2026/0001", "held": 1,
                "present": 1, "late": 0, "absent": 0, "excused": 0, "percentage": 100.0}],
  "average_percentage": 50.0}}
```

### `my_timetable`
- **Path:** `mahanaim.api.academics.my_timetable`
- **Method:** GET
- **Guard:** student

Args: `from_date` (default: today), `to_date` (default: `from_date` + 6 days; the range may be at most 120 days).
Returns the sessions of the offerings the student is enrolled in, including Cancelled ones (their `meeting_link` is
hidden), and Scheduled/Open/Closed exams overlapping the range.

```json
{"message": {"from_date": "2026-10-21", "to_date": "2026-10-28",
  "sessions": [{"name": "CS-2026-000048", "course_offering": "OFF-2026-00014", "course_title": "Old Testament Survey",
                "session_date": "2026-10-21", "start_time": "8:00:00", "end_time": "10:00:00", "venue": "Hall B", "mode": "In Person",
                "meeting_link": null, "status": "Scheduled", "topic": "Torah", "lecturer_name": "Rev. Peter Otieno", "…": "…"}],
  "exams": [{"name": "EXM-2026-00007", "title": "CAT 1", "course_title": "…", "start_datetime": "…", "end_datetime": "…", "…": "…"}]}}
```

### `my_attendance`
- **Path:** `mahanaim.api.academics.my_attendance`
- **Method:** GET
- **Guard:** student (enrolled when `offering` is given)

Args: `offering` (optional). With an offering, the per-session statuses are added in `sessions`.

```json
{"message": {"data": [{"course_offering": "OFF-2026-00014", "course_title": "Old Testament Survey", "held": 1, "present": 1,
  "late": 0, "absent": 0, "excused": 0, "percentage": 100.0}],
  "sessions": [{"name": "CS-2026-000048", "session_date": "2026-10-21", "start_time": "8:00:00", "topic": "Torah",
                "status": "Present", "remarks": null}]}}
```
