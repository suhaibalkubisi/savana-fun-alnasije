import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { ready, ids, routeModule, dbDependencies, httpRequest } from "./staff-round2-fixture.mjs";

test("N01 raw Auth error_code controls definitive duplicate classification without weakening rejection or unknown recovery", async () => {
  const { db, a } = await ready();
  const actor = { current: ids.admin };
  try {
    await db.exec("reset role");
    const accountsBefore = (await db.query("select count(*)::int n from fu_accounts")).rows[0].n;
    await a.who(ids.admin);
    for (const [name, status, data, expected, state] of [
      ["native duplicate", 422, { code: 422, error_code: "email_exists" }, 409, "duplicate"],
      ["native alternate duplicate", 422, { code: 422, error_code: "user_already_exists" }, 409, "duplicate"],
      ["legacy duplicate", 409, { code: "email_exists" }, 409, "duplicate"],
      ["native validation", 422, { code: 422, error_code: "validation_failed" }, 422, "rejected"],
      ["numeric status alone", 422, { code: 422 }, 422, "rejected"],
      ["native code precedes legacy", 422, { code: "email_exists", error_code: "validation_failed" }, 422, "rejected"],
      ["malformed native code falls back", 409, { code: "user_already_exists", error_code: 422 }, 409, "duplicate"],
      ["throttled", 429, { code: 429, error_code: "over_request_rate_limit" }, 429, "unknown"],
      ["unavailable", 503, { code: 503, error_code: "unexpected_failure" }, 503, "unknown"],
      // This stub throws a generic Error; real upstream maps network loss to503.
      ["lost transport", 0, null, 500, "unknown"],
    ]) {
      let creates = 0;
      const deps = dbDependencies(db, a, actor);
      deps.z = z;
      deps.upstream = async () => {
        creates++;
        if (!status) throw Error("Synthetic lost provider transport");
        return { response: new Response(null, { status }), data };
      };
      const route = await routeModule("app/api/users/route.ts", deps);
      const input = { name: "Synthetic provider shape", email: crypto.randomUUID() + "@candidate.invalid", password: "Synthetic-N01-Password!", role: "VIEWER", departments: [], reason: "Explicit isolated provider error acceptance", request_id: crypto.randomUUID() };
      const post = async value => route.POST(httpRequest(value, "http://isolated.invalid/api/users"));
      const response = await post(input);
      assert.equal(response.status, expected, name);
      const result = await response.json();
      if (state === "duplicate") assert.match(result.error, /الحساب موجود بالفعل/, name);
      await db.exec("reset role");
      const row = (await db.query("select state,created_user_id from fu_account_creations where user_id=$1 and request_id=$2", [ids.admin, input.request_id])).rows[0];
      assert.equal(row.state, state, name);
      assert.equal(row.created_user_id, null, name);
      assert.equal((await db.query("select count(*)::int n from fu_requests where user_id=$1 and request_id=$2", [ids.admin, input.request_id])).rows[0].n, 0, name);
      assert.equal((await db.query("select count(*)::int n from fu_accounts")).rows[0].n, accountsBefore, name);
      await a.who(ids.admin);
      if (state === "unknown") {
        assert.equal((await post(input)).status, 503, name);
        assert.equal((await post({ ...input, request_id: crypto.randomUUID() })).status, 409, name);
      }
      assert.equal(creates, 1, name + " must not repeat ambiguous provider creation");
    }
  } finally {
    await db.close();
  }
});
