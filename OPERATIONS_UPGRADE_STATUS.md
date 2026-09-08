# Evening operations refinement

This change extends the existing production project. It does not complete the entire HRIS transformation brief.

## Implemented

- Safe login failure classification; upstream configuration or service errors are no longer labelled as incorrect credentials.
- Accessible password visibility control; no password reset or account changes.
- Explicit client request timeout with an uncertain-write warning, no automatic retry of mutations.
- Correct visible SAVANA text in login and monthly PDF. The legacy bitmap is no longer rendered; original FANU assets remain unchanged. Correct SAVANA text is not represented as a replacement official logo.
- Search employees by name/number, active fingerprint codes, departments, and explicit employee manager assignments.
- Quick operations menu, evening HR task center, date-effective department schedule/default-responsible overview.
- Real task values from existing authorized queries; manual HR status takes precedence over fingerprint interpretation.
- Query parameters now open the actual selected department, manager, daily status/date, or open administrative-action filter.
- Lazy-loaded operational modules and scoped polling for enabled requests.

## Production read-only checks

- Existing project: 206 employees, 75 HR status records, 2 profiles, both active; 1 active full-access ADMIN.
- Public Supabase authentication settings returned HTTP 200 with email login enabled.
- These checks do not validate an individual password or a successful login.
- No database migration, data import, permission change, password change or deletion was performed in this refinement.

## Not yet completed / not verified

- The user's rejected sign-in attempt has not been reproduced or diagnosed to a specific upstream code. Do not claim login fixed.
- Authenticated browser testing of the new internal screens remains outstanding.
- Full custom roles, department-scoped permissions, leave approvals, official document storage/numbering, configurable signatures, complete historic transfers and the expanded HRIS settings require further implementation and security review.
- No claim of comprehensive visual PDF/Excel QA for this refinement. Automated existing export tests cover the shared export engine.
- Existing department overview shows current employee membership and date-effective rules, not a reconstructed historic organization chart.
- Global search does not yet include documents or administrative-action references; fingerprint-code results cover active employees only.
