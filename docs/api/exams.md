# Exams API (`mahanaim.api.exams`)

Online examinations: the question bank, exam set-up, the student exam room, marking, release and analytics (SOW M10).
Calls go to `/api/method/<dotted path>`. Reads use GET and writes use POST.

**Guards**
- **teaching**: a lecturer of the exam's offering (`require_lecturer_of`). Academic Dean, Registrar, College
  Administrator and System Manager also pass. Other lecturers get `PermissionError`.
- **course**: for the question bank, academic admins, or a lecturer who teaches any offering of the course.
- **student**: a signed-in student. Every attempt call checks that the attempt belongs to the caller; otherwise it
  raises `PermissionError` with "Exam attempt not found.".

**Security**
- The server clock is the only clock: `deadline`, `server_time` and `time_remaining` (seconds) come from the server.
- Students never receive correct answers, accepted answers, matching keys, marking guides or explanations before
  release. After release they get them only when `show_answers_after_release` is set.

## Lifecycle

- **Exam**
  - Status machine:
    - `Draft → Scheduled | Cancelled`
    - `Scheduled → Draft | Open | Cancelled`
    - `Open → Closed | Cancelled`
    - `Closed → Marking | Released | Open`
    - `Marking → Released | Closed`
    - `Released → Marking`
    - `Cancelled → Draft`
  - `exam_type` is one of `CAT`, `Main Exam`, `Supplementary`, `Special` or `Quiz`. `CAT` and `Quiz` feed the
    mark-sheet CAT component; `Main Exam` and `Special` feed the exam component.
  - `delivery_mode` is `Online` or `In Person`. In-person exams are listed but cannot be started online.
  - `start_datetime < end_datetime`, and `0 < duration_minutes ≤` the window.
  - `total_marks` is the sum of the question marks. When `random_question_count` (≤ the number of questions) is
    set, it is `random_question_count × average marks`.
  - Questions must come from the offering's course bank and appear once each. They are frozen once the exam
    leaves Draft/Scheduled.
  - Scheduling an online exam requires questions. Moving to Scheduled (from Draft or Cancelled) notifies enrolled
    students with **"Exam Scheduled"**.
  - An exam with non-void attempts cannot be cancelled, and an exam with any attempts cannot be deleted.
- **Clock-driven statuses**:
  - `update_exam_statuses` runs hourly. Exams are also promoted lazily whenever they are accessed, so the hourly
    run is only a backstop.
  - At `start_datetime`: `Scheduled → Open`.
  - At `end_datetime`, `Open → Closed`. Live attempts are auto-submitted first. Then:
    - `Marking` if essay answers await marking.
    - Otherwise `Released` if `auto_release_objective` is set and every attempt is fully marked.
    - Otherwise it stays `Closed`.
- **Auto-submit**: `auto_submit_expired_attempts` runs every 5 minutes. It submits In Progress attempts whose
  `deadline` has passed. Such submissions are recorded with an **"Auto Submitted"** event and
  `submission_mode: "Auto Submitted"`. The attempt status then follows the marking rules below.
- **Attempt status**: `In Progress → Marked` (all answers auto-marked) or `Marking` (an essay is pending), then
  `Marked → Released`. `Void` cancels an attempt so the student may sit again.
  - Unanswered essays score 0 and need no marking.
  - A submit that arrives more than 30 s after the deadline is accepted, but it is recorded as Auto Submitted.

## Auto-marking

| Type | Answer format sent by the client | Marking |
|---|---|---|
| Multiple Choice | option id (string) | full marks or 0 |
| Multiple Select | JSON list of option ids | `marks × max(0, (correct selected − wrong selected) / total correct)` |
| True or False | `"true"` or `"false"` | full marks or 0 |
| Short Answer / Fill in the Blank | text (≤ 1000 chars) | full marks if it equals any accepted answer after trimming and collapsing spaces (case-insensitive unless `case_sensitive`) |
| Matching | JSON object `{prompt_id: match_text}` | `marks × correct pairs / total pairs` |
| Essay | HTML or text (≤ 60000 chars) | manual (`mark_answer`) |

An empty answer (`null`, `""`, `[]` or `{}`) clears the saved answer and scores 0. Ids that are not in the
student's paper are rejected.

## Question bank (lecturer)

**Question validation:**
- `marks > 0`.
- Multiple Choice needs ≥ 2 unique options and exactly one correct.
- Multiple Select needs ≥ 2 options and at least one correct.
- True or False needs `correct_boolean` (`True` or `False`).
- Short Answer and Fill in the Blank need `accepted_answers`, one per line.
- Matching needs ≥ 2 unique prompts, each with a match.
- Essay is marked manually; an optional `marking_guide` is shown to markers.

### `question_bank`
- **Path:** `mahanaim.api.exams.question_bank`
- **Method:** GET
- **Guard:** course

Args:
- `course`.
- `filters`: an object with `{question_type, topic, difficulty (Easy|Medium|Hard), is_active, search}`.
- `start` and `page_length` (default 50).

`used_in` lists the exams that use the question. `topics` lists the course's distinct topics.

```json
{"message": {"data": [{"name": "Q-000023", "course": "OTS101", "question_type": "Multiple Choice",
  "question_title": "Who led Israel out of Egypt?", "marks": 2.0, "topic": "Exodus", "difficulty": "Easy", "is_active": 1,
  "created_by_staff": "STF-00003", "modified": "…", "used_in": []}], "total": 1, "topics": ["Exodus"]}}
```

### `get_question` / `save_question`
- **Paths:** `mahanaim.api.exams.get_question` (GET; args `name`) and `mahanaim.api.exams.save_question` (POST)
- **Guard:** course

`save_question` args: `data`, an object with `{name?, course, question_type, question (HTML), marks, topic?,
difficulty?, is_active?, correct_boolean?, accepted_answers?, case_sensitive?, marking_guide?, explanation?,
options?: [{name?, option_text, is_correct}], matching_pairs?: [{name?, prompt, match}]}`. Send each option's existing
`name` to keep its id stable. Both endpoints return the full question, including the key, for staff.

```json
{"message": {"name": "Q-000023", "course": "OTS101", "topic": "Exodus", "question_type": "Multiple Choice",
  "question_title": "Who led Israel out of Egypt?", "marks": 2.0, "difficulty": "Easy", "is_active": 1, "created_by_staff": "STF-00003",
  "question": "Who led Israel out of Egypt?", "correct_boolean": null, "accepted_answers": null, "case_sensitive": 0,
  "marking_guide": null, "explanation": null,
  "options": [{"name": "957jeapilj", "option_text": "Moses", "is_correct": 1}, {"name": "957h4afv8l", "option_text": "Aaron", "is_correct": 0}],
  "matching_pairs": [], "creation": "…", "modified": "…", "idx": 0}}
```

### `delete_question`
- **Path:** `mahanaim.api.exams.delete_question`
- **Method:** POST
- **Guard:** course

Args: `name`. A question used in any exam cannot be deleted; set `is_active: 0` instead. Returns `{"ok": true, "name": …}`.

### `import_questions`
- **Path:** `mahanaim.api.exams.import_questions`
- **Method:** POST
- **Guard:** course

Args:
- `course`.
- `rows`: a JSON list of CSV-like objects with these columns:
  - `question_type`: the full name, or `MCQ`, `TF` or `True/False`. Default: Multiple Choice.
  - `question`, `marks` (default 1), `topic`, `difficulty` (default Medium).
  - `option_a` … `option_f`.
  - `correct`:
    - option letters, e.g. `B` or `A,C`
    - `True` or `False`
    - accepted answers separated by `|`
  - `pairs`: `"left=right|left2=right2"`.
  - `case_sensitive`, `marking_guide`, `explanation`.

Valid rows are created and invalid rows are reported (row numbers are 1-based).

```json
{"message": {"created": 2, "failed": 1, "questions": ["Q-000024", "Q-000025"], "errors": [{"row": 3, "error": "Add at least two options."}]}}
```

## Exams (lecturer)

### `list_exams`
- **Path:** `mahanaim.api.exams.list_exams`
- **Method:** GET
- **Guard:** teaching

Args: `offering`, `status` (optional). `to_mark` counts the attempts awaiting marking.

```json
{"message": {"data": [{"name": "EXM-2026-00007", "title": "CAT 1", "exam_type": "CAT", "assessment_component": "CAT",
  "course_offering": "OFF-2026-00014", "course_title": "Old Testament Survey", "delivery_mode": "Online", "status": "Scheduled",
  "start_datetime": "…", "end_datetime": "…", "duration_minutes": 45, "total_marks": 13.0, "pass_mark": 40.0, "max_attempts": 1,
  "attempt_count": 0, "submitted_count": 0, "average_score": 0.0, "to_mark": 0, "question_count": 3}], "total": 1}}
```

### `get_exam` / `save_exam`
- **Paths:** `mahanaim.api.exams.get_exam` (GET; args `name`) and `mahanaim.api.exams.save_exam` (POST)
- **Guard:** teaching

`save_exam` args: `data`, an object with:
- Required: `course_offering` and `title`.
- Optional:
  - `name` (include it to update)
  - `exam_type`, `delivery_mode`, `start_datetime`, `end_datetime`, `duration_minutes`, `venue`, `access_code`
  - `pass_mark`, `max_attempts`, `shuffle_questions`, `shuffle_options`, `random_question_count`
  - `require_fee_clearance`, `show_answers_after_release`, `auto_release_objective`, `instructions`
  - `questions`: question names, or `[{question, marks?}]`. Marks default to the question's marks.

New exams start as `Draft`.

```json
{"message": {"name": "EXM-2026-00007", "title": "CAT 1", "exam_type": "CAT", "course_offering": "OFF-2026-00014",
  "course_title": "Old Testament Survey", "academic_term": "2026-2027 Term 1", "assessment_component": "CAT", "delivery_mode": "Online",
  "status": "Draft", "created_by_staff": "STF-00003", "start_datetime": "…", "end_datetime": "…", "duration_minutes": 45,
  "venue": null, "access_code": null, "total_marks": 13.0, "pass_mark": 40.0, "max_attempts": 1, "shuffle_questions": 1,
  "shuffle_options": 1, "random_question_count": 0, "require_fee_clearance": 1, "show_answers_after_release": 0,
  "auto_release_objective": 0, "instructions": null, "attempt_count": 0, "submitted_count": 0, "average_score": 0.0,
  "questions": [{"question": "Q-000023", "question_type": "Multiple Choice", "topic": "Exodus", "marks": 2.0,
                 "title": "Who led Israel out of Egypt?", "difficulty": "Easy"}],
  "has_manual_questions": true, "creation": "…", "modified": "…", "idx": 0}}
```

### Status actions
All of these are POST, take `name`, use the teaching guard and return the `get_exam` shape (except `delete_exam`).

- **`schedule_exam`** (`mahanaim.api.exams.schedule_exam`): Draft → Scheduled. Notifies students; the exam opens
  automatically at `start_datetime`.
- **`unschedule_exam`** (`mahanaim.api.exams.unschedule_exam`): Scheduled → Draft.
- **`cancel_exam`** (`mahanaim.api.exams.cancel_exam`): → Cancelled. Not allowed once students have attempted it.
- **`close_exam`** (`mahanaim.api.exams.close_exam`): closes an Open exam now. Live attempts are auto-submitted,
  then the exam moves to Marking, Released or Closed as above.
- **`delete_exam`** (`mahanaim.api.exams.delete_exam`): only for exams without attempts. Returns
  `{"ok": true, "name": …}`.

## Marking & results (lecturer)

### `marking_queue`
- **Path:** `mahanaim.api.exams.marking_queue`
- **Method:** GET
- **Guard:** teaching

Args: `exam`. Lists the submitted attempts (Submitted, Auto Submitted, Marking, Marked and Released; not In
Progress or Void), oldest submission first. `unmarked` counts the answers that still need manual marks, and
`pending` counts the attempts not yet Marked.

```json
{"message": {"exam": {"name": "EXM-2026-00007", "title": "CAT 1", "status": "Marking", "total_marks": 13.0},
  "data": [{"name": "ATT-2026-000005", "student": "STU-2026-00012", "student_name": "Jane Doe", "attempt_number": 1,
            "status": "Marking", "submitted_on": "…", "auto_score": 3.0, "manual_score": 0.0, "total_score": 3.0, "max_score": 13.0,
            "percentage": 23.08, "focus_lost_count": 1, "unmarked": 1}],
  "total": 1, "pending": 1, "unmarked_answers": 1}}
```

### `get_attempt_for_marking`
- **Path:** `mahanaim.api.exams.get_attempt_for_marking`
- **Method:** GET
- **Guard:** teaching

Args: `attempt`. Returns the student's answers alongside the key (`correct_answer`, in the same wire format as the
answers), `explanation`, `marking_guide` and the proctoring `events`.

```json
{"message": {"attempt": {"name": "ATT-2026-000005", "exam": "EXM-2026-00007", "student": "STU-2026-00012", "student_name": "Jane Doe",
  "course_offering": "OFF-2026-00014", "attempt_number": 1, "status": "Marking", "started_on": "…", "deadline": "…", "submitted_on": "…",
  "auto_score": 3.0, "manual_score": 0.0, "total_score": 3.0, "max_score": 13.0, "percentage": 23.08, "marked_by": null,
  "marked_on": null, "focus_lost_count": 1, "ip_address": "41.90.1.2", "remarks": null, "submission_mode": "Submitted"},
  "items": [{"question": "Q-000023", "question_type": "Multiple Choice", "text": "Who led Israel out of Egypt?", "answer": "957jeapilj",
             "marks_awarded": 2.0, "max_marks": 2.0, "is_correct": 1, "is_marked": 1, "auto_marked": 1, "feedback": null,
             "options": [{"id": "957jeapilj", "text": "Moses"}, {"id": "957h4afv8l", "text": "Aaron"}],
             "correct_answer": ["957jeapilj"], "explanation": null, "marking_guide": null},
            {"question": "Q-000025", "question_type": "Essay", "text": "Discuss the covenant.", "answer": "<p>Covenant essay</p>",
             "marks_awarded": 0.0, "max_marks": 10.0, "is_correct": 0, "is_marked": 0, "auto_marked": 0, "feedback": null,
             "correct_answer": null, "explanation": null, "marking_guide": null}],
  "events": [{"timestamp": "…", "event": "Started", "detail": null}, {"timestamp": "…", "event": "Focus Lost", "detail": "{\"at\": \"q2\"}"}]}}
```

### `mark_answer`
- **Path:** `mahanaim.api.exams.mark_answer`
- **Method:** POST
- **Guard:** teaching

Args: `attempt`, `question`, `marks` (0..max_marks), `feedback` (optional). Any answer can be marked, including an
override of an auto-mark, until the attempt is released.

```json
{"message": {"ok": true, "attempt": "ATT-2026-000005", "status": "Marking", "total_score": 10.0, "percentage": 76.92, "unmarked": 0}}
```

### `finalise_attempt`
- **Path:** `mahanaim.api.exams.finalise_attempt`
- **Method:** POST
- **Guard:** teaching

Args: `attempt`. Moves the attempt to `Marked` once every answer has marks.

```json
{"message": {"ok": true, "attempt": "ATT-2026-000005", "status": "Marked", "percentage": 76.92}}
```

### `void_attempt`
- **Path:** `mahanaim.api.exams.void_attempt`
- **Method:** POST
- **Guard:** teaching

Args: `attempt`, `reason` (required). Use it after a technical failure: a void attempt does not count towards
`max_attempts`. Released attempts cannot be voided.

```json
{"message": {"ok": true, "attempt": "ATT-2026-000005", "status": "Void"}}
```

### `release_results`
- **Path:** `mahanaim.api.exams.release_results`
- **Method:** POST
- **Guard:** teaching

Args: `exam`. Needs the exam to be Closed or Marking, with no attempt still pending marking. Marked attempts become
`Released`, the exam becomes `Released`, and the students are notified (**"Exam Results Released"**, link
`/student/exams`). Returns the `get_exam` shape.

### `exam_stats`
- **Path:** `mahanaim.api.exams.exam_stats`
- **Method:** GET
- **Guard:** teaching

Args: `exam`. Covers the marked and released attempts.
- `distribution`: ten percentage buckets.
- `grades`: per the default grading scale.
- Per question: `facility` (average % of marks earned), `correct_rate` and `difficulty` (Easy ≥ 70, Hard < 40,
  otherwise Medium), hardest first.

```json
{"message": {"exam": "EXM-2026-00007", "title": "CAT 1", "status": "Released", "count": 1, "average": 76.92, "highest": 76.92,
  "lowest": 76.92, "pass_rate": 100.0, "distribution": [{"range": "0-9", "count": 0}, "…", {"range": "90-100", "count": 0}],
  "grades": [{"grade": "A-", "count": 1}],
  "questions": [{"question": "Q-000025", "title": "Discuss the covenant.", "question_type": "Essay", "responses": 1, "answered": 1,
                 "correct_rate": 0.0, "facility": 70.0, "difficulty": "Easy"}]}}
```

### `exam_monitor`
- **Path:** `mahanaim.api.exams.exam_monitor`
- **Method:** GET
- **Guard:** teaching

Args: `exam`. A live invigilation view: poll it every 15–30 s. `time_left` is in seconds.

```json
{"message": {"exam": {"name": "EXM-2026-00007", "title": "CAT 1", "status": "Open", "course_offering": "OFF-2026-00014",
  "start_datetime": "…", "end_datetime": "…"}, "server_time": "…",
  "attempts": [{"name": "ATT-2026-000005", "student": "STU-2026-00012", "student_name": "Jane Doe", "status": "In Progress",
                "attempt_number": 1, "started_on": "…", "deadline": "…", "submitted_on": null, "focus_lost_count": 1, "percentage": 0.0,
                "ip_address": "41.90.1.2", "answered": 3, "questions": 3, "time_left": 2699}],
  "in_progress": 1, "submitted": 0, "not_started": ["STU-2026-00013"]}}
```

## Student exam room

### `my_exams`
- **Path:** `mahanaim.api.exams.my_exams`
- **Method:** GET
- **Guard:** student

The student's Scheduled, Open, Closed, Marking and Released exams in three lists: `upcoming`, `open` and `past`.
Past exams are listed newest first. Drafts and Cancelled exams are hidden.
- `can_start` is true when `reasons` is empty, or when there is a live attempt to resume.
- `reasons` contains translated messages:
  - not enrolled
  - cancelled, not scheduled, "opens on …" or "closed on …"
  - all attempts used
  - the fee-clearance message from Finance
  - "This exam is sat in person (venue)."
- When there is a live attempt, `in_progress_attempt` and `time_remaining` let the UI resume it.

```json
{"message": {"upcoming": [], "past": [], "server_time": "2026-10-21 23:55:46",
  "open": [{"name": "EXM-2026-00007", "title": "CAT 1", "exam_type": "CAT", "course_offering": "OFF-2026-00014",
            "course_title": "Old Testament Survey", "status": "Open", "delivery_mode": "Online", "venue": null, "start_datetime": "…",
            "end_datetime": "…", "duration_minutes": 45, "total_marks": 13.0, "max_attempts": 1, "attempts_used": 0,
            "requires_access_code": false, "in_progress_attempt": null, "time_remaining": null, "can_start": true, "reasons": [],
            "attempts": [], "best_percentage": null}]}}
```

`attempts[]` lists my attempts: `{name, attempt_number, status, percentage}`. `percentage` is null until the
attempt is released. `best_percentage` is the best released percentage.

### `start_exam`
- **Path:** `mahanaim.api.exams.start_exam`
- **Method:** POST
- **Guard:** student

Args: `exam`, `access_code` (needed when the exam has one). The checks run in this order and the first failure is
raised:
1. Enrolled in the offering.
2. The exam is `Open` and now is within the window.
3. The access code matches.
4. Fewer than `max_attempts` attempts have been used (Void ones excluded).
5. Fee clearance, when `require_fee_clearance` is set or Settings `exam_fee_clearance_percent > 0`. This uses
   `fees.fee_clearance(student, "exam")` and shows its `message` (title "Fee clearance required").
6. `delivery_mode` is Online.

If an In Progress attempt exists and its deadline has not passed, it is **resumed** with the same frozen paper and
saved answers. Otherwise a new attempt is created:
- The question order and option order are shuffled per the exam settings; a random subset is used when
  `random_question_count` is set.
- `deadline = min(start + duration, exam end)`.
- The IP address and user agent are recorded.

The response has **no correct-answer information**. Each question carries:
- Option types: `options[{id, text}]`.
- True or False: `options` `true` and `false`.
- Matching: `prompts[{id, text}]` plus `matches[]` (shuffled texts).

```json
{"message": {"attempt": "ATT-2026-000005", "status": "In Progress", "attempt_number": 1,
  "exam": {"name": "EXM-2026-00007", "title": "CAT 1", "course_title": "Old Testament Survey", "exam_type": "CAT", "instructions": null,
           "end_datetime": "2026-10-22 01:55:46", "duration_minutes": 45},
  "started_on": "2026-10-21 23:55:46", "deadline": "2026-10-22 00:40:46", "server_time": "2026-10-21 23:55:46", "time_remaining": 2700,
  "max_score": 13.0, "answered": 0,
  "questions": [
    {"no": 1, "question": "Q-000023", "question_type": "Multiple Choice", "marks": 2.0, "text": "Who led Israel out of Egypt?", "answer": null,
     "options": [{"id": "957jeapilj", "text": "Moses"}, {"id": "957h4afv8l", "text": "Aaron"}]},
    {"no": 2, "question": "Q-000024", "question_type": "True or False", "marks": 1.0, "text": "Jesus was born in Bethlehem.", "answer": null,
     "options": [{"id": "true", "text": "True"}, {"id": "false", "text": "False"}]},
    {"no": 3, "question": "Q-000026", "question_type": "Matching", "marks": 3.0, "text": "Match the book to its author.", "answer": null,
     "prompts": [{"id": "95a1b2c3d4", "text": "Romans"}], "matches": ["Paul", "Luke"]},
    {"no": 4, "question": "Q-000025", "question_type": "Essay", "marks": 10.0, "text": "Discuss the covenant.", "answer": null}]}}
```

### `get_attempt`
- **Path:** `mahanaim.api.exams.get_attempt`
- **Method:** GET
- **Guard:** student (owner)

Args: `attempt`. While In Progress it returns the `start_exam` shape, for a refresh or resume. Past the deadline it
auto-submits first. Once submitted it returns the summary shape of `submit_attempt`.

### `save_answer`
- **Path:** `mahanaim.api.exams.save_answer`
- **Method:** POST
- **Guard:** student (owner)

Args: `attempt`, `question`, `answer` (in the format from the auto-marking table; send lists and objects as JSON).
Autosave on every change. It is rejected once the attempt is submitted ("This attempt has already been submitted.")
or after the deadline ("Time is up. Answers can no longer be changed.").

```json
{"message": {"ok": true, "question": "Q-000023", "saved_at": "2026-10-21 23:55:46", "time_remaining": 2699}}
```

### `log_exam_event`
- **Path:** `mahanaim.api.exams.log_exam_event`
- **Method:** POST
- **Guard:** student (owner)

Args: `attempt`, `event_type`, `details` (optional; a string or JSON).
- `event_type` is one of `focus_lost`, `focus_regained`, `fullscreen_exit`, `copy`, `paste`, `reconnect` or
  `resumed`. Any other value raises a ValidationError.
- `focus_lost` increments `focus_lost_count`, which lecturers see in the monitor and the marking views.
- Events after submission are ignored (`ok: false`). At most 1000 events are stored per attempt.

```json
{"message": {"ok": true, "focus_lost_count": 1}}
```

### `submit_attempt`
- **Path:** `mahanaim.api.exams.submit_attempt`
- **Method:** POST
- **Guard:** student (owner)

Args: `attempt`. Auto-marks the objective answers and returns a summary **without scores**.

```json
{"message": {"ok": true, "attempt": "ATT-2026-000005", "exam": "EXM-2026-00007", "status": "Marking", "attempt_number": 1,
  "started_on": "…", "submitted_on": "…", "submission_mode": "Submitted", "answered": 3, "questions": 3, "result_available": false}}
```

### `my_exam_result`
- **Path:** `mahanaim.api.exams.my_exam_result`
- **Method:** GET
- **Guard:** student (owner)

Args: `attempt`. Only for Released attempts; otherwise it raises "Results for this exam have not been released yet."
`items` always include my answer, marks and feedback. `correct_answer` and `explanation` are added only when
`show_answers` is true.

```json
{"message": {"exam": {"name": "EXM-2026-00007", "title": "CAT 1", "exam_type": "CAT", "course_title": "Old Testament Survey",
  "pass_mark": 40.0, "show_answers_after_release": 0, "total_marks": 13.0},
  "attempt": {"attempt": "ATT-2026-000005", "exam": "EXM-2026-00007", "status": "Released", "attempt_number": 1, "started_on": "…",
              "submitted_on": "…", "submission_mode": "Submitted", "answered": 3, "questions": 3, "result_available": true,
              "total_score": 10.0, "max_score": 13.0, "percentage": 76.92, "grade": "A-", "passed": true},
  "show_answers": false,
  "items": [{"question": "Q-000023", "question_type": "Multiple Choice", "text": "Who led Israel out of Egypt?", "answer": "957jeapilj",
             "marks_awarded": 2.0, "max_marks": 2.0, "is_correct": 1, "is_marked": 1, "auto_marked": 1, "feedback": null,
             "options": [{"id": "957jeapilj", "text": "Moses"}, {"id": "957h4afv8l", "text": "Aaron"}]}]}}
```
