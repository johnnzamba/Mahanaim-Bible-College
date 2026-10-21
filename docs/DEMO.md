# Demo dataset

`mahanaim.demo.seed.run()` builds a realistic demo campus so every portal (public website, applicant, student,
lecturer, sponsor, alumni and admin) has data to show. It **never runs automatically**: it is not called by install,
migrate or any hook.

## Running it

```bash
# any bench
bench --site <site> execute mahanaim.demo.seed.run

# this dev environment (serialise with migrations/tests)
cd ~/mahanaim-bench/sites && flock /tmp/mahanaim_migrate.lock ~/mahanaim-bench/env/bin/python \
  -m frappe.utils.bench_helper frappe --site mahanaim.localhost execute mahanaim.demo.seed.run
```

A run takes about 5 seconds and ends with a summary table (created / existing / errors per section) followed by the
credentials table below.

**Do not run it on a production site.** It creates users with a shared, published password.

## Behaviour

- **Idempotent.** Every record is fetched or created by a natural key (codes, emails, titles, dates), so a second run
  reports `created 0`. Re-running also **self-heals**: missing enrolments, attendance rows and published results are
  topped up.
- **Date-based rows.** Class sessions cover the last 28 days plus the next one, and chapel services are keyed by
  date. Running the seed on a later day therefore adds sessions for the new dates. That is expected.
- **Resilient.** Each section runs in its own savepoint and each record in a nested one. A failure is printed with
  `!`, logged to the Error Log as "Mahanaim demo seed: …" and the run carries on. Other domains' side effects
  (M-Pesa, LMS sync, emails) are avoided: `frappe.flags.in_demo_seed = True` is set, payments use manual modes and
  documents are inserted with `ignore_permissions`.
- **Existing campuses are reused.** Campuses are resolved by code: if a campus with code `MNC` or `NKR` already
  exists (e.g. "Nakuru Campus"), the demo data is attached to it instead of creating a duplicate.
- The current academic term is the one whose dates include today. It is marked `is_current` with registration open.

## Credentials

Every account uses the password **`Demo@12345`**.

| Role | Login |
| --- | --- |
| College Administrator | `admin@mahanaim.demo` |
| Principal (College Administrator) | `principal@mahanaim.demo` |
| Registrar | `registrar@mahanaim.demo` |
| Finance Officer | `finance@mahanaim.demo` |
| Admissions Officer | `admissions@mahanaim.demo` |
| Academic Dean + Lecturer | `dean@mahanaim.demo` |
| Lecturer | `lecturer@mahanaim.demo` |
| Library Officer | `library@mahanaim.demo` |
| Communications Officer | `comms@mahanaim.demo` |
| Chaplain | `chaplain@mahanaim.demo` |
| Student (Grace Wanjiku, DBS, Main Campus Nairobi) | `student@mahanaim.demo` |
| Applicant (draft DBS application) | `applicant@mahanaim.demo` |
| Sponsor (Harvest Fellowship Kasarani Missions Board) | `sponsor@mahanaim.demo` |
| Alumni (John Maina) | `alumni@mahanaim.demo` |

## What gets created

| Area | Data |
| --- | --- |
| Foundation | Campuses **MNC** (Main Campus Nairobi) and **NKR** (Nakuru Extension); departments Biblical Studies, Theology, Pastoral Ministry and Leadership; academic years 2025-2026 and 2026-2027 with terms; intakes January, May and September 2026; Mahanaim Settings branding |
| Programmes | **DBS** Diploma in Biblical Studies, **DPM** Diploma in Pastoral Ministry, **CTH** Certificate in Theology, **CLM** Certificate in Christian Leadership & Ministry, each with a 6–10 course curriculum (Old/New Testament Survey, Hermeneutics, Systematic Theology I, Homiletics, Church History, Christian Ethics, Pastoral Care & Counselling, Missions & Evangelism, Greek I, …) |
| Staff | 13 staff members (5 lecturers, plus the registrar, finance, admissions, library, communications, chaplain and principal accounts) with user accounts, roles and public website profiles |
| Teaching | Course offerings for the current term with lecturers; the demo lecturer teaches 5 offerings; class sessions with attendance |
| Students | 25 students across programmes and campuses, plus 3 alumni (one with the alumni portal user), enrolments, semester registrations, sponsorship links and partner churches |
| Results | A previous-term mark sheet with published Course Results, so results, CGPA and transcripts have data (the demo student's CGPA is 3.65) |
| Assessments | 2 published assignments with submissions; an exam with 8 mixed-type questions |
| Admissions | 10 programme applications across statuses (Draft → Admitted/Rejected); one belongs to the demo applicant |
| Finance | A fee structure per programme with components; invoices for students; manual payments; some overdue invoices |
| Website | Website settings copy, 6 news posts, 4 events (upcoming and past, with registrations), 6 FAQs, 4 testimonials, 3 contact enquiries |
| Church | 5 partner churches (a denomination group with branches), 4 sponsors (one with the sponsor portal user), sponsorships, giving records, chapel services with attendance, ministry groups |
| Library | 30 items (books, commentaries, reference works, e-books, journals, periodicals, audio, video, theses) across subjects, plus 7 loans including overdue ones |
| Communication | 4 announcements (various audiences) and portal notifications for the demo student |

## Notes

- Demo users all end in `@mahanaim.demo`. Demo students and sponsors are linked to those users, which makes the
  demo data easy to spot.
- To start over, use a fresh site; there is no automated teardown. On a shared dev site, other agents' test data
  (e.g. `@test.local` users) may appear alongside the demo data.
