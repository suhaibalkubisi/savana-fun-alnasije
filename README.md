# FANU ALNASIJ / SAVANA — Evening follow-up

Current local repair candidate: Sites v39, commit `4f24d2798147e64922c44566c81ae1399eb7086b`. Start with the [current Arabic operator guide](docs/staff-operator-guide.ar.md) and [review/rollout plan](docs/staff-rollout.ar.md). This candidate is not published. `supabase/proposals/staff-repairs.sql` is REVIEW ONLY. Native Supabase Auth/Storage acceptance, native Excel print acceptance and authorized production setup remain pending.

The text below describes historical HR modules and infrastructure; it is not the current evening workflow or role guide. The current primary destinations are the eight documented in the Arabic guide, with ADMIN, FOLLOWUP, SUPERVISOR and VIEWER access. Identity, dated service status and evening membership are separate.

## Historical infrastructure notes

Arabic RTL employee and daily HR exception management. Next.js, React, TypeScript, Tailwind, Supabase PostgreSQL and Supabase Auth. Supports ADMIN, HR and VIEWER roles, immutable audit history, monthly matrices, employee summaries, XLSX/PDF export, printing and confirmed bulk import.

See [DEPLOYMENT.md](DEPLOYMENT.md) for runtime configuration and reproducible database setup, and [VERIFICATION.md](VERIFICATION.md) for tested behavior and the remaining live-service gate.

`supabase/seed.sql` in this public repository is a TEST-ONLY sanitized fixture, not the production employee import or a database dump. It preserves the test baseline (206 synthetic employees: 192 active, 13 resigned, 1 long leave), department/manager relationships and duplicate-name coverage. All employee/manager names, UUIDs and the source fingerprint are replaced. The private employee files are intentionally excluded.

The database and export tests create disposable PGlite instances and explicitly enable `hr.test_fixture` before loading the fixture. The seed rejects execution without that flag, or when employees/accounts already exist. Never apply it to production. No Supabase connection or credentials are needed for these tests.

`.openai/hosting.json` retains the existing Sites project association and unchanged `d1: null` and `r2: null` bindings. Publish only the reviewed source and its matching Worker artifact. See [development support provenance](docs/development-support.md).

`npm run dev` runs the Sites adapter; `npm run dev:vercel` runs standard Next.js. `npm run build` packages the Worker and `npm run build:vercel` validates the standard Next.js target. `npm run typecheck`, `npm run lint`, `npm run test:db` and `npm run test:exports` provide validation. Node.js 22.13 or newer is required.

Database credentials belong in encrypted server environment variables. An unconfigured installation denies login and all data access.

Identity review supports an explicit batch grouped by department, a shared evidence reference, individual corrections/exclusions and an export of the selected UUIDs and expected revisions. Selections start empty. Each person is saved through the existing guarded identity transaction; a failed or uncertain response stops the queue and requires reading saved progress before another attempt. Established mappings are reused by later exports from the same confirmed source. Mapping, preview review and attendance approval remain separate.

Daily attendance requires a valid entry only. Monthly attendance uses effective dated assignments and entry windows, preserves raw evidence and marks verified next-day exits `+1`. Unknown identity, missing historical rules and unproven coverage remain unresolved rather than becoming absence. Browser printing uses the complete filtered export scope for the selected matrix, calendar-evidence or summary view.
