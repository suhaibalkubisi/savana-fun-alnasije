# HR Management System

Arabic RTL employee and daily HR exception management. Next.js, React, TypeScript, Tailwind, Supabase PostgreSQL and Supabase Auth. Supports ADMIN, HR and VIEWER roles, immutable audit history, monthly matrices, employee summaries, XLSX/PDF export, printing and confirmed bulk import.

See [DEPLOYMENT.md](DEPLOYMENT.md) for runtime configuration and reproducible database setup, and [VERIFICATION.md](VERIFICATION.md) for tested behavior and the remaining live-service gate.

The initial source is fully analyzed in `data/import-summary.json`; `supabase/seed.sql` contains the 206 legitimate employees from AHH.xlsx. No example employees, passwords or exception records are included in the production seed. Test data lives only in disposable PostgreSQL test instances.

`npm run dev` runs the Sites adapter; `npm run dev:vercel` runs standard Next.js. `npm run build` packages the Worker and `npm run build:vercel` validates the standard Next.js target. `npm run typecheck`, `npm run lint`, `npm run test:db` and `npm run test:exports` provide validation. Node.js 22.13 or newer is required.

Database credentials belong in encrypted server environment variables. An unconfigured installation denies login and all data access.
