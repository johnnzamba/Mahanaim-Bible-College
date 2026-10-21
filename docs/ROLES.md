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
| Chaplain | admin | Chapel services and attendance, ministry groups, giving overview, church events |
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
| `/students` | Registrar, Academic Dean, Finance Officer |
| `/students/requests` | as `/students`, plus Library Officer |
| `/academics` (programmes, offerings, calendar, exams, mark sheets), `/staff`, `/alumni` | Registrar, Academic Dean |
| `/academics/results` | Registrar, Academic Dean, Auditor (read-only) |
| `/credentials` | Registrar, Academic Dean, Auditor (read-only); issuing is Registrar only |
| `/finance` | Finance Officer, Auditor |
| `/church` (dashboard, giving) | Finance Officer, Chaplain, Auditor, Registrar |
| `/church/churches` | as `/church`, plus Admissions Officer and Communications Officer |
| `/church/sponsors` | as `/church`, plus Admissions Officer |
| `/church/chapel`, `/church/ministry-groups` | Chaplain, Auditor, Registrar, Academic Dean |
| `/communication` (announcements) | Communications Officer, Registrar, Academic Dean, Finance Officer, Chaplain |
| `/communication/templates` | Communications Officer |
| `/communication/messages` | Communications Officer, Auditor |
| `/website` | Communications Officer, Chaplain, Admissions Officer |
| `/website/news` | Communications Officer |
| `/website/events` | Communications Officer, Chaplain |
| `/website/enquiries`, `/website/content` | Communications Officer, Admissions Officer |
| `/library` | Library Officer, Registrar, Auditor, Finance Officer |
| `/reports` | Registrar, Academic Dean, Finance Officer, Auditor |
| `/audit` | Auditor |
| `/settings` | super-roles only |

The map lives in `frontend/src/shared/access.js` and mirrors the `require_roles()` gates in `mahanaim/api/*`; the server
remains the authority. Inside an area, write buttons are hidden for read-only roles.

A user may hold several roles (for example Lecturer and Academic Dean); the portal switcher in the user menu
lists every portal the user can open. `utils/portal.portal_for(user)` decides where to land after sign-in:
admin, then lecturer, student, sponsor, applicant.

## Sign-in identifiers

Users sign in at `/signin` with their email, **student number**, **staff number** or (students, applicants,
sponsors) **phone number**. `mahanaim.api.auth.login` resolves the identifier server-side
(`services.auth.resolve_login_user`), so the browser never learns which email an identifier belongs to. Every
answer is generic, so a stranger can't probe which accounts exist. Users can also sign in with a one-time code
(`request_otp` → `login_with_otp`) and reset a forgotten password with a code or an emailed link.

Applicants register with email and phone; both are verified by OTP before an application can be submitted.

## Staff two-step verification

With **Mahanaim Settings → Admin MFA Required** (`admin_mfa_required`) on, a staff password sign-in returns
`mfa_required` and the SPA asks for the emailed code (`verify_mfa`, `resend_mfa`). The `on_login` hook
`services.auth.enforce_staff_mfa` refuses any staff session opened another way: Frappe's stock
`/api/method/login`, desk `/login`, or the automatic sign-in after a key-based password reset (the new
password is kept).
