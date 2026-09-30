# FANU HR product contract and acceptance ledger

Assessment started 2026-09-25 (Asia/Baghdad). Production source: Sites version 19,
`0681008bd65129542a43cce3c531dedbba967a21`; public checkout `0bc3d6f`.
The September 25 baseline included a cancelled monthly import. Subsequent legitimate imports must be preserved; the September 30 checkpoint has 28 imports.

## Rule provenance

| Rule | Source | Acceptance |
|---|---|---|
| Employee UUID and FANU code never change with a correction/transfer | Explicit user brief; unique/immutable database constraints | Concurrent creation, edits, transfers and resignation preserve identity |
| Device identifier differs from internal code | Explicit user brief | Separate labels, search, matching and export columns |
| One active manual exception per employee/date | Verified database constraint and established workflow | Conflicting entries fail atomically; corrections use revisions |
| Absence ×2/×3 are weighted units, not days or financial deductions | Explicit user brief; existing status vocabulary | Separate day count and weighted total; no monetary calculation |
| Manual HR status takes precedence over fingerprint interpretation | Existing documented workflow | Source visible; raw evidence remains available |
| Fingerprint uploads do not imply approval | Explicit user brief | Preview/review/approval remain separate, transactional and role checked |
| A punch retains its actual calendar timestamp | Explicit user brief and original XLS | Overnight pairs cannot manufacture a next-day timestamp or reuse a punch |
| Entry windows, start and grace are effective-dated department rules | Verified database rows (earliest 2026-09-08/09) | No earlier schedule inferred; exact configured boundary used |
| First entry and last subsequent punch within the next entry boundary | Existing implementation only; no explicit exit window exists | Explain interpretation and retain all intermediate evidence; flag boundary ambiguity |
| Historical organizational assignment | Unknown before explicitly documented effective dates | Never represent today's assignment as proven historical assignment |
| No punches means absence | Rejected by explicit user brief | Missing evidence, coverage and future dates are distinct; no automatic absence |
| Future leave / exceptional combinations | Existing one-exception workflow; no new company policy supplied | Preserve current supported entry policy; no new deductions or automatic decisions |
| Original logos and concise Arabic RTL working surfaces | Explicit user brief and reference images | Both brands, navy navigation, usable tables, desktop/tablet/mobile |

## Architecture disposition

Retain Supabase Auth, live-profile role checks, immutable audit, permanent code
sequence, guarded imports and revision checks. Refactor the request boundary,
shared evidence interpretation, report/export definitions, forms and navigation.
Replace conflicting attendance calculation paths where independent fixtures show
different answers. Add schema only for demonstrated integrity/provenance gaps.
Do not rewrite the framework or migrate employee identities.

## Acceptance matrix

| Area | Independent evidence required | State |
|---|---|---|
| Employees and organization | Isolated creation/edit/transfer/resignation, duplicate identifiers, concurrent revisions | Implemented; evidence and remaining gates below |
| Daily HR and administrative actions | Weighted days vs minutes, corrections, cancellation, persistence and failure | Implemented; evidence and remaining gates below |
| Raw XLS | Actual BIFF signatures/hash; separate token/cell/identity reconciliation | Implemented; evidence and remaining gates below |
| Shift interpretation | Hand-derived same-day, overnight, duplicates, schedule-change, first/last boundary and future fixtures | Implemented; evidence and remaining gates below |
| Review lifecycle | Isolated matching, refresh/reopen, approval, overlap, replacement, cancellation, stale writes | Implemented; evidence and remaining gates below |
| Reports | Manual precedence, population/filter definitions, source vs official distinction, independent totals | Implemented; evidence and remaining gates below |
| Exports | Actual downloaded XLSX/PDF structure and rendered Arabic pages; brand/scope/repeated headers | Implemented; evidence and remaining gates below |
| Interface | All routes, error/empty/loading, keyboard, unsaved changes, three viewport widths | Implemented; evidence and remaining gates below |
| Security | RLS/grants/RPC guards, dependency reachability, auth/API failures | Implemented; evidence and remaining gates below |
| Production | Read-only baseline, migration rehearsal/backup, exact-source deployment, authenticated safe checks | Implemented; evidence and remaining gates below |

## Defect ledger

| ID | Reproduction / actual behavior | Expected and source | Root cause / repair / verification |
|---|---|---|---|
| D01 | Legacy monthly SQL moves a same-calendar morning punch to tomorrow | Preserve original timestamp (brief §9) | Shared canonical engine retains actual timestamps; legacy calculation grants retired only after deployment; independent overnight tests |
| D02 | Daily SQL ignores a second punch inside the entry window | Subsequent same-shift evidence must remain visible; no guessed exit | Canonical first-entry/last-subsequent selection; same-window second punch and boundary fixtures pass |
| D03 | Daily open-issue check includes cancelled/unrelated import evidence | Review indicators scoped to the consumed evidence (§10) | Daily evidence RPC limits applied daily sources and related issues; cancellation/isolation fixtures pass |
| D04 | Employee transfer can change interpretation of prior months | Historical assignment must be supported (§5) | Effective-dated assignment evidence, explicit unresolved history and frozen approval context; transfer and correction tests pass |
| D05 | Employee/action dialogs can discard unsaved input | Preserve input and handle unsaved changes (§13) | Dirty guards cover employee, status, administration and settings forms; code/UX tests pass; native confirm-dialog behavior has not been exhaustively browser-verified |
| D06 | Current coded reports lose filter description and workbook branding | Export must state exact scope and retain brands (§14) | Scope, original brands, Baghdad generation time and Arabic credit; actual downloaded PDF rendered and XLSX XML/content checked |
| D07 | Login/sidebar put white image rectangles on navy | Original brand naturally integrated (§12) | Original brand assets integrated with navy shell; Cairo typography, responsive navigation and overflow checked at 390/768/1280 |

Production mutations are never test fixtures. Missing historical policy is not
permission to infer it. Release evidence is recorded separately from this plan.

## September 30 release evidence

- 152/152 isolated tests pass, including approval/replacement/cancellation, role guards, concurrency, independent attendance fixtures and transport failure behavior.
- TypeScript and build pass. Final lint initially caught a React ref naming rule; corrected and lint rerun passed. Final packaging repeats source checks.
- Dependency audit: zero reported vulnerabilities after the scoped undici 7.29.1 override.
- Removed 39 unreachable starter UI files and ten unused direct dependencies; retained used chart/progress components.
- Synthetic browser upload → review → approval survives local restart: two identities, six punches, 1125 work minutes, 20 late minutes; no real attendance approval.
- PDF actual download: five seven-day A3 pages, Arabic text, repeated headings, both brands, real exit dates and footer. XLSX clocks/dates are numeric, identifiers/text remain safe inline strings.
- Authorized private recovery snapshot rehearsed: 231 unchanged employee identities, 28 unchanged imports; 231 additive assignment-history rows. Raw/manual evidence checksums matched the production recheck at 19:43 Baghdad. This is an affected-scope recovery snapshot, not a full Auth/PITR backup.
- NOT VERIFIED: native Excel rendering, native browser print, exhaustive keyboard/confirm-dialog paths, production HR/VIEWER sign-in and native print. ADMIN production reads and actual exports are now verified; see september30-verification.md for deployment receipts and limits.

## Measured local performance

Reproduce with `node scripts/benchmark-system.mjs` (synthetic isolated PGlite only).
250 employees × 30 days / 15000 punches: baseline parser median 302.1 ms, current
269.5 ms; matching and preview 12.54 s; evidence query 0.83 s; calculation median
0.78 s; filtering median 1.3 ms; 500-row Excel 0.57 s and Arabic PDF 8.11 s.
Only parsing has a comparable before/after baseline. These are local timings,
not production page-load or network latency claims.

## Additional defects resolved

D08: historical assignment guessed from current employee row → dated evidence and
explicit unresolved status. D09: approval could omit calculation provenance →
frozen context and database coverage guard. D10: uncertain transport retry/body
size handling → byte limits, bounded requests and no automatic write retry.
D11: stale response overwrite/refresh races → single-flight refresh and deduplicated
reads. D12: atomic status/note save → one database transaction. D13: mobile topbar
overflow → bounded flex title/logo and verified viewport widths. D14: exported
clock labels were text → real numeric Excel times/dates with Arabic formats.
D15: direct legacy calculated RPCs could disagree with server canonical results →
allowlisted metadata gateway and staged grants cutover.
