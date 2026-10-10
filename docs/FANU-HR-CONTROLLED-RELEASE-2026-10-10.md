# FANU HR — concrete controlled release for explicit authorization, 2026-10-10

Prepared locally; **NOT EXECUTED**. Production migration, GitHub/source push, Sites version save/publication and paid infrastructure remain unauthorized. Native acceptance passed; real attendance remains on hold until the consolidated onboarding checklist is complete.

Candidate: current local branch codex/hr-acceptance-2026-10-09, audited base/deployed v25 SHA 17dde9a05e48bbaf1ba35dc8b7a3050ed501af66. This is an uncommitted candidate identified by the local source/patch/build SHA-256 manifest. Do not label it as a published Git commit or an existing Sites v26. The source archive, tracked patch, new-file patch and built Worker are reviewable local deliverables. Generated local keys, certificates, native tools, database backups/data, original private files and .env/.dev.vars are excluded from the release package.

After explicit production authorization, execute the following gated sequence:

1. Recheck actual live Sites version/SHA/deployment and production schema/migration/function/ACL drift. Current observations: v25 unchanged; 12 migration history entries through 20261004191207; 38 active mappings/3 scopes; new catalog absent. Use the read-only preflight. A changed target must be reviewed before proceeding.
2. Take a fresh native production backup and validate restoration in an authorized isolated environment, including source/identity/history/HR/audit data, Auth, owners/grants/RLS, code sequence and post-backup change reconciliation. The local native rehearsal validates the procedure; it is not a production backup. Preserve the deployed v25 artifact and the release source/build manifest.
3. Reconcile the existing migration history explicitly. The repo's earlier foundations are already represented in the deployed schema but are not all recorded. **Do not blanket db push / replay old foundation DDL / blindly mark history entries.** Apply only the three reviewed additive migrations in filename order: 20261008230045, 20261010100737, 20261010113948. Each is transactional, with lock_timeout 5s / statement_timeout 60s. Confirm owner access to auth.sessions, required functions/constraint shapes and no conflict before executing. Stop and roll back on timeout/error; do not relax locks or bypass safeguards casually.
4. Record before/after invariants: every existing employee UUID/permanent code, source raw evidence, closed attempt, mapping/reason/alias, assignment, HR decision and audit entry preserved; new catalog entries do not fabricate device proof and coverage defaults remain false. Verify RLS/grants/private helper exposure, current and permitted legacy RPCs, live session binding and schema cache. If this gate fails, stop before app publication.
5. Only then commit/push the approved exact source and save/publish that exact Sites version through the supported connector workflow. Match its commit/source archive and build fingerprint to the reviewed manifest. Preserve audience/settings. No paid branch/resource is needed or authorized by this plan.
6. Keep an operational hold while verifying the actual hosted Worker and managed gateway: login, expired refresh/rotation, logout and immediate revocation, inactive session, ADMIN/HR/VIEWER permissions, CSRF, direct-table denial, current/legacy gateways, existing 195-record September HR report/export conservation, permanent codes, native import review-only path, settings and schema cache. These target checks occur after authorization; isolated Native Next/TLS gateway testing is not represented as prior production execution.
7. Lift only the technical deployment hold after those checks. **Do not automatically confirm real mappings, backdate history/schedules, approve real attendance, or certify missing-entry coverage.** Business operations remain blocked where evidence is missing until the consolidated checklist is signed off.

Failure/recovery:

- Migration transaction failure: stop before publication, verify rollback and preserved invariants, and repair forward against the approved backup/reference.
- Application failure after successful additive migrations: keep the operational hold, preserve the database and restore a verified repaired build or fix forward. **Do not resume unrestricted v25 attendance.** Actual v25 login/read/preview/HR mutation contracts work with the new DB, but its no-entry UI remains unsafe; use it diagnostic-only or behind an independently verified restriction on affected views/actions/exports.
- Do not drop new sources/attempts or recreate old global hash uniqueness after corrective attempts exist. Do not silently restore a stale database over later HR decisions. A full production database restore requires separately authorized recovery, preservation/reconciliation of post-backup changes and code/identity/audit verification.

Native spreadsheet print preview remains a separate NOT TESTED limitation. It does not change core technical integration status.

Approval must identify this concrete candidate and authorize the required production backup/migrations, source push and publication. No approval is inferred from elapsed time or this document.

READY FOR CONTROLLED DEPLOYMENT: YES
READY FOR TRUSTED ATTENDANCE OPERATIONS: NO
