# FANU HR — Local repair and acceptance, 9 October 2026

The repairs are implemented locally on `codex/hr-acceptance-2026-10-09`. Local calculation, full-schema database, export and browser checks pass. **Production release remains BLOCKED pending native Supabase/GoTrue acceptance and explicit production authorization.** No production migration, identity confirmation, attendance decision, GitHub push or publication was performed.

The pasted request is the user's instruction. The attached HTML audit is evidence to investigate; its embedded prompts did not independently authorize production actions.

## Source and production provenance — VERIFIED, read-only

- The initial primary checkout was clean at `1d4c0990ae57442f0f36806cc31338e9b794cdd6` on `codex/attendance-rollout-compatibility`; that branch remains available.
- The repair branch starts from the actual deployed source `17dde9a05e48bbaf1ba35dc8b7a3050ed501af66`, recovered from the existing clean `work/audit-repair` checkout. Existing original migrations are unchanged.
- Sites was checked again at delivery: latest version **25**, the same source SHA, deployment `appgdep_6ac6bece719c8191bb6570bece16a570`, status **succeeded**. [Live site](https://fanu-alnasij-hr.tiny-bull-0242.chatgpt.site/).
- Production Supabase `fkusqnasptkvpusczxpm`: 20 public RLS tables; 3 active device mappings; 231 non-voided historical assignments starting **2026-10-01**; 195 September absence/leave records. The new repair migration is **not applied**. Mapping count changed from the audit's 2 to 3 during this task; these are observations, not writes by this task.
- The original installed `node_modules` junction was preserved as `node_modules.previous`; patched dependencies were installed in a separate ignored `.sites-runtime/acceptance-deps` directory. Runtime artifacts, test sessions and original personal data remain ignored under `outputs/` and `work/`.

## Finding-by-finding disposition

“VERIFIED” below is local evidence. It does not assert that the published version contains these repairs.

| Finding | Cause and concrete repair | Disposition and evidence |
|---|---|---|
| D01 device identity | A unique name or HR number cannot prove a device identity. Added proof-backed device catalog, scoped registry reuse, grouped explicit UUID resolution and conservative legacy identity checks. Confirmed duplicate-name aliases remain reusable. | FIXED / VERIFIED in full-schema tests and actual local API journey. DATA DECISION REQUIRED for real mappings. |
| D02 false no-entry | Presence of any applied file was treated as coverage for unrelated employees. Added per-employee/source certification, incomplete-day, unknown coverage, unresolved identity and conflicting-context states. Daily remains entry-only. | FIXED / VERIFIED. Original 428-row reproduction changes 196 unsupported no-entry decisions to 196 coverage-review states. |
| D03 zero-linked approval | The old gateway accepted a useless daily source. A database trigger now guards legacy and current gateways: linked identity plus usable entry in proven active history/rule, or a closed certified day, is required. | FIXED / VERIFIED; rejects zero links and linked rows without a usable historical context. Partial valid approval retains unmatched evidence. |
| D04 historical correction | Read/write and report department filters used different organization dates. Status corrections use proven day assignment; historical report membership and labels use dated evidence. | FIXED / VERIFIED: A→B transfer, old-date correction, filtering and stale revision. Legacy records without history stay traceable; they do not manufacture history. |
| D05 cancelled recovery | Global file-hash uniqueness returned the cancelled object. One open attempt per hash/period, linked prior attempts and a closed-source corrective clone preserve old evidence. Same-hash duplicate daily approval remains prohibited. | FIXED / VERIFIED: cancelled re-upload, idempotent retry, closed immutability, namespace correction role check and separate replacement. |
| D06 missing export rows | Exports mapped the current 50-row page. All three operational reports now fetch one bounded full filtered snapshot; count mismatch stops download. Scope changes invalidate pending export. | FIXED / VERIFIED. Actual browser XLSX/PDF each contain all 195 records, with zero differences in canonical business fields. |
| D07 period propagation | Report pages initialized the current month instead of URL scope. Valid month parameters and subsequent changes feed filters, captions and exports. Dashboard links retain date and decision group. | FIXED / VERIFIED: September absence, lateness and actions routes opened September. |
| D08 Arabic PDF | DejaVu lacked Allah U+FDF2; Cairo lacked some shaped isolated forms. Added licensed static FANUArabic font derived from Cairo with the same isolated glyphs and a licensed tick. Original fonts/names/logos/credit are retained. | FIXED / VERIFIED: shaped-codepoint coverage, independent extraction and first/middle/last rendered pages; full “عبدالله حسين عبدالهادي” retained. |
| D09 permanent identifiers | HR read/search/export models omitted FANU code. Added UUID-backed permanent code throughout and safe employee import updates by existing UUID/code, with conflicting-key rejection and missing-key creation warning. | FIXED / VERIFIED: full-schema code search and actual API import preview; no actual employee import committed. |
| D10 stale match counts | Row resolution left stored counters unchanged. Refresh/import-summary now runs with identity resolution and explicit reprocess. | FIXED / VERIFIED: daily matched/unmatched counts reconcile within the transaction. |
| D11 daily filters | Quick and advanced filters silently competed, and options mixed decision/evidence axes. Selecting either clears the other; clear-all resets both, department and search; evidence/review states are complete options. | FIXED; calculation predicates and code reviewed. Exhaustive browser testing of every filter option is NOT TESTED. |
| D12 open preview reuse | A registry confirmation did not update an older preview. Added explicit scoped reprocess; old name-only hints are made unresolved rather than auto-confirmed. | FIXED / VERIFIED in database and actual API journey. Closed sources cannot be reprocessed. |
| D13 monthly printing | Default long-form person/day output repeated identities hundreds of times. Added full-month matrix, separate summaries, optional detailed source PDF, exact page preview and Excel print settings. | FIXED / VERIFIED for generated PDF/XLSX data and rendered samples. Native Excel print engine is NOT TESTED. |
| D14 false departure dialog | Dirty protection treated generated download anchors as navigation. Download/blob/data anchors and safe same-page actions are excluded. Real navigation/modal/reload protection remains. | FIXED / VERIFIED: original 196-identity unsaved file downloads without dialog; declining real navigation preserves the preview. |
| D15 history/rule gaps | October assignments do not establish September organization; missing department rules cannot be guessed. Added period-aware gap queue and reviewed atomic bulk historical onboarding with UUID/version/date/reason. | FIXED tools / VERIFIED atomic rollback and gap changes. DATA DECISION REQUIRED for real history, employment eligibility and rules. |
| D16 comprehensive presence | Shared report contained HR decisions alone. Added a read-only evidence snapshot/model producing ✓ only from approved, eligible, sufficiently verified entry. Manual HR decisions win; conflicts remain visible. | FIXED / VERIFIED: no ticks for unknown/future evidence; all 6,180 fixture day cells and row totals compare independently. |
| D17 review/audit/settings | Fingerprint events used settings labels; gap queue was incomplete; action type header/cell parity was wrong. Added entity-specific audit descriptions, period gap workflow and missing order header. | FIXED; audit/queue database checks VERIFIED. Exhaustive settings editing browser acceptance is NOT TESTED. |
| D18 dependencies/security | Runtime advisories and developer-tool findings were mixed. Updated pinned packages deliberately, preserved RLS deny-direct model, guarded new RPCs and reviewed advisor categories. | FIXED runtime package findings / VERIFIED Worker build and runtime audit. Remaining developer graph and native auth security work are described below. |

## Original-file reconciliation — VERIFIED

Files were parsed independently from the original bytes, without modifying them or assigning real employees.

| Original | Period | Bytes | Identities/source rows | Calendar cells | Populated cells | Raw tokens | Distinct saved minutes |
|---|---|---:|---:|---:|---:|---:|---:|
| `Punch+Record (46).xls` | 2026-10-08 | 43,008 | 196 | 196 | 196 | 392 | 346 |
| `Punch+Record (11).xls` | September 2026 | 119,296 | 215 | 6,450 | 4,318 | 7,416 | 7,416 |
| `Punch+Record (48).xls` | 2026-10-08 | 89,600 | 428 | 428 | 428 | 856 | 779 |

SHA-256, in table order:

```text
f39db813fbe42b73220020c800fd197a19d339f6a92447313776b1b5dcc835f6
f3c53cbe99d7cdd02725959e2f254d7d51fb4fd81b4332327073e0ad7834d7ec
5fdcf29b164a5b0e9543226138da8e9b089d7d54a9916e4da65072fa0688a874
```

Evidence: [original counts](C:/Users/Suhaib/Documents/GitHub/savana-fun-alnasije/outputs/acceptance/original-file-reconciliation.json), [428-row old/new reproduction](C:/Users/Suhaib/Documents/GitHub/savana-fun-alnasije/outputs/acceptance/audited-428-reproduction.json). The latter runs the original v25 engine and repaired engine on original punches with **synthetic** 199 employee UUIDs, 198 expected assignments and 2 fixture links: old = 1 present / 196 no-entry / 2 review; repaired = 1 present / 0 no-entry / 198 review, including 196 unproven coverage. These links are not real identity decisions.

## Export acceptance — VERIFIED locally

These are real files made by application export code, not replacement spreadsheets or mockups. Original source exports contain private names and remain ignored. Calculated monthly employees/history and HR examples are synthetic; their attendance is not a finding about real people.

| Export | Records/identities | PDF pages | Paper / scope |
|---|---:|---:|---|
| Actual absence UI download, all 9 columns | 195 | **20** | A4 landscape; complete filtered September snapshot |
| Seven-column absence test fixture | 195 | 17 | A4; controlled independent calculation fixture |
| Original daily source | 196 | 16 | A4; all original evidence |
| Original monthly source matrix | 215 | 13 | A3; all 30 dates / 7,416 punches |
| Original monthly punches with synthetic calculation context | 215 | 15 | A3; all 30 dates, 8-point text, variable row heights |
| Comprehensive synthetic acceptance model | 206 + totals footer | 10 | A3; full 30-day matrix, 6,180 day cells |

The UI download reconciles 147 absence, 38 absence×3, 10 leave, weighted total 261, all 195 permanent-code occurrences and the full Arabic example name. Date cells are typed Excel dates; numeric totals remain numeric. The two audit metadata columns are retained. Excel has RTL layout, both logos, print area, repeated header rows and fit-width 1 / unrestricted vertical pages. PDF first/middle/last pages were independently rendered and visually reviewed. Some longer 12-hour labels wrap within their measured monthly cell; rows reserve their height and are not split across pages.

- [Actual browser export comparison](C:/Users/Suhaib/Documents/GitHub/savana-fun-alnasije/outputs/acceptance/browser/download-independent-checks.json)
- [Matrix/source independent comparisons](C:/Users/Suhaib/Documents/GitHub/savana-fun-alnasije/outputs/acceptance/export-independent-checks.json)
- [Actual full XLSX](C:/Users/Suhaib/Documents/GitHub/savana-fun-alnasije/outputs/acceptance/browser/absence-ui-195.xlsx) · [Actual full PDF](C:/Users/Suhaib/Documents/GitHub/savana-fun-alnasije/outputs/acceptance/browser/absence-ui-195.pdf)
- [Monthly synthetic PDF](C:/Users/Suhaib/Documents/GitHub/savana-fun-alnasije/outputs/acceptance/monthly-test-calculation.pdf) · [Comprehensive synthetic PDF](C:/Users/Suhaib/Documents/GitHub/savana-fun-alnasije/outputs/acceptance/comprehensive-test.pdf)

Native Excel/LibreOffice print preview, physical printing, all alternate printer drivers and all font substitutions are NOT TESTED. These print settings alone do not prove native spreadsheet pagination.

## Test boundary and results

Full local suite: **181 / 181 passed**, zero failures/skips. The repository `npm test` includes the actual vinext Worker build and bounded test concurrency. TypeScript and ESLint pass. A shell-independent lint wrapper was added because Windows has no Bash executable. UI component regression compilation now bundles the actual components with esbuild; the previous Vite test runner stalled in dependency/module loading. No component behavior was mocked to get those tests passing.

The new daily regressions were exercised against the old engine (4 of the first 6 fail there); four targeted database regressions failed against the deployed baseline before the new migration. The final suite also exercises zero-link and missing-context guards, immutable corrective attempts, scope privileges, duplicate retries, atomic history rollback, manual/future/identity tick precedence and page-preview equality. Existing lifecycle fixtures now provide explicit past dated organization evidence and replacement reasons; approval guards were retained.

- [Final complete suite](C:/Users/Suhaib/Documents/GitHub/savana-fun-alnasije/outputs/acceptance/all-tests-final.log)
- [Repository test command](C:/Users/Suhaib/Documents/GitHub/savana-fun-alnasije/outputs/acceptance/npm-test-final.log)
- [Required typecheck](C:/Users/Suhaib/Documents/GitHub/savana-fun-alnasije/outputs/acceptance/npm-typecheck-final.log) · [Required lint](C:/Users/Suhaib/Documents/GitHub/savana-fun-alnasije/outputs/acceptance/npm-lint-final.log)
- [Worker build](C:/Users/Suhaib/Documents/GitHub/savana-fun-alnasije/outputs/acceptance/worker-build-final.log)

The disposable PGlite database loads the **complete migration set**, including the new migration. Older-schema compatibility tests are separately useful but are not the new-schema acceptance proof. Local dump/restore preservation passes; no production backup/restore was performed.

Browser tests use actual React components, actual Worker CSS and actual `app/api/{auth,data,import,users}` handlers, with a disposable full-schema database and a restricted synthetic auth/fetch adapter. No production URL or keys are loaded. This verifies real route validation/CSRF/live application-role checks **through the adapter**. It does not verify native Supabase PostgREST, GoTrue JWT validation, refresh/revocation behavior or production cookies.

VERIFIED browser/API journeys: September navigation in all three operational reports; 50-row browsing versus 195-row downloads; code search returning 30 rows; zero-link rejection; explicit identity resolution; reuse in another open file; explicit reprocess; daily approval with manual absence precedence/conflict; cancellation/reupload; new corrective preview without altering its parent; safe existing-code employee import preview without commit; original daily upload/save as review only; unsaved download versus real navigation guard; anonymous 401 / missing-CSRF 403 / prohibited VIEWER and HR configuration writes. Actual mobile viewport 390×844 has body width 390 and a scrolling table; eight keyboard focus steps cover navigation/actions/export and month input.

- [Integrated checks](C:/Users/Suhaib/Documents/GitHub/savana-fun-alnasije/outputs/acceptance/browser/integrated-checks.json)
- [Original file / dirty form](C:/Users/Suhaib/Documents/GitHub/savana-fun-alnasije/outputs/acceptance/browser/original-and-dirty-checks.json)
- [Mobile / keyboard](C:/Users/Suhaib/Documents/GitHub/savana-fun-alnasije/outputs/acceptance/browser/mobile-keyboard-checks.json)
- [Desktop screenshot](C:/Users/Suhaib/Documents/GitHub/savana-fun-alnasije/outputs/acceptance/browser/absence-september-desktop.png) · [Mobile screenshot](C:/Users/Suhaib/Documents/GitHub/savana-fun-alnasije/outputs/acceptance/browser/absence-mobile.png) · [Corrective preview](C:/Users/Suhaib/Documents/GitHub/savana-fun-alnasije/outputs/acceptance/browser/corrective-desktop.png)

NOT TESTED: native Supabase/GoTrue acceptance; real user creation/password change/reset/email/MFA; production Worker browser sessions; multi-session PostgreSQL deadlocks/load and PostgREST schema-cache refresh; all filter choices; full keyboard-only identity picker/bulk onboarding journeys; every settings mutation; native spreadsheet printing. Native computer-use capture was unavailable; screenshots above are actual headless Chromium captures, explicitly local.

## Security and performance disposition

`npm audit --omit=dev`: **0** vulnerabilities after deliberate updates to Next 16.3.8, DOMPurify 3.4.16, source-map-js 1.2.2 and sharp 0.35.5, with compatible Cloudflare tooling updates. The actual Worker build succeeds. This is package-inventory evidence, not a claim that every production attack surface was penetration-tested.

Full audit still reports **8 high developer-graph packages**: braces/micromatch/fast-glob and dependents including lint/vinext Vite plugins. No force downgrade or nonexistent patch was installed. Runtime audit classification does not prove zero exposure in a build pipeline; untrusted build inputs and glob expressions remain a development/build risk. Reassess a compatible upstream patch before release rather than changing the framework blindly.

Primary advisory references: [Next](https://github.com/advisories/GHSA-cjq9-62q9-8jv4), [DOMPurify](https://github.com/advisories/GHSA-6688-9rhm-gjv2), [source-map-js](https://github.com/advisories/GHSA-68fv-2mgg-jv7q), [sharp](https://github.com/advisories/GHSA-wq5f-xc86-pv6w). Next's affected remote image pattern path and DOMPurify IN_PLACE configuration were assessed as conditional findings; patching was still preferred.

Production advisor evidence was refreshed read-only and saved under `outputs/acceptance/final_security.json` and `final_performance.json`:

- 19 INFO policy-less RLS tables: deliberate direct-table denial with role-guarded RPC access. No broad policies added. Existing anonymous, viewer, HR/admin and inactive-user denial/last-admin tests pass locally; native role/JWT checks still need rehearsal.
- 26 WARN callable SECURITY DEFINER functions: each listed function belongs to the public attendance/HR/identity/import/history read/write API. Authenticated callability is intentional; live role checks and empty search paths are required. Legacy gateways are exercised so they cannot bypass closed-source/approval guards. Listing these functions is not a finding that any user may perform every operation. Native per-function privilege verification after migration remains required.
- Leaked-password protection remains disabled in production: DATA DECISION REQUIRED / BLOCKED configuration change until authorized; native policy/user flows are NOT TESTED.
- 30 unindexed foreign-key notices: no blanket indexes added. Use measured `EXPLAIN (ANALYZE, BUFFERS)` for source/history/report joins and retention/update workloads on an isolated representative dataset before selecting indexes.
- 1 profiles RLS init-plan notice: isolate and compare the profile policy plan before a separate policy migration; no broadening of access here.
- 7 unused-index notices: retained because a low observation count is insufficient evidence for removal, especially uniqueness/rare audit/retention workloads.

New functions revoke PUBLIC/anon access and enforce live roles. New device-source table enables RLS and denies direct client access. Source rows, UUIDs, internal codes, approved snapshots and audit history remain preserved. Advisory locks, ordered employee locks, optimistic revisions and 5-second lock bounds mitigate concurrency issues locally; a WASM database serializing statements is not native concurrent-session proof.

## Changed implementation

- Migration: `supabase/migrations/20261008230045_operational_acceptance_repair.sql` — additive columns/table and versioned function/trigger replacement, attempt lifecycle, identity proof, historical reads/writes, export snapshots, approved evidence, audit and role guards.
- Calculation/read models: `lib/hr/attendance-engine.mjs`, `monthly-position.mjs` and declarations, new `comprehensive-position.mjs` and declarations, `types.ts`, `attendance-validation.ts`, `import-diagnostics.mjs`, `app/api/data/route.ts`.
- Operator screens: fingerprint/identity/daily/monthly/report/operations/dashboard/administration components; new device-source selector, corrective-attempt, monthly replacement, period completeness and print estimate components; print CSS.
- Exports/import/forms: `lib/hr/exports.ts`, `lib/server/import.ts`, `lib/hr/use-dirty-form.ts`; licensed `public/fonts/FANUArabic.ttf`, license and `scripts/build-report-font.py`.
- Checks/build support: targeted new repair tests, historical/lifecycle fixture corrections, export/UI tests, isolated browser server, compiler/lint ignores, package/lock updates and `scripts/lint-verified.mjs`.

## Operator procedure — real decisions still required

1. Admin documents each device/export source from the actual device catalog. A namespace is stable; changing its label/evidence does not merge devices.
2. HR resolves each genuine person identity group once, choosing employee UUID/permanent code from independent device evidence. A name match remains a candidate. Reused confirmed mappings apply to future files in the same scope; older previews use explicit reprocess. Closed files use a new corrective attempt.
3. HR documents September assignments, active/inactive eligibility and effective department rules from actual records. The 231 October assignments are not backdated automatically. Bulk onboarding requires selected UUIDs, dates, department, status and proof reason, then a reviewed confirmation.
4. Device coverage must be attested for the selected identities and interval. First/last populated dates do not establish coverage; unchecked remains unknown. A missing file or unresolved employee is neither absent nor present.
5. Review evidence, resolve exceptions, then approve explicitly. Daily requires only an eligible entry, never exit or next-day file. Monthly handles entry/exit and overnight boundary evidence; one punch remains incomplete. HR manual decisions retain precedence with visible conflicts.
6. Approved-source corrections create a reviewed new attempt and use explicit daily replacement or monthly supersede. Do not mutate old evidence, approve a duplicate hash as an additional daily source, or merge device namespaces.

## Release and recovery plan — BLOCKED, not executed

There is no existing isolated native Supabase branch/project available in this task. Creating a paid branch requires separate cost authorization; no paid resource was created. Supply an authorized native test environment first. Load the real complete schema there, use synthetic employees and the original raw-file previews, exercise actual GoTrue/PostgREST and Worker sessions, restore its backup, and complete native printing/concurrency checks. Do not point the local adapter at production.

Only after those gates and explicit **“نفّذ”** production authorization:

1. Re-read live source/version/deployment, migration history and advisor/role state; review drift. Preserve the currently deployed v25 artifact and original source.
2. Take a fresh native database backup with source rows, histories, identity registry, review states, HR records, audit, grants/policies and sequence/code state; validate restoration in isolation. Record counts/checksums before changes.
3. Reconcile migration history **without replaying old migrations**: the production history has 12 recorded entries while the repo includes earlier foundational schema files already represented in the deployed schema. Do not use blanket `db push` to recreate them or blindly mark versions applied.
4. Apply only the reviewed new migration `20261008230045` once to the verified schema. Its transaction uses `lock_timeout=5s` and `statement_timeout=60s`. It replaces the old global hash uniqueness with a preview-only unique index and an applied-daily unique index, preserving closed attempts. Existing namespaces are seeded without fabricated proof. Defaults do not certify old coverage. DDL may briefly lock imports; timeout must roll back rather than be disabled casually. Check exact constraints/columns/function drift beforehand; this is intentionally not a script to replay twice.
5. Verify full rollback on failure, grants/RLS/new table, schema cache, function inventory and before/after preservation counts. Rehearse at least the oldest legacy gateway as well as V5 and the actual Worker route. Log each completed change.
6. Publish the reviewed code only after database compatibility checks, then observe login/session, selected-month report, code search, 195-row export, original-file preview, role denials and audit. Real identity confirmation/HR decisions remain separate business actions; deployment is not permission to auto-resolve them.
7. If application deployment fails, restore the saved v25 application while keeping additive database evidence. Rehearse old-app compatibility first: new explicit reason/approval guards can intentionally reject older mutation paths. If unsafe, disable affected mutations until forward fix; do not restore permissive identity behavior.
8. Do not drop the new device/attempt data or blindly recreate old hash uniqueness after corrective attempts exist. Prefer a forward fix. A full database restore requires a separately approved recovery window, preservation/reconciliation of any post-backup decisions and identity/code/audit verification; never silently lose later HR changes.

Readiness: local repairs and evidence are reviewable; essential native integration, native backup/restore, production business-data decisions and explicit deployment authorization remain outstanding. **Not production ready yet.**
