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
