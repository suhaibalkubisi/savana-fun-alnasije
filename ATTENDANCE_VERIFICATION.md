# Attendance upgrade — 2026-09-08

Existing Site and production Supabase project retained. No employee reimport,
history reset, auth changes, or existing policy changes were performed.

## Applied production migrations

- 202609080001_attendance_foundation.sql
- 202609080002_attendance_operations.sql

Both completed successfully in the original savanna-hr SQL editor. The six
new tables use RLS and deny direct anonymous/authenticated table access.
New security-definer RPCs validate active ADMIN/HR/VIEWER roles through the
existing role checker. Department-rule mutations are ADMIN-only.

## Before/after original-data verification

| Table | Rows | MD5 of ordered original records, unchanged |
|---|---:|---|
| employees | 206 | 2735f5341df3d2ba7930851b343e4a40 |
| hr_status_records, including soft deleted | 75 | b81e01d7983d8109e57ca77cf7660845 |
| profiles | 2 | 49f5f32d3d6a229de3ec3031d3fab0fd |
| departments | 10 | 21c0d774bf7876f1cf0dc03283f88195 |

## Verification performed

- 43 automated tests passed: existing HR operations and security, exports,
  fingerprint preview/apply, idempotency, role protection, calendar parsing,
  manual override, and cross-midnight entry/exit separation.
- TypeScript and lint passed.
- Production build passed; parser is loaded on demand.
- Supplied monthly BIFF XLS parsed fully: 6,840 employee-day rows, 30 dates,
  zero invalid time cells. Supplied daily BIFF XLS: 183 rows, zero invalid time
  cells. These files have NOT been imported into production by this upgrade.
- The login page renders with the original branding and real Supabase public
  configuration. No secret key was copied into the preview or browser.

## Pending before production publication

- Authenticated browser QA of new routes, real import review/apply, mobile and
  print/export appearance. Requires secure login to the QA browser.
- Operational department schedules must be confirmed by HR; no actual shift
  start/grace times were invented or written to production.
- New source has not yet been deployed; the previous live release is preserved.

Daily classification never creates absence from a missing entry punch. A manual
HR exception takes precedence. Missing department schedules remain explicitly
unclassified. Original monthly exception reports retain their existing manual
exception calculations; attendance dashboards are separate derived views.
