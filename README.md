# Mahanaim Bible College — Digital Campus POC

A full frontend proof of concept for the Mahanaim Bible College Digital Campus, created from the project Scope of Work before backend integration.

## What this POC demonstrates

- Public recruitment website: home, programmes, admissions, fees, e-library, news/events and contact-oriented navigation
- Multi-step online application flow with programme selection, applicant details, academics, document uploads, application fee simulation and review
- Applicant portal with application status, uploaded documents, payment history, admission decision area and messaging
- Student portal with dashboard, LMS courses, assignments/CATs, examinations, results, fees/M-Pesa history, documents, notifications and profile
- Lecturer portal with teaching dashboard, course management, content studio, assessment management, grading queue, exams, student roster, announcements and calendar
- Administrative console covering admissions, students, academics, LMS, assessments, exams, fees, payments/reconciliation, transcripts/certificates, communications, reporting and system settings
- Public certificate/transcript verification experience
- Phase 2 previews for digital library, sponsor/church partner portal, alumni, timetable/attendance, student support, advanced PWA, multi-campus and analytics
- Responsive layouts for desktop, tablet and mobile

All operational data is intentionally hardcoded for the POC. The UI structure is designed so mock data can later be replaced with Frappe REST/resource calls and Frappe LMS integration.

## Technology

- React
- Vite
- Plain CSS design system (no UI framework dependency)
- Hash-based POC navigation to keep hosting simple

## Run locally

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
npm run preview
```

## Demo routes

- `#/` — Public website
- `#/apply` — Online application wizard
- `#/login` — POC role selector
- `#/applicant` — Applicant portal
- `#/student` — Student portal
- `#/lecturer` — Lecturer portal
- `#/admin` — Administration console
- `#/verify` — Public credential verification

## Backend integration direction

The next implementation phase should replace the hardcoded mock layer with:

1. Frappe Framework authentication/session APIs and OTP workflow.
2. Custom Frappe DocTypes for admissions, student lifecycle, academics, fees, exams, documents and communications.
3. Frappe LMS as the learning engine, connected through a bridge app for course offering/enrolment synchronization.
4. Safaricom Daraja for M-Pesa STK Push, callbacks, verification, receipts and reconciliation.
5. Frappe print formats for admission letters, receipts, transcripts and certificates.
6. QR/public verification APIs for credentials.
7. Role and campus permissions enforced server-side.
8. Frappe reporting / Insights integration for management analytics.

## POC note

The image backgrounds currently use remote Unsplash assets for presentation quality. Production should replace these with Mahanaim-owned photography and approved brand assets.
