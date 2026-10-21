import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  ready,
  grant,
  ids,
  employee,
  routeModule,
  dbDependencies,
  httpRequest,
} from "./staff-round2-fixture.mjs";

const evidenceDirectory = path.resolve("../n01-n02-2026-10-21");
const roles = {
  ADMIN: ids.admin,
  FOLLOWUP: ids.follow,
  SUPERVISOR: ids.supervisor,
  VIEWER: ids.viewer,
};
async function handlers(db, a, actor) {
  const route = await routeModule(
    "app/api/followup/route.ts",
    dbDependencies(db, a, actor),
  );
  return {
    post: async (kind, data, id) => {
      const response = await route.POST(
        httpRequest({ kind, data, request_id: id }),
      );
      return { status: response.status, data: await response.json() };
    },
    get: async (kind, filters) => {
      const response = await route.GET(
        new Request(
          "http://isolated.invalid/api/followup?" +
            new URLSearchParams({ kind, ...filters }),
        ),
      );
      return { status: response.status, data: await response.json() };
    },
  };
}
async function businessSnapshot(db) {
  await db.exec("reset role");
  return (
    await db.query(`select
    (select count(*)::int from fu_reports) reports,
    (select count(*)::int from fu_entries) entries,
    (select count(*)::int from fu_service_decisions) service_decisions,
    (select count(*)::int from employee_assignment_history) assignments,
    (select count(*)::int from fu_business_events) business_events,
    (select count(*)::int from fu_requests) durable_business_requests,
    (select jsonb_agg(jsonb_build_object('id',id,'version',version,'name',name,'employee_number',employee_number,'shift_id',shift_id,'employment_status',employment_status) order by id) from employees) employees
  `)
  ).rows[0];
}
const service = (eid) => ({
  employee_id: eid,
  version: 1,
  employment_status: "long_leave",
  valid_from: "2026-10-19",
  reason: "Synthetic API scope recovery decision",
});
const filters = (id, eid, kind = "service_state") => ({
  request_id: id,
  employee_id: eid,
  decision_kind: kind,
});

test("N02 actual GET/POST recovery handlers enforce all four roles, department scope, live capability and active account without business mutations", async () => {
  const { db, a } = await ready(),
    actor = { current: ids.admin },
    rows = [];
  try {
    for (const user of Object.values(roles))
      await grant(a, "service_manage", user);
    const h = await handlers(db, a, actor),
      before = await businessSnapshot(db);
    for (const [role, user] of Object.entries(roles)) {
      actor.current = user;
      const id = crypto.randomUUID(),
        eid = employee(20),
        data = service(eid),
        allowed = role !== "VIEWER";
      const staged = await h.post(
        "decision_recovery_stage",
        { kind: "service_state", data },
        id,
      );
      assert.equal(staged.status, allowed ? 200 : 403);
      const restored = await h.get("decision_recovery", filters(id, eid));
      assert.equal(restored.status, allowed ? 200 : 403);
      if (allowed) {
        assert.equal(restored.data.actor, user);
        assert.equal(restored.data.request_id, id);
        assert.deepEqual(restored.data.data, data);
      }
      const closed = await h.post(
        "decision_recovery_close",
        { employee_id: eid, decision_kind: "service_state" },
        id,
      );
      assert.equal(closed.status, allowed ? 200 : 403);
      if (allowed) {
        assert.equal(closed.data.state, "closed");
        const delayed = await h.post("service_state", data, id);
        assert.equal(
          delayed.status,
          409,
          "Same-RID tombstone must prevent a delayed business decision",
        );
        assert.equal(
          (
            await h.post(
              "decision_recovery_stage",
              { kind: "service_state", data },
              id,
            )
          ).status,
          409,
        );
        const readClosed = await h.get("decision_recovery", filters(id, eid));
        assert.equal(readClosed.data.state, "closed");
        assert.equal("data" in readClosed.data, false);
      }
      rows.push({
        role,
        scope: "assigned department",
        stage: staged.status,
        read: restored.status,
        close: closed.status,
      });

      const outsideId = crypto.randomUUID(),
        outside = employee(21),
        outsideData = service(outside);
      const outsideStage = await h.post(
        "decision_recovery_stage",
        { kind: "service_state", data: outsideData },
        outsideId,
      );
      const outsideRead = await h.get(
        "decision_recovery",
        filters(outsideId, outside),
      );
      const outsideClose = await h.post(
        "decision_recovery_close",
        { employee_id: outside, decision_kind: "service_state" },
        outsideId,
      );
      const outsideStatus = role === "ADMIN" ? 200 : 403;
      assert.equal(outsideStage.status, outsideStatus);
      assert.equal(outsideRead.status, outsideStatus);
      assert.equal(outsideClose.status, outsideStatus);
      rows.push({
        role,
        scope:
          role === "ADMIN"
            ? "other department; ADMIN has global authorized scope"
            : "outside assigned department",
        stage: outsideStage.status,
        read: outsideRead.status,
        close: outsideClose.status,
      });

      await db.exec("reset role");
      await db.query(
        "update fu_capabilities set granted=false where user_id=$1 and capability='service_manage'",
        [user],
      );
      assert.equal(
        (
          await h.post(
            "decision_recovery_stage",
            { kind: "service_state", data },
            crypto.randomUUID(),
          )
        ).status,
        403,
      );
      assert.equal(
        (await h.get("decision_recovery", filters(id, eid))).status,
        403,
      );
      assert.equal(
        (
          await h.post(
            "decision_recovery_close",
            { employee_id: eid, decision_kind: "service_state" },
            id,
          )
        ).status,
        403,
      );
      rows.push({
        role,
        condition: "revoked capability",
        stage: 403,
        read: 403,
        close: 403,
      });

      await db.exec("reset role");
      await db.query(
        "update fu_capabilities set granted=true where user_id=$1 and capability='service_manage'",
        [user],
      );
      await db.query("update fu_accounts set active=false where user_id=$1", [
        user,
      ]);
      assert.equal(
        (
          await h.post(
            "decision_recovery_stage",
            { kind: "service_state", data },
            crypto.randomUUID(),
          )
        ).status,
        403,
      );
      assert.equal(
        (await h.get("decision_recovery", filters(id, eid))).status,
        403,
      );
      assert.equal(
        (
          await h.post(
            "decision_recovery_close",
            { employee_id: eid, decision_kind: "service_state" },
            id,
          )
        ).status,
        403,
      );
      rows.push({
        role,
        condition: "disabled account",
        stage: 403,
        read: 403,
        close: 403,
      });
      await db.exec("reset role");
      await db.query("update fu_accounts set active=true where user_id=$1", [
        user,
      ]);
    }
    assert.deepEqual(
      await businessSnapshot(db),
      before,
      "Staging and closing only affect the recovery ledger, never employee/roster/attendance/business history",
    );
    await fs.mkdir(evidenceDirectory, { recursive: true });
    await fs.writeFile(
      path.join(evidenceDirectory, "n02-api-service-scope-evidence.json"),
      JSON.stringify(
        {
          environment:
            "Actual Next API handler functions with isolated PGlite; no native Auth/Storage/cookies assertion",
          checks: rows,
          no_business_mutation: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await db.close();
  }
});

test("N02 identity recovery restores exact private payload only to its actor under identity_edit and fails closed after scope, session or capability loss", async () => {
  const { db, a } = await ready(),
    actor = { current: ids.admin };
  try {
    for (const user of [ids.admin, ids.follow, ids.supervisor])
      await grant(a, "identity_edit", user);
    const h = await handlers(db, a, actor),
      before = await businessSnapshot(db),
      id = crypto.randomUUID(),
      eid = employee(20);
    const data = {
      employee_id: eid,
      version: 1,
      name: "Synthetic private N02 corrected name",
      employee_number: "PRIVATE-SYNTHETIC-N02",
      reason: "Synthetic private identity recovery reason",
    };
    const posted = await h.post(
      "decision_recovery_stage",
      { kind: "employee_identity", data },
      id,
    );
    assert.equal(posted.status, 200);
    const restored = await h.get(
      "decision_recovery",
      filters(id, eid, "employee_identity"),
    );
    assert.equal(restored.status, 200);
    assert.equal(restored.data.actor, ids.admin);
    assert.deepEqual(restored.data.data, data);

    actor.current = ids.follow;
    const anotherActor = await h.get(
      "decision_recovery",
      filters(id, eid, "employee_identity"),
    );
    assert.equal(anotherActor.status, 200);
    assert.equal(anotherActor.data.state, "not_found");
    assert.equal(
      "data" in anotherActor.data,
      false,
      "A different authorized actor must not receive the original actor's private payload",
    );
    const ownId = crypto.randomUUID();
    assert.equal(
      (
        await h.post(
          "decision_recovery_stage",
          { kind: "employee_identity", data },
          ownId,
        )
      ).status,
      200,
    );
    const own = await h.get(
      "decision_recovery",
      filters(ownId, eid, "employee_identity"),
    );
    assert.equal(own.data.actor, ids.follow);
    assert.deepEqual(own.data.data, data);
    const mismatch = await h.post(
      "decision_recovery_stage",
      {
        kind: "employee_identity",
        data: { ...data, reason: "Different private reason on the same RID" },
      },
      ownId,
    );
    assert.equal(mismatch.status, 409);

    await db.exec("reset role");
    await db.query(
      "update fu_capabilities set granted=false where user_id=$1 and capability='identity_edit'",
      [ids.follow],
    );
    assert.equal(
      (
        await h.get(
          "decision_recovery",
          filters(ownId, eid, "employee_identity"),
        )
      ).status,
      403,
    );
    await db.exec("reset role");
    await db.query(
      "update fu_capabilities set granted=true where user_id=$1 and capability='identity_edit'",
      [ids.follow],
    );
    await db.query(
      "update fu_departments set valid_to='2026-10-18' where user_id=$1 and department_id=$2",
      [ids.follow, ids.d1],
    );
    assert.equal(
      (
        await h.get(
          "decision_recovery",
          filters(ownId, eid, "employee_identity"),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await h.post(
          "decision_recovery_close",
          { employee_id: eid, decision_kind: "employee_identity" },
          ownId,
        )
      ).status,
      403,
    );
    await db.exec("reset role");
    await db.query(
      "update fu_departments set valid_to=null where user_id=$1 and department_id=$2",
      [ids.follow, ids.d1],
    );
    await db.query("delete from auth.sessions where user_id=$1", [ids.follow]);
    assert.equal(
      (
        await h.get(
          "decision_recovery",
          filters(ownId, eid, "employee_identity"),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await h.post(
          "decision_recovery_close",
          { employee_id: eid, decision_kind: "employee_identity" },
          ownId,
        )
      ).status,
      403,
    );

    actor.current = ids.admin;
    const close = await h.post(
      "decision_recovery_close",
      { employee_id: eid, decision_kind: "employee_identity" },
      id,
    );
    assert.equal(close.status, 200);
    assert.equal(close.data.state, "closed");
    assert.equal((await h.post("employee_identity", data, id)).status, 409);
    assert.deepEqual(await businessSnapshot(db), before);
    await fs.mkdir(evidenceDirectory, { recursive: true });
    await fs.writeFile(
      path.join(evidenceDirectory, "n02-api-identity-scope-evidence.json"),
      JSON.stringify(
        {
          environment:
            "Actual Next API handler functions with isolated PGlite; synthetic identity only",
          exact_private_restore: true,
          another_actor_not_found_without_payload: true,
          payload_change_rejected: 409,
          revoked_capability_rejected: 403,
          revoked_department_rejected: 403,
          deleted_session_rejected: 403,
          closed_same_RID_business_write_rejected: 409,
          no_business_mutation: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await db.close();
  }
});
