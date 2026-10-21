# Controlled evening release amendment — 14 October 2026

This amendment descends from saved v37, source 5208e4cf3526dec8459be122a5ce97e2567244d3. It preserves the existing Sites/Supabase identities and hostname. Earlier candidate documents describe their historical pre-release state; the deployment receipt in the private task outputs is authoritative for the actual release.

## Required migrations

Apply only 20261013223509_evening_release_candidate.sql (SHA256 8ee5a113a3530848d371d3eb38e2dd57a36b0a9a75a3c28d4abe0b9085d088fd) and the reviewed additive 20261014181643_evening_controlled_roster_setup.sql (SHA256 ce5ada98eeaafa0fec81f7a5cbb2195db9d7f0f6795caf2fe7f490e267adb73b). Do not replay archived migrations. The native runner verifies full original-column values and existing migration history, and commits both schema changes and exact SQL history records atomically.

## Business setup remains explicit

The authorized employee directory includes all existing employees regardless of their recorded shift. It labels unverified membership separately. Only a dated, verified evening assignment belongs to the operating roster. Empty report information stays unknown.

Roster managers select actual employees, provide a reason and effective date, review a preview, and confirm one decision. No automatic selection, relabeling or backdating occurs. A interrupted confirmation retains only its preview/request IDs and reconciles the same decision before any new write.

Administrators explicitly assign departments and account roles. Existing future or expired assignment dates remain intact unless the operator explicitly selects current activation. No department or privilege is guessed.

## Export capacity and privacy

Server preparation has two active and24 waiting requests per Worker isolate, with a60second queue bound. Browser preparation and rendering use one active pipeline and24 waiting jobs, with a120second bound. These are per-runtime limits, not a global fleet semaphore. Overload returns429 with Retry-After; confirmed transient503 responses have bounded retries. Cancellation and ambiguous errors never report a downloaded success.

Directory exports state authorized-directory scope and preserve all server-authorized search matches without copying private phone/reference search values. Every dated operational report requires evening scope. Directory management printing retains directory rows.

## Recovery and verification

A fresh native production custom archive was restored in an owned isolated PostgreSQL17 cluster. Complete values across73 tables and45877 rows, identities, assignments, declarations, revisions, audit, Auth and Storage metadata matched; functions, security grants, policies, triggers and constraints matched. Storage had no objects or buckets at checkpoint. Empty Vault is retained in the raw archive but unavailable in native Windows PG; zero secrets and measured application dependencies justify the explicit exception. Managed platform behavior still requires hosted Auth/Storage verification.

Migration rehearsal passed without changing original values. Vanilla PG lacks Supabase's supautils Storage policy ownership bypass, so only the owned isolated executor temporarily used SUPERUSER for this rehearsal; all original role attributes were restored. Production privileges remain unchanged. Four provider metadata tables permit only ACCESS SHARE locks; complete before/after values are checked, while application/Auth-user/session/Storage-object writes are frozen for the short transaction.

277 full regressions passed, with additional focused export/transport/setup checks. The original isolated20 global request workload returned20 complete229-employee,31day models with no retries or lost/duplicate rows (p95 48.8s).20 actual rendering jobs completed with peak concurrency1 (87.1s total), including10 PDFs with42 pages and all229 permanent codes independently extracted, and10 branded RTL XLSX files. This isolated test uses synthetic Auth/Storage; it is not evidence of hosted managed service success or native Excel printing.

Logout clears local credentials only after managed Auth confirms revocation. Unconfirmed responses retain credentials for explicit retry. Hosted replay tests must prove old sessions are denied.
