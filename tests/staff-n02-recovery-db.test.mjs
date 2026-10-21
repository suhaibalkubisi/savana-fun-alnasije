import test from "node:test";
import assert from "node:assert/strict";
import { ready, grant, ids, employee } from "./staff-round2-fixture.mjs";
const data = () => ({
  employee_id: employee(20),
  version: 1,
  employment_status: "long_leave",
  valid_from: "2026-10-19",
  reason: "Synthetic private staged reason",
});
const stage = (a, p, id) =>
  a.write("decision_recovery_stage", { kind: "service_state", data: p }, id);
const read = (a, id, eid = employee(20)) =>
  a.read("decision_recovery", {
    request_id: id,
    employee_id: eid,
    decision_kind: "service_state",
  });
test("N02 durable staging is immutable and actor-bound, live-rechecks permission/session and preserves exact retry without business effects", async () => {
  const { db, a } = await ready();
  try {
    await grant(a, "service_manage");
    const p = data(),
      id = crypto.randomUUID();
    const staged = await stage(a, p, id);
    assert.equal(staged.state, "staged");
    assert.deepEqual(staged.data, p);
    await db.exec("reset role");
    assert.equal(
      (await db.query("select count(*)::int n from fu_service_decisions"))
        .rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query("select version from employees where id=$1", [
          employee(20),
        ])
      ).rows[0].version,
      1,
    );
    await a.who(ids.admin);
    await assert.rejects(
      stage(a, { ...p, reason: "Changed reason" }, id),
      (e) => e.code === "PT409",
    );
    assert.deepEqual((await read(a, id)).data, p);
    await a.write("service_state", p, id);
    assert.equal((await read(a, id)).state, "committed");
    await db.exec("reset role");
    await db.query(
      "update fu_capabilities set granted=false where user_id=$1 and capability='service_manage'",
      [ids.admin],
    );
    await a.who(ids.admin);
    await assert.rejects(read(a, id), (e) => e.code === "42501");
    await assert.rejects(stage(a, p, id), (e) => e.code === "42501");
    await grant(a, "service_manage", ids.follow);
    await a.who(ids.follow);
    assert.equal((await read(a, id)).state, "not_found");
    await assert.rejects(read(a, id, employee(21)), (e) => e.code === "42501");
    await db.exec("reset role");
    await db.query("update fu_accounts set active=false where user_id=$1", [
      ids.follow,
    ]);
    await a.who(ids.follow);
    await assert.rejects(read(a, id), (e) => e.code === "42501");
  } finally {
    await db.close();
  }
});
test("N02 legacy committed payload recovers from exact fu_requests; atomic close safely blocks delayed unstaged writes without cancelling committed requests", async () => {
  const { db, a } = await ready();
  try {
    await grant(a, "service_manage");
    const p = data(),
      committed = crypto.randomUUID();
    await a.write("service_state", p, committed);
    const proof = await read(a, committed);
    assert.equal(proof.state, "committed");
    assert.deepEqual(proof.data, p);
    const closedSaved = await a.write(
      "decision_recovery_close",
      { employee_id: p.employee_id, decision_kind: "service_state" },
      committed,
    );
    assert.equal(closedSaved.state, "committed");
    const missing = crypto.randomUUID();
    assert.equal((await read(a, missing)).state, "not_found");
    const closed = await a.write(
      "decision_recovery_close",
      { employee_id: p.employee_id, decision_kind: "service_state" },
      missing,
    );
    assert.equal(closed.state, "closed");
    await assert.rejects(
      a.write("service_state", { ...p, version: 2 }, missing),
      (e) => e.code === "PT409",
    );
    await assert.rejects(
      stage(a, { ...p, version: 2 }, missing),
      (e) => e.code === "PT409",
    );
    assert.equal((await read(a, missing)).state, "closed");
    await db.exec("reset role");
    assert.equal(
      (await db.query("select count(*)::int n from fu_service_decisions"))
        .rows[0].n,
      1,
    );
    await db.exec("reset role");
    await db.query("delete from auth.sessions where user_id=$1", [ids.admin]);
    await a.who(ids.admin);
    await assert.rejects(read(a, committed), (e) => e.code === "42501");
  } finally {
    await db.close();
  }
});
