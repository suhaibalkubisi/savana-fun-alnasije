# September 30 verification and release record

## Published runtime

Sites version 20, source `6d715c349d465586cdb7d30560ca3161bf42a88a`, deployed
successfully at 17:18:42 UTC on the existing public origin. Supabase authentication
is still required for HR data. The earlier source-only deployment failed on the
remote builder's dependency-source policy; it was replaced by the locally built
and validated archive. No downgrade of SheetJS or access controls was made.

The bundled Sites build helper passed. Its packaging wrapper requires Bash, absent
on this Windows host. Packaging therefore used the same bundled
`prepare-site-build.cjs`, attribution comparison/merge and native tar, preserving
the worker structure. The archive-backed native save/deploy succeeded.

## Production migrations — applied exactly once

| Version | Name | Effect |
|---|---|---|
| 20260930170046 | rebuild_calculation_integrity | Add history/evidence/atomic save and approval guards |
| 20260930170120 | attendance_read_gateway | New role-checked metadata gateway |
| 20260930172331 | restrict_legacy_attendance_reads | Retire direct execution of the four old calculated read APIs after publication |
| 20260930172524 | restrict_platform_event_trigger | Remove unnecessary client execution of the platform event-trigger function |

Local filenames were aligned to the server-assigned migration versions without
changing their SQL. Earlier bootstrap migrations are historical local fixtures;
do not blindly replay them into this existing production project. Native migration
history is authoritative. Recovery is forward-only for data: preserve later writes,
new history and frozen review context. An old application rollback also requires
restoring its prior read ACLs from the private snapshot.

## Data preservation

The user approved an affected-scope private local recovery snapshot. Restoring it
into isolated PGlite succeeded for 231 employees and 28 imports. One missing Auth
parent was represented by an inactive local fixture only; this is not a full Auth
backup or PITR. Raw source and manual HR records are not modified by these migrations.

Before/after production checks: 231 employees, 28 imports, one review, 11887 raw
source rows, zero persistent device mappings. Permanent identity hash, complete raw
row hash and manual-record hash were unchanged. The new 231 observed history rows
start on 2026-10-01; audit grew from 12051 to 12282 by those inserts. No audit deletion,
employee replacement, real attendance approval or invented historical assignment.

## Verification

- Full isolated suite: 152/152 passed. Further focused platform-grant and daily PDF
  regression tests accompany the final narrow follow-up; record their actual run
  separately rather than claiming they were in the earlier 152-test run.
- TypeScript, ESLint and production build passed. npm audit reported zero known
  vulnerabilities after the scoped undici 7.29.1 override.
- Synthetic browser XLS upload/review/approval persisted through local restart:
  2 identities, 6 punches, 2 complete days, 1 incomplete day, 3 covered empty days,
  1125 worked minutes and 20 late minutes, independently derived.
- Responsive widths 390/768/1280 have no document overflow; navigation closes.
- Actual local monthly XLSX/PDF downloads checked: numeric Excel clock/date cells,
  safe identifier text, both brands, Arabic headers/footer, five seven-day PDF pages.
- Production shell HTTP 200; unauthenticated data HTTP 401. Actual saved browser
  sign-in succeeded without exposing or changing credentials. Dashboard, canonical
  daily view, monthly empty state and monthly import list were read successfully.
- Cancelled September import remains cancelled. Its original evidence is accessible
  as a preview; the official monthly view correctly says no approved file exists.
- Actual production daily exports downloaded: 209 spreadsheet rows including header/
  metadata/notes, two brand images, no formulas, and a 20-page PDF containing 199
  employee rows. Visual inspection found a daily column-weight count mismatch;
  the narrow follow-up corrects all 16 weights and tests that codes remain intact.

## Security findings and limits

No anonymous security-definer function execution remains after platform hardening.
The 18 RLS-without-policy INFO findings are intentional deny-direct-access tables;
data is exposed only through role-checked RPCs. The 22 authenticated-definer warnings
are the intended application API boundaries, not blanket table access. The platform
event trigger was separately restricted without disabling automatic RLS.

Leaked-password protection remains disabled in the existing Auth configuration;
this release has not changed account policies or claimed complete security.
See [Supabase password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
and [RLS diagnostics](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

NOT VERIFIED: native Excel rendering/print, native browser print, exhaustive keyboard
and confirmation-dialog paths, production HR/VIEWER logins (their guards have isolated
tests), and real production mutations, which are deliberately not test fixtures.
Unknown past assignments/rules still require HR evidence. No payroll or penalty
policy has been inferred.

## Performance evidence

Synthetic local benchmark: 250 people, 7500 person-days, 15000 punches. Baseline parser
median 302.1 ms, current 269.5 ms; preview matching 12.54 s; evidence 0.83 s; calculation
median 0.78 s; filter 1.3 ms; 500-row Excel 0.57 s; Arabic PDF 8.11 s. Only parsing has
a comparable before/after baseline. No production page-load speed claim is made.

Scripts: `scripts/verify-system.mjs`, `scripts/benchmark-system.mjs`,
`scripts/rehearse-rebuild.mjs`; private evidence stays in ignored `outputs/`.

## Final follow-up verification

The daily PDF regression and focused export/read-cutover/platform-grant suite passed
12/12. TypeScript, source-only ESLint and the final build passed. Generated archives
and private outputs are now excluded from source lint/type discovery. The existing
Git runtime's `sh.exe` was verified to be GNU Bash and reused under its expected
name in the ignored task runtime; the original Sites packaging helper then passed.
The following publication uses the normal end-to-end helper again.

Additional authenticated production reads passed for all 231 employees, status
entry, administrative actions, review and daily import. The cancelled monthly file
preview loaded without errors or changing its state. Production downloads remain
private local evidence, not repository artifacts.
