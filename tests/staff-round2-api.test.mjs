import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { z } from "zod";
import {
  ready,
  grant,
  ids,
  employee,
  routeModule,
  dbDependencies,
  httpRequest,
} from "./staff-round2-fixture.mjs";
test("R2 API role matrix checks real SQL permissions in actual GET/POST handlers, scope, revoked capability and disabled account", async () => {
  const { db, a } = await ready(),
    actor = { current: ids.admin },
    rows = [];
  try {
    for (const user of [ids.admin, ids.follow, ids.supervisor])
      await grant(a, "service_manage", user);
    const deps = dbDependencies(db, a, actor),
      route = await routeModule("app/api/followup/route.ts", deps);
    const post = async (kind, data) => {
      const response = await route.POST(
        httpRequest({ kind, data, request_id: crypto.randomUUID() }),
      );
      return { status: response.status, data: await response.json() };
    };
    const get = async (kind, filters) => {
      const response = await route.GET(
        new Request(
          "http://isolated.invalid/api/followup?" +
            new URLSearchParams({ kind, ...filters }),
        ),
      );
      return { status: response.status, data: await response.json() };
    };
    for (const [role, user] of Object.entries({
      ADMIN: ids.admin,
      FOLLOWUP: ids.follow,
      SUPERVISOR: ids.supervisor,
      VIEWER: ids.viewer,
    })) {
      actor.current = user;
      const profile = await get("profile", { employee_id: employee(20) });
      assert.equal(profile.status, 200);
      const result = await post("service_state", {
        employee_id: employee(20),
        version: profile.data.employee.version,
        employment_status: role === "ADMIN" ? "inactive" : "long_leave",
        valid_from: "2026-10-19",
        reason: "Synthetic API matrix " + role,
      });
      assert.equal(result.status, role === "VIEWER" ? 403 : 200);
      rows.push({
        role,
        operation: "service_state",
        scope: "authorized department",
        status: result.status,
      });
      if (role !== "ADMIN") {
        const outside = await get("actions", { employee_id: employee(21) });
        assert.equal(outside.status, 403);
        const writeOutside = await post("service_state", {
          employee_id: employee(21),
          version: 1,
          employment_status: "resigned",
          valid_from: "2026-10-19",
          reason: "Out-of-scope API attempt",
        });
        assert.equal(writeOutside.status, 403);
        rows.push({
          role,
          operation: "read/write",
          scope: "outside department",
          status: 403,
        });
      }
      const account = await post("account", {
        user_id: ids.viewer,
        version: 1,
        role: "VIEWER",
        active: true,
        departments: [ids.d1],
        reason: "Synthetic account authorization matrix",
      });
      assert.equal(
        account.status,
        role === "ADMIN" ? 200 : 403,
        JSON.stringify(account),
      );
      rows.push({ role, operation: "account", status: account.status });
      const newAction = await post("action", {
        employee_id: employee(20),
        department_id: ids.d1,
        responsible_id: ids.supervisor,
        description: "Synthetic " + role + " action",
        due_date: "2026-10-19",
      });
      assert.equal(
        newAction.status,
        ["ADMIN", "FOLLOWUP"].includes(role) ? 200 : 403,
      );
      rows.push({ role, operation: "create_action", status: newAction.status });
      if (role === "ADMIN") {
        actor.current = ids.supervisor;
        const own = await post("action", {
          ...newAction.data,
          state: "progress",
          notes: "Allowed supervisor note",
          comment: "Allowed supervisor comment",
        });
        assert.equal(own.status, 200, JSON.stringify(own));
        assert.equal(
          (
            await post("action", {
              ...own.data,
              description: "Forbidden supervisor replacement",
              responsible_id: ids.admin,
              state: "completed",
            })
          ).status,
          403,
        );
        actor.current = user;
        rows.push({
          role: "SUPERVISOR",
          operation: "own action state/comment only",
          status: 200,
          forbidden_description: 403,
        });
      }
      await db.exec("reset role");
      await db.query(
        "update fu_capabilities set granted=false where user_id=$1 and capability=$2",
        [user, "service_manage"],
      );
      actor.current = user;
      const revoked = await post("service_state", {
        employee_id: employee(20),
        version: 100,
        employment_status: "active",
        valid_from: "2026-10-19",
        reason: "Revoked capability must be checked first",
      });
      assert.equal(revoked.status, 403);
      rows.push({
        role,
        operation: "revoked_capability",
        status: revoked.status,
      });
      await db.exec("reset role");
      await db.query("update fu_accounts set active=false where user_id=$1", [
        user,
      ]);
      assert.equal(
        (await get("profile", { employee_id: employee(20) })).status,
        403,
      );
      assert.equal(
        (
          await post("action", {
            department_id: ids.d1,
            description: "Disabled account attempt",
          })
        ).status,
        403,
      );
      rows.push({
        role,
        operation: "disabled_account read/write",
        status: 403,
      });
      await db.exec("reset role");
      await db.query("update fu_accounts set active=true where user_id=$1", [
        user,
      ]);
    }
    await fs.mkdir("work/round2-flow", { recursive: true });
    await fs.writeFile(
      "work/round2-flow/api-role-matrix.json",
      JSON.stringify(
        {
          environment:
            "Actual app route handlers + isolated PGlite authorization; not native provider",
          checks: rows,
        },
        null,
        2,
      ),
    );
  } finally {
    await db.close();
  }
});
test("R2 account API handles success, lost provider reply, partial setup and repeated POST without issuing a second provider create", async () => {
  const { db, a } = await ready(),
    actor = { current: ids.admin },
    provider = new Map();
  let mode = "success",
    creates = 0,
    failAccount = false;
  try {
    const deps = dbDependencies(db, a, actor),
      originalRpc = deps.rpc;
    deps.z = z;
    deps.rpc = async (fn, args) => {
      if (args.p_kind === "account" && failAccount) {
        failAccount = false;
        throw Object.assign(new Error("Synthetic partial configuration"), {
          __dbStatus: 503,
        });
      }
      return originalRpc(fn, args);
    };
    deps.upstream = async (url, opts = {}) => {
      if (opts.method === "POST") {
        creates++;
        const p = JSON.parse(opts.body);
        if (mode === "reject")
          return {
            response: new Response(null, { status: 422 }),
            data: { code: "validation_failed" },
          };
        if (mode === "duplicate")
          return {
            response: new Response(null, { status: 409 }),
            data: { code: "email_exists" },
          };
        if (mode === "lost-before") throw Error("Lost before provider result");
        const id = crypto.randomUUID();
        provider.set(id, { id, email: p.email });
        await db.exec("reset role");
        await db.query(
          "insert into profiles(id,name,email,role,is_active) values($1,$2,$3,'VIEWER',true)",
          [id, p.user_metadata.name, p.email],
        );
        await a.who(actor.current);
        if (mode === "lost-after")
          throw Error("Lost after provider created user");
        return { response: new Response(null, { status: 200 }), data: { id } };
      }
      if (url.includes("?"))
        return {
          response: new Response(null, { status: 200 }),
          data: { users: [...provider.values()] },
        };
      const value = provider.get(url.split("/").at(-1));
      return {
        response: new Response(null, { status: value ? 200 : 404 }),
        data: value || {},
      };
    };
    const route = await routeModule("app/api/users/route.ts", deps);
    const post = async (data) => {
      const r = await route.POST(
        httpRequest(data, "http://isolated.invalid/api/users"),
      );
      return { status: r.status, data: await r.json() };
    };
    const get = async (id) => {
      const r = await route.GET(
        new Request("http://isolated.invalid/api/users?request_id=" + id),
      );
      return { status: r.status, data: await r.json() };
    };
    // Network loss before the app receives POST: close and claim serialize on the same request.
    const missing = crypto.randomUUID();
    assert.equal((await get(missing)).data.state, "not_found");
    assert.equal(
      (await post({ close_unstarted_request_id: missing })).data.state,
      "not_started",
    );
    const delayed = {
      name: "Delayed request",
      email: "delayed@candidate.invalid",
      password: "Synthetic-Password-2026!",
      role: "VIEWER",
      departments: [],
      reason: "Synthetic delayed request",
      request_id: missing,
    };
    assert.equal((await post(delayed)).status, 409);
    assert.equal(
      creates,
      0,
      "A delayed POST cannot create after atomic closure",
    );
    const claimed = crypto.randomUUID();
    await originalRpc("followup_write", {
      p_kind: "account_creation_begin",
      p_request_id: claimed,
      p_data: {
        name: "Already claimed",
        email: "claimed@candidate.invalid",
        role: "VIEWER",
        departments: [],
        reason: "Synthetic in-flight request",
      },
    });
    assert.equal(
      (await post({ close_unstarted_request_id: claimed })).data.state,
      "pending",
      "Closing must not cancel an already claimed provider request",
    );
    for (const scenario of [
      "success",
      "lost-after",
      "partial",
      "lost-before",
      "reject",
      "duplicate",
    ]) {
      mode = scenario === "partial" ? "success" : scenario;
      failAccount = scenario === "partial";
      const before = creates;
      const p = {
        name: "Synthetic " + scenario,
        email: scenario + "@candidate.invalid",
        password: "Synthetic-Password-2026!",
        role: "VIEWER",
        departments: [],
        reason: "Explicit synthetic " + scenario + " account",
        request_id: crypto.randomUUID(),
      };
      let result = await post(p);
      assert.equal(creates, before + 1);
      const proof = await get(p.request_id);
      assert.equal(proof.status, 200);
      if (["lost-after", "partial"].includes(scenario)) {
        assert.notEqual(result.status, 200);
        assert.ok(proof.data.found_user_id);
        result = await post({
          recovery_request_id: p.request_id,
          user_id: proof.data.found_user_id,
        });
        assert.equal(result.status, 200);
        assert.equal((await get(p.request_id)).data.state, "configured");
        assert.equal(creates, before + 1);
      } else if (scenario === "success") {
        assert.equal(result.status, 200, JSON.stringify(result));
        assert.equal(proof.data.state, "configured");
      } else if (scenario === "reject") {
        assert.equal(result.status, 422);
        assert.equal(proof.data.state, "rejected");
      } else if (scenario === "duplicate") {
        assert.equal(result.status, 409);
        assert.equal(proof.data.state, "duplicate");
      } else {
        assert.notEqual(result.status, 200);
        assert.equal(proof.data.found_user_id, null);
        assert.equal((await post(p)).status, 503);
      }
      if (["success", "lost-after", "partial"].includes(scenario)) {
        assert.equal((await post(p)).status, 200);
        assert.equal(creates, before + 1);
      }
    }
    actor.current = ids.viewer;
    assert.equal((await post({})).status, 403);
  } finally {
    await db.close();
  }
});
