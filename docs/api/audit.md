# Audit trail API (`mahanaim.api.audit`)

This is a read-only view of what Frappe already records:

- **Document changes** come from `Version`. Frappe writes a Version on every save of a doctype that has
  *Track Changes* enabled, which is all 64 Mahanaim doctypes. Each one holds the field diff, child-row
  changes and docstatus changes.
- **Access events** come from `Activity Log`: Login, Logout, Impersonate, and failed logins (`status: "Failed"`).

**Guard.** Every endpoint requires Auditor, College Administrator or System Manager. Anyone else, including
students, gets `PermissionError`.

**Lists.**
- Lists are newest first and paginated with `start` (default 0) and `page_length` (default 20, max 200).
- They return `{rows, total}`.
- Date filters (`from_date`, `to_date`, formatted `YYYY-MM-DD`) are inclusive calendar days.

**Data handling.**
- Values of Password fields are never returned; they show as `"••••"`.
- Other values are truncated to 200 characters.
- HTML is stripped.

## Endpoints

| Endpoint | Method | Args | Returns |
| --- | --- | --- | --- |
| `mahanaim.api.audit.document_changes` | GET | `doctype?`, `docname?`, `user?`, `from_date?`, `to_date?`, `search?`, `start`, `page_length` | `{rows, total}` (see below) |
| `mahanaim.api.audit.access_log` | GET | `user?`, `operation?` (Login \| Logout \| Impersonate; default all three), `status?` (Success \| Failed \| Linked \| Closed), `from_date?`, `to_date?`, `start`, `page_length` | `{rows, total}` |
| `mahanaim.api.audit.audit_summary` | GET | `from_date?`, `to_date?` (defaults to the last 30 days; at most 366 days) | Summary object |
| `mahanaim.api.audit.audit_doctypes` | GET | none | `[{value, label, module}]`: Mahanaim doctypes with Track Changes (child tables excluded), for the filter dropdown |
| `mahanaim.api.audit.export_audit` | GET | `kind` (`document_changes` \| `access_log`), `filters?` (JSON object holding the list endpoint's filters) | CSV download `audit-<kind>-<date>.csv` (max 5000 rows) |

**`document_changes` filters**

- `doctype` must be a Mahanaim doctype; any other value raises `ValidationError`.
- Without `doctype`, the endpoint covers every doctype in the app's modules.
- `search` matches the document name, the change data or the user.

## `document_changes` row

```json
{"name": "9uqa7d8b0v", "ref_doctype": "Fee Structure", "docname": "FS-DBS-2026-T1",
 "owner": "bursar@mbc.ac.ke", "owner_name": "Grace Wanjiru", "creation": "2026-10-21 09:14:02",
 "changed": [
  {"field": "allow_installments", "label": "Allow Installments", "old": 0, "new": 1},
  {"field": "items[2].amount", "label": "Items (row 2): Amount", "old": "15000.00", "new": "16500.00"}],
 "added": 2, "removed": 0, "row_changed": 1, "is_new": false}
```

Field meanings:

- `changed` holds field changes. Child-table changes appear as `table[idx].field`, with the label prefixed by
  the table label and row number.
- `docstatus` changes appear as Draft / Submitted / Cancelled, for example a cancellation shows
  `Submitted → Cancelled`.
- `added` and `removed` count the child rows added or removed.
- `is_new` is true only for creation records, which Frappe writes for imports and documents with an updater
  reference.
- `impersonated_by` appears when an administrator made the change while impersonating someone.

## `access_log` row

```json
{"name": "56dk66j3uk", "creation": "2026-10-21 23:49:00", "user": "student@example.com",
 "full_name": "Joseph Kamau", "operation": "Login", "status": "Failed", "subject": "Incorrect password",
 "ip_address": "102.68.1.20"}
```

## `audit_summary`

```json
{"from_date": "2026-09-22", "to_date": "2026-10-21",
 "totals": {"changes": 76, "logins": 12, "failed_logins": 1, "active_users": 5},
 "changes_by_doctype": [{"doctype": "Class Session", "label": "Class Session", "count": 16}],
 "top_users": [{"user": "registrar@mbc.ac.ke", "full_name": "Grace Wanjiru", "count": 40}],
 "sensitive_events": [
  {"name": "286atsfr8g", "creation": "2026-10-21 23:43:59", "ref_doctype": "Programme Application",
   "docname": "APP-2026-00002", "owner": "admissions@mbc.ac.ke", "owner_name": "Peter Otieno",
   "kind": "application_decision", "description": "Application decision: Admitted"}],
 "daily": [{"date": "2026-10-21", "changes": 12, "logins": 4, "failed": 1}]}
```

Field meanings:

- `changes_by_doctype` is the top 10 and `top_users` the top 5.
- `logins` counts successful logins; `active_users` counts distinct users who logged in successfully.
- `daily` has one entry per day in the range, including days with no events.
- `sensitive_events` holds the 20 most recent sensitive events. Each `kind` is one of:

| `kind` | Recorded when |
| --- | --- |
| `student_status` | A Student's status changes |
| `application_decision` | A Programme Application becomes Admitted, Waitlisted or Rejected |
| `cancellation` | A Student Payment, Student Invoice or Fee Adjustment is cancelled |
| `refund_decision` | A Refund Request becomes Approved, Rejected or Paid |
| `revocation` | A Transcript or Certificate becomes Revoked |
| `settings_update` | Any change to a Mahanaim single doctype: Mahanaim Settings, M-Pesa Settings, LMS Bridge Settings or Campus Website Settings |

## `export_audit`

The export runs the same query as the list endpoint, so it is subject to the same guard and filters.

**`document_changes` CSV columns:** Date, DocType, Document, User, Full Name, Action (Created/Updated), Changes
(`Label: old → new; …`), Rows Added, Rows Removed.

**`access_log` CSV columns:** Date, User, Full Name, Operation, Status, IP Address, Subject.

Cells that start with `=`, `+`, `-` or `@` get a leading `'`, so spreadsheets don't treat them as formulas.

## Notes

- Frappe deletes Activity Log entries older than 90 days by default (`clear_old_logs`). Version rows are kept.
- Only saves made through the document API are tracked. Direct `db_set`/`set_value` updates don't create a
  Version. Status-flow fields that controllers set with `db_set` therefore show up only through the save that
  triggered them.
- Nothing needs to be added to `hooks.py`.
