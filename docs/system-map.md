# FANU HR system map — 30 September 2026

This map describes the rebuilt source. Publication and migration status are recorded
in the release handoff; this document does not assert that the changes are deployed.

## Boundaries and sources of truth

Employee UUID and immutable `FANU-` code identify a person. `employee_number` and
device identifiers are separate source attributes. `employee_assignment_history`
records documented date ranges; observed current attributes establish only future
work dates and never fill unknown history. Department rules are effective-dated.

Imports preserve source rows and raw values. Identity mappings and review issues
remain distinct from punches. Daily evidence consumes applied daily imports only.
Monthly evidence selects an explicitly chosen preview or approved monthly import.
`attendance-engine.mjs` interprets work dates and punch windows for both views.
Approval freezes rule/assignment context. `hr_status_records` are separate human
decisions; no missing punch or uncovered day writes an HR absence.

## Product inventory

| Route / workflow | Outcome and source | Permission | Disposition / failure handling |
|---|---|---|---|
| Login, password, logout | Supabase Auth plus current `profiles` role/active state | Existing account | Retain; distinguish invalid login, upstream failure and expiry; no secret logging |
| `/` | Overview of manual HR records and organization | All active roles | Retain; label manual population independently of punch metrics |
| `/tasks`, `/review` | Actionable exceptions and data-review queues | ADMIN/HR | Retain; decisions require explicit action and current revision |
| `/organization` | Departments, managers, active headcount | All; changes ADMIN | Retain; source is current organization, not historical attendance |
| `/employees`, `/employees/:id` | Search, details, creation, edits, employment status, history | Read all; ordinary edits ADMIN/HR; protected identity decisions ADMIN | Repair; permanent code preserved, dated history, stale revision rejection, duplicate evidence, dirty forms |
| `/status` | Single or atomic bulk absence/leave/lateness exceptions | ADMIN/HR | Repair; one active decision per person/date, bounded lateness, correction/cancellation audit, dirty guards |
| `/absence-leave`, `/lateness` | Documented manual exceptions with filtered totals | All | Retain; rows use saved HR evidence; no inferred missing-punch absence |
| `/actions` | Administrative action types, employee actions and states | Read all; create/edit ADMIN/HR; cancellation ADMIN | Repair dirty forms; required type/date/reason, version checked |
| `/fingerprint-daily` | File validation → preserved daily source → explicit apply | ADMIN/HR | Retain separate daily lifecycle; duplicate hashes and issue blocking |
| `/fingerprint-monthly` | Upload → preview → matching → review → approval | ADMIN/HR | Repair period/coverage parsing and identity safety; preview never official |
| `/fingerprint-issues` | Evidence and identity review grouped without losing rows | ADMIN/HR; protected mapping ADMIN | Retain; ambiguous matches stay unresolved; reason/revision required |
| `/daily-position`, `/daily-dashboard` | Shift-aware applied daily evidence and manual annotations | All; HR decisions ADMIN/HR | Replace old SQL calculation with canonical engine and atomic decision/note save |
| `/monthly-position`, `/monthly-dashboard` | Full month, UUID groups, entry/exit subrows, metrics and summary | All | Replace competing calculation paths; historical assignment filter at month-end or today; unknown history explicit |
| `/monthly`, `/departments`, `/summary` | Manual HR matrix and summaries | All | Retain manual reports; population uses current employee filters, explicitly separate from historical fingerprint report |
| `/reports` | Report navigation and filtered manual outputs | All | Retain; exact scope flows to XLSX/PDF |
| `/audit` | Immutable before/after business changes | ADMIN | Retain; paginated filters, no editing of audit evidence |
| `/users` | Create accounts, roles, activate/deactivate | ADMIN | Repair server validation/dirty state; live-profile authorization prevents stale JWT role grants |
| `/settings`, `/attendance-settings` | Organization labels and effective-dated work rules | ADMIN | Repair input/dirty protection; no arbitrary historical defaults |
| `/import` | Employee spreadsheet validation and controlled import | ADMIN | Retain independent from fingerprint import; stable employee identity |

All data pages share bounded request timeouts, safe Arabic errors, explicit loading
and empty states, filter-keyed requests and stale-response protection. The mobile
navigation closes after selection. Wide monthly tables scroll inside their region.

## HTTP and database entry points

| Boundary | Source / rule | Authorization and recovery |
|---|---|---|
| `GET /api/auth`, `POST /api/auth` | Session, login, refresh, logout/password operations | HttpOnly session cookies, validated user/current profile, safe errors, same-origin mutation protection |
| `GET /api/data` | `hr_read_v4`; metadata via `attendance_read_v5`; raw evidence via daily/monthly evidence RPCs, canonical calculation on server | Every RPC checks current active role; no browser service key |
| `POST /api/data` | Zod-validated HR/attendance commands; `hr_write_v2`, `attendance_write_v5`, identity resolver, assignment and atomic day-save RPCs | ADMIN/HR with narrower ADMIN commands; CSRF, byte bound, optimistic versions, no automatic uncertain-write retry |
| `POST /api/import` | Employee import parsing and transactional database import | ADMIN; bounded body and row validation; retained source/import audit |
| `/api/users` | Server-side Supabase Admin operations and profile updates | ADMIN only; service credential remains server-side |
| `attendance_read[_v2.._v4]` | Historical compatibility functions | Retain definitions for controlled recovery; revoke public client execution after new site deployment |
| `attendance_read_v5` | Allowlisted metadata only | ADMIN/HR/VIEWER; rejects legacy calculation kinds and inactive/anonymous callers |
| `employee_assignment_record` | Finite dated evidence, overlap/revision checks, reason | ADMIN/HR; audit and employee revision serialization |
| `attendance_day_save` | Manual exception and note in one transaction | ADMIN/HR; any conflict rolls both back |
| `attendance_monthly_evidence_v2`, `attendance_daily_evidence` | Traceable sources, assignments, rules, issues | All active roles; no calculation or approval implied by reading |
| Review/approval write functions and triggers | State, open issues, history/rule coverage, frozen context | Atomic row locking; direct legacy write paths retain approval guards |
| Employee identity triggers/sequence | UUID/code stability and non-reuse | Unique constraints and deletion guard; no merge that deletes a permanent identity |

The complete function-name inventory is in `database-function-inventory.txt`.
There is no background payroll processor, scheduled automatic approval or automatic
absence creation. Local verification/benchmark/recovery scripts never connect to
production; connector-based production reads/migrations are explicit operations.

## Export contracts

XLSX: inline text for employee identifiers/user strings, numeric totals, valid date
and clock cells, original two brands, Cairo font choice, RTL, frozen identity/header
panes, repeated print titles and landscape page settings. Wide monthly exports
preserve readable scale and may span horizontal pages. A native Excel visual check
is separate from XML/content validation and remains an explicitly recorded gate.

PDF: embedded Arabic font, original cropped assets, scope, Baghdad generation time,
Arabic credit, page numbers and repeated headers. Monthly fingerprint pages show
seven days each, preserving actual next-day exit dates. Browser print is a separate
surface and must not be confused with the downloaded PDF.

## Release and recovery sequence

1. Read migration history and exact production project; compare drift. Save the
   approved local private snapshot; never publish it or credentials.
2. Rehearse the snapshot in PGlite. Auth parents absent from the older local profile
   fixture are represented by inactive local placeholders; this is not an Auth
   account backup or a full PITR restore. Raw/audit tables are unchanged and hashed.
3. Apply `rebuild_calculation_integrity` and `attendance_read_gateway` once. Existing
   release 19 retains its reads during this preparation interval.
4. Build, commit/push and publish the exact private Sites source; inspect deployment
   status and authenticated read-only workflows.
5. Apply `restrict_legacy_attendance_reads` once after canonical reads are verified.
6. Compare permanent identity, raw evidence and manual-record hashes; reconcile
   legitimate intervening writes rather than overwriting them. Assignment insertion
   adds audit events, so audit growth is expected, never audit deletion.

If the app publish fails, keep the additive schema and the old read grants; fix
forward. After cutover, restoring release 19 requires restoring its exact prior
read ACLs from the snapshot first. Never drop the new history or frozen contexts,
restore stale business-table snapshots over new writes, or delete migration history.
Repair faulty functions with a new audited migration. Preserve the original backup.

## Evidence, limitations and remaining business decisions

152 isolated tests passed together after read-cutover changes. Further export/form
changes have targeted validation and require a final build. Browser synthetic
monthly import persisted through restart: 2 identities, 6 raw punches, 2 complete
days, 1 incomplete day, 3 covered no-punch days, 1125 worked minutes, 20 late minutes.
Those totals were computed independently. No production attendance was approved.

Unknown historical assignments and rules require authorized HR evidence; neither
software nor this release supplies those business facts. No payroll, penalties or
leave entitlements were invented. Native Excel rendering, production authentication
and the publication result must be reported at their actual verified state.
