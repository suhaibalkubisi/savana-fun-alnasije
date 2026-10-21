# Evening Follow-up screen and permission matrix

Release candidate, 14 October 2026. This describes the implemented software contract, not privileges assigned to real users. Evening scope, current authorization and dated department constraints are enforced on the server.

| Screen / workflow | Platform administrator | Follow-up operator / reviewer | Department supervisor | Read-only viewer |
|---|---|---|---|---|
| Today desk / daily / monthly position | Authorized scope | Assigned scope | Assigned dated departments | Assigned authorized scope |
| Search / UUID profile navigation | Authorized results only | Assigned results | Assigned results | Assigned results |
| Declaration draft / submission | Authorized scope | Authorized scope | Assigned dated department | Denied |
| Actual registry reporter without login | Record authorized reporter, separate entrant | Same | Assigned declaration scope | Denied |
| Review / return / correction / reconciliation | Authorized scope | Authorized scope | Read report state; review mutation denied | Read only |
| Actions | Manage authorized actions | Manage assigned scope | Update own assigned action | Read only |
| Contact register / manual communication | Manage authorized scope | Manage authorized scope | Read permitted register | Read permitted data |
| Evening handover | Create / update authorized scope | Create / update assigned scope | Read permitted handover | Read permitted handover |
| Profile enrichment | Independent `profile_edit` | Independent `profile_edit` | Explicit grant plus scope | Business write denied |
| Employee addition / dated transfer / service state | Explicit `roster_manage` | Explicit grant plus scope | Explicit grant plus scope | Denied |
| Operational private documents / photo | Independent read / write capabilities | Same | Explicit grant plus scope | Explicit read grant only |
| Restricted identity documents / reference | Independent sensitive read / write | Same | Explicit grant plus scope | Explicit read grant only |
| Upload resume / abandon / cleanup | Own original-uploader record only | Own original-uploader record only | Own original-uploader record only | Denied |
| Account creation / role / department assignment | Explicit role and reason; administrator only | Denied | Denied | Denied |
| Capability grant / revoke | Administrator; exact version and reason | Denied | Denied | Denied |
| Reporting policy / department order | Administrator only | Read configuration | Read configuration | Read configuration |
| Saved read-only views | Own account preferences | Own account preferences | Own account preferences | Own account preferences |
| PDF / XLSX / formal print | Canonical authorized result | Canonical assigned result | Canonical assigned result | Canonical permitted result |
| Legacy restricted archive | Explicit `archive_read` | Explicit `archive_read` | Explicit grant and server scope | Explicit grant and server scope |

Operational `profile_edit`, `documents_read` and `documents_write` default to administrator / Follow-up roles. Identity documents, roster maintenance and archive access have no automatic grant. Explicit decisions override defaults, never expand department scope and never make a viewer a business-data editor. Saved views are personal read preferences, not business record updates.

Primary/secondary phone and emergency-contact fields, including historical event values, require `profile_edit` or `documents_sensitive_read` to read. The private reference number requires sensitive read. Authorized search can match employee reference/phone fields only with those permissions; inaccessible values are not exposed as ordinary directory columns.

Profile enrichment cannot change employee UUID, permanent code or historical reporting. Dated roster maintenance is separate. An unassigned supervisor remains blocked until an administrator assigns the actual department. The software does not guess a department.

Generated private object paths and short-lived application grants require current session and capability checks. Originals and archived versions are immutable. Pending upload recovery and abandoned cleanup are restricted to the original uploader; administrator status does not authorize adopting another uploader’s pending file. Every content request rechecks current permissions.

UI visibility supports the server boundary. Viewer business writes, unauthorized direct RPCs, guessed employee/object UUIDs, cross-department access and direct public storage access are denied on the server and in storage. Ordinary attendance reports exclude private documents, full identity numbers and emergency-contact details.

Source implementation and isolated tests are separate from production readiness. This candidate does not authorize production migrations, real account upgrades, actual declarations or public deployment.
