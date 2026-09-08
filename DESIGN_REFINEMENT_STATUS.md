# Existing-site visual refinement and twelve-hour time display

Implemented 2026-09-08 in the existing HR application.

- Shared screen theme applied through the root layout, with stronger Arabic weights, navy navigation, compact filters, uniform tables, dialogs and status badges.
- Split corporate login layout using the existing original FANU logo; no original brand bitmap was edited.
- Collapsible icon navigation with tooltips, current-user header, global search trigger and daily-operation links using existing authorized routes.
- Reorganized dashboard metric layout using the existing database response, with no invented statistics.
- Shared twelve-hour Arabic clock display for fingerprint preview, daily position, schedules, organizational view and their exports. Audit timestamps explicitly use twelve-hour Asia/Baghdad formatting.
- Schedule editing uses hour, minute and AM/PM choices; database minute values and raw fingerprint evidence remain unchanged.
- No database migration, data mutation, authentication change, permission change or password reset in this update.

Validation: TypeScript and lint passed. All 55 automated tests passed, including all 1,440 schedule-minute round trips, noon/midnight, evening and next-day display, and editable XLSX time labels. Production build passed.

Browser QA limitation: the Cloud browser rejected the preview reload under its URL policy. No alternative browser path or authentication bypass was attempted. Authenticated visual QA, mobile visual inspection and live CRUD were not performed for this update. Automated tests run against isolated test data, not the production database.

The larger HRIS expansion (custom roles, document management and other unfinished modules) is outside this bounded visual/time-display update and must not be reported as completed.
