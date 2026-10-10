# FANU HR — proposed production execution plan

Prepared 2026-10-04. **Not executed.** The user's authorization covers local implementation and isolated testing only. Production requires separate explicit execution authorization for the final reviewed commit, backup, migration and deployment. Attendance approvals and employee/device identity decisions are not included in code-deployment authorization.

## Release artifact

- Isolated branch: `codex/hr-audit-repair-2026-10-04`, in `work/audit-repair`.
- New migration only: `supabase/migrations/20261004191207_hr_audit_repair.sql`.
- Deployment anchor to recheck: Sites project `appgprj_6a9af274e9908191a04ba042ed441523`, v23, source `c12f78142273cef209868785f40658014ea95db9`.
- Database anchor: Supabase `fkusqnasptkvpusczxpm`. No production credentials belong in scripts, screenshots, Git or reports.
- No production identities, assignment backfills, attendance import state changes or HR decisions are contained in the migration. Existing evidence receives additive metadata; existing data and history are retained.

## Gates before requesting execution authorization

1. Review the final local commit and evidence report. Recheck Sites deployment/source and the live migration list immediately before execution; compare runtime contents if the deployment changed. Rebase/cherry-pick repair changes onto any newer work and repeat affected tests. Do not deploy the old main branch or overwrite unrelated work.
2. Provision a disposable native PostgreSQL/Supabase test environment using approved tooling, with synthetic data, all 11 baseline migrations, then the repair migration. Run the following two-session cases. This environment was unavailable during this task; PGlite alone cannot close this gate.
3. Restore a fresh encrypted production backup to a separately authorized, access-restricted test database. Validate extensions/roles/functions/RLS, row counts, UUID/internal-code uniqueness, foreign keys, raw evidence hashes, HR decisions and audit ordering. Restore success must be established before production migration; possession of a backup is insufficient. Restore location and access need authorization for the sensitive data.
4. Verify a preview built from the reviewed commit against the migrated isolated database. Repeat browser matching, daily entry-only, missing-history raw view, monthly approved/missing/cancelled/overnight/month-boundary, employee context and Excel/PDF checks. No real business decisions are needed.
5. Confirm a maintenance window, expected read-only UI behavior, backup retention/location, deploy identity and rollback owner. Record the reviewed commit SHA and migration SHA-256 in the execution record. Present this concrete package for the user's explicit production execution authorization.

## Native PostgreSQL concurrency acceptance

Use two independent client connections and synthetic fixtures. Set each session's authenticated JWT/profile identity using the test environment's supported mechanism. Begin explicit transactions; set bounded lock_timeout and statement_timeout. Synchronize at the actual first operation lock, inspect pg_locks in a third read-only connection, then release transaction A. Merely calling Promise.all on one database connection is insufficient.

| Transaction A | Transaction B | Required result |
|---|---|---|
| Resolve identity in monthly preview; hold transaction | Review same import | Serial completion with current evidence or explicit stale/review rejection; no approved snapshot with later-mutated identity. |
| Review/approve source; hold transaction | Legacy base/v2/v3/v4 resolve or reprocess | B waits, then fails because source is closed/stale; raw/identity snapshot unchanged. Repeat for every callable route. |
| Approve reviewed monthly source | Cancel or supersede same source | One valid terminal transition; competing stale request rejected; no two approved conflicting sources. |
| Apply daily source for UUID/date | Apply another source with overlapping UUID/date | At most one applies; duplicate rejected; unrelated dates remain usable. |
| ADMIN daily replacement A→B | Same replacement repeated and opposite-order import operation | No deadlock; one atomic replacement, old raw preserved; retry/stale rejected. |
| Attach explicit next-month boundary | Review target / cancel adjacent source | Sorted import/review locks; attachment contains the verified approved snapshot or clean rejection; no partially written boundary. |
| Resolve same device namespace/code to different UUIDs | Conflicting resolve | Unique constraint/explicit conflict; no silent overwrite. |

Also disconnect a client after server commit but before response, refetch state/version, and retry with the old version. Assert no duplicate effects and unchanged raw/HR evidence. Capture pg_locks, errors, audit events and before/after state, with synthetic data only. Check deadlock and lock-timeout logs rather than assuming lock ordering is sufficient.

## Authorized execution sequence

1. Revalidate all gates and the exact final commit. Put the application in maintenance/read-only mode using an explicitly authorized deployment mechanism; do not change business data to simulate maintenance.
2. Take and verify the fresh database backup (schema, data, roles/privileges and required extension configuration), record restore instructions and preservation digests. Preserve previous application artifact and source. Do not print secrets or export employee data into public artifacts.
3. Apply only migration `20261004191207_hr_audit_repair.sql` using the approved Supabase migration workflow. Inspect the migration plan first; confirm no pending unrelated migrations. The SQL has its own transaction. On an error, stop and investigate; do not mark a failed migration applied manually.
4. Verify migration history, function definitions, constrained search_path/roles, RLS, identity uniqueness, no orphaned relations, equal original raw counts/digests, preserved employee UUIDs/codes and HR/audit records. Additive columns and new audit activity must be evaluated separately from pre-existing row values.
5. Deploy the exact reviewed application commit through Sites. Record new deployment/version/source. Verify actual artifact content rather than assuming branch names imply the right release. Avoid exposing full connector output containing bypass tokens.
6. Run read-only live smoke tests: sign-in/session roles, employee list/detail, daily raw evidence and entry-only layout, historical missing-context explanation, monthly no-approved-source state, source/registry views, report labels and settings/audit access. Use synthetic staging for writes; never approve attendance or confirm real identities as a live smoke test.
7. Recheck preservation totals, API/worker/database errors and response times. Restore normal application access only when checks pass. Record any limitation and the deployed source. Keep mapping proposals and administrative-history decisions pending separate authorization.

## Rollback

The migration is additive but tightens identity/lifecycle semantics. Rolling back only the application can expose an older UI whose mutation requests the database correctly rejects. Therefore the default incident response is maintenance/read-only mode, preservation of all evidence and a forward fix. Do not disable guards to make an older UI accept a write.

If an application-only regression can be safely mitigated, redeploy the preserved v23 artifact/source after verifying its read-only compatibility with the new schema; keep mutation workflows closed until tested. Leave additive columns, registry data, boundary snapshots, triggers and audit history in place. Do not delete applied migration history or drop newly confirmed mappings to pretend rollback succeeded.

If database recovery is necessary, use the verified backup restore procedure during a separately authorized maintenance action, first preserving all legitimate post-backup changes for reconciliation. Never overwrite a live database with the old backup without identifying and reconciling later HR/audit/evidence changes. Restore must recover UUIDs, permanent codes, raw punches, HR decisions and audit records together. A destructive down migration is intentionally not supplied.

## Administrative follow-up, separately authorized

- Reconcile physical device register → explicit namespace. `legacy-unscoped` is unknown, not a universal device. Do not bulk-confirm the 178 name candidates or assume the 176 historical associations are final identities.
- Supply dated administrative evidence for historical assignment and schedule corrections. Review overlap/conflict/version errors; document same-day changes explicitly.
- Keep September's cancelled import cancelled. Any new preview, coverage, source replacement, review or approval needs its own operator decision.
- Review Supabase leaked-password protection and hosted-auth rate limits with the account owner. No production authentication settings were changed here.
