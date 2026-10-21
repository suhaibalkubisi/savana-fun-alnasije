# Frontend release candidate handoff

14 October 2026. Source checkout: `work/followup`. This continuation changes only the Follow-up client, UI stylesheet and client regression tests. Production release, real declarations and real account assignment were not performed.

## Finished interface workflows

- Durable saved-view create/read/delete uses authenticated server preferences, immutable employee/department IDs and optimistic version checks. Saved state is cleared on logout. Opening a shortcut rechecks current authorization. Viewer preferences do not mutate business records.
- Read-only report-family tabs are URL-backed and recoverable in saved views, including employee/month selection. Editable declaration forms are not saved as shortcuts. Local text search is deliberately excluded from saved preference records.
- The reporting center associates preview and declaration choices with the exact active date, department, employee, report family and action filter. A response for another filter cannot be displayed or exported under the current scope.
- The today desk loads authorized entered document expiries through a 30-day horizon including expired dates, labels overdue/upcoming state and drills into the employee UUID. It does not manufacture an expiry or attendance result.
- Administrator settings expose explicit independent capability grant/revoke with reason and exact version, department order updates preserving names and IDs, deliberate account role choice and concrete unassigned-supervisor tasks. Failed capability loading cannot be mistaken for default permissions.
- Profile documents expose current and archived versions, private photo crop/replace/remove, pending exact-original resume, reasoned abandon, and safe abandoned-object cleanup retry. Resume metadata and crop are frozen; the user reselects bytes. No file bytes are stored in browser persistent storage. Private retry keys contain a SHA-256 payload digest rather than the file payload string.
- Upload success is separated from photo-profile linking. A profile version conflict cannot be misreported as an upload failure or silently create another uploaded document.
- Profile document/transfer forms have explicit dirty navigation guards. Profile personal detail loading clears prior-scope rows, checks aborts and has loading/failure/retry states. No prior employee details are used as an empty successful result.
- Stored reported timestamps are converted to the Baghdad datetime-local representation before editing. After-midnight reload/save preserves the original UTC instant and leaves the independently selected service date unchanged. Unknown timestamps stay blank.

## Verification

`node --test tests/followup-client-workflows.test.mjs` passes 12 tests: Baghdad midnight time roundtrip, headcount/weight separation, historical status category weights, hidden-row bulk exclusion, revision additions/removals, immutable saved-view scopes, individual report-family recovery, expiry horizon calendar boundaries, no-store/abort transport, ambiguous retry identity, private exact payload retries, account-scoped logout cleanup.

`node node_modules/typescript/bin/tsc --noEmit` passes. `node scripts/lint-verified.mjs` passes with zero errors; nine pre-existing unused-variable warnings are in legacy onboarding/native QA files, not in the new Follow-up client. No lint suppressions were added.

UTF-8 source was checked through Node directly: all Arabic-bearing client sources contain Arabic codepoints and zero literal `???` runs. PowerShell display corruption is an output-encoding issue, not source corruption.

Root owns final production-style build, browser/touch/keyboard QA and evidence. Database agent owns role/RLS/concurrency/storage contracts. Export agent owns PDF/XLSX/print tests. These remain separate evidence scopes; client unit tests do not assert that production storage or hosted UI has been tested.

## Documentation

Arabic operational guide: `docs/ARABIC_USER_GUIDE_RC.md`, copied to the deliverable `outputs/docs/arabic-user-guide.md`.

Screen/permission matrix: `docs/SCREEN_PERMISSION_MATRIX_RC.md`, copied to `outputs/docs/screen-permission-matrix.md`.

All real operator assignments, dated roster evidence, retention decisions and controlled deployment remain business/release gates. F18 is not resolved by assigning a guessed department.
