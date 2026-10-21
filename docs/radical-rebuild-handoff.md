# Product rebuild — acceptance, 1 October 2026

The original request is a full product rebuild with acceptance against both supplied XLSX files. This file supplements, not replaces, the previous handoff.

## Verified baseline

- Clean GitHub checkout. Existing Sites checkout in `work/rebuild-site` at source `76cb7b05a600b9135ff1f5ca92195651676aa62f`.
- Live Sites version 21 and Supabase `savanna-hr` / `fkusqnasptkvpusczxpm` confirmed through read-only tools; 11 applied migrations match the prior handoff.
- Daily attachment `(26).xlsx`: actual OpenXML, 197 × 9 including header, September 30, 2026, calendar-day first/last summaries without direction.
- Monthly attachment `(27).xlsx`: actual OpenXML, 213 × 32 including header, September 1–30 headers without year. Explicit selected year required.
- Production has one monthly file, an older `(11).xls`, cancelled, 215 source identities. 207 matched, 8 unmatched; 240 unmatched person/day rows. No approved monthly file.
- All 231 employee history records begin October 1, 2026. September calculations therefore correctly lack historical assignment evidence. Existing rules begin September 8–9.
- These are separate causes: cancelled lifecycle, unresolved identities, missing historical context. Blanketing all three as review creates a product dead end.
- No production attendance approved, no imports created, no employee identity decisions made during this task.

## Completed implementation and acceptance

| Previous gap | Implemented behavior | Verification | Remaining limitation |
|---|---|---|---|
| Overlapping navigation | Stable primary work tasks; daily/monthly distinct; secondary reports and settings grouped | Before/after browser views | Existing permission gates retained |
| Generic dashboard | Work queue, scoped today HR decisions, latest imports, selected-month approved evidence, recent HR decisions | Isolated browser and API tests | Unapproved month is unavailable, not zero attendance |
| Review hides valid evidence | Four stages, raw calendar view, separate calculated view, explicit save | Both original files opened in browser; complete reconciliation | Identity/history decisions remain human |
| Daily first/last ambiguity | Calendar evidence and adjacent-day warning, counts, source export, approved-day link | Original 196-identity workbook | No fabricated next-day exit |
| Generic monthly blockers | Causes grouped by person/date with next actions and embedded identity review | Saved real-file local preview | Missing September history not guessed |
| Review versus approval unclear | Separate confirmations; disabled blockers; existing atomic server enforcement | Role, lifecycle, stale revision, concurrency and rollback tests | No production approval performed |
| Employee context | Identity card, permanent code separate from device reference, dated history, attendance tab, source-device tab | Isolated directory/profile browser | Device tab covers selected approved monthly source, not a global registry |
| Large matrices | Twenty identities per browser page, sticky columns/headers, horizontal scrolling; exports retain full filtered scope | Browser and typecheck | No controlled production latency comparison |
| Manual HR safeguards | Absence, ×2, ×3, leave, late minutes, auditing, dirty form and conflict rules retained | Isolated database/validation suite | No monetary deductions inferred |
| Reports/exports | Shared month, separate HR/fingerprint sources; Arabic branded exports; paired entry/exit PDF pagination | Actual files independently reopened and rendered | Full calendar audit PDF is large |
| Recovery/security | Inline errors/retry, readback, loading/empty states; existing session/RLS/RPC restrictions retained | 158-test suite | Not a new independent penetration test |

### Source reconciliation

Independent Python/openpyxl inspection covered every relevant cell. Application parsing was compared against that oracle for identities, calendar dates, minutes and original cell strings. Raw whitespace is now retained separately from normalization. Both originals remain untouched; all private outputs remain ignored under `outputs/radical/`.

| Property | Daily `(26).xlsx` | Monthly `(27).xlsx` |
|---|---|---|
| Format / sheet | OpenXML / Punch Record | OpenXML / Punch Record |
| Dimensions | A1:I197 | A1:AF213 |
| Layout | Calendar-day first/last summaries | Person × calendar-day matrix |
| Date coverage | 2026-09-30 | 09-01 through 09-30, no year |
| Identities | 196 | 212 |
| Calendar cells | 196 | 6,360 |
| Populated cells | 196 | 5,718 |
| Raw time values | 392 | 10,079 |
| Unique minute values | 371 | 10,079 |
| Duplicate minute values | 21 | 0 |
| Invalid values | 0 | 0 |
| Empty cells | 0 | 642 |
| Single distinct punch cells | 21 | 1,552 |
| Cells with more than two times | 0 | 181 |

Neither file declares entry/exit direction. Device codes are not permanent employee identifiers. The monthly year was explicitly selected as 2026 for acceptance; that year is not recoverable from its headers. Daily totals are not treated as paid work hours.

SHA-256 daily: `0d29e80d95e7678500205758721facdd33aa78160cb32c03caf3c96f2741540b`.

SHA-256 monthly: `5b430fc8c888dfe15c21669d1ef14d81827cac96b1582f81cf19871c82cdb086`.

Reproduction: `scripts/inspect-punch-sources.py`, `scripts/reconcile-punch-sources.mjs`, `scripts/real-file-calculation-check.mjs`. Private evidence: `source-inspection.private.json`, `reconciliation.json`, `calculation-acceptance.json`.

### Independent calculation contract

An independent implementation checked every one of the 6,360 person/workday cases using an explicit **TEST ONLY noon-to-next-noon window**, synthetic employee IDs, 16:00 start and 15-minute grace. It found 4,760 complete shifts, including 4,703 overnight, 235 single-punch windows, 1,345 empty windows, 178 with more than two eligible punches, and 117 unassigned first-boundary punches. All 10,079 raw punches remained preserved. These are test-window outcomes, **not official September employee attendance**.

Without assignment history, results stayed explicitly unresolved. Fixtures also cover September 12 15:25 → September 13 01:10, one punch not serving as both entry and exit, missing adjacent-day/month evidence, month/year boundaries, future dates and leap years. Observed span is distinct from paid hours.

### Tests, timings and actual exports

- Final isolated suite: **158 passed, 0 failed**, 345.6 seconds; `outputs/radical/final-tests.log`. Includes ADMIN/HR/VIEWER API/database restrictions, source isolation, repeat upload, persistence, stale revisions, atomic approval, replacement, cancellation and rollback.
- Full ESLint and TypeScript checks passed; small subsequent UI additions received targeted rechecks.
- Parser timings in one recorded run: 97 ms daily, 225 ms monthly; independent full test-window calculation 564 ms. Isolated preview writes: 0.84 s daily, 14.13 s monthly. These are local observations, not production performance guarantees.
- Generated real-source Excel/PDF via `scripts/verify-real-file-exports.mjs`, independently reopened/rendered with `scripts/inspect-acceptance-exports.py`.
- Excel: 196 daily rows, 6,360 monthly source rows, 424 test-matrix entry/exit rows. RTL, frozen panes, filters, two embedded original logos, text-safe values and full row counts passed.
- PDF: 16 daily source pages, 491 full monthly audit-list pages, 132 test-matrix pages in seven-day sections. First/middle/last pages rendered; sampled Arabic shaping, logos, repeated headers, page numbers, paired rows, +1 and actual exit dates inspected. Use filters/matrix for routine reporting; full raw audit output is intentionally long.
- Private actual outputs and render samples: `outputs/radical/*.private.xlsx`, `*.private.pdf`, `*-page-*.png`, `export-inspection.json`.
- Before/after dashboard, directory/profile, daily, monthly, review and reports screenshots are under `outputs/radical/`. They show the functioning isolated app. Directory data is synthetic; source screenshots may contain real names and remain private.
- Three truncated PNG assets in the root checkout were restored from complete existing originals in the deployment checkout. This was a local-source problem; the older deployed originals were already complete.

### Production and remaining decisions

No new migration is required. Production database access was SELECT-only. Before/after table counts and content hashes cover employees, assignments, manual records, imports, source rows, identities, issues, reviews, rules, notes, actions and audits. No real source was reimported or approved, and no employee/history data was rewritten.

Production deployment: **YES, Sites version 23**, succeeded 2026-10-01 09:26:38 UTC. Source commit `c12f78142273cef209868785f40658014ea95db9`; version `appgprj_6a9af274e9908191a04ba042ed441523~appgver_e8c4ce467ed081918fe5b926ac40a7d2`; deployment `appgdep_6abe273a58c08191847eb8075acda7b8`. The existing audience and environment configuration remain unchanged. The archive contains build output and hosting metadata only. The Sites helper was absent at its advertised path; native credential, save-version and deploy tools completed publishing.

Authenticated read-only live checks **passed after reload exposed the user's signed-in session**: dashboard (199 active employees), active directory drill-down (199), existing September 30 applied daily source (196 identities, 371 saved distinct minutes), cancelled monthly source with visible raw times (215 identities, 207 matched), grouped diagnostics, closed-source approval prevention, existing employee profile and October 1 dated-history boundary, report selection, and September official-position empty state. The monthly diagnostics separate 4,761 missing-history person/days, 184 unmatched person/days within observed coverage, and 1,505 outside-coverage person/days; the 240 stored identity issue rows also include dates outside that observed coverage. No production forms were submitted.

Live testing found a confusing zero-item identity queue for cancelled imports, which the server intentionally excludes from open queues. Version 23 replaces that queue with an explicit closed-source/read-only explanation while keeping evidence and diagnostic counts visible. Typecheck, targeted lint and final production build passed after this small UI change. The complete 158-test run preceded that explanatory-only change.

Final live bundle hashes match all four checked build assets (employees, fingerprint workspace, monthly position, reports). Public shell returned 200 and unauthenticated API returned 401. After both deployment and live navigation, **all 12 production table row counts and complete-content hashes exactly match the pre-deployment checkpoint**. See private `production-preservation.json` and `deployed-assets.json`.

Local write-path acceptance remains separate: production imports, identity decisions, edits, approval and cancellation were deliberately not exercised. Device mappings are scoped to approved monthly evidence; a comprehensive global device-mapping registry is not added. Before/after captures are available for every requested page, but three pairs differ slightly in pixel dimensions (1265×712 versus 1280×720) because of browser-panel sizing; they are not represented as pixel-identical comparisons.

HR decisions still required: confirm monthly year and device-export coverage; resolve unmatched identities using independent evidence; supply legitimate effective-dated September assignments and schedules; choose the source to replace the cancelled monthly batch; explicitly review and approve after blockers clear. Do not backdate simply to remove a warning.

Next HR action: establish the legitimate historical context and identity decisions listed above. The software does not turn the currently cancelled, historically unresolved monthly source into approved attendance.

No unqualified claim of all bugs fixed or full production readiness is made.
