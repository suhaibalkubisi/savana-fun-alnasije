# Complete HR release checklist

Baseline: version 18, GitHub ff4005e7, Sites d9d965a. Preserve subsequent writes and the original XLS preview; no real attendance decisions for QA.

| Area | Evidence / priority | Acceptance | State / verification |
|---|---|---|---|
| Permanent employee code | P1 missing independent field | Immutable unique FANU code; UUID/device fields unchanged; search/display/export | Implemented; four regression tests and 231-employee restored-copy backfill pass |
| Monthly calculation | P1 same-calendar morning ambiguity and raw-only preview | Actual timestamp/windows, no reuse/next-afternoon leak, missing rules/boundaries explicit | Implemented; 18 pure regressions plus restored original evidence |
| Monthly position/dashboard/detail | P1 missing matrix, scoped metrics and timeline | Two labeled subrows, +1, stable identity, drilldown, shared export values | Implemented; isolated full workflow and responsive UI pass |
| Coverage | P1 final header not proof of collection completeness | Explicit selected end, observed vs confirmed, future not absence | Implemented; partial/future/month-boundary regressions pass |
| Employee/status/history | Baseline local mutation tests pass; no dated department ledger or employment dates | Preserve UUID/history/HR priority; expose current-assignment limitation; add code tests | Retain + verify |
| Population | 201 vs 204 reports had different snapshots/eligibility | Explain source, active and manual populations without hardcoding | Read-only current September: 204 unique = 203 active + 1 inactive with HR history; source has 215 identities; historical attribution limitation documented |
| Imports/review/replacement | Baseline guarded V3 workflow | No silent approval, stale revisions/retries/overlaps blocked; replacement exact scope | Retain + test new position on transitions |
| Daily records | Entry-only operational UI, manual HR priority | Preserve absence multipliers/late minutes; no financial-policy invention or future absence | Regression suite |
| Identity matching | Eight pending groups; no decisions authorized for QA | Separate internal/device codes; preserve explicit mappings/reasons | Implemented; original 207 matched / 8 unmatched and review content preserved in rehearsal |
| Navigation/dashboard | Requested unified working surface | Grouped navigation, actionable real metrics, distinct preview/official state | Implemented; local dashboard and navigation inspected |
| Tables/forms/mobile | Wide monthly table | Frozen identities, internal scroll, reset, labels, 1440/1024/390 QA | Three widths checked without page overflow; keyboard focus and mobile dialog verified |
| Comprehensive/department/employee reports | Preserve existing report values | Internal code without changing totals/identity | Code added; regression/export-engine pass; live browser-download receipt remains separate |
| Actions/notes/users/settings/audit | Existing role-checked flows | Preserve permissions/audit; inspect shared UI and isolated mutations | Regression + read-only smoke |
| Excel/PDF/print | Preserve font and pagination fixes | Ten-day PDF segments, repeated identity, Arabic/+1/coverage | Actual generated XLSX and rendered PDF pass; print CSS implemented, system print dialog not separately verified; browser download receipt remains live gate |
| Security | Dependency and Supabase advisors | Role guards, no anonymous/direct access or secret exposure | Runtime audit zero; 12 build-tool advisories assessed with reachability/limitations in release19-verification.md; Free-plan password warning retained |
| Performance | Avoid unmeasured speed claims | Measure scoped evidence read/calculation | Restored-copy observation 1,233ms; no comparative production-speed claim |
| Recovery/release | New additive schema | Fresh backup, target-only atomic SQL/history, exact-content drift gates | Recovery and local rehearsal pass; 136 tests, typecheck, lint, Worker build pass; production execution/live status tracked separately |

Visual thesis: a compact Arabic administrative ledger—navy grouped navigation, cool-gray workspace, white working panels, readable labels, frozen employee identity and semantic status text. No decorative imagery or unrelated framework changes.

Production mutations are not E2E fixtures. Full write journeys use isolated synthetic databases; visual fixtures are isolated and never included as live business records.
