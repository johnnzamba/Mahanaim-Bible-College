# SOW module map

Where each module of the Statement of Work (section 7) lives in the code. Backend paths are relative to
`mahanaim/`, frontend paths to `frontend/src/portals/`, and API modules are under `mahanaim.api.*`.
Each module's endpoint reference is in `docs/api/<module>.md`.

## MVP modules (7.1)

| Code | Module | Backend | Frontend |
| --- | --- | --- | --- |
| M01 | Frappe Foundation and DevOps | Frappe v16 app `mahanaim`, `install.py` (roles, settings, fixtures), `hooks.py` | Vite SPA served by `www/mbc.py`; CI in `.github/workflows/ci.yml`; see `docs/DEPLOYMENT.md` |
| M02 | Core Master Data and Role Access | `mahanaim_setup` (Campus, Department, Academic Year/Term, Intake, Study Mode, Staff Member, Settings, Status Log); `permissions.py`; `api.setup` | `admin/settings` (master data, settings), `admin/staff`, `admin/academics/calendar`; role matrix in `docs/ROLES.md` |
| M03 | Authentication and OTP | `services.auth` (identifier resolution, OTP with cooldowns and attempt caps, staff MFA), OTP Verification; Frappe `LoginManager` lockout for failed passwords; `on_login` MFA hook; `api.auth` | `auth/AuthRoutes.jsx` (password, one-time code, MFA, reset), shared `AccountSettings` |
| M04 | Public Website and Content Management | `website_cms` (News Post, Campus Event, Event Registration, FAQ, Testimonial, Contact Enquiry, Campus Website Settings); `services.website`; `api.website` | `public/*` (home, about, academics, programmes, admissions, fees, library, news, events, contact, give, verify); `admin/website` |
| M05 | Online Admissions | `admissions` (Programme Application, documents, academic records); `services.admissions`; admission letter print | `applicant/*`, `/apply`; `admin/admissions` (pipeline, review, interviews, decisions, conversion) |
| M06 | Student Registration and Lifecycle | `student_records` (Student, Semester Registration, Course Enrolment, Student Request, Clearance Item); `services.students` | `student/*` (registration, requests); `admin/students` (360 view, registrations, requests, clearance) |
| M07 | Programme and Curriculum Management | `academics` (Programme + curriculum, Course + prerequisites, Course Offering + lecturers, assessment weights); `api.academics` | `admin/academics` (programmes, courses, offerings) |
| M08 | Frappe LMS Bridge and Digital Learning | `learning` (Course Module, Learning Resource, Learning Progress, LMS Bridge Settings); `services.lms_bridge`; `api.learning` | `student/courses/<offering>`, `lecturer/courses/<offering>`; bridge settings in `admin/settings` |
| M09 | Assignments and CAT Management | `assessments` (Assignment, Assignment Submission); `services.assessments`; `api.assessments` | `student/assignments`, lecturer gradebook; oversight in `admin/academics/offerings/<name>` |
| M10 | Examination Management | `assessments` (Question + options/match pairs, Exam, Exam Attempt, answers, events); `services.exams`; `api.exams` | `student/exams/<exam>` (exam runner), lecturer exams and marking; `admin/academics/exams`, question bank |
| M11 | Grading and Results Management | `results` (Mark Sheet, Course Result); Grading Scale and classification bands; `services.grading`, `services.results`; `api.results` | `student/results`; lecturer mark sheets; `admin/academics/mark-sheets`, `results`, `grading` |
| M12 | Fees Management | `finance` (Fee Component/Structure/Installment, Student Invoice, Ledger, Adjustment, Scholarship, Refund Request); `services.fees` | `student/fees`; `admin/finance` (invoices, structures, adjustments, refunds, defaulters, aging) |
| M13 | Payments and M-Pesa Integration | M-Pesa Settings/Request/Transaction, Student Payment + allocations; `services.mpesa`; `api.mpesa`; `docs/MPESA.md` | shared `MpesaPay` dialog; `admin/finance/payments`, `admin/finance/mpesa` (reconciliation) |
| M14 | Transcripts and Certificates | `credentials` (Transcript, Certificate, Verification Log); `services.documents`; QR print templates | `/verify/<code>`; `student/documents`; `admin/credentials` |
| M15 | Communication and Notifications | `communication` (Announcement, Message Template, Message Log, Portal Notification); `services.communication`, `services.messaging` | Notification bell (realtime); `admin/communication` (announcements, templates, message log) |
| M16 | Administration Dashboard and Reporting | `services.dashboard`; `api.dashboard` (overview, report catalogue, exports, global search, campus comparison) | `admin` dashboard, `admin/reports`, `admin/audit`; Frappe Desk remains available to super-roles |

## Phase 2 modules built early (7.2)

These sit on the same foundation, so they were delivered with the MVP rather than retrofitted later.

| Code | Module | Backend | Frontend |
| --- | --- | --- | --- |
| M17 | Digital Library | `library` (Library Item, Library Loan); `services.library`; `api.library` | `public` library page; `student/library`; `admin/library` (catalogue, loans, requests) |
| M18 | Church Partner/Sponsor Portal | `church_partners` (Partner Church, Sponsor, Sponsorship, Giving Type/Record, Chapel Service, Ministry Group); `services.church`; `api.church`, `api.sponsor` | `sponsor/*`; `/give`; `admin/church` |
| M19 | Alumni System | Student status Alumni, `api.alumni` (directory, graduation) | `admin/alumni`; alumni view in the student portal |
| M20 | Advanced Multi-Campus Operational Controls | Campus on every operational record, User Permissions on Campus via Staff Member, `campus_comparison` | Campus filters across admin lists; campus comparison on the dashboard |
| M21 | Timetable and Attendance | `learning` (Class Session, Class Attendance); `api.academics` sessions and attendance | `student` timetable and attendance; lecturer attendance; offering timetable in `admin/academics` |
| M22 | Student Support and Document Request Portal | Student Request (deferment, withdrawal, course drop, clearance), transcript requests | `student/requests`, `student/documents`; `admin/students/requests` |
| M23 | Advanced PWA/Offline Capabilities | Service worker served by `api.session.service_worker` | Installable PWA (`shared/pwa.jsx`), offline shell and cached assets |

## Not included (M24 to M28)

Native Android (M24) and iOS (M25) apps, HR/Payroll (M26), full accounting/ERP (M27) and SCORM/xAPI (M28) are out
of scope. The SPA is mobile-first and installable as a PWA. Finance keeps its own student ledger and can post to
ERPNext later if the college adopts it.

## Known limitations

Deliberate gaps or items that need production credentials before they can be proven end to end:

- **M-Pesa C2B gifts** paid straight to the paybill without a matching giving request stay *Unmatched*
  until Finance allocates them by hand in `admin/finance/mpesa`.
- **ERPNext posting** is optional and has not been exercised against a live ERPNext site.
- **Status changes made with `db_set`** (workflow transitions, bulk publish) are recorded in
  `Mahanaim Status Log` and Activity Log, but they do not create Frappe `Version` rows.
- **Activity Log** is purged by Frappe after 90 days by default. Extend *Log Settings* if audits need a longer trail.
- **Mark sheets** can be published while some marks are still blank. The publish dialog warns, and those students
  get grade I (Incomplete). Publishing is final in the portal workflow; a Registrar or Academic Dean corrects a
  published grade on the Course Result in Desk.
- **Demo M-Pesa payments** created by the demo seed have no Daraja transaction, so reconciliation shows them as
  *No Transaction*.
- **Applications** have no "returned for changes" state. Officers ask for anything missing by direct message,
  and applicants can keep uploading documents until a decision is made (Draft through Interview).
- **Queued jobs** (bulk announcements, termly sponsor reports, large exports) need `bench worker` running.
  A development bench without workers will queue them but never send.
