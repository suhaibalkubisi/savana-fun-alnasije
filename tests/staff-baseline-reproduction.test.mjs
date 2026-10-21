import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { setup, api, ids, employee } from "./evening-db-fixture.mjs";
test("v39 reproduction: F09 read-only, F10 enrollment side effect, F11 dated drift", async () => {
  const db = await setup();
  try {
    await db.exec(
      await fs.readFile(
        "supabase/migrations/20261014181643_evening_controlled_roster_setup.sql",
        "utf8",
      ),
    );
    const a = api(db);
    await a.who(ids.admin);
    assert.equal(
      (await a.read("profile", { employee_id: employee(20) })).read_only,
      true,
    );
    await a.write("capability", {
      user_id: ids.admin,
      capability: "roster_manage",
      granted: true,
      version: 0,
      reason: "Synthetic reproduction only",
    });
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Baghdad",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    await a.write("assignment", {
      employee_id: employee(20),
      version: 1,
      department_id: ids.d1,
      employment_status: "long_leave",
      valid_from: day,
      reason: "Synthetic status-only intent",
    });
    const p = await a.read("profile", { employee_id: employee(20) });
    assert.equal(p.employee.shift_id, ids.evening);
    assert.equal(p.employee.evening_verified, true);
    const future = new Date(day + "T12:00:00Z");
    future.setUTCDate(future.getUTCDate() + 1);
    const date = future.toISOString().slice(0, 10);
    await a.write("assignment", {
      employee_id: employee(1),
      version: 1,
      department_id: ids.d1,
      employment_status: "resigned",
      valid_from: date,
      reason: "Synthetic future resignation",
    });
    await db.exec("reset role");
    await db.exec(
      `create or replace function followup_private.today() returns date language sql stable as $$select '${date}'::date$$`,
    );
    await a.who(ids.admin);
    assert.equal(
      (await a.read("profile", { employee_id: employee(1) })).employee
        .employment_status,
      "active",
    );
    assert.equal(
      (await a.read("roster", { department_id: ids.d1, start: date })).some(
        (e) => e.id === employee(1),
      ),
      false,
    );
  } finally {
    await db.close();
  }
});
