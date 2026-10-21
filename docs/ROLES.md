# Roles and access

Roles are created by `mahanaim/install.py` and enforced in three places:

1. **API**: every `mahanaim.api.*` endpoint calls `require_roles(...)` or resolves the caller's own record
   (`current_student`, `current_staff`, `current_sponsor`) before touching data.
2. **DocType permissions**: DocPerms plus `permissions.py` row scoping (lecturers see only the offerings they
   teach; portal users see only their own notifications and records).
3. **UI**: `frontend/src/shared/access.js` hides admin screens a role cannot use. This is a convenience
   only; the server checks again.

`System Manager` and `College Administrator` are super-roles: they see every portal and every admin screen.

## Roles

| Role | Portal | Purpose |
| --- | --- | --- |
| College Administrator | admin | Full administration of the college, settings and users |
| Registrar | admin | Student records, registration, academics, results publishing, transcripts and certificates |
| Admissions Officer | admin | Applications, reviews, interviews, offers, applicant communication |
| Academic Dean | admin | Programmes and curriculum, offerings, moderation of mark sheets, lecturers |
| Finance Officer | admin | Fee structures, invoices, payments, M-Pesa reconciliation, scholarships, refunds, giving |
| Library Officer | admin | Library catalogue, loans and digital resources |
| Communications Officer | admin | Website CMS, news, events, announcements, bulk messaging |
| Chaplain | admin | Chapel services and attendance, ministry groups, pastoral notes on students |
| Auditor | admin | Read-only finance, results and audit trail |
| Lecturer | lecturer | Own course offerings: content, attendance, assignments, exams, marking, mark sheets |
| Student | student | Own courses, assessments, results, fees and payments, requests, profile |
| Applicant | applicant | Own applications, documents, application fee, offer acceptance |
| Sponsor | sponsor | Sponsored students' progress and statements, giving history |
| Alumni | student (alumni view) | Transcripts, certificates, giving, events |

## Admin screens by role

| Admin area (`/admin/...`) | Roles (besides super-roles) |
| --- | --- |
| `/` dashboard | all staff roles |
| `/admissions` | Admissions Officer, Registrar, Academic Dean |
| `/students` | Registrar, Admissions Officer, Academic Dean, Finance Officer, Chaplain, Auditor |
| `/academics`, `/exams`, `/credentials`, `/staff` | Registrar, Academic Dean |
| `/results` | Registrar, Academic Dean, Auditor |
| `/finance` | Finance Officer, Auditor |
| `/church` | Finance Officer, Chaplain, Communications Officer |
| `/communication` | Communications Officer, Registrar, Admissions Officer, Academic Dean |
| `/website` | Communications Officer |
| `/library` | Library Officer, Academic Dean |
| `/alumni` | Registrar, Communications Officer, Chaplain |
| `/reports` | Registrar, Academic Dean, Finance Officer, Auditor |
| `/audit` | Auditor |
| `/settings` | super-roles only |

A user may hold several roles (for example Lecturer and Academic Dean); the portal switcher in the user menu
lists every portal the user can open. `utils/portal.portal_for(user)` decides where to land after sign-in:
admin, then lecturer, student, sponsor, applicant.

## Sign-in identifiers

Users sign in at `/signin` with their email, **student number** or **staff number**
(`mahanaim.api.auth.resolve_login` maps the number to the user's email). Applicants register with email and
phone; both are verified by OTP before an application can be submitted.
