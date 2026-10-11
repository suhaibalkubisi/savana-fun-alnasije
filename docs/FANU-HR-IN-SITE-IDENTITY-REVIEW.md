# Company identity review inside FANU HR

Authorized ADMIN/HR reviewers load the reviewed proposal from a private database record. Employee data and original evidence are never bundled into public assets. VIEWER and anonymous callers cannot read or submit the batch.

Select reviewed candidates by department, correct existing employee targets with separate evidence, and exclude uncertain cases. Selections start unchecked. One explicit confirmation saves the exact selections. A separate apply action uses that immutable receipt; retrying it does not duplicate mappings. Unselected identities remain unresolved and can be reviewed in a later batch revision.

The server checks the live Auth session/profile, company source, batch and employee revisions, both open preview revisions, raw identity rows/issues and the complete mapping checkpoint. It locks previews in deterministic order and applies selected identity rows/issues transactionally, retaining the original proposal and audit records. It never creates employees, changes historical assignments/schedules/coverage, closes imports or approves attendance. Verified counts and the persistent receipt are displayed after application.

Outside-window punches show their original local times, source rows and effective rule. Missing coverage cannot become trusted absence. Shared business evidence can be saved privately inside the website; evidence notes do not establish historical facts or confirm coverage.

Release adds only the company identity batch migration: three private RLS-protected tables, four authenticated gateways, one private guard, and an import/person-code lookup index. Foundational migrations are not replayed. Recovery and managed-role rehearsal precede production changes. Native write acceptance uses synthetic GoTrue/PostgREST/PostgreSQL sessions and actual handlers, including a 144-identity/4,443-row transaction. Production acceptance reads the real proposal without confirming it.
