# HR Management System

A Next.js / React / TypeScript application built with the Sites Vinext worker adapter. PostgreSQL and authentication use Supabase over HTTPS. No application data is stored in browser storage. Supabase is not provisioned by this repository.

## Runtime configuration

Set these variables in the hosting provider's encrypted environment settings:

- `NEXT_PUBLIC_SUPABASE_URL`: the project's HTTPS URL.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: the project's new `sb_publishable_…` API key.
- `SUPABASE_SECRET_KEY`: the new `sb_secret_…` API key, used only for account creation and signing import confirmations. It never appears in client code.

The secret key is server-only. Both API keys travel only in the `apikey` header; `Authorization: Bearer` carries a signed-in user JWT. Server administrative requests have no user bearer token. The application deliberately has no fallback to legacy environment variable names. Built-in PostgreSQL roles (`anon`, `authenticated`, `service_role`) keep their standard names.

No credentials are committed. Copy `.env.example` for local configuration. On Sites, use its runtime environment settings. Keep site access private until the intended HR users have been granted access. Sites also has its own outer access gate; Supabase accounts do not grant Sites access automatically.

## Database and initial import

The three application values do not provide a PostgreSQL migration connection. Applying DDL requires a database-owner connection or authorized Supabase management access.

1. Apply `supabase/migrations/202609040001_hr.sql` as the database migration owner to a clean Supabase project.
2. For an authorized new installation only, obtain any approved initial employee data separately. The public `supabase/seed.sql` is TEST ONLY and must never be applied to production. Existing production data must not be re-imported or reset.
3. Run `node scripts/bootstrap-admin.mjs` from a trusted interactive terminal with the server variables set. It requests an admin email, name, and hidden password. It refuses to replace an existing active administrator.
4. Disable public signups in Supabase Auth, enable a suitable password policy and production auth rate limits, and keep the database backup/PITR settings appropriate to the organization's retention policy. The profile trigger still creates any unexpected signup as disabled VIEWER, so signup alone never grants access.

The original private import had 206 records, 192 active, 13 resigned, one long leave, ten departments and one duplicate name across two departments. Its employee source files and production seed are excluded from this public repository. The test-only seed preserves these structural assumptions using synthetic identities. It is not evidence of the contents of the current live database. See [development support provenance](docs/development-support.md).

## Validation and packaging

- `node --test tests/supabase-connection.test.mjs`
- `npm run typecheck`
- `npm run lint`
- `npm run test:db` (real PostgreSQL engine in PGlite, with a minimal Supabase auth-schema fixture; does not certify hosted GoTrue or hosted PostgREST)
- `npm run build` (the bundled verified Worker build)
- `npm run build:vercel` (standard Next.js build for a Vercel deployment)

Sites deployment uses its native version and deployment workflow. The public `.openai/hosting.json` retains only the original non-secret local binding settings; it intentionally excludes the production project identifier and is not a deployment association. This development-support change does not deploy, create a Site or change the existing Site configuration. Authorized production deployment must use the original private project configuration. For Vercel, set build command `npm run build:vercel`, configure the same server variables and use the PostgreSQL migrations above. The app uses only Next-compatible APIs except the environment binding adapter; `next.config.ts` aliases that adapter for the standard Next build.

## Permissions and integrity

All base tables have RLS enabled. Authenticated users have no direct table mutation grants. Public RPCs enforce ADMIN/HR/VIEWER roles from the live, enabled profile on every call. SECURITY DEFINER functions have an empty search_path and no PUBLIC/anonymous execute privileges. The bootstrap RPC is available only to service_role. Table triggers record old/new values in an append-only audit log; audit modifications are blocked.

Mutations use optimistic revisions, foreign keys, checked status values and a partial unique index on employee/date. Bulk imports are one transaction, bound to the admin, expire after ten minutes, are HMAC signed, preserve absent optional columns on updates, and detect repeated files. Employee records are never hard deleted; exception deletion is a confirmed audited soft delete. Corrections to historical exceptions are allowed after resignation; new entries require an active employee.

Current monthly reports use current department assignment. Historical exceptions retain employee identity; historical department snapshots are available through the audit trail rather than a separate effective-dated department report. Reports optionally include inactive employees.

PDF reports use A3 landscape and split the month into 1–15 and 16–month-end sections to preserve readable Arabic names and repeated table headers. Excel exports contain typed values and status codes. Print uses A3 landscape CSS.

## Remaining deployment gate

A live Supabase project, its encrypted environment values, applied migrations, authorized private initial data where required, and a first administrator are required for operational publication. The public test seed must not be used for this. Local schema, code, and isolated tests are not proof of a live database or live authentication. Configure these before calling the system production ready. Perform live login/logout, refresh-token, multi-account, and database-backup verification after connection.

Reference documentation: https://supabase.com/docs/guides/getting-started/api-keys and https://supabase.com/docs/guides/database/functions
