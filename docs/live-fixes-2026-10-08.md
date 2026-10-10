# Live workflow corrections — 2026-10-08

Based on deployed version 24 / source `989d60c57b784235b13ad5bfe71a12b2b8ffbd83`. Changes are on `codex/hr-live-fixes-2026-10-08`. No new SQL migration or production business-data correction is included.

Confirmed defects corrected:

- A missing monthly worked duration rendered as `0 س 0 د` in the dashboard. It now renders unavailable; numeric zero remains distinguishable.
- A coverage display filter could expand saved source coverage and classify uncovered blank dates as covered. The calculation now intersects filters with documented/observed source coverage, validates a nonempty overlap, and constrains date controls.
- A completely blank source with explicit coverage was classified entirely outside coverage. It now means no recorded punch within documented coverage, without creating HR absence; undocumented empty coverage remains unknown.
- Monthly report navigation from a saved source lost its month/import. The source-specific report link now retains both and distinguishes a file preview from the official report.
- Changing month kept the previous import pinned. Standalone month changes release the old source; employee drilldowns retain an import only for its linked month.
- Administrative action and employee-report pickers could not search the permanent FANU code. Both now show/search it, retaining UUID selection and a separate administrative-reference label.
- Daily raw-evidence copy still required overnight exits and a next-day file. It now states the entry-only contract.
- An old prepared download remained offered after report filters/view changed. The retry link is now bound to its generating scope and disappears for a different scope.
- Daily employee drilldown scope was hidden and had no return to the full population. It is now visible with a clear all-employees link.
- Employee device/fingerprint tabs showed unrelated HR-record pagination. Only actual paged record tabs now show that pager. Daily print is disabled with export while a filter request is pending.

Verification: 30 targeted calculation/export cases passed, then 20 calculation cases passed including both new coverage regressions; these overlap. Eleven synthetic database approval/lifecycle/preservation cases passed. Typecheck and targeted lint passed. Browser verification covers unavailable duration, unchanged covered blank-date count under an attempted expansion, hidden stale-download link, permanent-code UUID selection and source/month drilldown. The independent filtered Excel check confirms one employee/two movement rows, unavailable duration and one no-punch date. Further month navigation and scoped daily interaction checks are recorded in the local evidence.

Evidence is under ignored `outputs/live-fixes`, including database log, filtered-export check and synthetic screenshots. The actual production browser currently requires login; no authenticated production save, identity decision or attendance approval was performed. Deployment status is recorded separately after publication. Independent native PostgreSQL concurrency remains outside this patch's verified scope.
