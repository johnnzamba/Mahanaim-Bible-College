# AGENTS.md — Mahanaim Digital Campus

Guidance for humans and AI agents working in this repository. Read this before editing.

## What this is

A Frappe v16 app (`mahanaim/`) plus a React SPA (`frontend/`) that together deliver the Mahanaim Bible College
**Digital Campus** described in the SOW (modules M01–M23): public website, online admissions, student lifecycle,
curriculum, LMS bridge, assignments/CATs, online exams, grading & results, fees, M-Pesa, transcripts & certificates,
communication, dashboards, plus the church-partner/sponsor, library and alumni extensions.

```
mahanaim/                 Frappe app (python package)
  hooks.py                SPA routes, scheduler, permission hooks — single owner, do not edit casually
  install.py              idempotent defaults (roles, grading scale, templates…) run on install + migrate
  utils/                  role constants + small helpers (settings, status logs, phone normalisation, jinja)
  permissions.py          lecturer row-level scoping (permission_query_conditions / has_permission)
  api/                    whitelisted endpoints consumed by the SPA — one module per domain
  services/               business logic shared by controllers, APIs and scheduler jobs
  <module>/doctype/*      91 doctypes across 13 modules (JSON is the schema source of truth)
  www/mbc.{html,py}       single page that boots the SPA for every public/portal route
  public/app/             BUILT SPA (committed, like 360-hr-payroll — deploys need no Node)
  templates/print|emails  Jinja print formats (admission letter, invoice, receipt, transcript, certificate)
  tests/                  integration tests (one file per domain) + factories.py
frontend/                 Vite + React 18 + Tailwind SPA (portals: public, applicant, student, lecturer, admin, sponsor)
docs/                     ARCHITECTURE, API reference (docs/api/<domain>.md), MODULES (SOW map), ROLES, DEPLOYMENT
```

## Dev environment (isolated bench)

| Thing | Value |
|---|---|
| Bench | `~/mahanaim-bench` (apps/mahanaim → this repo) |
| Site | `mahanaim.localhost` (Administrator / `admin`), developer_mode on, mute_emails on, allow_tests on |
| DB | MariaDB 10.11 user-space on `127.0.0.1:3308` (`~/mahanaim-bench/local-db/my.cnf`, root/root) |
| Redis | cache 13110, queue/socketio 11110 |
| Web | `http://127.0.0.1:8010` (`serve --port 8010`), Vite dev on 8080 proxies to it |
| Start services | `bash ~/mahanaim-bench/local-db/start.sh` (idempotent) |
| Lint | `~/mahanaim-bench/env/bin/ruff check mahanaim` (CI enforces it) |

Run Frappe commands with the absolute interpreter (no `bench` CLI needed):

```bash
cd ~/mahanaim-bench/sites
F="$HOME/mahanaim-bench/env/bin/python -m frappe.utils.bench_helper frappe --site mahanaim.localhost"
flock /tmp/mahanaim_migrate.lock $F migrate                      # after ANY doctype JSON change
flock /tmp/mahanaim_migrate.lock $F run-tests --module mahanaim.tests.test_admissions
$F execute mahanaim.some.module.fn --kwargs '{"x": 1}'
$F console                                                       # IPython with frappe connected
```

**Always wrap `migrate` and `run-tests` in `flock /tmp/mahanaim_migrate.lock`** — several agents share one site.
Never run `bench build`, never `pip install` into the env (it shares site-packages with another bench), never touch
`~/frappe-bench` or `~/Documents/LMS_Moodle`. Disk is tight (~2.5 GB free): no large downloads.

## Ownership map (parallel work)

| Area | Owner | Files |
|---|---|---|
| Shared core | lead | `hooks.py`, `install.py`, `utils/*`, `permissions.py`, `api/utils.py`, `api/session.py`, `services/numbering.py`, `services/communication.py`, `tests/factories.py`, this file |
| B1 Admissions, auth, students, setup | B1 | `api/auth.py`, `api/admissions.py`, `api/students.py`, `api/setup.py`, `services/{auth,admissions,students}.py`, controllers in `mahanaim_setup/`, `admissions/`, `student_records/` |
| B2 Academics, learning, assessments, exams, results | B2 | `api/{academics,learning,assessments,exams,results,lecturer}.py`, `services/{lms_bridge,grading,results,exams,assessments}.py`, controllers in `academics/`, `learning/`, `assessments/`, `results/` |
| B3 Finance, M-Pesa, credentials | B3 | `api/{finance,mpesa,credentials}.py`, `services/{fees,mpesa,documents}.py`, controllers in `finance/`, `credentials/`, print formats in `templates/print/` |
| B4 Communication, website, church, library, dashboards | B4 | `api/{communication,website,church,library,dashboard,sponsor}.py`, `services/{website,library,church,dashboard}.py`, controllers in `communication/`, `website_cms/`, `church_partners/`, `library/` |

Need something in a file you don't own? Call the **contract functions** below; if a contract is missing, add it to
*your* service module and document it. Do not edit `hooks.py` — if you need a hook, write the function and list the
needed hook line in your final report; the lead wires it.

### Cross-domain contracts (signatures are fixed; owners implement bodies)

```python
# B1  services/students.py
ensure_user(email, first_name, last_name=None, phone=None, roles=(), user_type="Website User") -> str
create_student_from_application(application) -> str
# B1  services/admissions.py
mark_application_fee_paid(application: str, payment: str | None = None)
# B2  services/lms_bridge.py
sync_offering(offering) -> str | None; enrol(course_enrolment) -> str | None; unenrol(course_enrolment); lms_course_url(offering)
# B2  services/grading.py
grade_for(score, scale=None) -> {grade, grade_points, is_pass, description}
classification_for(cgpa, scale=None) -> str | None
compute_gpa(student, academic_term=None) -> {gpa, credits, quality_points}
refresh_student_standing(student) -> dict
# B2  services/results.py
transcript_data(student, as_of_term=None, published_only=True) -> dict
# B3  services/fees.py
create_invoice_for_registration(registration) -> str | None
get_student_balance(student) -> float
fee_clearance(student, purpose) -> {cleared, balance, paid_percent, required_percent, message}   # purpose: exam|lms|transcript|registration
# B3  services/mpesa.py
initiate_payment(phone, amount, purpose, student=None, application=None, sponsor=None, invoice=None, initiated_by=None)
	-> {request, checkout_request_id, customer_message}      # purpose: Student Fees|Application Fee|Event Fee|Giving|Other
# B4  services/website.py
route_meta(path) -> {title, description, image}             # used by www/mbc.py for SEO/OpenGraph
# lead  services/communication.py
notify(event, doc=None, recipients=[{user,email,phone,name}], context={}, link=None, category="Info", fallback=None)
recipient_for_student(student) / recipient_for_application(app) / recipient_for_sponsor(sponsor) / recipient_for_user(user)
push_portal_notification(user, title, message=None, link=None, category="Info", doc=None)
# lead  services/numbering.py
next_student_number(programme, campus=None, date=None); new_verification_code(length=10, doctype=None, field="verification_code"); next_serial(prefix, digits=5)
```

## Backend conventions

- **Python style**: tabs, double quotes, `from __future__ import annotations` optional, ruff config in `pyproject.toml`.
  Translate user-facing strings with `_()`. Raise with `frappe.throw(_("…"), frappe.ValidationError)` (or
  `frappe.PermissionError` / `frappe.DoesNotExistError`) — the SPA shows the message verbatim.
- **Status workflows** are plain `status` Select fields guarded in controllers with
  `mahanaim.utils.validate_transition(doc, TRANSITIONS)` and audited with `log_status(doc, to, note)` when the doctype
  has a `status_log` table. We deliberately do not use Frappe Workflow (API-first, testable).
- **Guards**: every whitelisted function starts with one of `require_login / require_roles(...) / require_staff /
  require_student / require_lecturer / require_lecturer_of(offering) / require_sponsor / require_applicant`
  from `mahanaim.api.utils`. System Manager and College Administrator pass every role check.
- **Portal endpoints** (`my_*`) never accept a student/sponsor id from the browser — resolve it from the session
  (`require_student()` returns the Student doc). They may use `frappe.get_all(..., ignore_permissions)` *because*
  they filter by the resolved owner.
- **Staff endpoints** prefer `frappe.get_list` (permission-aware, honours campus User Permissions and the lecturer
  query conditions). Use `frappe.has_permission(doctype, ptype, doc, throw=True)` before mutating.
- Mutating endpoints: `@frappe.whitelist(methods=["POST"])`. Read endpoints: `@frappe.whitelist()`.
  Public endpoints: `@frappe.whitelist(allow_guest=True)` — rate-limit sensitive ones with
  `from frappe.rate_limiter import rate_limit` (e.g. `@rate_limit(limit=5, seconds=60)`).
- Browser payloads: `data = parse_json(data)` then `clean_payload(data, ALLOWED_FIELDS)` — never `doc.update(data)`
  with raw input.
- **Response shapes**: lists return `{"data": [...], "total": n}` (use `page_args(start, page_length)`);
  single records return a plain dict; actions return the updated record dict or `{"ok": True, ...}`.
- Money fields are `Currency` in the settings currency (KES). Dates go over the wire as ISO strings.
- Heavy work (bulk SMS, LMS sync, PDF batches) → `frappe.enqueue(..., queue="long", enqueue_after_commit=True)`.
- Notifications: call `notify("<Message Template event>", doc, recipients, context, link=..., category=...)` with a
  `fallback={"subject","message"}` so it works without a template. Never let a notification failure break the
  transaction (notify already swallows/logs errors).
- Optional integrations: guard Frappe LMS with `has_app("lms")` and ERPNext posting with
  `has_app("erpnext") and setting("post_to_erpnext")`. Store external names in Data fields (no hard Link).

## Tests

- Integration tests live in `mahanaim/tests/test_<domain>.py`, subclass `frappe.tests.IntegrationTestCase`
  (rolls back after each class). Do **not** add tests inside doctype folders (they auto-create test records).
- Build data with `mahanaim.tests.factories` (`make_campus/make_term/make_programme/make_course/make_offering/
  make_staff/make_student/make_enrolment/make_user`). Put domain-only helpers in `tests/factories_<domain>.py`.
- To call an endpoint as a user: `frappe.set_user(email)` … finally `frappe.set_user("Administrator")`.
- Test behaviour that matters (state machines, money math, permissions, grading maths, idempotency of M-Pesa
  callbacks); skip trivial getters.

## Frontend conventions (frontend/)

Full guide: `frontend/DESIGN.md`. React 18 + Vite 5 + Tailwind 3 + TanStack Query 5 + react-router 6 + lucide-react + recharts.

- **One SPA** for the website and every portal. `www/mbc.html` (generated) + `www/mbc.py` (boot context) serve every
  route listed in `hooks._SPA_ROUTES`. New top-level public paths must be added there (lead owns `hooks.py`).
- **Portals** are lazy chunks: `src/portals/{public,auth,applicant,student,lecturer,admin,sponsor}/`. Each portal's
  default export renders `<PortalShell portal="student" nav={NAV} tabs={TABS}><Routes>…</Routes></PortalShell>`;
  nav paths are absolute (`/student/fees`). Admin nav items are filtered by `shared/access.js` `ADMIN_ACCESS`.
- **Data**: `useApi("mahanaim.api.x.y", args, {guest})` for reads (GET, cached under `[method, args]`),
  `useAction("mahanaim.api.x.z", {invalidate: ["mahanaim.api.x."], success: "Saved"})` for writes (POST, toasts).
  Raw calls: `frappe.call/get/uploadFile` from `shared/api/frappe.js`. Never `fetch` the API directly.
- **Session**: `useSession()` → `{user, roles, portals, student, staff, sponsor, settings, isGuest, hasRole, reload}`.
- **UI**: only `shared/components/ui.jsx` + `kit.jsx` + `Charts.jsx` primitives and the Tailwind tokens
  (`brand-*`, `gold-*`, `ink`, `canvas`, `surface`, `line`, `.card`, `.btn-*`, `.input`, `.chip`). No new colour hexes.
  Every list uses `DataTable` (sort, CSV export, mobile cards); every async surface handles loading/empty/error
  (`QueryState`). Money via `money()`, dates via `date()/ago()` from `shared/utils/format.js`.
- **Routes** (deep links used by notifications/search): `/admin/students/<name>`, `/admin/admissions/<name>`,
  `/admin/finance/invoices/<name>`, `/admin/academics/courses/<code>`, `/admin/church/sponsors/<name>`,
  `/admin/staff/<name>`, `/student/courses/<offering>`, `/student/exams/<exam>`, `/lecturer/courses/<offering>`.
- **Build**: `cd frontend && npm run build` = `check-refs` (catches icons/components used but never imported) →
  `vite build` (content-hashed entry + chunks into `mahanaim/public/app`) → `copy-html` (writes `www/mbc.html`,
  per-portal manifests, `sw.js`). Commit the build output. The service worker is served by
  `mahanaim.api.session.service_worker` so it can control scope `/`.
- **Dev**: `npm run dev` (port 8080, proxies `/api` etc. to bench on 8010).

## Commits

Conventional-ish messages (`feat(admissions): …`, `fix(fees): …`), include the trailer
`Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>` when an AI agent authored the change.
