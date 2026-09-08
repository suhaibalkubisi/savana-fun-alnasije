import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { authenticationFailure } from "../lib/server/auth-error.mjs";
import {
  operationalSummary,
  effectiveDepartmentRule,
} from "../lib/hr/operational-summary.mjs";

test("upstream outage is not reported as an incorrect password", () => {
  assert.equal(authenticationFailure(500, "unexpected_failure").status, 503);
  assert.doesNotMatch(
    authenticationFailure(401, "invalid_api_key").message,
    /غير صحيحة/,
  );
});
test("invalid credentials and rate limits have distinct safe errors", () => {
  assert.equal(authenticationFailure(400, "invalid_credentials").status, 401);
  assert.equal(
    authenticationFailure(429, "over_request_rate_limit").status,
    429,
  );
  assert.equal(authenticationFailure(400, "email_not_confirmed").status, 403);
});
test("task counts respect manual decisions and never turn no entry into absence", () => {
  const result = operationalSummary([
    { status: "no_entry", expected: true },
    { status: "absence2", expected: true },
    { status: "leave", expected: true },
    { status: "late", late_minutes: 27, expected: true },
    { status: "present", expected: true },
    { status: "off_day", expected: false },
    { status: "missing_schedule", expected: true, needs_review: true },
  ]);
  assert.deepEqual(result, {
    expected: 6,
    present: 1,
    late: 1,
    lateMinutes: 27,
    absence: 1,
    leave: 1,
    noEntry: 1,
    review: 1,
  });
});
test("department default resolver respects effective date without fabricating a name", () => {
  const rules = [
    {
      department_id: "a",
      effective_from: "2026-09-01",
      default_manager_id: "old",
    },
    {
      department_id: "a",
      effective_from: "2026-09-10",
      default_manager_id: "new",
    },
  ];
  assert.equal(
    effectiveDepartmentRule(rules, "a", "2026-09-08").default_manager_id,
    "old",
  );
  assert.equal(
    effectiveDepartmentRule(rules, "a", "2026-09-10").default_manager_id,
    "new",
  );
  assert.equal(effectiveDepartmentRule(rules, "b", "2026-09-10"), null);
});
test("active UI and PDF sources use SAVANA rather than the legacy bitmap", async () => {
  for (const path of ["components/hr/app.tsx", "lib/hr/exports.ts"]) {
    const source = await readFile(path, "utf8");
    assert.doesNotMatch(source, /savanna/i);
    assert.match(source, /SAVANA/);
  }
});
