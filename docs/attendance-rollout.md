# Attendance V2/V3 rollout boundary

The attendance-core migration performs a one-time historical backfill. The
separate `attendance_rollout_compatibility` migration protects imports created
afterward without rewriting the original shared migration.

- Every newly inserted monthly import receives a **preview**, not a reviewed or
  approved decision. Legacy cancellation cancels a pending review too.
- A deferred database constraint trigger rejects an applied monthly import at
  transaction commit unless its review is explicitly approved. This covers V1,
  V2, V3 and direct writes, not only the currently deployed application's caller.
- Existing V3 approval/supersession changes both records atomically and passes
  the deferred check. Existing historical superseded imports are not rewritten.
- Legacy clients can upload monthly previews; their old Apply action returns
  an Arabic instruction to use the review/approval screen. No upload is dropped
  and no approval is inferred. Daily V2 operations continue unchanged.
- Missing review records for already-applied imports cause migration failure,
  requiring explicit reconciliation; they are never silently approved.

Production rollout applies the original core and compatibility migration in one
transaction, with a bounded lock on attendance_imports acquired before the
baseline snapshot. This drains earlier import writes and prevents an import
from slipping between the backfill and trigger installation. Readers continue;
new import writes may briefly wait for the normal database migration lock.
Only these two executed versions are recorded in the Supabase migration ledger;
older migrations are not replayed or falsely marked applied.

An application rollback may redeploy saved Sites version 13 without restoring
the database. Daily operations remain available. Monthly uploads remain pending
and require the compatible V3 application for review/approval. Do not remove the
approval guard, restore over production, or retry uncertain migrations blindly.

Local synthetic regressions: `node --test tests/attendance-rollout.test.mjs`.
They cover V2 previews after backfill, explicit V3 approval, legacy apply refusal,
duplicate imports, cancellation, daily coexistence, RLS and role permissions.

## Monthly fingerprint row identity and assignment semantics

The additional `monthly_fingerprint_employee_rows` migration replaces only the
read RPC. Applied migrations and attendance computation remain unchanged.
The matrix aggregates daily cells by employee UUID only; same-name employees
remain distinct. Its month-end session supplies display metadata, including the
direct manager override or the department rule effective at month-end. Manager
filters use that same manager ID and include the employee's **whole month**,
not only days under that manager. Daily calculation still uses each day's rule.

The schema stores current employee department/direct-manager assignments, not
a dated employee-transfer ledger. Department display/filtering therefore use
the current employee department, including when viewing a past month. No past
department assignment is invented or business history rewritten. Effective-dated
department rules remain intact. A changed assignment does not split identity.

UI, Excel, PDF and print share the same filtered rows and formatted values,
including the month-end manager column. The report contains active employees as
before. Monthly punches still require explicit approved monthly imports and
never consume daily imports. Regression tests compare every daily cell and
summed duration against attendance_session, across manager and department changes.
