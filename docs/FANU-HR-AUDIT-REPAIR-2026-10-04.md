# FANU HR repair — local implementation and evidence

Date: 2026-10-04. Branch: `codex/hr-audit-repair-2026-10-04` in `work/audit-repair`.

This implements the supplied audit and its full implementation prompt. Production was read only. There was no deployment, migration, identity confirmation, attendance approval, cancellation, HR edit or authentication-setting change in production. Synthetic write/approval tests were confined to the isolated local database.

## Release provenance and preservation

Sites version 23 was rechecked: source `c12f78142273cef209868785f40658014ea95db9`, successful deployment `appgdep_6abe273a58c08191847eb8075acda7b8`. The exact source is present at `work/rebuild-site`. The user's original checkout was clean at `1d4c0990ae57442f0f36806cc31338e9b794cdd6` on `codex/attendance-rollout-compatibility`; it was cloned locally, not reset to old main.

Comparison of 126 tracked runtime/source/config/dependency/migration files, normalizing only line endings, found equivalent content; the local checkout additionally contained `supabase/seed.example.sql`. Evidence: `outputs/repair/provenance-comparison.json`. Remote branch freshness was not established: this installation's Git HTTP helper was unavailable. Deployed content, rather than an assumed main branch, was the verified implementation base.

Read-only production checks before and after work returned identical counts and ordered-row digests:

| Entity | Rows | Digest |
|---|---:|---|
| Employees | 231 | 02d21a44964d86df2fdfc84cabf74c39 |
| Raw source rows | 12,266 | d13def58074558ecd85072a4d7389fe1 |
| Confirmed fingerprint identities | 0 | d41d8cd98f00b204e9800998ecf8427e |
| Imports | 30 | 8248d5209b051db0a5f24acdbecf7605 |
| HR records | 345 | 46837a7f496dd3c3ba8709db60e07877 |
| Audit records | 12,305 | 1690555c07e24d58286435156ac0daa1 |
| Assignment records | 231 | 69e14bb5d5597eaaab77920010763e30 |

Evidence files `production-before.json` and `production-after.json` are local and ignored by Git. Original logo assets and previous migrations were not edited. The additive upgrade test compares every pre-existing column of eight tables before/after the migration, including identities, HR decisions, assignments and audit history. The local PGlite backup was restored into another PGlite instance and raw evidence compared. This is not a native PostgreSQL or production backup-restore test.

## Prioritized evidence ledger

O = observed in browser/database; S = static source finding. Audit observations are identified as such; hypotheses are not counted as confirmed defects.

| ID / severity | Evidence and reproduction | Expected / actual; root cause | Repair and meaningful verification | Residual limitation |
|---|---|---|---|---|
| F02 / P0 | O: reproduce old matching dialog locally, click candidate | UUID and label should remain; old popup selection returned blank. Shared Base UI popup was portaled outside the Radix modal's interaction boundary. | Place popup portal in the picker's local container; explicit accessibility labels. Browser tested mouse, keyboard, search, clear, close/reopen, refresh, stale rejection and successful explicit save. Manager and HR status pickers tested. | Real production save intentionally not exercised. |
| F01 / P1 | O: production latest daily preview has 184 unresolved rows and zero registry entries; S: name candidates deliberately not auto-confirmed | Previous evidence should help review and explicit decisions persist; HR reference is not a device identifier. | Namespaced confirmed mapping, reason/source provenance, original-name aliases, conflict and inactivity checks, read-only candidate proposal and employee registry. Isolated tests cover name-only, unknown, conflict, reused code, distinct devices and rename. | Physical device namespaces and 184 real identities require human evidence; no proposal was applied. |
| F03 / P1 | O/S: old daily UI required monthly-style exit/session interpretation | DAILY must show entry without exit or duration. | Dedicated documented entry-window calculation, daily-only source scope, 13-column export, raw drilldown. Tests retain previous-shift 01:30 evidence but select 16:40 entry with 40 minutes lateness and no exit dependency. | Without a documented historical assignment/schedule the raw evidence remains visible, but entry/lateness is uncalculable. |
| F04 / P1 | O: production assignments start Oct 1; audit September report hides usable timestamps behind missing history | Missing administrative evidence must not erase device evidence. | Explicit missing-history state and raw dialog; dated employee assignment workflow with reason, overlap and version checks. Tests cover joins, transfer, resignation, inactivity, reactivation, same-day uncertainty and explicit correction. | No September assignments/schedules were invented. Existing capture semantics start observations tomorrow and leave a changed day unresolved until documented correction. |
| F05 / P1 | O: only production September monthly import is cancelled, with no approved source | Empty official report is expected. | Cancelled history stays intact. MONTHLY uses UUID, entry/exit +1, distinct missing states and null missing hours. Explicit adjacent-month snapshot accepts only approved next-month evidence in the same device namespace; never auto-borrows another shift. | Real cancelled file remains cancelled. New preview, coverage, mapping and approval are separate future business actions. |
| F06 / P1 | S: legacy RPC definitions allowed identity edits after review; O: synthetic repro/test | Every callable path must enforce lifecycle. | Common import/review lock order, raw immutable guards, preview-only identity writes, role/version checks, immutable approval context; old RPC routes tested against closed sources. | Two independent PostgreSQL sessions were unavailable. True concurrent review/resolve/approve/deadlock testing remains a release gate. |
| F07 / P2 | O/S: optional shift/manager empty; employee and department manager meanings differ | Optional data must not falsely block identity; effective fallback must be clear. | Add optional phone, emergency phone, education; preserve UUID/code; daily effective department-manager fallback; current vs historical context and administrative reference labels. Browser saved synthetic phone/manager with same UUID/code. | Production missing fields were not populated. |
| F08 / P2 | S: merge/delete contradicted permanent-identity trigger | Preserve identity and history rather than delete source employee. | Explicit database denial of merge/permanent-delete, retained identity protection; deactivation remains the supported path. Tests verify denial. | No history-moving merge is provided. |
| F09 / P2 | O: applied daily imports have open issues | Partial inclusion must be visible and traceable. | Applied matched/unresolved counts, raw unresolved evidence, daily-specific explanation; explicit ADMIN daily replacement preserves old source/HR/audit and rejects duplicate/retried stale operation. | Legacy partial approvals are not rewritten. |
| F10 / P2 | S: comprehensive report aggregates manual HR, not device evidence | Distinct decisions and evidence with connected employee/month/source navigation. | Report source/organization-scope explanation, contextual employee links, employee daily and monthly evidence, monthly source version/calculation basis and frozen approval context. Population/export tests use UUID; historical filter contract is stated below. | Comprehensive HR filters still use current organization, explicitly labelled; fingerprint filters use documented period context. |
| F11 / P3 | O: long history and mismatched labels/copy | Focused Arabic daily/monthly tasks and accessible exceptions | Collapsible file history, evidence-based candidate states, shorter entry-only table, context-appropriate copy, branded exports; original RTL/assets/creator credit preserved. Desktop/mobile screenshots captured. | This is a workflow repair, not a claimed redesign of every administrative screen. Broad page smoke coverage is recorded separately. |

## Data and calculation contracts

- Employee UUID is the relational key. Internal FANU code, optional administrative reference and device person code are distinct. Registry uniqueness is `(device_namespace, person_code)`.
- Existing imports/identities receive `legacy-unscoped` as an explicit unknown namespace. It is not evidence of a shared physical device. New imports require a namespace. Registry entries do not silently transfer between namespaces. Code reuse/conflicting identities requires separate documented resolution, not overwriting an employee's history.
- Known-name and historical matches are proposals. Explicit confirmation needs an employee and reason. A name-only candidate never auto-confirms. Inactive employees are not silently auto-matched. Renaming an employee preserves UUID and confirmed source-name aliases.
- DAILY selects an eligible entry within the documented daily entry window. All calendar raw punches remain accessible. No exit, duration or next-day file is required. No fingerprint condition creates an HR absence.
- New daily applies freeze assignments/rules/managers. Old daily applies have no invented snapshot and disclose their evidence basis. MONTHLY approvals retain their saved calculation context. A later organization/rule edit does not rewrite the approved interpretation.
- Monthly rows use employee UUID once (the matrix renders separate entry/exit movements). Missing duration is null/emdash, not zero. Coverage and future exclusions are explicit. Filters group by documented assignment at the end of the displayed month/current as-of date; each day's calculation uses that day's assignment.
- Comprehensive manual HR reports filter by current organization and explicitly say so. Drilldowns retain employee and month, and monthly links retain import source where provided.

## Tests and their exact scope

Full regression run: **163 passed, 0 failed** (`outputs/repair/regression-final.log`). After final provenance/HR-picker changes: **29 targeted calculation/export tests passed**, and **6 repair database tests passed**, including the newly added join/reactivation test. These are overlapping runs, not 198 distinct tests. Final typecheck, lint and production build passed. Build emitted its existing route-classification limitation; no deployment followed.

Database tests execute PostgreSQL through PGlite, with all current migrations and disposable fixtures. They test authenticated ADMIN/HR/VIEWER, inactive and anonymous denial; legacy/current RPCs; immutable raw data; frozen contexts; version/retry rejection; partial daily inclusion; review, approval, replacement and cancellation. Three historical compatibility suites intentionally stop before the new migration to test the old contract; they are not evidence of current behavior. Current repair/workflow suites apply the full migration chain. Promise-based duplicate calls in a single PGlite instance are not independent-session concurrency proof.

Browser evidence (synthetic localhost, no production credentials): baseline failure reproduced, fixed matching dialog mouse/keyboard/search/clear/reopen/refresh/stale/save; employee manager selection and optional phone save; HR status permanent-code search and stable selected UUID; daily filtered entry/raw drilldown; export disabled during filter debounce; monthly approved/absent-source views, +1, partial coverage, raw detail and responsive 390px view. Native browser download-event receipt was unavailable; the test-only harness retained the identical generated Blob bytes while leaving the normal download click intact.

Final page smoke checks additionally covered dashboard, employee list/detail, daily status, daily/monthly upload workspaces, daily/monthly dashboards, administrative actions, reports, organization, schedules, users and audit at mobile width; desktop checks cover the principal repaired workflows and administration pages. Recorded document widths had no page-level horizontal overflow; wide matrices scroll inside their own regions. This is rendering/navigation coverage, not a claim that every administrative mutation or every filter combination was browser-tested. JSON records: `browser-page-smoke.json`, `browser-mobile-smoke.json`, `browser-fingerprint-mobile-smoke.json`. Screenshots are listed in `outputs/repair/evidence-gallery.md`.

Original files were available and freshly hashed and compared with two independent parsers (application SheetJS and Python xlrd), including every source coordinate, person code/name, raw cell and parsed minute:

| Original | SHA-256 | Fresh comparison |
|---|---|---|
| Punch+Record (30).xls | 8a1be5048ae75f65216cdbaecf78f8bbed538d68b2427dccd2e8ef25d221083d | 184 identities/rows; 368 raw time tokens; 308 distinct parsed minutes |
| Punch+Record (11).xls | f3c53cbe99d7cdd02725959e2f254d7d51fb4fd81b4332327073e0ad7834d7ec | 215 identities; 6,450 person/day cells; 4,318 populated; 7,416 punches |

Evidence: `original-parser-summary.json`, `original-independent-comparison.json` and private parsed files. Original files were not modified or reimported into production. One local parse sample was approximately 29.5ms daily / 70ms monthly; this is not a performance improvement claim or production latency benchmark. No speculative index removals/additions were made.

Actual browser Excel/PDF samples are in `outputs/repair/browser-exports`. Independent openpyxl checks compared all 13 daily body cells and 78 monthly body cells, dates, UUID-derived row population, missing values and totals. Monthly durations reconcile to 565 + 560 = 1,125 minutes. Both logos in Excel match original asset bytes. PDF checks verified identity/dates/totals/embedded font, rendered all six pages, and visually checked Arabic shaping, +1 markers, legibility, repeated headers and page layout. Monthly is five pages; daily is one. The monthly expected body comes from the shared matrix contract, with the fixture's times/totals also independently checked. See `export-inspection.json` and rendered page PNGs. Samples contain synthetic names only.

Security scope: RLS remains enabled and direct grants are not relaxed. New SECURITY DEFINER entry points use constrained search_path and explicit role checks; browser/API and isolated role tests supplement existing transport/auth tests. Production leaked-password protection remains unchanged; a full hosted-auth penetration/rate-limit exercise was not performed. Native concurrent load and query-plan performance benchmarks remain unverified.

## Acceptance status

| Area | Status | Evidence / boundary |
|---|---|---|
| DAILY ENTRY WORKFLOW | PASS | Isolated entry-window tests; browser entry/raw/filter/export; no exit requirement. |
| IDENTITY REVIEW | PASS | Browser regression fixed; explicit persisted namespaced decisions and conflict tests; private 184-row proposal prepared, not applied. |
| HISTORICAL EVIDENCE | PASS | Raw remains visible; dated corrections/joins/transfers/reactivation and frozen context tests. Real administrative gaps remain unresolved. |
| MONTHLY CALCULATION | PASS | Overnight/month boundary/missing/coverage/source isolation and stable approved-context tests; synthetic browser/export reconciliation. |
| LIFECYCLE SECURITY | NOT VERIFIED | Local role/guard/legacy/version/retry tests PASS; independent-session races and production-like restore still required. |
| EXPORTS | PASS | Actual generated daily/monthly Excel/PDF inspected; all fixture cells and monthly pagination checked. Native Save-As receipt not verified. |
| SOURCE PROVENANCE | PASS | Current deployed v23 content compared to preserved local base. Latest remote branch fetch not verified. |
| PRODUCTION CHANGES | PASS | None performed; read-only before/after preservation evidence matches. |

## Unresolved real-data decisions

The private mapping proposal contains 184 source rows, 178 unique name candidates and 176 previous same-code/name associations. These counts are evidence, not authorization. Verify the physical device namespace, register identity, renamed/reused codes and service dates before any confirmation. Six rows have no unique name candidate. Do not publish the private proposal or raw HR artifacts.

Obtain authoritative September assignments and effective schedules (including drivers/administration) before historical calculations can be complete. Decide documented source coverage separately. Keep the cancelled September monthly source intact; a new preview and eventual approval require explicit business authorization. Code-deployment approval never authorizes those decisions.

See `FANU-HR-PRODUCTION-ROLLOUT-2026-10-04.md` for concrete execution gates, backup/restore, race-test cases and rollback.
