# Evening release candidate: database contracts and release gate

The pending migration is `20261013223509_evening_release_candidate.sql`. It is frozen for candidate verification and has **not been applied to production**. The production project remains `fkusqnasptkvpusczxpm`; only read-only catalog, configuration and fingerprint queries were performed for this candidate.

## Source and migration history

Three Follow-up migrations were already recorded in production but their SQL had previously been delivered outside `supabase/migrations`. The candidate now contains copies reconstructed from their recorded statements:

| Recorded version | Recorded name | Candidate status |
|---|---|---|
| 20261011211438 | department_followup_rebuild | Already applied; archived source only |
| 20261012163301 | department_followup_position_integrity | Already applied; archived source only |
| 20261012173126 | department_followup_http_conflict | Already applied; archived source only |
| 20261013223509 | evening_release_candidate | Pending; apply once only after release authorization |

The archived statements retain their SQL content; only terminal semicolons and trailing whitespace are normalized in the local files. Do not replay them. Do not run an unreviewed blanket `db push`: other early local foundation files also need reconciliation against the complete recorded migration history. The controlled release applies only the reviewed pending candidate migration.

`scripts/assemble-evening-migration.mjs` assembles the head, the captured live `followup_write` core with explicit additive fixes, and the tail. The captured live session, role and retry contracts remain dependencies. Immediately before an authorized release, compare live definitions with `production-contract-verification-2026-10-14.json`; stop for review if they drift. The current three public FU gateway definitions, three FU private helpers and HR live-session helper all matched the captured definitions on 14 October 2026.

## Preserved identities and evidence

The additive migration retains employee UUIDs, permanent codes, original fields, the original code allocator and its immutable-identity trigger. It does not populate invented phones, education, group values, shift assignments or roster verification. Original declaration, revision, final-decision and biometric evidence remain in their original tables. Existing morning evidence remains stored and is excluded from new operational evening queries.

Production currently has 231 employee UUIDs and 231 unique permanent codes with no missing codes. The rechecked UUID/code aggregate is `197318ca2526276672e3342542ebecb06f1d2d6918bf0641c9a556ca3d71704e`, exactly matching the captured identity checkpoint. Its SQL serialization is saved with the verification evidence.

The original checkpoint and a later read-only checkpoint have matching counts for all 17 inventoried tables. The later whole-row digest query has an explicitly saved serialization. The original whole-row serialization was not preserved, so those whole-row hashes are not represented as comparable or as proof that every original value was rechecked. This is a fingerprint inventory, **not a backup or recovery verification**. Production migration preservation is not yet verified because no production migration occurred.

The disposable database preservation test compares every pre-existing fixture field across employees, assignments, declarations, entries, final decisions, revisions and historical source tables before and after the additive migration. It also verifies that historical morning declarations remain stored while evening reads exclude them. This synthetic preservation test passed; it is not a restore of the complete production database.

## Permission matrix

All public gateway calls retain active FU account, active profile and live bound session checks. Anonymous calls and direct client table access remain denied. Private helpers have fixed search paths and revoked client EXECUTE, except the two narrowly scoped storage policy predicates. New public tables have RLS and no direct client grants.

| Operation | ADMIN | FOLLOWUP | SUPERVISOR | VIEWER |
|---|---|---|---|---|
| Evening operational reads | Authorized scope | Assigned dated scope | Assigned dated scope | Assigned dated scope |
| Declaration entry | Authorized scope | Assigned dated scope/on behalf | Own account, assigned dated scope | Denied |
| Review/return/correct | Allowed | Assigned dated scope | Restricted by established contract | Denied |
| General profile edit | Default capability | Default capability | Explicit capability required | Denied |
| Contact/emergency fields read | profile_edit OR sensitive read | profile_edit OR sensitive read | Explicit profile_edit OR sensitive read | Explicit sensitive read |
| Restricted reference read/write | Explicit separate capability | Explicit separate capability | Explicit separate capability | Read only if deliberately granted |
| General document read/write | Default separate capabilities | Default separate capabilities | Explicit capabilities | Explicit read capability only |
| Identity document read/write | Explicit separate capabilities | Explicit separate capabilities | Explicit separate capabilities | Read only if deliberately granted |
| Roster verification/transfer/add | Explicit roster_manage | Explicit roster_manage | Explicit roster_manage | Denied |
| Account/capability/department order administration | Allowed | Denied | Denied | Denied |
| Historical biometric archive | Explicit archive_read; never implied by FU role | Explicit archive_read | Explicit archive_read | Explicit archive_read, read only |
| Personal saved filters | Own only | Own only | Own only | Own only |

Contact/emergency keys and their profile-change history are redacted when contact permission is absent. The restricted reference is redacted without sensitive-read permission. Authorized search includes optional employee number; phone/secondary-phone matches require contact permission, and reference matches require sensitive-read permission. Search never broadens department or evening scope.

Capability creation uses version 0 or an omitted version; edits require the exact existing version. Department ordering uses `department_order` with id, version, display_order and a required reason, retaining department identities and names. Personal saved-view updates/removal use ownership and exact versions; allowing a viewer to save their own filters does not permit business data changes.

## Document lifecycle

`document` creates typed immutable pending metadata, including `upload_request_id`, exact byte size, MIME type, digest, original path, optional thumbnail/crop and optional previous-document identity. Actor/request uniqueness and durable FU retry records bind the request to its exact payload. The uploader may reconcile a pending upload by its metadata; mismatched bytes or metadata are rejected by the HTTP upload route.

`document_activate` requires the original uploader, pending state and exact version. It verifies original/thumbnail storage metadata before activating. Replacing a document archives the previous active version transactionally; original objects, digests and paths are retained. Active and archived objects cannot be overwritten or deleted through client storage policies.

`document_abandon` requires the original uploader, pending state, exact version and a reason. It retains metadata and one attributable business event. Storage DELETE permits only that uploader's abandoned original/thumbnail objects and still requires current write permission and a live session. A cleanup failure leaves recoverable abandoned metadata; `pending_documents` with `include_abandoned: true` returns only the original uploader's authorized pending/abandoned rows. A cleanup retry does not create another abandonment event. An administrator cannot delete someone else's partial upload.

An uploader with write permission alone may read their own pending/abandoned metadata and partial storage bytes for exact retry or cleanup. This does not grant access to active/archived evidence; those states require the separate read capability. A viewer downgrade or revoked write permission also revokes partial-upload recovery.

The HTTP document proxy rechecks live authorization before delivery. Byte/magic/digest checks and signed-grant expiry are HTTP responsibilities, additional to the database metadata policy. The database cannot inspect file bytes in object storage. Hosted Supabase Storage behavior must be verified after an authorized deployment; isolated policy tests do not establish a hosted storage PASS.

## Declaration and reporting semantics

The operational shift is the existing configured evening shift. A verified dated assignment is required for roster entry; no current-field fallback invents an evening assignment. Missing report, unverified assignment, outside roster and future date remain distinct from declared attendance. An absent3 employee counts as one person with weight 3. Personal reporting is filtered server-side by exact UUID. Department order is returned consistently to the shared reporting model.

Offline reporters are independent registry records, not login accounts. Reported-by registry identity, entering actor, actual channel, service date and entered/submitted timestamps remain separate. Unknown on-behalf reported time stays NULL; an explicit after-midnight timestamp retains its actual instant and the selected service date. Legacy reports are not backfilled with invented reported times.

Unknown reported time also remains NULL for an account reporter unless explicitly supplied. Draft/returned save or submit can update explicitly supplied reported time and evidence reference; omitted values retain the saved metadata. Prior revisions capture the old values. New account-channel declarations must identify the actual authenticated reporter. An authorized correction of an existing historical account declaration retains its immutable genuine reporter/channel and records the new revision actor separately. Supervisors cannot revise or reconcile an offline reporter's declaration: the ownership predicate uses `IS DISTINCT FROM`, including a NULL account reporter.

The captured applied core already checked account-channel self-attribution and supervisor ownership before durable retry. The candidate adds an explicit account-attribution rejection and tests genuine historical corrections; these checks are not evidence of an exploitable impersonation or supervisor-ownership flaw in the captured production core.

Unchanged disabled statuses can still be submitted from existing drafts. Renaming/reclassifying/reweighting an existing code returns an explicit conflict, protecting prior meanings. Reviews record full/partial scope and unresolved counts. Existing optimistic version conflicts use PT409; durable retries recheck current authorization before returning the saved result.

## Database findings

| Finding | Database disposition |
|---|---|
| F01 | Explicit role required; unassigned new supervisors rejected. UI deliberate-choice verification is separate. |
| F02 | Archive requires a separate explicit capability; FU ADMIN alone is insufficient. |
| F03 | Independent reporter registry and separate entering/reporting attribution implemented. |
| F06 | Employee/department and responsible-actor scope validated, including action attachments. |
| F07 | Unchanged previously saved disabled status remains usable. |
| F08 | Changed duplicate code meaning is rejected with a clear conflict. |
| F09 | Shared reads use configured department order; audited versioned order updates supported. |
| F10 | Canonical rows retain category and separate absence weight; screen/export arithmetic is verified separately. |
| F11 | Personal position/reporting reads require/use employee UUID filtering; no initial full personal roster fetch. |
| F12 | Applied FU migration statements restored to source history; exact candidate source SHA recorded in main release manifest. |
| F15 | Capability-gated profile enrichment, dated roster maintenance and original allocator-backed employee add implemented. |
| F18 | OPEN business configuration: an authorized administrator must choose the supervisor's real departments. |
| F04/F05/F13/F14/F16/F17 | Client behavior, lint, contrast, URLs and sticky columns: see the main candidate verification. |

Current business configuration remains 6 explicitly evening employees, 225 unassigned shifts (193 active), 231 observed assignments and zero verified assignments. One active supervisor has no department assignment. No assignment was guessed or silently upgraded. Software readiness does not establish business operational readiness.

## Verification and measured limits

Eight disposable PGlite contracts passed, covering preservation, evening/morning separation, unknown/after-midnight reporting times, reporter attribution, retry/version conflicts, disabled-state compatibility, role/storage denials, profile history/search privacy, dated transfers, original allocator, document replacement/abandonment, expiry, capability revocation, ordering and viewer preferences.

The final native PostgreSQL 17 workload used 20 separate client processes, 231 synthetic employees and 12 synthetic departments in the dedicated loopback database. It completed 200 operations: 181 successes, 19 expected stale-version conflicts, zero unexpected failures. Elapsed 10.726 seconds; throughput 18.65 operations/second; successful-operation P50 651 ms and P95 2039 ms. Latency includes process creation, connection, session GUC setup and SQL gateway output. It is **not hosted HTTP login, hosted storage, PDF/XLSX rendering load or production performance**. Evidence: `work/evidence/evening-native-20-user-workload.json`.

A separate actual-Next HTTP test uses a synthetic single-process PGlite/Auth/Storage adapter. Its global peak export observation is retained as a failure: 20 simultaneous full global month export models returned 14 HTTP200 and 6 HTTP503. The other 180 measured operational requests passed with 19 expected conflicts. This adapter serializes SQL and shares a process with TLS acceptance; it is not a hosted or native Supabase capacity measurement. Selected-department HTTP workload evidence is recorded separately. Earlier dev route-manifest churn while build artifacts changed is also recorded separately; it must not be counted as a passing run.

The final clean HTTP run used the actual built Vinext Worker artifact through the official Vinext Node production preview, a bounded Windows static-asset adapter, and a Cloudflare workers environment stub. Dynamic API requests ran through the official Node engine, using the synthetic SQL/Auth/Storage adapter. All ten functional groups passed, including session refresh/revocation, CSRF, restricted-field privacy, uploads, signed proxy delivery, interrupted-upload recovery, immutable archived originals, metadata-free photo thumbnails, forged content/digest denial, typed reporter timestamps and write-only upload recovery.

The final 20-user HTTP workload completed 200 measured operations: 181 HTTP200, 19 expected HTTP409 conflicts and zero unexpected failures. Elapsed 10.591 seconds; throughput 18.88 operations/second; successful-operation P50 284 ms and P95 3009 ms. All 20 parallel full selected-department month models returned HTTP200 (phase P95 4627 ms). Separate full global evening and exact-UUID personal models also passed. These measurements do not exercise PDF/XLSX browser rendering, native Worker execution, hosted Auth/Storage or production capacity. Evidence: `work/evidence/candidate-http-20-user-workload.json` and `candidate-http-functional.json`.

An initial production-preview test completed the same 200 measured operations but failed in its cleanup assertion because the harness assumed the applied account write returned a version. That contract returns `{ok:true}`; the final harness rereads the authoritative version before restoring the account. Its failed result is retained as `candidate-http-harness-assumption-failure.json`, separately from the final passing run. Earlier Next development artifact failures and the global export peak limit remain in the evidence; no failed attempt is counted as a pass.

## Controlled release and rollback

1. Freeze and verify the candidate source/artifact/migration hashes. Recheck live schema, function definitions, migration history, grants, storage bucket/policies and business configuration for drift.
2. Obtain production execution authorization. Capture a fresh consistent production checkpoint and a recoverable backup covering all affected data, schema and ACLs; restore and verify it in isolation. Compare original fields/identities/history independently from permitted additive values. The read-only fingerprints above do not satisfy this recovery gate.
3. Apply only the reviewed pending migration once. Check atomic completion, authenticated gateway grants, revoked helper/table grants, the private bucket configuration and the exact pending migration history record.
4. Deploy the matching frozen candidate to the existing project, then verify authenticated hosted role denial, session revocation, storage upload/read/recovery, full authorized exports and preservation against that fresh checkpoint.
5. An authorized administrator assigns actual supervisor departments, verifies actual dated evening assignments and reviews the necessary business settings. Do not manufacture attendance to demonstrate readiness.

On a migration error the transaction rolls back its schema changes. On application failure, use maintenance/closed-write mode or a verified compatible application rollback while retaining the current restricted gateway. Do not reopen retired HR routes or restore broad archive privileges. Keep new profile columns, documents, original/archived files, reporter attributions, communications, actions, revisions and audit records. Do not drop new tables or restore an old database over valid later user work. Recovery of production backup/auth/storage has not been rehearsed for this candidate and remains a release prerequisite.
