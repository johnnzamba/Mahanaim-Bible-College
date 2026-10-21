# Communication & Notifications API (`mahanaim.api.communication`)

Calls go to `/api/method/<dotted path>`. Reads use GET and writes use POST. JSON arguments (`data`, `rows`, `names`,
`filters`, `recipients`, `students`) may be sent as objects/lists or as JSON strings. Responses are wrapped in
`{"message": ...}`. A missing record raises `DoesNotExistError` (404), a failed guard raises `PermissionError` (403)
and validation failures raise `ValidationError` (417) with a translated message. Examples were captured from the
demo dataset (`docs/DEMO.md`); long lists are trimmed.

Covers SOW 6.17 / M15: in-app notifications, portal announcements, message templates, the message log and direct
messages. Delivery goes through the lead's `mahanaim.services.communication` (`notify`, `send_announcement`,
`deliver_sms`). B4 helpers live in `mahanaim.services.messaging`.

**Guards**
- **guest**: `allow_guest=True`. Anyone, including anonymous visitors.
- **guest · rate-limited**: as guest, plus a per-IP `rate_limit` (HTTP 429 when exceeded). Public forms also carry a
  honeypot argument `website` that must stay empty; when filled, the call quietly returns `{"ok": true}` and saves nothing.
- **login**: any signed-in user (`require_login`).
- **staff**: any staff role (`require_staff`).
- **roles: …**: `require_roles(...)`. System Manager, College Administrator and Administrator always pass.
- **Announcers**: Communications Officer, Registrar, Academic Dean, Finance Officer, Chaplain and Lecturer. A user
  whose only staff role is Lecturer may only post to the **Course Offering** audience for offerings they teach
  (matched on `Course Offering Lecturer.user`), and may only edit, send or archive their own announcements.

**Pinned contracts**
- `my_notifications(limit=30, unread_only=0)` returns `{unread, items: [{name, title, message, link, category,
  is_read, creation}]}`, newest first, only for the session user.
- `mark_notifications_read(names=None, all=0)` returns `{unread}`. `names` may be a JSON list. Only the caller's rows
  are touched.

**Announcement visibility** (`my_announcements`): status Sent, `show_in_portal = 1`, not expired, pinned first.
- Student: Everyone, All Students, their programme, their campus, offerings they are enrolled in.
- Lecturer: Everyone, Lecturers, All Staff, offerings they teach. Other staff: Everyone, All Staff.
- Applicant: Everyone, Applicants. Sponsor: Everyone, Sponsors. Alumni: Everyone, Alumni.

## Rules enforced by the controllers

- **Announcement**
  - Status machine: `Draft → Scheduled | Sent | Archived`, `Scheduled → Draft | Sent | Archived`, `Sent → Archived`,
    `Archived → Draft | Sent`.
  - The audience-specific field is required: Programme → `programme`, Campus → `campus`,
    Course Offering → `course_offering`. Unrelated audience fields are cleared.
  - `posted_by` defaults to the session user. Scheduled needs `publish_on`. `expires_on` must be after `publish_on`.
  - The audience of a sent announcement cannot change. Sent announcements cannot be deleted; archive them instead.
  - Scheduled announcements are sent by the lead's 5-minute `dispatch_scheduled_announcements` job.
- **Message Template**
  - At least one channel. Each enabled channel needs its body (in-app may fall back to the email body).
  - SMS text is limited to 459 characters (3 parts).
  - Every body/subject is test-rendered with Jinja (empty context) and syntax errors are rejected.
- **Portal Notification**: `read_on` is set when `is_read` becomes 1 and cleared when it goes back to 0.

## Endpoints

### `my_notifications`
- **Path:** `mahanaim.api.communication.my_notifications`
- **Method:** GET
- **Guard:** login

CONTRACT (SPA shell): {"unread": int, "items": [{name,title,message,link,category,is_read,creation}]}.

Args: `limit` (default `30`), `unread_only` (default `0`), `start` (default `0`).

Example args: `{"limit": 2}`

```json
{
  "message": {
    "unread": 7,
    "items": [
      {
        "name": "c9uhks2rp6",
        "title": "Chapel this Wednesday",
        "message": "Join us at 10:00am in the Main Campus Chapel. Theme: Two Camps — God with us on the jou…",
        "link": "/student",
        "category": "Event",
        "is_read": 0,
        "creation": "2026-10-22 00:01:08.668774"
      },
      {
        "name": "c9ugr7uv1e",
        "title": "Library book overdue",
        "message": "'Knowing God' is overdue. Please return it to the library to avoid further fines.",
        "link": "/student/library",
        "category": "Info",
        "is_read": 0,
        "creation": "2026-10-22 00:01:08.666814"
      }
    ],
    "total": 8
  }
}
```

### `unread_count`
- **Path:** `mahanaim.api.communication.unread_count`
- **Method:** GET
- **Guard:** login

Args: None.

```json
{"message": {"unread": 7}}
```

### `mark_notifications_read`
- **Path:** `mahanaim.api.communication.mark_notifications_read`
- **Method:** POST
- **Guard:** login

CONTRACT (SPA shell): mark the caller's notifications read -> {"unread": int}.

Args: `names` (default `None`), `all` (default `0`).

Example args: `{"all": 1}`

```json
{"message": {"unread": 0, "marked": 7}}
```

### `mark_read`
- **Path:** `mahanaim.api.communication.mark_read`
- **Method:** POST
- **Guard:** login

Alias of mark_notifications_read (SOW naming).

Args: `names` (default `None`), `all` (default `0`).

Example args: `{"all": 1}`

```json
{"message": {"unread": 0, "marked": 7}}
```

### `my_announcements`
- **Path:** `mahanaim.api.communication.my_announcements`
- **Method:** GET
- **Guard:** login

Args: `limit` (default `20`), `start` (default `0`).

Example args: `{"limit": 2}`

```json
{
  "message": {
    "data": [
      {
        "name": "ANN-2026-00003",
        "title": "Welcome to the new term",
        "body": "<p>Welcome back! Lectures, chapel and the library are running on the normal timetable. …",
        "audience": "Everyone",
        "programme": null,
        "campus": null,
        "course_offering": null,
        "is_pinned": 1,
        "sent_on": "2026-10-22 00:00:28.129822",
        "publish_on": null,
        "expires_on": null,
        "attachment": null,
        "posted_by": "comms@mahanaim.demo",
        "posted_by_name": "Kevin Omondi",
        "course_title": null,
        "summary": "Welcome back! Lectures, chapel and the library are running on the normal timetable. Che…"
      },
      {
        "name": "ANN-2026-00005",
        "title": "THE106: CAT 1 is open on the portal",
        "body": "<p>CAT 1 on the Doctrine of God is open in the Exams section. You have 40 minutes once …",
        "audience": "Course Offering",
        "programme": null,
        "campus": null,
        "course_offering": "OFF-2026-00019",
        "is_pinned": 0,
        "sent_on": "2026-10-22 00:00:28.139526",
        "publish_on": null,
        "expires_on": null,
        "attachment": null,
        "posted_by": "dean@mahanaim.demo",
        "posted_by_name": "Miriam Njoroge",
        "course_title": "Systematic Theology I",
        "summary": "CAT 1 on the Doctrine of God is open in the Exams section. You have 40 minutes once you…"
      }
    ],
    "total": 2
  }
}
```

### `list_announcements`
- **Path:** `mahanaim.api.communication.list_announcements`
- **Method:** GET
- **Guard:** roles: Communications Officer, Registrar, Academic Dean, Finance Officer, Chaplain, Lecturer

Args: `status` (default `None`), `audience` (default `None`), `search` (default `None`), `start` (default `0`), `page_length` (default `20`).

Example args: `{"page_length": 2}`

```json
{
  "message": {
    "data": [
      {
        "name": "ANN-2026-00006",
        "title": "Termly sponsor reports are ready",
        "audience": "Sponsors",
        "programme": null,
        "campus": null,
        "course_offering": null,
        "status": "Sent",
        "publish_on": null,
        "expires_on": null,
        "is_pinned": 0,
        "show_in_portal": 1,
        "send_email": 0,
        "send_sms": 0,
        "posted_by": "comms@mahanaim.demo",
        "sent_on": "2026-10-22 00:00:28.143426",
        "recipients_count": 5,
        "modified": "2026-10-22 00:00:28.143444"
      },
      {
        "name": "ANN-2026-00005",
        "title": "THE106: CAT 1 is open on the portal",
        "audience": "Course Offering",
        "programme": null,
        "campus": null,
        "course_offering": "OFF-2026-00019",
        "status": "Sent",
        "publish_on": null,
        "expires_on": null,
        "is_pinned": 0,
        "show_in_portal": 1,
        "send_email": 0,
        "send_sms": 0,
        "posted_by": "dean@mahanaim.demo",
        "sent_on": "2026-10-22 00:00:28.139526",
        "recipients_count": 4,
        "modified": "2026-10-22 00:00:28.139544"
      }
    ],
    "total": 6,
    "counts": {"Sent": 6}
  }
}
```

### `get_announcement`
- **Path:** `mahanaim.api.communication.get_announcement`
- **Method:** GET
- **Guard:** roles: Communications Officer, Registrar, Academic Dean, Finance Officer, Chaplain, Lecturer

Args: `name` (required).

Example args: `{"name": "ANN-2026-00006"}`

```json
{
  "message": {
    "name": "ANN-2026-00006",
    "title": "Termly sponsor reports are ready",
    "audience": "Sponsors",
    "programme": null,
    "campus": null,
    "course_offering": null,
    "publish_on": null,
    "expires_on": null,
    "is_pinned": 0,
    "show_in_portal": 1,
    "send_email": 0,
    "send_sms": 0,
    "body": "<p>Thank you for standing with our students. Progress reports for this term are availab…",
    "attachment": null,
    "status": "Sent",
    "posted_by": "comms@mahanaim.demo",
    "sent_on": "2026-10-22 00:00:28.143426",
    "recipients_count": 5,
    "modified": "2026-10-22 00:00:28.143444",
    "creation": "2026-10-22 00:00:28.141138",
    "posted_by_name": "Kevin Omondi"
  }
}
```

### `save_announcement`
- **Path:** `mahanaim.api.communication.save_announcement`
- **Method:** POST
- **Guard:** roles: Communications Officer, Registrar, Academic Dean, Finance Officer, Chaplain, Lecturer

Args: `data` (required).

Example args: `{"data": {"title": "Chapel moves to the Main Hall", "audience": "All Students", "body": "<p>From next week…</p>", "show_in_portal": 1}}`

```json
{
  "message": {
    "name": "ANN-2026-00007",
    "title": "Chapel moves to the Main Hall",
    "audience": "All Students",
    "programme": null,
    "campus": null,
    "course_offering": null,
    "publish_on": null,
    "expires_on": null,
    "is_pinned": 0,
    "show_in_portal": 1,
    "send_email": 0,
    "send_sms": 0,
    "body": "<p>From next week…</p>",
    "attachment": null,
    "status": "Draft",
    "posted_by": "admin@mahanaim.demo",
    "sent_on": null,
    "recipients_count": null,
    "modified": "2026-10-22 00:09:12.143908",
    "creation": "2026-10-22 00:09:12.143908",
    "posted_by_name": "Brian Otieno"
  }
}
```

### `send_announcement_now`
- **Path:** `mahanaim.api.communication.send_announcement_now`
- **Method:** POST
- **Guard:** roles: Communications Officer, Registrar, Academic Dean, Finance Officer, Chaplain, Lecturer

Queue delivery now (email/SMS per the flags; the portal shows it once the job marks it Sent).

Args: `name` (required).

Example args: `{"name": "ANN-2026-00004"}`

```json
{"message": {"name": "ANN-2026-00004", "title": "Chapel moves to the Main Hall", "audience": "All Students", "...": "…",
  "status": "Draft", "queued": true}}
```

### `schedule_announcement`
- **Path:** `mahanaim.api.communication.schedule_announcement`
- **Method:** POST
- **Guard:** roles: Communications Officer, Registrar, Academic Dean, Finance Officer, Chaplain, Lecturer

Args: `name` (required), `publish_on` (required).

Example args: `{"name": "ANN-2026-00004", "publish_on": "2026-10-25 08:00:00"}`

```json
{"message": {"name": "ANN-2026-00004", "title": "Chapel moves to the Main Hall", "...": "…", "status": "Scheduled",
  "publish_on": "2026-10-25 08:00:00"}}
```

### `archive_announcement`
- **Path:** `mahanaim.api.communication.archive_announcement`
- **Method:** POST
- **Guard:** roles: Communications Officer, Registrar, Academic Dean, Finance Officer, Chaplain, Lecturer

Args: `name` (required), `undo` (default `0`).

Example args: `{"name": "ANN-2026-00006"}`

```json
{
  "message": {
    "name": "ANN-2026-00006",
    "title": "Termly sponsor reports are ready",
    "audience": "Sponsors",
    "programme": null,
    "campus": null,
    "course_offering": null,
    "publish_on": null,
    "expires_on": null,
    "is_pinned": 0,
    "show_in_portal": 1,
    "send_email": 0,
    "send_sms": 0,
    "body": "<p>Thank you for standing with our students. Progress reports for this term are availab…",
    "attachment": null,
    "status": "Archived",
    "posted_by": "comms@mahanaim.demo",
    "sent_on": "2026-10-22 00:00:28.143426",
    "recipients_count": 5,
    "modified": "2026-10-22 00:09:12.152401",
    "creation": "2026-10-22 00:00:28.141138",
    "posted_by_name": "Kevin Omondi"
  }
}
```

### `delete_announcement`
- **Path:** `mahanaim.api.communication.delete_announcement`
- **Method:** POST
- **Guard:** roles: Communications Officer, Registrar, Academic Dean, Finance Officer, Chaplain, Lecturer

Args: `name` (required).

Example args: `{"name": "ANN-2026-00004"}`

```json
{"message": {"ok": true, "name": "ANN-2026-00004"}}
```

### `preview_audience`
- **Path:** `mahanaim.api.communication.preview_audience`
- **Method:** GET
- **Guard:** roles: Communications Officer, Registrar, Academic Dean, Finance Officer, Chaplain, Lecturer

Args: `audience` (required), `programme` (default `None`), `campus` (default `None`), `course_offering` (default `None`).

Example args: `{"audience": "All Students"}`

```json
{
  "message": {
    "count": 40,
    "reachable": {"email": 40, "sms": 40, "in_app": 40},
    "sample": [
      {"name": "David Kiptoo", "email": "student.david@example.com", "phone": "254712345678"},
      {"name": "Catherine Wambui", "email": "student.catherine@example.com", "phone": "254712345678"}
    ]
  }
}
```

### `list_templates`
- **Path:** `mahanaim.api.communication.list_templates`
- **Method:** GET
- **Guard:** roles: Communications Officer

Args: `event` (default `None`), `search` (default `None`).

```json
{
  "message": {
    "data": [
      {
        "name": "Welcome — Account Created",
        "template_name": "Welcome — Account Created",
        "event": "Account Created",
        "is_active": 1,
        "send_email": 1,
        "send_sms": 0,
        "send_in_app": 1,
        "subject": "Welcome to the {{ college }} Digital Campus",
        "modified": "2026-10-21 22:36:59.657947"
      },
      {
        "name": "Admission Offer",
        "template_name": "Admission Offer",
        "event": "Application Approved",
        "is_active": 1,
        "send_email": 1,
        "send_sms": 1,
        "send_in_app": 1,
        "subject": "Congratulations — admission offer from {{ college }}",
        "modified": "2026-10-21 22:36:59.664022"
      }
    ],
    "total": 24,
    "events": ["Account Created", "OTP Code"]
  }
}
```

### `get_template`
- **Path:** `mahanaim.api.communication.get_template`
- **Method:** GET
- **Guard:** roles: Communications Officer

Args: `name` (required).

Example args: `{"name": "Sponsor Progress Report"}`

```json
{
  "message": {
    "name": "Sponsor Progress Report",
    "template_name": "Sponsor Progress Report",
    "event": "Sponsor Report",
    "is_active": 1,
    "send_email": 1,
    "send_sms": 0,
    "send_in_app": 1,
    "subject": "Progress update on the students you sponsor",
    "email_body": "<p>Dear {{ recipient.name }},</p><p>Thank you for partnering with {{ college }}. A prog…",
    "sms_body": "",
    "in_app_body": "Dear {{ recipient.name }},Thank you for partnering with {{ college }}. A progress updat…",
    "description": null,
    "modified": "2026-10-21 22:36:59.680174"
  }
}
```

### `save_template`
- **Path:** `mahanaim.api.communication.save_template`
- **Method:** POST
- **Guard:** roles: Communications Officer

Args: `data` (required).

Example args: `{"data": {"name": "Sponsor Progress Report", "is_active": 1}}`

```json
{
  "message": {
    "name": "Sponsor Progress Report",
    "template_name": "Sponsor Progress Report",
    "event": "Sponsor Report",
    "is_active": 1,
    "send_email": 1,
    "send_sms": 0,
    "send_in_app": 1,
    "subject": "Progress update on the students you sponsor",
    "email_body": "<p>Dear {{ recipient.name }},</p><p>Thank you for partnering with {{ college }}. A prog…",
    "sms_body": "",
    "in_app_body": "Dear {{ recipient.name }},Thank you for partnering with {{ college }}. A progress updat…",
    "description": null,
    "modified": "2026-10-22 00:09:12.166684"
  }
}
```

### `preview_template`
- **Path:** `mahanaim.api.communication.preview_template`
- **Method:** GET
- **Guard:** roles: Communications Officer

Render a template against a real document (if given) or a sample recipient.

Args: `name` (required), `doctype` (default `None`), `docname` (default `None`).

Example args: `{"name": "Sponsor Progress Report"}`

```json
{
  "message": {
    "rendered": {
      "subject": "Progress update on the students you sponsor",
      "email_body": "<p>Dear Brian Otieno,</p><p>Thank you for partnering with Mahanaim Bible College. A pro…",
      "sms_body": "",
      "in_app_body": "Dear Brian Otieno,Thank you for partnering with Mahanaim Bible College. A progress upda…",
      "sms_length": 0,
      "sms_parts": 0
    },
    "errors": {},
    "document": null
  }
}
```

### `message_log`
- **Path:** `mahanaim.api.communication.message_log`
- **Method:** GET
- **Guard:** roles: Communications Officer, Auditor

Args: `filters` (default `None`), `start` (default `0`), `page_length` (default `50`).

Example args: `{"page_length": 2}`

```json
{
  "message": {
    "data": [
      {
        "name": "es5b1g086e",
        "channel": "In-App",
        "recipient": "staff.naomi@example.com",
        "user": "staff.naomi@example.com",
        "subject": "Welcome to the Mahanaim Bible College Digital Campus",
        "status": "Sent",
        "event": null,
        "template": null,
        "sent_on": "2026-10-22 00:05:31.725526",
        "retries": 0,
        "reference_doctype": "Staff Member",
        "reference_name": "STF-00017",
        "provider_response": null,
        "creation": "2026-10-22 00:05:31.725578",
        "preview": "Dear Naomi Chepkoech,Your Digital Campus account is ready. Sign in at http://mahanai…"
      },
      {
        "name": "es5qrpoh7n",
        "channel": "Email",
        "recipient": "staff.naomi@example.com",
        "user": "staff.naomi@example.com",
        "subject": "Welcome to the Mahanaim Bible College Digital Campus",
        "status": "Queued",
        "event": "Account Created",
        "template": "Welcome — Account Created",
        "sent_on": null,
        "retries": 0,
        "reference_doctype": "Staff Member",
        "reference_name": "STF-00017",
        "provider_response": null,
        "creation": "2026-10-22 00:05:31.721951",
        "preview": "Dear Naomi Chepkoech,Your Digital Campus account is ready. Sign in at http://mahanai…"
      }
    ],
    "total": 375,
    "counts": {
      "by_channel": {"In-App": 155, "SMS": 88, "Email": 132},
      "by_status": {"Sent": 155, "Queued": 220},
      "matrix": {"In-App": {"Sent": 155}, "SMS": {"Queued": 88}, "Email": {"Queued": 132}}
    }
  }
}
```

### `retry_failed`
- **Path:** `mahanaim.api.communication.retry_failed`
- **Method:** POST
- **Guard:** roles: Communications Officer

Re-queue failed SMS (emails are retried by Frappe's Email Queue).

Args: `names` (default `None`).

Example args: `{"names": ["hp3k2l9a0b"]}`

```json
{"message": {"queued": 1, "skipped": 0}}
```

### `send_test_sms`
- **Path:** `mahanaim.api.communication.send_test_sms`
- **Method:** POST
- **Guard:** roles: Communications Officer

Args: `phone` (required), `message` (default `None`).

Example args: `{"phone": "0712345678", "message": "Test from Mahanaim"}`

```json
{"message": {"ok": true, "log": {"name": "h117ubl27n", "status": "Sent", "provider_response": "test-mode"}}}
```

### `send_direct_message`
- **Path:** `mahanaim.api.communication.send_direct_message`
- **Method:** POST
- **Guard:** roles: Communications Officer, Registrar, Admissions Officer, Finance Officer, Academic Dean

recipients: [{user|student|staff_member|sponsor|email|phone}], channels ⊆ Email/SMS/In-App.

Args: `recipients` (required), `subject` (required), `message` (required), `channels` (default `None`).

Example args: `{"recipients": [{"student": "STU-2026-00017"}, {"phone": "0712345678"}], "subject": "Chapel duty", "message": "You are on chapel duty this Wednesday.", "channels": ["In-App", "SMS"]}`

```json
{
  "message": {"queued": false, "recipients": 2, "sent": {"Email": 0, "SMS": 2, "In-App": 1, "failed": 0}, "skipped": []}
}
```
