# Lecturer API (`mahanaim.api.lecturer`)

The lecturer portal: dashboard, my offerings, the class overview and the roster export. It aggregates M07, M09,
M10, M11 and M21. Calls go to `/api/method/<dotted path>`.

**Guards**
- **lecturer**: the Lecturer role, or any staff (`require_lecturer`). Results are scoped to offerings where the
  caller's user is in the offering's `lecturers` table.
- **teaching**: a lecturer of the offering (`require_lecturer_of`), or Academic Dean, Registrar, College
  Administrator or System Manager. Other lecturers get `PermissionError`.

**`to_grade` counts** (per offering):
- `submissions`: assignment submissions with status Submitted or Late, i.e. not graded yet.
- `attempts`: exam attempts that are Submitted, Auto Submitted or Marking.
- `essay_answers`: answers in those attempts that still need manual marks.

## `lecturer_dashboard`
- **Path:** `mahanaim.api.lecturer.lecturer_dashboard`
- **Method:** GET
- **Guard:** lecturer

Covers my non-cancelled offerings in the current term. It returns:
- `offerings`: the same rows as `my_offerings`.
- `upcoming_sessions`: Scheduled or Rescheduled class sessions in the next 14 days (max 10).
- `attendance_due`: sessions dated today or earlier without attendance taken (max 10, newest first).
- `upcoming_exams`: Scheduled or Open exams that have not ended (max 10).
- `mark_sheets`: a count of offerings by `results_status`.

```json
{"message": {"term": "2026-2027 Term 1",
  "offerings": [{"name": "OFF-2026-00014", "course": "OTS101", "course_title": "Old Testament Survey", "credits": 3.0,
                 "academic_term": "2026-2027 Term 1", "campus": "Main Campus", "study_mode": "Full Time", "section": "A", "status": "Open",
                 "results_status": "Draft", "lms_course": null, "lms_sync_status": "Not Installed", "capacity": 0, "my_role": "Lead",
                 "enrolled_count": 24, "to_grade": {"submissions": 3, "essay_answers": 5, "attempts": 5}, "lms_url": null}],
  "totals": {"offerings": 1, "students": 24, "submissions_to_grade": 3, "attempts_to_mark": 5, "answers_to_mark": 5, "attendance_due": 1},
  "upcoming_sessions": [{"name": "CS-2026-00031", "course_offering": "OFF-2026-00014", "course_title": "Old Testament Survey",
                         "session_date": "2026-10-23", "start_time": "09:00:00", "end_time": "11:00:00", "venue": "Hall A", "mode": "In Person",
                         "meeting_link": null, "topic": "The Patriarchs"}],
  "attendance_due": [{"name": "CS-2026-00030", "course_offering": "OFF-2026-00014", "course_title": "Old Testament Survey",
                      "session_date": "2026-10-20", "start_time": "09:00:00", "topic": "Creation"}],
  "upcoming_exams": [{"name": "EXM-2026-00007", "title": "CAT 1", "exam_type": "CAT", "course_offering": "OFF-2026-00014",
                      "course_title": "Old Testament Survey", "status": "Scheduled", "delivery_mode": "Online",
                      "start_datetime": "2026-10-28 09:00:00", "end_datetime": "2026-10-28 11:00:00", "attempt_count": 0}],
  "mark_sheets": {"Draft": 1}}}
```

## `my_offerings`
- **Path:** `mahanaim.api.lecturer.my_offerings`
- **Method:** GET
- **Guard:** lecturer

Args: `term`: an Academic Term name, `all` for every term, or empty for the current term. Cancelled offerings are
excluded. `my_role` is my row role on the offering (`Lead` or `Assistant`). `lms_url` is set only when the offering
is synced to Frappe LMS. The response `term` is null for `all`.

```json
{"message": {"term": "2026-2027 Term 1", "data": [{"name": "OFF-2026-00014", "course": "OTS101", "course_title": "Old Testament Survey",
  "credits": 3.0, "academic_term": "2026-2027 Term 1", "campus": "Main Campus", "study_mode": "Full Time", "section": "A",
  "status": "Open", "results_status": "Draft", "lms_course": null, "lms_sync_status": "Not Installed", "capacity": 0,
  "my_role": "Lead", "enrolled_count": 24, "to_grade": {"submissions": 3, "essay_answers": 5, "attempts": 5}, "lms_url": null}],
  "total": 1}}
```

## `offering_overview`
- **Path:** `mahanaim.api.lecturer.offering_overview`
- **Method:** GET
- **Guard:** teaching

Args: `offering`. The class page:
- `offering`: the `academics.get_offering` shape.
- `roster`: Enrolled, Completed and Failed students with per-student metrics:
  - `assignment_average`: the average % of graded assignments, released or not.
  - `cat_average`: the average best % of Marked or Released CAT/Quiz attempts.
  - `attendance_percentage` and `sessions_held`. The percentage is (present + late) / (held − excused) × 100, or
    `null` (show "—") when nothing counts.
  - `fee_cleared` and `fee_message`, from Finance's `fee_clearance(student, "exam")`. If the check raises an
    error, the student is shown as not cleared with a message. Until Finance implements the contract, every
    student shows as cleared.
- The offering's assignments and exams (exams excluding Cancelled).
- `sessions`: counts, plus the upcoming and attendance-due session lists.
- `to_grade` counts.
- `mark_sheet`: its status.

```json
{"message": {
  "offering": {"name": "OFF-2026-00014", "course": "OTS101", "course_title": "Old Testament Survey", "credits": 3.0,
               "academic_term": "2026-2027 Term 1", "academic_year": "2026-2027", "campus": "Main Campus", "study_mode": "Full Time",
               "section": "A", "status": "Open", "capacity": 0, "start_date": "2026-09-07", "end_date": "2026-12-11",
               "grading_scale": null, "results_status": "Draft", "description": null, "require_fee_clearance": 0, "lms_course": null,
               "lms_sync_status": "Not Installed", "lms_last_synced": null, "lms_sync_error": null, "enrolled_count": 24,
               "lecturers": [{"staff_member": "STF-00003", "staff_name": "Rev. Peter Otieno", "user": "p.otieno@mbc.ac.ke", "role": "Lead"}],
               "assessment_weights": [], "lms_url": null, "mark_sheet": "MS-2026-00006",
               "counts": {"assignments": 1, "exams": 1, "sessions": 1, "modules": 1, "resources": 1}},
  "roster": [{"student": "STU-2026-00012", "student_number": "MBC/DBS/2026/0001", "full_name": "Jane Doe", "email": "jane@example.com",
              "phone": "254712345678", "programme": "DBS", "photo": null, "student_status": "Active", "enrolment_status": "Enrolled",
              "enrolled_on": "2026-09-01", "final_grade": null, "assignment_average": 80.0, "cat_average": 76.92,
              "attendance_percentage": 100.0, "sessions_held": 1, "fee_cleared": true, "fee_message": null}],
  "assignments": [{"name": "ASG-2026-00007", "title": "Exegesis paper", "assessment_component": "Assignment", "status": "Graded",
                   "due_date": "…", "max_score": 20.0, "submission_count": 2, "graded_count": 2, "average_score": 13.0}],
  "exams": [{"name": "EXM-2026-00007", "title": "CAT 1", "exam_type": "CAT", "status": "Released", "delivery_mode": "Online",
             "start_datetime": "…", "end_datetime": "…", "total_marks": 13.0, "attempt_count": 1, "submitted_count": 1, "average_score": 76.92}],
  "sessions": {"total": 1, "held": 1,
               "upcoming": [{"name": "CS-2026-00031", "session_date": "2026-10-23", "start_time": "09:00:00", "end_time": "11:00:00",
                             "status": "Scheduled", "topic": "The Patriarchs", "attendance_taken": 0}],
               "attendance_due": []},
  "to_grade": {"submissions": 0, "essay_answers": 0, "attempts": 0},
  "mark_sheet": {"name": "MS-2026-00006", "status": "Draft", "student_count": 24, "pass_count": 20, "average_score": 61.4,
                 "return_reason": null}}}
```

When no mark sheet exists yet, `mark_sheet` is `{"name": null, "status": "Not Started"}`.

## `roster_csv`
- **Path:** `mahanaim.api.lecturer.roster_csv`
- **Method:** GET
- **Guard:** teaching

Args: `offering`. A file download named `roster-<course>-<term>.csv`; use it as a link href. The columns are:
Student Number, Name, Email, Phone, Programme, Enrolment Status, Assignment Average %, CAT Average %, Attendance %
and Final Grade. No fee data is included.
