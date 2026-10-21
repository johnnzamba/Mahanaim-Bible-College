# Architecture

Mahanaim Digital Campus is one Frappe app (`mahanaim`) plus one React single-page app (`frontend/`). It
runs on Frappe v16 (v15 compatible). Frappe LMS and ERPNext are optional: both are detected at runtime and
never required.

```
                    ┌──────────────────────── Browser / installed PWA ────────────────────────┐
                    │  React SPA (frontend/)                                                    │
                    │  public site · /apply · /verify · applicant · student · lecturer ·        │
                    │  sponsor · admin portals  (lazy chunks, TanStack Query, service worker)   │
                    └───────────────┬───────────────────────────────┬──────────────────────────┘
                                    │ GET/POST /api/method/mahanaim.api.*      │ socket.io (realtime)
┌───────────────────────────────────▼───────────────────────────────▼──────────────────────────┐
│ Frappe app: mahanaim                                                                          │
│                                                                                               │
│  www/mbc.py ── boot payload + SEO meta for every SPA route (hooks._SPA_ROUTES)                 │
│                                                                                               │
│  api/        thin, whitelisted, role-checked endpoints that return JSON shaped for screens     │
│     session · auth · setup · admissions · students · academics · learning · assessments ·     │
│     exams · results · finance · mpesa · credentials · communication · website · church ·      │
│     sponsor · lecturer · alumni · library · dashboard · audit                                 │
│                                                                                               │
│  services/   all business rules; called by api/, doctype controllers, scheduler and tests      │
│     admissions · students · grading · results · fees · mpesa · lms_bridge · exams ·           │
│     assessments · communication · messaging · numbering · website · church · library ·        │
│     documents · dashboard · auth · audit                                                      │
│                                                                                               │
│  <module>/doctype/   91 DocTypes in 13 modules; controllers validate and delegate to services  │
│  permissions.py      lecturer row-level scoping; own-record scoping for portal users           │
│  templates/print/    transcript, certificate, receipt, admission letter, statement (PDF)       │
└───────────────┬───────────────────────────────┬───────────────────────────────┬──────────────┘
                │                               │                               │
        MariaDB (records)            Redis (cache, queue, realtime)     External services
                                                                       Safaricom Daraja (M-Pesa STK, C2B)
                                                                       SMS gateway · Email (Frappe)
                                                                       Frappe LMS (optional, same site)
```

## Layers

| Layer | Rule |
| --- | --- |
| `api/*` | Whitelisted. Resolves *who* is calling (`api/utils.py`: `require_roles`, `current_student`, `current_staff`, `current_sponsor`), validates input, calls a service, returns plain dicts. No business rules. |
| `services/*` | Business rules and multi-document workflows (application → student → user, registration → invoice, payment → allocation → ledger, marks → grade → result → transcript). Pure Python, unit-tested. |
| DocType controllers | Field-level validation, naming, status transitions; they delegate to services. |
| `permissions.py` + DocPerms | Desk and `frappe.get_list` safety net. Lecturers see only the offerings they teach; portal users see only their own records. |
| `www/mbc.py` | Server-rendered shell: CSRF token, session, site settings, SEO meta, per-portal manifest. |
| `frontend/` | Presentation only. All data via `useApi`/`useAction`; role checks repeated server-side. |

## Key flows

**Admissions → enrolment.** An applicant signs up with email and phone OTP (`services/auth`), then completes a
multi-step `Programme Application` with documents. The application fee is paid by M-Pesa STK push, after which
the application is submitted. Admissions reviews and shortlists it, and the decision issues an admission
letter PDF. On acceptance, `students.create_student_from_application` creates the `Student`, assigns a number
from `numbering`, and upgrades the user from Applicant to Student.

**Term registration → fees.** The student registers for the term (`Semester Registration` with course choices
validated against prerequisites and programme structure). `fees.create_invoice_for_registration` raises a
`Student Invoice` from the `Fee Structure`, applying scholarships and sponsorships. The invoice posts
`Student Ledger Entry` rows; the balance always equals the ledger sum.

**M-Pesa.** `mpesa.initiate_payment` sends an STK push and records an `M-Pesa Request`. The Daraja callback
(guest endpoint, idempotent on `CheckoutRequestID`/receipt) records an `M-Pesa Transaction`, creates a
`Student Payment`, allocates it oldest-invoice-first and notifies the payer in realtime. A scheduler expires
stale requests. C2B paybill confirmations follow the same path, keyed by account reference = student number.
Giving and event-fee payments use the same STK flow but are handed to `church.on_mpesa_success` and
`website.mark_event_registration_paid` instead of creating a `Student Payment`.

**Learning.** A `Course Offering` (course × term × campus × lecturers) carries modules, resources, class sessions,
attendance, assignments and online exams. If Frappe LMS is installed, `lms_bridge` mirrors offerings to LMS
courses and batches, and pulls progress into `Learning Progress`; otherwise native resources are used.

**Exams.** Question banks (multiple choice, multiple select, true/false, short answer, essay, matching, fill in
the blank) feed timed attempts
with randomisation, autosave, integrity events (tab switches, fullscreen exits) and auto-submit by scheduler.
Objective items are auto-marked; essays go to the lecturer's marking queue.

**Results → credentials.** A `Mark Sheet` per offering combines CATs, assignments and exam marks using
`Assessment Weight`. It moves through Draft → Submitted (lecturer) → Approved (academic dean) → Published
(registrar); the dean or registrar can return it to the lecturer with remarks. Publishing writes `Course Result`
rows (grade points from the `Grading Scale`). Transcripts
compute term and cumulative GPA and the award classification. Certificates and transcripts carry a
verification code and QR that `/verify/<code>` checks publicly, with every check logged.

**Church and partners.** Partner churches and sponsors are linked to the students they support; the sponsor
portal shows progress and statements. Giving (tithes, offerings, pledges, donations via M-Pesa) is recorded
against giving types, along with chapel services, attendance and ministry groups (ported from cfms_plus).

## Cross-cutting

- **Authentication** (`services/auth`, `api/auth`): sign-in with email, student or staff number, or phone,
  resolved server-side, with generic answers so accounts can't be enumerated. One-time codes cover sign-in,
  signup, password reset and phone changes; they are hashed, rate-limited and expire. Staff MFA is enforced by
  the `on_login` hook (see `ROLES.md`).
- **Audit**: DocTypes track changes (Frappe `Version`). `api/audit` presents document changes and sign-in
  activity to auditors.
- **Numbering** (`services/numbering`): `MBC/2026/0001`-style series for students, applications, invoices,
  receipts, certificates and transcripts, configurable in Mahanaim Settings.
- **Communication** (`services/communication.notify`): one call fans out to portal notification, realtime push,
  email and SMS using `Message Template`s; every send is logged in `Message Log`.
- **Status log**: state transitions write `Mahanaim Status Log`, which is rendered as timelines in the portals.
- **Scheduler**: M-Pesa expiry, exam auto-submit and scheduled announcements every 5 minutes; exam status and
  giving reconciliation hourly; overdue invoices, fee reminders, event statuses, library overdue, OTP purge,
  assignment reminders and termly sponsor reports daily.
- **Reports** (`services/dashboard.REPORTS`): one registry drives the admin report catalogue, JSON results,
  charts and CSV export (admissions, enrolment, fees, collections, payment reconciliation, results,
  attendance, lecturer workload, credentials issued, giving, library…), each gated by role.
- **Caching**: public website payloads are cached in Redis (`mbc:web:*`) and cleared on CMS document changes.
- **PWA**: per-portal manifests, an offline shell and install prompts; API responses are never cached.

## Security design

- **Two permission layers.** DocType role permissions decide what a role may touch at all. Row-level hooks in
  `permissions.py` (`permission_query_conditions` and `has_permission`) narrow lecturers to the offerings they
  teach: submissions, attempts, results, questions, announcements, enrolments, progress, and the students in
  their classes. In Frappe v16 a falsy `has_permission` result, `None` included, means *deny*, so every hook
  returns `True` for users it does not restrict. Hooks receive `(doc, ptype, user)`. New children are
  checked against the offering of their parent assignment or exam (`PARENT_OFFERING`).
- **The admin UI mirrors the server, it does not replace it.** `frontend/src/shared/access.js`
  (`ADMIN_ACCESS`, longest path prefix wins) copies the `require_roles()` gates. It filters the rail and backs a
  route-level guard in `AdminPortal.jsx`, so a typed or stale URL shows "Not available for your role"
  instead of a failed request. When an API gate changes, update this map in the same change.
- **APIs check access themselves.** Every whitelisted method checks the role or ownership it needs
  (`api/utils.require_*`) before using `ignore_permissions`. Guest endpoints that write, send or pay
  (sign-in, OTP, sign-up, enquiries, events, giving, digital access, verification) are rate-limited. M-Pesa
  callbacks need the secret `?token=` instead.
- **Message templates are sandboxed.** Templates are written by staff but rendered for everyone, so they
  use `services.communication.template_env()`: an isolated `ImmutableSandboxedEnvironment` that exposes only
  `_`, `money` and a curated set of `frappe.utils` formatters. It has no database, no HTTP and no session.
  Saving a template only parses it; nothing is rendered. Fallback texts are literal strings.
- **Secrets stay out of logs.** One-time codes and reset links are redacted in Message Log (the
  `mahanaim_log_secrets` site flag is for development only).
- **HTML from the server is untrusted.**
  - The SPA renders rich text only through `<Html>` (DOMPurify via `shared/utils/sanitize.js`).
  - It turns HTML into text with `plainText()` (DOMParser, never a live element).
  - It passes every server-supplied link through `safeUrl()` (http, https, mailto, tel and same-origin
    paths only).
  - The shell (`www/mbc.html`) escapes every value it prints, and the CSRF token and boot data are emitted
    with `tojson`.
- **Files.** Downloads stream through permission-checked endpoints. Only PDFs and raster images may be shown
  inline; everything else is sent as an attachment with `nosniff`.

## Frontend

Portals live in `frontend/src/portals/<portal>/`; the admin portal is further split into areas
(`portals/admin/<area>/` with its own routes and nav section). Shared design system, API hooks, session,
theming and PWA code live in `frontend/src/shared/`. See [`frontend/DESIGN.md`](../frontend/DESIGN.md).

**Dates and times.** Frappe stores naive datetimes in the site time zone (System Settings → Time Zone), which the
boot payload exposes as `session.settings.time_zone`. `shared/utils/format.js` `parseServerDate` turns a naive
`YYYY-MM-DD HH:mm:ss` into the correct instant and `date` / `dateTime` / `time` render it in the site zone, so a
student abroad sees the college's times. Plain dates stay calendar days. Countdowns compare instants against
`serverNow()` (device clock corrected by the `server_time` the APIs return); calendar maths ("today", the
timetable now-line) uses `siteWallClock()`. Never parse server datetimes by hand.

**Navigation and access.** `shared/access.js` maps every admin path to the roles whose API calls succeed there.
The sidebar, mobile tab bar and command palette hide what the user cannot open, and `AreaGuard` shows a
"not available for your role" state for a typed URL. The active nav item is the longest matching path, so detail
pages highlight their list.
