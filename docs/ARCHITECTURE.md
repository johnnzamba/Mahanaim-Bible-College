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
│     session · auth · admissions · students · academics · learning · assessments · exams ·     │
│     results · finance · mpesa · credentials · communication · website · church · sponsor ·    │
│     library · dashboard · reports                                                             │
│                                                                                               │
│  services/   all business rules; called by api/, doctype controllers, scheduler and tests      │
│     admissions · students · grading · results · fees · mpesa · lms_bridge · exams ·           │
│     communication · numbering · website · church · library · documents · auth                │
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

**Learning.** A `Course Offering` (course × term × campus × lecturers) carries modules, resources, class sessions,
attendance, assignments and online exams. If Frappe LMS is installed, `lms_bridge` mirrors offerings to LMS
courses and batches, and pulls progress into `Learning Progress`; otherwise native resources are used.

**Exams.** Question banks (MCQ, multi-select, true/false, matching, short and long answer) feed timed attempts
with randomisation, autosave, integrity events (tab switches, fullscreen exits) and auto-submit by scheduler.
Objective items are auto-marked; essays go to the lecturer's marking queue.

**Results → credentials.** A `Mark Sheet` per offering combines CATs, assignments and exam marks using
`Assessment Weight`. It moves through Draft → Submitted (lecturer) → Moderated (dean) → Approved/Published
(registrar), and publishing writes `Course Result` rows (grade points from the `Grading Scale`). Transcripts
compute term and cumulative GPA and the award classification. Certificates and transcripts carry a
verification code and QR that `/verify/<code>` checks publicly, with every check logged.

**Church and partners.** Partner churches and sponsors are linked to the students they support; the sponsor
portal shows progress and statements. Giving (tithes, offerings, pledges, donations via M-Pesa) is recorded
against giving types, along with chapel services, attendance and ministry groups (ported from cfms_plus).

## Cross-cutting

- **Numbering** (`services/numbering`): `MBC/2026/0001`-style series for students, applications, invoices,
  receipts, certificates and transcripts, configurable in Mahanaim Settings.
- **Communication** (`services/communication.notify`): one call fans out to portal notification, realtime push,
  email and SMS using `Message Template`s; every send is logged in `Message Log`.
- **Status log**: state transitions write `Mahanaim Status Log`, which is rendered as timelines in the portals.
- **Scheduler**: M-Pesa expiry, exam auto-submit and scheduled announcements every 5 minutes; exam status hourly;
  overdue invoices, fee reminders, event statuses, library overdue, OTP purge and assignment reminders daily.
- **Caching**: public website payloads are cached in Redis (`mbc:web:*`) and cleared on CMS document changes.
- **PWA**: per-portal manifests, an offline shell and install prompts; API responses are never cached.

## Frontend

See [`frontend/DESIGN.md`](../frontend/DESIGN.md).
