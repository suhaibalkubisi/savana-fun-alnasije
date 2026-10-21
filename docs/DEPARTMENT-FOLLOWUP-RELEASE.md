# Department Follow-up rebuild

Existing Site: `appgprj_6a9af274e9908191a04ba042ed441523`.
Baseline deployed source: `087bb98e74aae6c0b09a1f55b6a9e2c579c9742d` (v30), verified from Sites and by opening its current remote repository. Branch: `codex/department-followup-rebuild-2026-10-11`.

The operational application now uses supervisor declarations, revisions, scoped memberships, review and follow-up actions. Employee UUIDs remain the identity. No fingerprint import, identity approval or biometric device evidence participates in declaration entry. Historical biometric data stays in its original tables and can be read only through the administrator archive. Legacy operational routes return 410; legacy RPC and table grants are revoked at cutover.

## Preservation and release gate

231 employee records, every UUID, permanent FANU code and existing field were captured. Their ordered JSON SHA256 is `a350fc699874b74af6725f23f482797e36f0a7d4fbd256727307c47d3f61ebbf`.

The current production backup was captured from one repeatable-read snapshot, native custom format, fully decoded and checked. Backup SHA256: `60b6a587f75b1009104cbcb29985ec3e7518558116a9f1187321784ba4540c2f`. Its exact public/hr_private schema, constraints, triggers and all 21 public tables were restored locally. The rebuild migration preserved every pre-existing public-table row and all employee fields in this rehearsal. Platform auth/storage/vault restoration was not rehearsed on the vanilla Windows PostgreSQL instance.

`supabase/followup-rebuild.sql` is additive except for narrowing existing privileges. It does not alter employee columns, constraints, values or biometric history. Only existing active legacy administrators bootstrap as Follow-up administrators. Existing HR accounts remain unassigned until an authorized administrator chooses their new role and departments.

Before production cutover, verify current employee and historical-table fingerprints, capture exact affected ACLs, then apply the reviewed migration once. Publish the matching saved version on the same Site. If publication fails, restore the captured legacy ACLs and redeploy v30. Keep new Follow-up tables and revisions intact; do not delete newly entered declarations. New accounts introduced after cutover must remain disabled in a legacy recovery so they cannot inherit old broad Viewer access. Prefer the reversible ACL/application recovery to restoring unrelated employee or historical data.

## Verification evidence

Tests use separate native PostgreSQL and disposable PGlite databases, synthetic actors and synthetic employees. The source includes lifecycle, transfer-conflict/reconciliation, configured-state, session-revocation, idempotency and concurrency tests. The actual local Next routes were tested against official GoTrue/PostgREST and native PostgreSQL.

Twenty authenticated synthetic users simultaneously submitted twenty different department/day declarations through the local application with a 20-employee roster: 20 successes, zero failures, zero duplicates, 400 final rows. Final run after live-session hardening: median 3,098 ms; P95 3,258 ms; maximum 3,269 ms. A separate 20-connection database test measured parallel retries and stale edits: one idempotent submission result, one winning edit, 19 expected stale-version rejections, zero unexpected failures.

The deployed v31 on the existing production Site was also measured with 20 authenticated synthetic users, an isolated department and two synthetic employees: 20 requests, 20 successes, zero failures, zero duplicates, 20 reports and 40 entries. Median latency was 1,740 ms; P95 1,801 ms; maximum 2,336 ms. No real attendance was submitted. This hosted measurement uses a smaller roster than the native test and does not establish latency for every production department size.

## Verified v32 source integrity

`tests/followup-release-integrity.test.mjs` adds nine independent disposable-database regressions. All nine passed; the combined run with `followup.test.mjs` and `followup-exceptions.test.mjs` passed all 12 executed tests. The verified cases cover:

- Cached retries recheck current department membership, write role, active account and live session. A department removal, Viewer downgrade, inactive account or deleted session denies replay without changing persisted records.
- A role downgrade also denies cached review, administrator configuration, another supervisor's report and an action assigned to another person. Remaining read permission does not grant modification permission.
- Existing report, action and account updates require current versions. Missing, null and stale versions fail; rejected report submissions roll back entries, revisions and retry records.
- Drafts and returned reports remain unresolved in the consolidated final position. Submitted and reviewed declarations contribute declared attendance. The fixture reconciles 20 expected people as 15 present + 3 absent + 1 leave + 1 unresolved; absence headcount stays 3 and weighted absence is 5. Returning or revising removes final statuses while retaining declaration entries and revision history.
- A dated outgoing transfer blocks submission until roster reconciliation. Reconciliation retains previous snapshots, preserves retained employee identities and allows one final row per employee after the receiving department submits. An incoming employee omitted from a submitted snapshot appears unresolved with a visible exception.
- An explicit null shift in a dated assignment remains null; the current employee shift is used only when no assignment covers that day.
- Supervisors can update progress, notes and completion details for their assigned actions. Changes to responsibility or description are denied; chronological activity includes actor names.

Actual daily Excel and PDF downloads were inspected for complete employee codes and totals. Arabic PDF shaping and Latin code direction were visually checked and repaired. Browser print preview was not verified in this release audit. Further release evidence must distinguish local verification from authenticated production verification.

## Optimistic conflict transport

Deterministic stale or missing versions in Follow-up writes use SQLSTATE `PT409`, which PostgREST maps directly to HTTP 409. Custom `40001` exceptions can cause transaction retry loops in PostgREST 14; Supabase recommends the `PT` prefix for explicit HTTP status codes. The server maps `PT409` to 409 while retaining 409 handling for genuine or legacy `40001` responses. See the [Supabase RPC retry advisory](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b).

`tests/followup-conflict-transport.test.mjs` exercises the real transpiled `rpc()` and `errorResponse()` with mocked HTTP responses: `PT409` and `40001` return API 409, and conflict, upstream failure and lost-response paths make exactly one RPC request. These are local transport regressions and do not establish production deployment or hosted latency for a later version.

## Typography and brands

The v30 login department title was live text, inherited `Cairo` from `workspace-shell.css`, at weight 750. The rebuilt title uses that exact family and weight. PDF title embedding uses a static instance at 750 generated from the original Cairo variable font; ordinary PDF text uses the established FANUArabic font. The original FANU/ZMC and SAVANA files and crop rectangles are retained byte-for-byte. Historical title/header artwork stays in source history and is not used by the active product.

## First declaration

1. Assign the supervisor's role and departments in Settings, then sign in as that supervisor.
2. Open تصريح القسم, select department/date/shift and load the roster; review names, set statuses and exceptions, or save a draft.
3. Check the counts and unresolved employees, then submit to Follow-up review.

