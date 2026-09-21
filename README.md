# HR Management System

Arabic RTL employee and daily HR exception management. Next.js, React, TypeScript, Tailwind, Supabase PostgreSQL and Supabase Auth. Supports ADMIN, HR and VIEWER roles, immutable audit history, monthly matrices, employee summaries, XLSX/PDF export, printing and confirmed bulk import.

See [DEPLOYMENT.md](DEPLOYMENT.md) for runtime configuration and reproducible database setup, and [VERIFICATION.md](VERIFICATION.md) for tested behavior and the remaining live-service gate.

`supabase/seed.sql` in this public repository is a TEST-ONLY sanitized fixture, not the production employee import or a database dump. It preserves the test baseline (206 synthetic employees: 192 active, 13 resigned, 1 long leave), department/manager relationships and duplicate-name coverage. All employee/manager names, UUIDs and the source fingerprint are replaced. The private employee files are intentionally excluded.

The database and export tests create disposable PGlite instances and explicitly enable `hr.test_fixture` before loading the fixture. The seed rejects execution without that flag, or when employees/accounts already exist. Never apply it to production. No Supabase connection or credentials are needed for these tests.

`.openai/hosting.json` is a sanitized local-build configuration: the original `d1: null` and `r2: null` bindings are unchanged, while the private Sites project association is omitted. It enables local Vite/build verification and does not identify a deployable production project. See [development support provenance](docs/development-support.md).

`npm run dev` runs the Sites adapter; `npm run dev:vercel` runs standard Next.js. `npm run build` packages the Worker and `npm run build:vercel` validates the standard Next.js target. `npm run typecheck`, `npm run lint`, `npm run test:db` and `npm run test:exports` provide validation. Node.js 22.13 or newer is required.

Database credentials belong in encrypted server environment variables. An unconfigured installation denies login and all data access.
