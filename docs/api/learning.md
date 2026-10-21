# Learning API (`mahanaim.api.learning`)

The Frappe LMS bridge and native course content (modules, resources and progress): SOW M08.
Calls go to `/api/method/<dotted path>`. Reads use GET and writes use POST.

**Guards**
- **admin**: Academic Dean, Registrar, College Administrator or System Manager.
- **lecturer**: the Lecturer role or any staff role.
- **teaching**: a lecturer of the offering (`require_lecturer_of`) or an admin. For an existing module or resource,
  the offering is taken from the record.
- **enrolled**: the session student has a Course Enrolment in the offering with status Enrolled, Completed or Failed.
- **student**: a signed-in user linked to a Student record.

## LMS bridge behaviour

Frappe LMS is a **soft dependency**. Every bridge call checks `has_app("lms")` and `LMS Bridge Settings.enabled`.
- **LMS not installed:** the contract functions return `None`, the offering's `lms_sync_status` becomes
  `Not Installed`, and `lms_url` is `null`. The portal then uses the native content below. It always works.
- **LMS installed and enabled:**
  - `sync_offering` creates or updates an **LMS Course**:
    - title `"<course_code> — <course_title> (<term label>)"`
    - short introduction and description from the offering or course
    - `instructors` = the offering lecturers' users
    - `published` = `publish_on_create`
  - It stores `lms_course`, sets `lms_sync_status = Synced` and records `lms_last_synced`. Failures set `Error` and
    `lms_sync_error`. It is idempotent.
  - Offerings are synced automatically on save when `auto_create_courses` is on.
  - `enrol` creates an **LMS Enrollment** (`member_type = Student`) for an Enrolled student when
    `auto_enrol_students` is on. It requires `fee_clearance(student, "lms")` unless Settings
    `lms_fee_clearance_percent` is 0.
  - `unenrol` deletes it when `remove_enrolment_on_drop` is on.
- **`lms_url`**: `/lms/courses/<lms_course>`, only when synced and LMS is installed.

`lms_sync_status` is one of `Not Synced`, `Synced`, `Error` or `Not Installed`.

## Bridge administration

### `bridge_status`
- **Path:** `mahanaim.api.learning.bridge_status`
- **Method:** GET
- **Guard:** admin (whole bridge) or lecturer (read-only, own offerings)

Args: `offering` (optional).
- **Admins** get `scope: "all"`, and `counts` groups every non-cancelled offering by `lms_sync_status`. With
  `offering`, its sync row is added in `offerings`.
- **Lecturers** get `scope: "lecturer"`. The counts cover only the offerings they teach (or just `offering`, which
  they must teach, or `PermissionError`). An `offerings` list of per-offering sync rows is added.

`sync_offering_now`, `full_sync`, `retry_failed` and `save_bridge_settings` stay admin-only.

```json
{"message": {"installed": false, "enabled": false, "active": false,
  "settings": {"auto_create_courses": 1, "auto_enrol_students": 1, "publish_on_create": 0, "remove_enrolment_on_drop": 1},
  "lms_fee_clearance_percent": 0.0, "last_full_sync": null, "counts": {"Not Synced": 15},
  "synced": 0, "failed": 0, "not_synced": 15, "not_installed": 0, "enrolments_synced": 0, "scope": "all"}}
```

Lecturer view (also returned to admins who pass `offering`):

```json
{"message": {"installed": false, "enabled": false, "active": false, "…": "…", "counts": {"Not Installed": 2},
  "synced": 0, "failed": 0, "not_synced": 0, "not_installed": 2, "enrolments_synced": 0, "scope": "lecturer",
  "offerings": [{"name": "OFF-2026-00014", "course": "OTS101", "course_title": "Old Testament Survey",
                 "academic_term": "2026-2027 Term 1", "lms_course": null, "lms_sync_status": "Not Installed",
                 "lms_last_synced": null, "lms_sync_error": null, "lms_url": null}]}}
```

### `save_bridge_settings`
- **Path:** `mahanaim.api.learning.save_bridge_settings`
- **Method:** POST
- **Guard:** admin

Args: `data`, an object with any of `enabled`, `auto_create_courses`, `auto_enrol_students`, `publish_on_create` and
`remove_enrolment_on_drop` (0 or 1). Returns `bridge_status`.

### `sync_offering_now`
- **Path:** `mahanaim.api.learning.sync_offering_now`
- **Method:** POST
- **Guard:** admin

Args: `offering`. Runs the sync immediately.

```json
{"message": {"ok": false, "offering": "OFF-2026-00014", "lms_course": null, "lms_sync_status": "Not Installed",
  "lms_last_synced": null, "lms_sync_error": "Frappe LMS is not installed; native course content is used.", "lms_url": null}}
```

When synced: `{"ok": true, "lms_course": "ots101-old-testament-survey", "lms_sync_status": "Synced", "lms_url": "/lms/courses/ots101-…", …}`.

### `full_sync`
- **Path:** `mahanaim.api.learning.full_sync`
- **Method:** POST
- **Guard:** admin

Args: `term` (optional; default: all terms). Queues a background job that syncs every non-cancelled offering and
enrols their students. The job is deduplicated per term.

```json
{"message": {"ok": true, "queued": true, "job_id": "mbc-lms-full-sync-2026-2027 Term 1", "installed": false}}
```

### `retry_failed`
- **Path:** `mahanaim.api.learning.retry_failed`
- **Method:** POST
- **Guard:** admin

Re-syncs offerings whose `lms_sync_status` is `Error`.

```json
{"message": {"retried": 2, "synced": 2, "failed": 0}}
```

## Course content (lecturer)

**Modules** (`Course Module`) have `module_title`, `week`, `sequence`, `is_published` and `description`.

**Resources** (`Learning Resource`) have `title`, `course_module` (optional), `resource_type`, `sequence`,
`is_published`, `downloadable`, `duration_minutes`, `file`, `url`, `embed_url` and `body`. The rules per
`resource_type`:

| Type | Content |
|---|---|
| `PDF`, `Document`, `Image` | `file`: a `file_url` from `/api/method/upload_file`, with an allowed extension |
| `Video`, `Audio` | `file` (an upload), or `url` (an http(s) link) |
| `Link` | `url` (http or https) |
| `Embed` | `embed_url` (https only), e.g. a YouTube or Vimeo embed |
| `Text` | `body` (HTML, sanitised) |

For file-based resources, list responses add `download_url`
(`/api/method/mahanaim.api.learning.download_resource?resource=<name>`). It is set when the resource is downloadable
or viewable (Video/Audio/Image/PDF), and is `null` otherwise.

### `list_modules`
- **Path:** `mahanaim.api.learning.list_modules`
- **Method:** GET
- **Guard:** teaching

Args: `offering`. Returns all modules (published or not) with their resources. `resources` at the top level holds
resources that are not in any module.

```json
{"message": {"offering": "OFF-2026-00014",
  "modules": [{"name": "955jkocj4v", "module_title": "Week 1", "week": 0, "sequence": 1, "is_published": 1, "description": null,
               "resources": [{"name": "955pv9f8a1", "title": "Reading", "course_offering": "OFF-2026-00014", "course_module": "955jkocj4v",
                              "resource_type": "Link", "sequence": 1, "is_published": 1, "downloadable": 1, "duration_minutes": 0,
                              "file": null, "url": "https://example.com/genesis", "embed_url": null, "lms_lesson": null, "body": null}]}],
  "resources": []}}
```

### `save_module`
- **Path:** `mahanaim.api.learning.save_module`
- **Method:** POST
- **Guard:** teaching

Args: `data`, an object with `{name?, course_offering, module_title, week?, sequence?, is_published?, description?}`.
Include `name` to update. A new module is appended at the end.

```json
{"message": {"name": "955jkocj4v", "course_offering": "OFF-2026-00014", "module_title": "Week 1", "week": 0, "sequence": 1,
  "is_published": 1, "description": null, "creation": "…", "modified": "…", "idx": 0}}
```

### `delete_module`
- **Path:** `mahanaim.api.learning.delete_module`
- **Method:** POST
- **Guard:** teaching

Args: `name`. Deletes the module. Its resources are kept and moved out of the module. Returns `{"ok": true, "name": …}`.

### `reorder_modules` / `reorder_resources`
- **Paths:** `mahanaim.api.learning.reorder_modules` and `mahanaim.api.learning.reorder_resources`
- **Method:** POST
- **Guard:** teaching

Args:
- `reorder_modules`: `offering`, `order` (module names in display order).
- `reorder_resources`: `offering`, `order` (resource names in display order), `module` (optional).

The sequence becomes 1..n. Both return `list_modules(offering)`.

### `save_resource`
- **Path:** `mahanaim.api.learning.save_resource`
- **Method:** POST
- **Guard:** teaching

Args: `data`, an object with `{name?, course_offering?, course_module?, title, resource_type, file?, url?, embed_url?,
body?, is_published?, downloadable?, duration_minutes?, sequence?}`. The offering is taken from `course_module`
when `course_offering` is omitted. Upload files first with the standard `/api/method/upload_file` and pass the
returned `file_url`. The file must be the caller's own upload; private uploads are recommended.

```json
{"message": {"name": "955pv9f8a1", "title": "Reading", "course_offering": "OFF-2026-00014", "course_module": "955jkocj4v",
  "resource_type": "Link", "sequence": 1, "is_published": 1, "downloadable": 1, "duration_minutes": 0, "file": null,
  "url": "https://example.com/genesis", "embed_url": null, "body": null, "lms_lesson": null, "creation": "…", "modified": "…", "idx": 0}}
```

### `delete_resource`
- **Path:** `mahanaim.api.learning.delete_resource`
- **Method:** POST
- **Guard:** teaching

Args: `name`. Also removes the students' progress rows for the resource. Returns `{"ok": true, "name": …}`.

### `publish_toggle`
- **Path:** `mahanaim.api.learning.publish_toggle`
- **Method:** POST
- **Guard:** teaching

Args:
- `name`.
- `kind`: `resource` (default) or `module`.
- `is_published`: 0 or 1. Omit it to toggle.

```json
{"message": {"ok": true, "name": "955pv9f8a1", "kind": "resource", "is_published": 1}}
```

## Student

Students only see **published** resources inside **published** modules (or with no module).

### `my_courses`
- **Path:** `mahanaim.api.learning.my_courses`
- **Method:** GET
- **Guard:** student

Args: `term` (optional). Lists offerings with an Enrolled, Completed or Failed enrolment.

```json
{"message": {"data": [{"name": "OFF-2026-00014", "course": "OTS101", "course_title": "Old Testament Survey", "credits": 3.0,
  "academic_term": "2026-2027 Term 1", "campus": "Main Campus", "status": "Open", "enrolment_status": "Enrolled",
  "lecturers": [{"staff_name": "Rev. Peter Otieno", "role": "Lead"}], "lms_url": null, "resource_count": 1, "progress": 0.0}],
  "total": 1}}
```

### `my_course`
- **Path:** `mahanaim.api.learning.my_course`
- **Method:** GET
- **Guard:** enrolled

Args: `offering`. Returns the course page:
- the offering and its lecturers
- `lms_url`
- published modules and resources, each with my `progress`
- overall `progress`
- Published assignments (with my `submission_status` and `is_overdue`)
- Scheduled and Open exams
- portal announcements for the offering (pinned first)

```json
{"message": {
  "offering": {"name": "OFF-2026-00014", "course": "OTS101", "course_code": "OTS101", "course_title": "Old Testament Survey",
               "credits": 3.0, "academic_term": "2026-2027 Term 1", "campus": "Main Campus", "status": "Open",
               "start_date": "2026-10-21", "end_date": "2027-02-08", "description": null, "learning_outcomes": null, "pass_mark": 40.0},
  "lecturers": [{"staff_member": "STF-00003", "staff_name": "Rev. Peter Otieno", "role": "Lead", "email": "p.otieno@mbc.ac.ke",
                 "photo": null, "designation": null}],
  "lms_url": null,
  "modules": [{"name": "955jkocj4v", "module_title": "Week 1", "week": 0, "sequence": 1, "is_published": 1, "description": null,
               "resources": [{"name": "955pv9f8a1", "title": "Reading", "resource_type": "Link", "url": "https://example.com/genesis",
                              "…": "…", "progress": {"status": "Completed", "progress": 100.0, "last_accessed": "2026-10-21 23:55:46"}}]}],
  "resources": [],
  "progress": {"completed": 1, "total": 1, "percentage": 100.0},
  "assignments": [{"name": "ASG-2026-00007", "title": "Exegesis paper", "assessment_component": "Assignment", "due_date": "…",
                   "late_cutoff": null, "allow_late": 1, "max_score": 20.0, "status": "Published",
                   "submission_status": "Submitted", "is_overdue": false}],
  "exams": [{"name": "EXM-2026-00007", "title": "CAT 1", "exam_type": "CAT", "start_datetime": "…", "end_datetime": "…",
             "duration_minutes": 45, "delivery_mode": "Online", "venue": null, "status": "Scheduled"}],
  "announcements": [{"name": "ANN-0001", "title": "Reading week", "body": "<p>…</p>", "attachment": null, "sent_on": "…", "is_pinned": 1}]}}
```

### `mark_resource_complete`
- **Path:** `mahanaim.api.learning.mark_resource_complete`
- **Method:** POST
- **Guard:** enrolled (the resource must be visible to the student)

Args: `resource`, `progress` (0–100; default 100). Upserts **Learning Progress**: `Completed` at 100, otherwise
`In Progress`. A Completed resource is never downgraded. A hidden or unknown resource raises `PermissionError` with
"Resource not found.".

```json
{"message": {"ok": true, "resource": "955pv9f8a1", "status": "Completed", "progress": 100.0}}
```

### `download_resource`
- **Path:** `mahanaim.api.learning.download_resource`
- **Method:** GET
- **Guard:** enrolled (visible resource) or teaching

Args: `resource`, `inline` (optional, `1` = preview in the browser; default is a download).
- The response is `Content-Disposition: inline` only when `inline=1` **and** the file is `application/pdf` or a
  raster image (png, jpeg, gif, webp). Everything else, including SVG, HTML and XML, is always an attachment.
- Every response carries `X-Content-Type-Options: nosniff`.
- Private files are streamed.
- Public files are streamed as attachments. Public inline previews (and audio/video) redirect to the static URL so
  range requests work.

Use `?inline=1` for `<iframe>`/`<img>` previews and the plain URL for download links. A resource that is neither
downloadable nor viewable raises `PermissionError`.
