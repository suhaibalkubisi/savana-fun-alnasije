# Verification — 4 September 2026

## Automated checks

- TypeScript: passed.
- ESLint: passed without errors or warnings.
- Next.js 16 production build: passed, including all four authenticated API routes and the application routes.
- Sites/Vinext Worker production build: passed.
- PostgreSQL integration suite: 17 passed. Uses the real PostgreSQL engine in PGlite, an isolated `auth.users` fixture and the exact production migration and seed.
- Export suite: 3 passed against a report calculated by that database.
- Component regression suite: 4 passed.
- Supabase new-key transport suite: 6 passed. Login/refresh use the publishable key in `apikey`; user RPCs add only the user's JWT as Bearer; administrative calls use the secret key only in `apikey` and reject user-token mixing or header overrides.

The database suite covers source counts, new employees, search, duplicate names, five exception types, weighted absence, lateness, duplicate dates, invalid departments, optimistic revisions, corrected names, transfers, resignation, historical corrections, confirmed soft deletion, audit old/new values, RLS and direct-SQL/RPC role restrictions, disabled accounts, last-admin protection, calendar validation, safe department settings and transactional import rollback/replay prevention.

Excel verification also used an independent reader: the September matrix contains 192 active employees, 30 valid day columns, typed values, no formulas, RTL views and correct totals. Summary column order and department-filtered export were checked. The five isolated test exceptions produce weighted absence 6 and late minutes 27. They are never seeded into production.

PDF generation was inspected visually after rendering: embedded Arabic font, A3 landscape, readable names, day segments 1–15 and 16–month-end, repeated headers and pagination. The export suite validates embedded fonts and page counts. Print-specific A3 CSS is implemented; a physical printer/OS print-dialog run was not performed.

## Browser checks

Desktop dashboard and employee form, plus 390px mobile login, dashboard, employee list/add form, dependent searchable status form and monthly matrix were visually inspected. Arabic type-to-search and conditional lateness input were exercised. The report URL-update loop found during inspection was corrected. Table overflow remains inside scrollable containers; mobile navigation collapses.

Authenticated browser views were inspected with temporary read-only responses produced by the isolated PostgreSQL database. Those temporary API routes, response files and responsive-check route were removed, and the production authentication/data endpoints restored before both final builds. No browser-only authentication or fixture data is present in the shipped application. Mobile employee edit uses the same inspected employee form; the summary uses the shared responsive report implementation, but a separate final summary screenshot was not captured.

## Source import

AHH.xlsx was read in full, without modifying it: one worksheet, 207 rows including the header, 206 employees, 192 active, 13 resigned and one long leave. Ten departments use stable UUIDs and bilingual display labels. One exact duplicate human name remains two distinct employees. Employee numbers, shifts and manager relationships are absent in the source and remain null. Source supervisor entries are available as selectable managers without inferred reporting relationships.

## Deployment gate

The hosted Supabase database and authentication service were unavailable during construction. The source import and authorization tests ran only in isolated test databases. No claim is made that employees have been imported into a live production database or that a first administrator has been created.

Operational acceptance still requires the live Supabase connection, migration/seed application, first-admin bootstrap and real multi-account browser/API tests (login, logout, refresh and access disabling). The private application can be deployed with these operations securely unavailable until configured. Database backups and recovery depend on the selected Supabase project.

On 4 September 2026 the code was migrated to `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and the server-only `SUPABASE_SECRET_KEY`. It has no application fallback to the legacy environment names. Both production targets built successfully and neither client bundle contains the secret variable name or an `sb_secret_` value. The Sites production environment had revision 0 with no configured variables, so live migration, import, administrator creation and CRUD testing could not run in that environment.
