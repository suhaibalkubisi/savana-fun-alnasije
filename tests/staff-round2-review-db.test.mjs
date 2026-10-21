import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { setup, api, ids, employee } from "./evening-db-fixture.mjs";

async function ready() {
  const db = await setup();
  await db.exec(
    await fs.readFile(
      "supabase/migrations/20261014181643_evening_controlled_roster_setup.sql",
      "utf8",
    ),
  );
  await db.exec(
    await fs.readFile(
      process.env.FANU_TEST_PROPOSAL || "supabase/proposals/staff-repairs.sql",
      "utf8",
    ),
  );
  await db.exec(
    "create or replace function followup_private.today() returns date language sql stable as $$select '2026-10-19'::date$$",
  );
  const a = api(db);
  await a.who(ids.admin);
  return { db, a };
}

test("R2 review: an authorized empty individual result still validates department, shift, date range, and live account", async () => {
  const { db, a } = await ready();
  try {
    await a.who(ids.supervisor);
    const eid = employee(20);
    for (const kind of ["position", "reports", "completeness"]) {
      assert.deepEqual(await a.read(kind, { employee_id: eid }), []);
      for (const [filter, code] of [
        [{ department_id: ids.d2 }, "42501"],
        [{ shift_id: ids.morning }, "22023"],
        [{ start: "2026-10-22", end: "2026-10-19" }, "22023"],
        [{ start: "2026-01-01", end: "2027-01-03" }, "22023"],
      ])
        await assert.rejects(
          a.read(kind, { employee_id: eid, ...filter }),
          (e) => e.code === code,
          kind + " must retain filter guard " + JSON.stringify(filter),
        );
      await assert.rejects(
        a.read(kind, { employee_id: employee(21) }),
        (e) => e.code === "42501",
      );
    }
    await db.exec("reset role");
    await db.query("update fu_accounts set active=false where user_id=$1", [
      ids.supervisor,
    ]);
    await a.who(ids.supervisor);
    await assert.rejects(
      a.read("position", { employee_id: eid }),
      (e) => e.code === "42501",
    );
  } finally {
    await db.close();
  }
});

test("R2 review: a committed service request replays after Baghdad midnight while new backdated requests and revoked permissions remain rejected", async () => {
  const { db, a } = await ready();
  try {
    await a.write("capability", {
      user_id: ids.admin,
      capability: "service_manage",
      granted: true,
      version: 0,
      reason: "Explicit isolated replay permission",
    });
    const id = crypto.randomUUID();
    const payload = {
      employee_id: employee(20),
      version: 1,
      employment_status: "long_leave",
      valid_from: "2026-10-19",
      reason: "Exact request crossing Baghdad midnight",
    };
    const saved = await a.write("service_state", payload, id);
    await db.exec(
      "reset role; create or replace function followup_private.today() returns date language sql stable as $$select '2026-10-20'::date$$",
    );
    await a.who(ids.admin);
    assert.deepEqual(await a.write("service_state", payload, id), saved);
    await assert.rejects(
      a.write(
        "service_state",
        { ...payload, reason: "Changed request data across midnight" },
        id,
      ),
      (e) => e.code === "PT409",
    );
    await assert.rejects(
      a.write("service_state", { ...payload, version: 2 }),
      (e) => e.code === "22023",
    );
    await db.exec("reset role");
    assert.equal(
      (await db.query("select count(*)::int n from fu_service_decisions"))
        .rows[0].n,
      1,
    );
    await db.query(
      "update fu_capabilities set granted=false where user_id=$1 and capability='service_manage'",
      [ids.admin],
    );
    await a.who(ids.admin);
    await assert.rejects(
      a.write("service_state", payload, id),
      (e) => e.code === "42501",
    );
  } finally {
    await db.close();
  }
});
