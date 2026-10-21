# Results API (`mahanaim.api.results`)

Mark sheets (continuous assessment + exam → grade), the approval workflow, publication into Course Results, and
student results, GPA and transcripts (SOW M11).
Calls go to `/api/method/<dotted path>`. Reads use GET and writes use POST.

**Guards**
- **teaching**: a lecturer of the offering (`require_lecturer_of`), or an academic admin.
- **admin**: Academic Dean, Registrar, College Administrator or System Manager.
- **dean**: Academic Dean, College Administrator or System Manager.
- **registrar**: Registrar, College Administrator or System Manager.
- **academic reader**: admin plus the read-only Auditor role.
- **offering reader**: teaching, or staff with read access to the offering.
- **student**: the signed-in student (their own data only).

## Mark sheet rules

There is one **Mark Sheet** per Course Offering. It is created automatically the first time it is opened, with one
entry per Enrolled, Completed or Failed student.

**Components and weights.** Each component is stored as **weighted points**: `percentage × weight / 100`.
- Weights are copied from the offering's assessment weights when the sheet is created. Project, Practical and
  Participation weights map to `other`. The default is CAT 20 / Assignment 10 / Exam 70 / Other 0, and the four
  must total 100.

| Component | Source (only assessments that are due: past their due/end date or closed) |
|---|---|
| `cat_score` | average % of CAT and Quiz exams (best Marked/Released attempt; no attempt = 0) and of assignments with component `CAT` |
| `assignment_score` | average % of released `final_score / max_score` for assignments with component `Assignment` (no submission = 0) |
| `exam_score` | best % of the Main Exam / Special exam |
| `other_score` | Project, Practical and Participation assignments; **manual** when the offering has none (pending until entered when `other_weight > 0`) |

**Result per entry:**
- `total` = the sum of the weighted points.
- `grade` and `grade_points` come from the offering's grading scale (or the default, "MBC Standard").
- `result_status`:
  - `Pass` / `Fail`: `total` against the course `pass_mark` (default 40).
  - `Incomplete` (grade `I`, 0 points): a weighted component has no due assessment yet, or has unmarked or
    unreleased work. The component is listed in `pending_components`.
  - `Absent` (grade `ABS`, 0 points; `is_absent = 1`): a final online exam is due and the student has no
    attempt.

**Overrides.** While the sheet is `Draft` or `Returned`, lecturers may set any component in weighted points
(0..weight). An override:
- is listed in `overridden_components`, is kept across recomputes, and clears `pending` for that component
- clears `Absent` when it is the exam component (for example, a paper sat on another day)

Send `null` to drop an override and use the computed value again.

**Workflow:**
- `Draft → Submitted` (lecturer).
- `Submitted → Approved` (dean) or `Returned` (admin, with remarks).
- `Approved → Published` (registrar) or `Returned`.
- `Returned → Submitted | Draft`.

Marks are locked outside Draft and Returned. The offering's `results_status` mirrors the sheet status
(`Not Started` when there is no sheet).

**On publication**, for each entry:
- A **Course Result** is created or updated: `total_score`, `grade`, `grade_points`,
  `quality_points = grade_points × credits`, `result_status`, `is_published = 1` and `published_on`. `attempt`
  is `Retake` when the student already has a result for the course, otherwise `First`.
- The **Course Enrolment** gets `final_score`, `final_grade` and `grade_points`, and its status becomes
  `Completed` (Pass) or `Failed` (Fail or Absent). Incomplete leaves the status unchanged.
- `refresh_student_standing` updates `Student.cgpa`, `credits_earned` and `academic_standing`.
- Students are notified with **"Results Published"** (context `term` and `course_title`, link `/student/results`).

**GPA and standing** (`mahanaim.services.grading`):
- `GPA = Σ(grade_points × credits) / Σ credits` over published Course Results. Only the best attempt per course
  counts (highest grade points, then highest total). `Incomplete` results are excluded.
- `credits_earned` counts the Pass credits.
- Standing uses the last term with GPA credits:
  - `Dean's List` if that term's GPA ≥ 3.6
  - otherwise `Probation` if CGPA < 2.0
  - otherwise `Academic Warning` if that term's GPA < 2.0
  - otherwise `Good Standing`
  - `null` when there are no GPA credits
- Classification (Distinction, Credit, Pass or Fail) comes from the scale's classification bands by CGPA.

**Grading Scale validation:**
- Bands must not overlap and must cover 0–100 contiguously (gaps of up to 0.99 between bands are tolerated). A
  score falls into the highest band whose `min_score ≤ score`, so 39.99 → F, 40 → D and 80 → A on MBC Standard.
- There is only one default scale, and the default scale cannot be deleted.
- Classification bands must not overlap.

## Mark sheet shape

All mark-sheet endpoints return the following shape.
- `assessments` lists the work feeding each bucket.
- `actions` tells the UI which buttons to show to the caller.

```json
{"message": {"name": "MS-2026-00006", "course_offering": "OFF-2026-00014", "course_title": "Old Testament Survey",
  "academic_term": "2026-2027 Term 1", "campus": "Main Campus", "grading_scale": null, "status": "Draft",
  "cat_weight": 20.0, "assignment_weight": 10.0, "exam_weight": 70.0, "other_weight": 0.0,
  "submitted_by": null, "submitted_on": null, "approved_by": null, "approved_on": null, "published_by": null, "published_on": null,
  "returned_by": null, "returned_on": null,
  "submitted_by_name": null, "approved_by_name": null, "returned_by_name": null, "published_by_name": null,
  "return_reason": null, "student_count": 2, "pass_count": 1, "average_score": 39.19, "highest_score": 55.0,
  "entries": [
    {"student": "STU-2026-00012", "student_name": "Jane Doe", "student_number": "MBC/DBS/2026/0001", "cat_score": 15.38,
     "assignment_score": 8.0, "exam_score": 0, "other_score": 0, "total": 23.38, "grade": "I", "grade_points": 0.0,
     "result_status": "Incomplete", "is_absent": 0, "remarks": null, "pending_components": ["exam"], "overridden_components": []},
    {"student": "STU-2026-00013", "student_name": "John Mwangi", "student_number": "MBC/DBS/2026/0002", "cat_score": 0.0,
     "assignment_score": 5.0, "exam_score": 50.0, "other_score": 0, "total": 55.0, "grade": "C+", "grade_points": 2.3,
     "result_status": "Pass", "is_absent": 0, "remarks": "Paper exam", "pending_components": [], "overridden_components": ["exam"]}],
  "weights": {"cat": 20.0, "assignment": 10.0, "exam": 70.0, "other": 0.0}, "pass_mark": 40.0,
  "assessments": [{"kind": "exam", "name": "EXM-2026-00007", "title": "CAT 1", "bucket": "cat", "status": "Released"},
                  {"kind": "assignment", "name": "ASG-2026-00007", "title": "Exegesis paper", "bucket": "assignment", "status": "Graded"}],
  "lecturers": [{"staff_member": "STF-00003", "staff_name": "Rev. Peter Otieno", "user": "p.otieno@mbc.ac.ke", "role": "Lead"}],
  "actions": {"can_edit": true, "can_submit": true, "can_approve": false, "can_return": false, "can_publish": false},
  "creation": "…", "modified": "…", "idx": 0}}
```

Workflow stamps:
- `submitted_by`/`approved_by`/`returned_by`/`published_by` are user ids. Each has a `*_by_name` companion with the
  user's full name (`null` when unset).
- `returned_by`/`returned_on` are stamped when a sheet is returned. They are kept as history after resubmission;
  `return_reason` is cleared.

## Lecturer

### `get_mark_sheet`
- **Path:** `mahanaim.api.results.get_mark_sheet`
- **Method:** GET
- **Guard:** teaching

Args: `offering`. Creates the sheet on first access. While it is Draft or Returned, the figures in the response are
recomputed from live assessment data **in memory only**. Reads never save the sheet, so concurrent reads are safe.
Returns the mark sheet shape plus `stale`: `true` when the stored sheet is behind the live data. The UI should then
call `recompute_mark_sheet`; saving entries or submitting also persists the fresh figures.

### `recompute_mark_sheet`
- **Path:** `mahanaim.api.results.recompute_mark_sheet`
- **Method:** POST
- **Guard:** teaching

Args: `name`. Draft or Returned only. Re-syncs the roster and recomputes the components that are not overridden.

### `save_mark_sheet_entries`
- **Path:** `mahanaim.api.results.save_mark_sheet_entries`
- **Method:** POST
- **Guard:** teaching

Args:
- `name`.
- `rows`: `[{student, cat_score?, assignment_score?, exam_score?, other_score?, remarks?}]`. Scores are weighted
  points (0..weight). `null` removes the override; an omitted key leaves the component unchanged.

Draft or Returned only.

```json
{"rows": [{"student": "STU-2026-00013", "exam_score": 50, "remarks": "Paper exam"}]}
```

### `update_mark_sheet_weights`
- **Path:** `mahanaim.api.results.update_mark_sheet_weights`
- **Method:** POST
- **Guard:** teaching

Args: `name`, `weights` (`{cat_weight, assignment_weight, exam_weight, other_weight}`, which must total 100). Draft
or Returned only. Computed components are recalculated for the new weights. An existing override above its new
weight is rejected; clear or adjust it first.

### `submit_mark_sheet`
- **Path:** `mahanaim.api.results.submit_mark_sheet`
- **Method:** POST
- **Guard:** teaching

Args: `name`. Recomputes the sheet, then moves it from Draft or Returned to `Submitted` (stamping `submitted_by` and
`submitted_on`). Marks are locked from this point.

## Dean & registrar

### `pending_mark_sheets`
- **Path:** `mahanaim.api.results.pending_mark_sheets`
- **Method:** GET
- **Guard:** academic reader

Args: `term` (optional), `status` (optional). Without `status`, it returns the sheets awaiting the caller: `Submitted`
for deans and `Approved` for the registrar (both for admins and read-only auditors). The oldest submission comes
first. Rows include `published_by`, `returned_by`, `returned_on` and the four `*_by_name` fields.

```json
{"message": {"data": [{"name": "MS-2026-00006", "course_offering": "OFF-2026-00014", "course_title": "Old Testament Survey",
  "academic_term": "2026-2027 Term 1", "campus": "Main Campus", "status": "Submitted", "student_count": 2, "pass_count": 1,
  "average_score": 43.04, "highest_score": 55.0, "submitted_by": "p.otieno@mbc.ac.ke", "submitted_on": "…", "approved_by": null,
  "approved_on": null, "published_by": null, "published_on": null, "returned_by": null, "returned_on": null,
  "return_reason": null, "lecturers": ["Rev. Peter Otieno"], "submitted_by_name": "Rev. Peter Otieno",
  "approved_by_name": null, "returned_by_name": null, "published_by_name": null}], "total": 1}}
```

### `get_mark_sheet_by_name`
- **Path:** `mahanaim.api.results.get_mark_sheet_by_name`
- **Method:** GET
- **Guard:** offering reader

Args: `name`. Returns the mark sheet shape without recomputing it.

### `approve_mark_sheet`
- **Path:** `mahanaim.api.results.approve_mark_sheet`
- **Method:** POST
- **Guard:** dean

Args: `name`. Submitted → Approved (stamps `approved_by` and `approved_on`). Lecturers and the registrar get
`PermissionError`.

### `return_mark_sheet`
- **Path:** `mahanaim.api.results.return_mark_sheet`
- **Method:** POST
- **Guard:** admin

Args: `name`, `remarks` (required; stored as `return_reason`). Submitted or Approved → Returned. The lecturer can
then edit and resubmit.

### `publish_mark_sheet`
- **Path:** `mahanaim.api.results.publish_mark_sheet`
- **Method:** POST
- **Guard:** registrar

Args: `name`. Approved → Published, with all the publication side effects above. A published sheet is final and
cannot be deleted.

### `bulk_publish`
- **Path:** `mahanaim.api.results.bulk_publish`
- **Method:** POST
- **Guard:** registrar

Args: `term`, `mark_sheets` (optional list or JSON list of names). Without `mark_sheets`, it publishes every
Approved sheet of the term. With it, only those sheets are published. The list is checked up front: unknown names
raise `DoesNotExistError`; sheets outside the term or not Approved raise `ValidationError`, and nothing is
published. Each sheet is published in its own transaction; failures are reported and do not stop the batch.

```json
{"message": {"term": "2026-2027 Term 1", "published": ["MS-2026-00006"], "failed": [{"mark_sheet": "MS-2026-00009", "error": "…"}],
  "published_count": 1, "failed_count": 1}}
```

## Student

### `my_results`
- **Path:** `mahanaim.api.results.my_results`
- **Method:** GET
- **Guard:** student

Args: `term` (optional; filters `terms` to one term while keeping the overall figures). Only **published** results
are included. Terms are ordered by start date, and each term has its GPA and running `cgpa`. `credits_earned`
counts the passed credits; `credits_attempted` counts the GPA credits.

```json
{"message": {"student": {"name": "STU-2026-00012", "student_number": "MBC/DBS/2026/0001", "full_name": "Jane Doe",
  "programme": "DBS", "programme_name": "Diploma in Biblical Studies", "campus": "Main Campus"},
  "terms": [{"term": "2026-2027 Term 1", "label": "Term 1 2026-2027", "academic_year": "2026-2027", "start_date": "2026-09-07",
             "courses": [{"code": "OTS101", "title": "Old Testament Survey", "credits": 3.0, "total": 82.0, "grade": "A",
                          "grade_points": 4.0, "status": "Pass", "attempt": "First", "course_result": "CR-2026-000009", "is_published": 1}],
             "gpa": 4.0, "credits": 3.0, "credits_earned": 3.0, "quality_points": 12.0, "cgpa": 4.0}],
  "cgpa": 4.0, "credits_earned": 3.0, "credits_attempted": 3.0, "quality_points": 12.0, "standing": "Dean's List",
  "classification": "Distinction", "min_credits_to_graduate": 120.0}}
```

### `my_transcript_preview`
- **Path:** `mahanaim.api.results.my_transcript_preview`
- **Method:** GET
- **Guard:** student

Returns `mahanaim.services.results.transcript_data(student, published_only=True)`, the same data that official
transcripts (credentials) are built from.

```json
{"message": {"student": {"name": "STU-2026-00012", "student_number": "MBC/DBS/2026/0001", "full_name": "Jane Doe", "programme": "DBS",
  "programme_name": "Diploma in Biblical Studies", "campus": "Main Campus", "study_mode": "Full Time", "intake": null,
  "admission_year": null, "status": "Active", "enrollment_date": null, "completion_date": null, "graduation_date": null,
  "academic_standing": "Dean's List", "cgpa": 4.0, "credits_earned": 3.0, "photo": null, "date_of_birth": null, "gender": "",
  "level": "Diploma", "award_title": null, "min_credits_to_graduate": 120.0, "min_cgpa_to_graduate": 2.0},
  "terms": ["… same as my_results …"], "cgpa": 4.0, "total_credits": 3.0, "credits_attempted": 3.0, "quality_points": 12.0,
  "classification": "Distinction", "as_of_term": null, "published_only": true, "generated_on": "…"}}
```

`total_credits` is the earned (passed) credits. `as_of_term` (service argument) limits the data to terms starting
on or before that term.

## Staff reports

### `results_overview`
- **Path:** `mahanaim.api.results.results_overview`
- **Method:** GET
- **Guard:** academic reader

Args: `term`. Gives mark-sheet status counts for the term's non-cancelled offerings, overall and per programme
(from curriculum rows), plus one row per offering.

```json
{"message": {"term": "2026-2027 Term 1",
  "totals": {"Not Started": 1, "Draft": 0, "Submitted": 0, "Approved": 0, "Published": 1, "Returned": 0}, "offerings": 2,
  "programmes": [{"programme": "DBS", "programme_name": "Diploma in Biblical Studies", "offerings": 2, "Not Started": 1, "Draft": 0,
                  "Submitted": 0, "Approved": 0, "Published": 1, "Returned": 0}],
  "sheets": [{"course_offering": "OFF-2026-00014", "course_title": "Old Testament Survey", "campus": "Main Campus",
              "mark_sheet": "MS-2026-00006", "status": "Published", "student_count": 2, "pass_count": 1, "average_score": 43.04}]}}
```

### `grade_distribution`
- **Path:** `mahanaim.api.results.grade_distribution`
- **Method:** GET
- **Guard:** offering reader (for `offering`), academic reader (for `term`)

Args: `offering` (uses its mark sheet entries), or `term` (uses the published Course Results of the term).

```json
{"message": {"mark_sheet": "MS-2026-00006", "status": "Published", "count": 2, "grades": [{"grade": "C+", "count": 1}, {"grade": "I", "count": 1}],
  "statuses": {"Pass": 1, "Incomplete": 1}, "average": 43.04, "highest": 55.0, "lowest": 31.08}}
```

With `term`, the response has `"term": "…"` instead of `mark_sheet` and `status`.

### `student_results`
- **Path:** `mahanaim.api.results.student_results`
- **Method:** GET
- **Guard:** admin

Args: `student`, `published_only` (0/1; default 0, which includes unpublished results). Returns the full
`transcript_data` shape.

### `can_manage_results`
- **Path:** `mahanaim.api.results.can_manage_results`
- **Method:** GET
- **Guard:** signed in

A UI helper that says which mark-sheet actions the session user may perform.

```json
{"message": {"academic_admin": true, "approve": true, "publish": false}}
```

## Grading scales

### `get_grading_scales`
- **Path:** `mahanaim.api.results.get_grading_scales`
- **Method:** GET
- **Guard:** staff or lecturer (read)

Returns every scale, default first. Bands are ordered highest first and classifications by `min_cgpa` descending.
`default` is the effective default scale, which `grade_for` uses when an offering has no `grading_scale`.
`offering_count` is how many offerings use the scale explicitly.

```json
{"message": {"default": "MBC Standard",
  "data": [{"name": "MBC Standard", "scale_name": "MBC Standard", "is_default": 1, "is_effective_default": true,
            "pass_mark": 40.0, "description": null, "modified": "…", "offering_count": 0,
            "bands": [{"grade": "A", "min_score": 80.0, "max_score": 100.0, "grade_points": 4.0, "description": "Excellent", "is_pass": 1},
                      {"grade": "F", "min_score": 0.0, "max_score": 39.99, "grade_points": 0.0, "description": "Fail", "is_pass": 0}],
            "classifications": [{"classification": "Distinction", "min_cgpa": 3.6, "max_cgpa": 4.0},
                                {"classification": "Fail", "min_cgpa": 0.0, "max_cgpa": 1.99}]}]}}
```

### `save_grading_scale`
- **Path:** `mahanaim.api.results.save_grading_scale`
- **Method:** POST
- **Guard:** `require_roles("Registrar", "Academic Dean")` (System Manager and College Administrator always pass)

Args: `doc` (object or JSON):
`{name?, scale_name, is_default?, pass_mark?, description?, bands?: [{grade, min_score, max_score, grade_points, description?, is_pass?}], classifications?: [{classification, min_cgpa, max_cgpa}]}`.

How the save works:
- It upserts by `name` (or `scale_name`) and creates the scale if it is missing.
- Renaming is not supported: a `scale_name` that differs from the stored one throws.
- Only the listed fields are read. Client `creation`/`modified` and child-row metadata are ignored, so a stale copy
  never raises a timestamp mismatch.
- `bands`/`classifications`, when sent, replace the existing rows. When omitted, the existing rows are kept.

Validation (`ValidationError`):
- Bands must not overlap and must cover 0–100 contiguously. Gaps of up to 1 are tolerated, so both integer bands
  (0–39, 40–49) and .99 bands (0–39.99, 40–49.99) work.
- Grade points must be within 0–5.
- Classification bands must not overlap and `max_cgpa` must be ≤ 5.

Setting `is_default` does not modify other scales. The effective default is resolved in this order:
1. `Mahanaim Settings.default_grading_scale`.
2. A scale with `is_default`.
3. Any scale.
Returns the saved scale in the `get_grading_scales` row shape.
