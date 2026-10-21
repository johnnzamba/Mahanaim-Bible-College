# Assessments API (`mahanaim.api.assessments`)

Assignments and CATs (take-home work), submissions, grading and release: SOW M09.
Calls go to `/api/method/<dotted path>`. Reads use GET and writes use POST.

**Guards**
- **teaching**: a lecturer of the assignment's offering (`require_lecturer_of`). Academic Dean, Registrar, College
  Administrator and System Manager also pass. Other lecturers get `PermissionError`.
- **enrolled**: the session student is enrolled in the assignment's offering, and the assignment is
  Published, Closed or Graded. Drafts are invisible to students and return "Assignment not found.".

## Rules

- **Assignment**
  - `assessment_component` is one of `CAT`, `Assignment`, `Project`, `Practical` or `Participation`. It decides
    which mark-sheet bucket the score feeds (see results.md).
  - `submission_type` is one of `File Upload`, `Text` or `File and Text`. `allowed_file_types` is comma-separated
    (default `pdf,doc,docx,odt,jpg,png`).
  - `open_date < due_date ≤ late_cutoff`. `max_score > 0`. The late percentages must be between 0 and 100.
  - Status machine: `Draft → Published`, `Published → Closed | Draft`, `Closed → Published | Graded`,
    `Graded → Closed`.
  - Publishing from `Draft` notifies enrolled students with event **"Assignment Published"** (link
    `/student/courses/<offering>`). Re-opening a Closed assignment does not notify again. Publishing sets
    `open_date` to now when it is empty.
  - Releasing grades on a Closed assignment moves it to `Graded`.
  - `submission_count`, `graded_count` and `average_score` (the mean `final_score`) are refreshed from the
    submissions.
  - An assignment with submissions cannot be deleted; close it instead.
- **Assignment Submission**
  - One per student + assignment.
  - Submitting is allowed while the assignment is Published (and past `open_date`):
    - up to `due_date`
    - after that only when `allow_late`, and until `late_cutoff` if one is set
  - Students may resubmit freely until `due_date` unless the submission is already graded. After the due date, an
    on-time submission is frozen.
  - `is_late` is set, and `days_late = ceil((submitted_on − due_date) / 1 day)`.
  - `penalty = raw_score × min(days_late × late_penalty_percent_per_day, max_late_penalty_percent) / 100`.
  - `final_score = max(raw_score − penalty, 0)`, and `0 ≤ raw_score ≤ max_score`.
  - Status is one of `Submitted`, `Late`, `Graded` or `Returned`.
  - Releasing a grade notifies the student with **"Assignment Graded"**.
- **Due reminders** (scheduler, daily): `mahanaim.services.assessments.send_due_reminders` finds Published
  assignments due within 48 h and notifies enrolled students who have not submitted (**"Assignment Due Reminder"**).
  Each assignment is reminded once (`reminder_sent_on`); moving the due date resets it.

## Lecturer

### `list_assignments`
- **Path:** `mahanaim.api.assessments.list_assignments`
- **Method:** GET
- **Guard:** teaching

Args: `offering`, `status` (optional).

```json
{"message": {"data": [{"name": "ASG-2026-00007", "title": "Exegesis paper", "course_offering": "OFF-2026-00014",
  "course_title": "Old Testament Survey", "academic_term": "2026-2027 Term 1", "assessment_component": "Assignment",
  "status": "Published", "open_date": "2026-10-21 23:55:46", "due_date": "2026-10-26 23:55:46", "late_cutoff": null,
  "allow_late": 1, "max_score": 20.0, "submission_type": "Text", "submission_count": 1, "graded_count": 0, "average_score": 0.0,
  "enrolled_count": 2, "released_count": 0, "to_grade": 1}], "total": 1}}
```

### `get_assignment`
- **Path:** `mahanaim.api.assessments.get_assignment`
- **Method:** GET
- **Guard:** teaching

Args: `name`.

```json
{"message": {"name": "ASG-2026-00007", "title": "Exegesis paper", "course_offering": "OFF-2026-00014", "course_title": "…",
  "academic_term": "…", "assessment_component": "Assignment", "status": "Published", "created_by_staff": "STF-00003",
  "instructions": null, "attachment": null, "open_date": "…", "due_date": "…", "max_score": 20.0, "submission_type": "Text",
  "allowed_file_types": "pdf,doc,docx,odt,jpg,png", "allow_late": 1, "late_penalty_percent_per_day": 5.0, "late_cutoff": null,
  "max_late_penalty_percent": 50.0, "submission_count": 0, "graded_count": 0, "average_score": 0.0, "reminder_sent_on": null,
  "enrolled_count": 2, "creation": "…", "modified": "…"}}
```

### `save_assignment`
- **Path:** `mahanaim.api.assessments.save_assignment`
- **Method:** POST
- **Guard:** teaching

Args: `data`, an object with `{name?, course_offering, title, assessment_component?, instructions?, attachment?,
open_date?, due_date, max_score, submission_type?, allowed_file_types?, allow_late?, late_penalty_percent_per_day?,
late_cutoff?, max_late_penalty_percent?}`. New assignments start as `Draft`. `attachment` (the brief) must be the
caller's upload from `/api/method/upload_file`. Returns the same shape as `get_assignment`.

### `publish_assignment` / `close_assignment`
- **Paths:** `mahanaim.api.assessments.publish_assignment` and `mahanaim.api.assessments.close_assignment`
- **Method:** POST
- **Guard:** teaching

Args: `name`. Returns the assignment (`get_assignment` shape). Publishing from Draft notifies the students.

### `delete_assignment`
- **Path:** `mahanaim.api.assessments.delete_assignment`
- **Method:** POST
- **Guard:** teaching

Args: `name`. Only an assignment without submissions can be deleted. Returns `{"ok": true, "name": …}`.

### `list_submissions`
- **Path:** `mahanaim.api.assessments.list_submissions`
- **Method:** GET
- **Guard:** teaching

Args: `assignment`, `status` (optional; `Not Submitted` is also accepted). Each enrolled student without a submission
gets a placeholder row with `status: "Not Submitted"` and `name: null`.

```json
{"message": {"assignment": {"name": "ASG-2026-00007", "title": "Exegesis paper", "max_score": 20.0, "…": "…"},
  "data": [{"name": "SUB-2026-000007", "assignment": "ASG-2026-00007", "student": "STU-2026-00012", "student_name": "Jane Doe",
            "student_number": "MBC/DBS/2026/0001", "status": "Submitted", "submitted_on": "…", "is_late": 0, "days_late": 0,
            "answer_text": "My answer", "attachment": null, "raw_score": 0.0, "penalty": 0.0, "final_score": 0.0, "feedback": null,
            "feedback_attachment": null, "graded_by": null, "graded_on": null, "released": 0},
           {"name": null, "assignment": "ASG-2026-00007", "student": "STU-2026-00013", "student_name": "John Mwangi",
            "student_number": "MBC/DBS/2026/0002", "status": "Not Submitted"}],
  "total": 2}}
```

### `grade_submission`
- **Path:** `mahanaim.api.assessments.grade_submission`
- **Method:** POST
- **Guard:** teaching

Args: `name` (submission), `raw_score`, `feedback`, `feedback_attachment` (the caller's upload), `release` (0/1;
default 0). It computes `penalty` and `final_score` and sets the status to `Graded`. With `release=1` the student
sees the grade immediately and is notified.

```json
{"message": {"name": "SUB-2026-000007", "assignment": "ASG-2026-00007", "assignment_title": "Exegesis paper",
  "student": "STU-2026-00012", "student_name": "Jane Doe", "course_offering": "OFF-2026-00014", "status": "Graded",
  "submitted_on": "…", "is_late": 0, "days_late": 0, "answer_text": "My answer", "raw_score": 16.0, "penalty": 0.0,
  "final_score": 16.0, "graded_by": "p.otieno@mbc.ac.ke", "graded_on": "…", "released": 0, "feedback": "Good work",
  "feedback_attachment": null}}
```

### `bulk_grade`
- **Path:** `mahanaim.api.assessments.bulk_grade`
- **Method:** POST
- **Guard:** teaching

Args:
- `assignment`.
- `rows`: `[{submission? | student, raw_score, feedback?}]`.
- `release` (0/1).

A `student` without a submission (for example, work handed in on paper) gets one created. Rows with an empty
`raw_score` are skipped. It is all-or-nothing: any invalid row rolls back the whole batch.

```json
{"message": {"ok": true, "graded": 1, "submissions": ["SUB-2026-000008"]}}
```

### `release_grades`
- **Path:** `mahanaim.api.assessments.release_grades`
- **Method:** POST
- **Guard:** teaching

Args: `assignment`. Releases every graded, unreleased submission and notifies each student ("Assignment Graded"). A
Closed assignment becomes `Graded`.

```json
{"message": {"ok": true, "released": 2}}
```

### `assignment_stats`
- **Path:** `mahanaim.api.assessments.assignment_stats`
- **Method:** GET
- **Guard:** teaching

Args: `assignment`. `distribution` has ten percentage buckets of `final_score / max_score`.

```json
{"message": {"assignment": "ASG-2026-00007", "max_score": 20.0, "enrolled": 2, "submitted": 2, "not_submitted": 0, "late": 0,
  "graded": 2, "released": 2, "to_grade": 0, "average": 13.0, "highest": 16.0, "lowest": 10.0,
  "distribution": [{"range": "0-9", "count": 0}, {"range": "10-19", "count": 0}, "…", {"range": "90-100", "count": 0}]}}
```

## Student

A submission is shown to its student without scores or feedback until it is **released**. Before release, a graded
submission still reports `Submitted` (or `Late`).

### `my_assignments`
- **Path:** `mahanaim.api.assessments.my_assignments`
- **Method:** GET
- **Guard:** student (enrolled, when `offering` is given)

Args: `status` (`pending`, `late_open`, `submitted`, `graded` or `overdue`; optional), `offering` (optional). Each
row has:
- `state`, one of:
  - `pending`: not submitted, not yet due.
  - `late_open`: past due and not submitted, but late work is still accepted (`allow_late`, before any
    `late_cutoff`). A submission now is late and penalised.
  - `overdue`: past due, not submitted, and the window is closed.
  - `submitted`.
  - `graded`: released.
- `is_late` (bool): now is past `due_date`. Use it with `state` to show "late" badges.
- `can_submit`.
- `reason`: why the student cannot submit.

```json
{"message": {"data": [{"name": "ASG-2026-00007", "title": "Exegesis paper", "course_offering": "OFF-2026-00014",
  "course_title": "Old Testament Survey", "academic_term": "…", "assessment_component": "Assignment", "status": "Published",
  "open_date": "…", "due_date": "2026-10-26 23:55:46", "late_cutoff": null, "allow_late": 1, "max_score": 20.0,
  "submission_type": "Text", "state": "submitted", "is_late": false, "can_submit": true, "reason": null,
  "submission": {"name": "SUB-2026-000007", "status": "Submitted", "submitted_on": "…", "is_late": 0, "days_late": 0,
                 "answer_text": "My answer", "attachment": null, "released": 0}}], "total": 1}}
```

Once released, `submission` also carries `raw_score`, `penalty`, `final_score`, `feedback`, `graded_on` and
`has_feedback_attachment`.

### `get_my_assignment`
- **Path:** `mahanaim.api.assessments.get_my_assignment`
- **Method:** GET
- **Guard:** enrolled

Args: `name`. `server_time` lets the UI show a countdown using the server clock.

```json
{"message": {"assignment": {"name": "ASG-2026-00007", "title": "Exegesis paper", "course_offering": "OFF-2026-00014",
  "course_title": "…", "assessment_component": "Assignment", "status": "Published", "instructions": null, "open_date": "…",
  "due_date": "…", "late_cutoff": null, "allow_late": 1, "max_score": 20.0, "submission_type": "Text",
  "allowed_file_types": "pdf,doc,docx,odt,jpg,png", "late_penalty_percent_per_day": 5.0, "max_late_penalty_percent": 50.0,
  "has_attachment": false},
  "submission": {"name": "SUB-2026-000007", "status": "Submitted", "…": "…"}, "state": "submitted", "can_submit": true,
  "reason": null, "is_late": false, "server_time": "2026-10-21 23:55:46"}}
```

### `submit_assignment`
- **Path:** `mahanaim.api.assessments.submit_assignment`
- **Method:** POST
- **Guard:** enrolled

Args: `assignment`, `answer_text` (for Text and File and Text), `attachment` (for File Upload and File and Text). The
attachment is the student's own `/api/method/upload_file` URL, with an extension in `allowed_file_types`. This
creates the submission, or updates it on a resubmission. Rejections give a translated reason (closed, past due, late
not accepted, already graded, and so on).

```json
{"message": {"ok": true, "submission": {"name": "SUB-2026-000007", "status": "Submitted", "submitted_on": "…", "is_late": 0,
  "days_late": 0, "answe