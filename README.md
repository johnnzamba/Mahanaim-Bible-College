# Mahanaim Bible College: Digital Campus

The college's complete digital campus on one Frappe backend: public website, online admissions, student
records, programmes and curriculum, digital learning (LMS bridge), assignments and CATs, an examination
engine, grading and results, fees with M-Pesa, transcripts and certificates with QR verification, notifications,
church partners and sponsors, chapel, library, alumni and management reporting.

One React single-page app serves every audience:

| Portal | Route | Who |
| --- | --- | --- |
| Public website | `/`, `/programmes`, `/admissions`, `/fees`, `/news`, `/events`, `/give`, `/verify/<code>` | Everyone |
| Applicant | `/applicant` | Applicants (sign up with email and phone OTP) |
| Student | `/student` | Students and alumni |
| Lecturer | `/lecturer` | Lecturers |
| Sponsor | `/sponsor` | Sponsors and partner churches |
| Administration | `/admin` | Registrar, admissions, finance, dean, library, chaplaincy, communications, auditor, administrators |

Every portal works on a phone (360 px and up), installs as a PWA, and supports light and dark themes.

## Documentation

| Document | What it covers |
| --- | --- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Layers, key flows, cross-cutting concerns, frontend serving |
| [`docs/MODULES.md`](docs/MODULES.md) | Where each SOW module (M01–M28) lives in the code |
| [`docs/ROLES.md`](docs/ROLES.md) | Roles, portals, admin access matrix, sign-in and staff MFA |
| [`docs/api/`](docs/api) | Endpoint reference per module |
| [`docs/MPESA.md`](docs/MPESA.md) | Safaricom Daraja setup, callbacks, simulation, going live |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Install, configuration, email/SMS, security, jobs, backups, upgrades |
| [`frontend/DESIGN.md`](frontend/DESIGN.md) | Frontend architecture, components, visual language, routes |
| [`AGENTS.md`](AGENTS.md) | Contributor guide: dev environment, conventions, ownership, tests |

## Repository layout

```
mahanaim/                 Frappe app
  <module>/doctype/       DocTypes for the 13 modules (setup, academics, admissions, student records, learning,
                          assessments, results, finance, credentials, communication, website CMS, church, library)
  services/               Business logic (one module per domain); controllers stay thin
  api/                    Whitelisted endpoints used by the SPA (role-checked, documented in docs/api)
  templates/print/        Admission letter, invoice, receipt, statement, transcript and certificate
  tests/                  Integration tests and factories
  www/mbc.py              Serves the SPA shell with boot data (session, branding, settings)
  public/app/             Built SPA bundle (committed)
frontend/                 React 19 + Vite + Tailwind + TanStack Query
  src/shared/             Design system, layout, API client, session, theming, PWA
  src/portals/<portal>/   public, auth, applicant, student, lecturer, sponsor, admin/<area>
```

## Development

You need a Frappe v16 bench (Python 3.14, Node 24, MariaDB, Redis).

```bash
# backend
bench get-app <this repo>            # or symlink apps/mahanaim to your checkout
bench --site campus.localhost install-app mahanaim
bench --site campus.localhost execute mahanaim.demo.seed.run     # optional demo data (@mahanaim.demo users)
bench start

# frontend (hot reload on :8080, proxies /api to the bench on :8010)
cd frontend
npm ci
npm run dev
```

| Task | Command |
| --- | --- |
| Backend tests | `bench --site <site> run-tests --app mahanaim` |
| Python lint | `ruff check mahanaim && ruff format --check mahanaim` |
| Frontend check and build | `cd frontend && npm run check && npm run build`, then commit `mahanaim/public/app` and `mahanaim/www/mbc.html` |

CI (`.github/workflows/ci.yml`) runs ruff, the frontend build, a check that the committed bundle is up to
date, and the backend test suite.

## License

GNU General Public License v2. See [`LICENSE`](LICENSE).
