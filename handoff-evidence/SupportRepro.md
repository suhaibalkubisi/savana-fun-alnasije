# DRAFT ONLY — private Storage cache after authorization revocation

This is a sanitized support reproduction draft. It has not been sent externally.
All data is synthetic in the independent FREE test project
`oovfsstwhwkpvndepluy`. No production project was modified or used for this test.

Evidence was saved at **2026-10-21 19:17:29 UTC** in
`hosted/results/managed-evidence-storage-acl-only.json` (file modification time,
not a claimed provider request timestamp).

The private bucket has `public=false` and only the three intended policies:
authorized INSERT, authorized SELECT, and owner cleanup of abandoned objects.
No UPDATE policy or additional permissive SELECT policy was introduced.
The object was genuinely uploaded through the application to original managed
Storage using the user's JWT and `x-upsert:false`. Its response header reports
`Cache-Control: private, no-store`.

Sanitized endpoint shape:

```text
GET https://<TEST_PROJECT>.supabase.co/storage/v1/object/authenticated/fu-private/<synthetic-employee>/<synthetic-document>/v1
apikey: <test publishable key — omitted>
Authorization: Bearer <same synthetic user's genuine JWT — omitted>
```

Reproduction:

1. A synthetic FOLLOWUP user has department scope and `documents_read=true`.
   An authenticated GET of the original private object returns 200.
2. Synthetic ADMIN revokes that user's `documents_read` through the actual
   application's HTTPS API. The returned capability is `granted=false`.
3. With the **same genuine JWT**, original PostgREST `followup_session` reports
   `capabilities.documents_read=false`.
4. A test-only SECURITY INVOKER RPC evaluates the exact deployed
   `followup_private.storage_access(bucket,path,false)` helper using that JWT.
   It returns the correct synthetic FOLLOWUP actor, `database_role=authenticated`,
   and **`read_allowed=false`**.
5. The actual application's document metadata route returns **403**.
6. A GET of the **same original private Storage URL** nevertheless returns
   **200**, with:

   ```text
   Cache-Control: private, no-store
   CF-Cache-Status: HIT
   ```

7. A separate diagnostic GET with a unique `qa_cache_probe` query returns
   **400**, with `CF-Cache-Status: DYNAMIC`. This diagnostic is not substituted
   for the failed same-URL authorization test.
8. ADMIN explicitly restores the synthetic capability in `finally`. Both local
   application and transparent proxy ports are confirmed closed after the test.

Observed: the current database authorization and application deny access, while
a cached original Storage URL continues to deliver the private object's bytes.
Expected for this acceptance requirement: the original authenticated URL denies
the user after the live capability is revoked. We have not relabeled the cached
200 response as a pass and have not deployed an application workaround.

Provider request IDs were not captured for this first revocation reproduction.
No API key, JWT, password, cookie value, real employee identity or real document
is included here. The detailed sanitized evidence includes the native guard
result, HTTP statuses, cache headers and cleanup result. Production release is
blocked pending resolution/acceptance of this behavior and the other explicitly
unexecuted gates.

## Independent logout reproduction

A later separate native case first proved that a genuine object in another
department is denied to FOLLOWUP (400), while ADMIN can read it (200). It then
primed the original object URL with a new genuine FOLLOWUP session, logged out
through actual Next HTTP and original GoTrue, and confirmed the real
`auth.sessions` row was deleted. The same old unexpired JWT's native RLS helper
returned `read_allowed=false`. The same object URL still returned **200/HIT**
with `Cache-Control: private, no-store`; a separate unique-query request returned
**400/DYNAMIC**. The synthetic actor was reauthenticated in `finally`.

Sanitized provider trace IDs from this logout case:

| Request | CF-Ray | sb-request-id |
| --- | --- | --- |
| Same URL after logout: 200/HIT | `a4e2a1e7e9a1b73c-BGW` | `01a15fea-6cfc-75ba-8136-c02f252315d7` |
| Separate query diagnostic: 400/DYNAMIC | `a4e2a1e849d8b73c-BGW` | `01a15fea-6d2f-7bf3-a0e1-bee6cbe54b51` |

Evidence: `hosted/results/managed-evidence-storage-remaining.json`, saved at
**2026-10-21 19:22:45 UTC** (evidence file modification time). This is a
second failed immediate-access-revocation gate, not an authentication bypass
claim inferred from a mock. No credentials or authorization headers are included
in these trace IDs. Both local ports were closed after the case.
