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
async function grant(a, cap, user = ids.admin) {
  await a.write("capability", {
    user_id: user,
    capability: cap,
    granted: true,
    version: 0,
    reason: "Explicit isolated round two test",
  });
}
const deny = (e) => e.code === "42501";
test("R2-01 later enrollment or transfer snapshots cannot override earlier independent service decisions; historical and explicit reactivation preserved", async () => {
  const { db, a } = await ready();
  try {
    await grant(a, "roster_manage");
    await grant(a, "service_manage");
    const p = await a.write("roster_setup_preview", {
      department_id: ids.d1,
      valid_from: "2026-10-22",
      reason: "Isolated future enrollment before resignation",
      employees: [{ employee_id: employee(20), version: 1 }],
    });
    await a.write("roster_setup_commit", { preview_id: p.id });
    let version = (await a.read("profile", { employee_id: employee(20) }))
      .employee.version;
    await a.write("service_state", {
      employee_id: employee(20),
      version,
      employment_status: "resigned",
      valid_from: "2026-10-20",
      reason: "Independent resignation starts before enrollment",
    });
    await db.exec("reset role");
    const state = async (day) =>
      (
        await db.query("select followup_private.service_state($1,$2) value", [
          employee(20),
          day,
        ])
      ).rows[0].value;
    assert.equal(await state("2026-10-19"), "active");
    assert.equal(await state("2026-10-22"), "resigned");
    const original = (
      await db.query(
        "select * from employee_assignment_history where employee_id=$1 order by valid_from",
        [employee(20)],
      )
    ).rows;
    await a.who(ids.admin);
    version = (await a.read("profile", { employee_id: employee(20) })).employee
      .version;
    await a.write("service_state", {
      employee_id: employee(20),
      version,
      employment_status: "long_leave",
      valid_from: "2026-10-21",
      reason: "Explicit independent long leave replaces resignation",
    });
    await db.exec("reset role");
    assert.equal(await state("2026-10-20"), "resigned");
    assert.equal(await state("2026-10-22"), "long_leave");
    await a.who(ids.admin);
    version = (await a.read("profile", { employee_id: employee(20) })).employee
      .version;
    await a.write("assignment", {
      employee_id: employee(20),
      version,
      department_id: ids.d2,
      valid_from: "2026-10-24",
      reason: "Isolated future department transfer",
    });
    version = (await a.read("profile", { employee_id: employee(20) })).employee
      .version;
    await a.write("service_state", {
      employee_id: employee(20),
      version,
      employment_status: "active",
      valid_from: "2026-10-23",
      reason: "Explicit reactivation required for active service",
    });
    await db.exec("reset role");
    assert.equal(await state("2026-10-22"), "long_leave");
    assert.equal(await state("2026-10-24"), "active");
    assert.equal(
      (await db.query("select count(*)::int n from fu_reports")).rows[0].n,
      0,
    );
    for (const old of original) {
      const now = (
        await db.query(
          "select * from employee_assignment_history where id=$1",
          [old.id],
        )
      ).rows[0];
      assert.equal(now.employment_status, old.employment_status);
    }
  } finally {
    await db.close();
  }
});
test("R2-02 action for authorized no-shift identity survives scoped and profile readback without enrollment or attendance", async () => {
  const { db, a } = await ready();
  try {
    const saved = await a.write("action", {
      employee_id: employee(20),
      department_id: ids.d1,
      description: "No-shift employee action",
      responsible_id: ids.supervisor,
      due_date: "2026-10-22",
      note: "Isolated test",
    });
    const filtered = await a.read("actions", {
      employee_id: employee(20),
      start: "2026-10-19",
      end: "2026-10-19",
    });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].id, saved.id);
    assert.equal(
      (await a.read("actions")).some((x) => x.id === saved.id),
      true,
    );
    assert.equal(
      (await a.read("profile", { employee_id: employee(20) })).employee
        .shift_id,
      null,
    );
    await a.who(ids.supervisor);
    assert.equal(
      (await a.read("actions", { employee_id: employee(20) }))[0].id,
      saved.id,
    );
    await assert.rejects(
      a.read("actions", { employee_id: employee(21) }),
      deny,
    );
    await db.exec("reset role");
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from employee_assignment_history where employee_id=$1 and shift_id=$2",
          [employee(20), ids.evening],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (await db.query("select count(*)::int n from fu_reports")).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});
test("R2-03 individual canonical report distinguishes authorized no-evening-history from forbidden identity", async () => {
  const { db, a } = await ready();
  try {
    for (const u of [ids.admin, ids.follow, ids.supervisor, ids.viewer]) {
      await a.who(u);
      const f = {
        employee_id: employee(20),
        start: "2026-10-19",
        end: "2026-10-19",
      };
      for (const kind of ["position", "reports", "completeness"])
        assert.deepEqual(await a.read(kind, f), []);
      const report = await a.read("reporting_model", f);
      assert.deepEqual(report.positions, []);
      assert.deepEqual(report.reports, []);
      assert.equal(report.employees[0].id, employee(20));
      assert.equal(report.employees[0].name, "موظف 20");
      assert.equal(report.empty_reason, "no_evening_history");
      if (u !== ids.admin)
        await assert.rejects(
          a.read("reporting_model", { ...f, employee_id: employee(21) }),
          deny,
        );
    }
  } finally {
    await db.close();
  }
});
test("R2-07c request receipt is actor/request bound and rechecks current permission and account state", async () => {
  const { db, a } = await ready();
  try {
    await grant(a, "service_manage");
    const rid = crypto.randomUUID(),
      eid = employee(20);
    const payload = {
      employee_id: eid,
      version: 1,
      employment_status: "long_leave",
      valid_from: "2026-10-19",
      reason: "Exact request receipt proof",
    };
    assert.equal(
      (await a.read("request_receipt", { employee_id: eid, request_id: rid }))
        .found,
      false,
    );
    const saved = await a.write("service_state", payload, rid);
    const receipt = await a.read("request_receipt", {
      employee_id: eid,
      request_id: rid,
    });
    assert.equal(receipt.request_id, rid);
    assert.equal(receipt.entity_id, saved.id);
    assert.equal(receipt.actor, ids.admin);
    assert.equal(receipt.employee_version, 2);
    await a.who(ids.follow);
    assert.equal(
      (await a.read("request_receipt", { employee_id: eid, request_id: rid }))
        .found,
      false,
    );
    await db.exec("reset role");
    await db.query(
      "update fu_capabilities set granted=false where user_id=$1 and capability='service_manage'",
      [ids.admin],
    );
    await a.who(ids.admin);
    await assert.rejects(
      a.read("request_receipt", { employee_id: eid, request_id: rid }),
      deny,
    );
    await db.exec("reset role");
    await db.query("update fu_accounts set active=false where user_id=$1", [
      ids.admin,
    ]);
    await a.who(ids.admin);
    await assert.rejects(
      a.read("request_receipt", { employee_id: eid, request_id: rid }),
      deny,
    );
  } finally {
    await db.close();
  }
});
test("R2-06c durable creation claim allows one provider attempt, stores no password, and only a matching account transaction proves completion", async () => {
  const { db, a } = await ready();
  try {
    const rid = crypto.randomUUID(),
      target = ids.viewer,
      p = {
        name: "Synthetic account",
        email: "recovery@candidate.invalid",
        role: "VIEWER",
        departments: [ids.d1],
        reason: "Explicit synthetic account creation",
      };
    assert.equal((await a.write("account_creation_begin", p, rid)).start, true);
    assert.equal(
      (await a.write("account_creation_begin", p, rid)).start,
      false,
    );
    await assert.rejects(
      a.write(
        "account_creation_begin",
        { ...p, name: "Changed identity" },
        rid,
      ),
      (e) => e.code === "PT409",
    );
    await assert.rejects(
      a.write("account_creation_begin", p),
      (e) => e.code === "PT409",
    );
    await a.write(
      "account_creation_result",
      { state: "created", user_id: target },
      rid,
    );
    await assert.rejects(
      a.write("account_creation_result", { state: "configured" }, rid),
      (e) => e.code === "PT409",
    );
    const account = await a.read("account_creation", { request_id: rid });
    assert.equal(account.state, "created");
    await a.write(
      "account",
      {
        user_id: target,
        role: p.role,
        active: true,
        departments: p.departments,
        reason: p.reason,
        version: 1,
      },
      rid,
    );
    assert.equal(
      (await a.read("account_creation", { request_id: rid })).state,
      "configured",
    );
    await db.exec("reset role");
    const stored = (await db.query("select payload from fu_account_creations"))
      .rows[0].payload;
    assert.equal("password" in stored, false);
    for (const user of [ids.follow, ids.supervisor, ids.viewer]) {
      await a.who(user);
      await assert.rejects(
        a.read("account_creation", { request_id: rid }),
        deny,
      );
      await assert.rejects(a.write("account_creation_begin", p), deny);
    }
  } finally {
    await db.close();
  }
});
