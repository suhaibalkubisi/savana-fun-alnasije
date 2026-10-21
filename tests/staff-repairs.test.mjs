import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { setup, api, ids, employee } from "./evening-db-fixture.mjs";
export async function ready() {
  const db = await setup();
  await db.exec(
    await fs.readFile(
      "supabase/migrations/20261014181643_evening_controlled_roster_setup.sql",
      "utf8",
    ),
  );
  await db.exec(
    await fs.readFile("supabase/proposals/staff-repairs.sql", "utf8"),
  );
  const a = api(db);
  const day = (await db.query("select followup_private.today()::text task_day"))
    .rows[0].task_day;
  await a.who(ids.admin);
  return { db, a, day };
}
const denied = (e) => e.code === "42501",
  conflict = (e) => e.code === "PT409";
const plus = (d, n) =>
  new Date(Date.parse(d + "T12:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
async function grant(a, cap, user = ids.admin) {
  await a.write("capability", {
    user_id: user,
    capability: cap,
    granted: true,
    version: 0,
    reason: "Explicit synthetic permission",
  });
}
test("directory profiles no longer require evening membership; service capabilities are explicitly ungranted", async () => {
  const { db, a } = await ready();
  try {
    const p = await a.read("profile", { employee_id: employee(20) });
    assert.equal(p.read_only, false);
    assert.equal(p.employee.shift_id, null);
    await a.write("profile", {
      employee_id: employee(20),
      version: 1,
      phone: "0123456789",
      reason: "Synthetic contact correction",
    });
    const boot = await a.read("bootstrap");
    assert.equal(boot.capabilities.service_manage, false);
    assert.equal(boot.capabilities.identity_edit, false);
    await assert.rejects(
      a.write("service_state", {
        employee_id: employee(20),
        version: 2,
        employment_status: "long_leave",
        valid_from: "2026-10-18",
        reason: "Synthetic decision",
      }),
      denied,
    );
  } finally {
    await db.close();
  }
});
test("all service states preserve identity, assignment evidence and attendance; retry and stale versions", async () => {
  const { db, a, day } = await ready();
  try {
    await grant(a, "service_manage");
    await db.exec("reset role");
    const before = (
        await db.query(
          "select id,internal_code,department_id,shift_id from employees where id=$1",
          [employee(20)],
        )
      ).rows[0],
      history = (
        await db.query(
          "select * from employee_assignment_history where employee_id=$1",
          [employee(20)],
        )
      ).rows;
    await a.who(ids.admin);
    for (const [i, state] of [
      "inactive",
      "resigned",
      "long_leave",
      "active",
    ].entries()) {
      const payload = {
          employee_id: employee(20),
          version: i + 1,
          employment_status: state,
          valid_from: day,
          reason: "Synthetic deliberate service decision " + state,
        },
        rid = crypto.randomUUID();
      const saved = await a.write("service_state", payload, rid);
      assert.equal((await a.write("service_state", payload, rid)).id, saved.id);
      assert.equal(
        (await a.read("profile", { employee_id: employee(20) })).employee
          .employment_status,
        state,
      );
      assert.equal(
        (await a.read("employee_directory")).find((e) => e.id === employee(20))
          .employment_status,
        state,
      );
      await assert.rejects(
        a.write(
          "service_state",
          { ...payload, reason: "Changed request data" },
          rid,
        ),
        conflict,
      );
      await assert.rejects(a.write("service_state", payload), conflict);
    }
    await db.exec("reset role");
    assert.deepEqual(
      (
        await db.query(
          "select id,internal_code,department_id,shift_id from employees where id=$1",
          [employee(20)],
        )
      ).rows[0],
      before,
    );
    assert.deepEqual(
      (
        await db.query(
          "select * from employee_assignment_history where employee_id=$1",
          [employee(20)],
        )
      ).rows,
      history,
    );
    assert.equal(
      (await db.query("select count(*)::int n from fu_reports")).rows[0].n,
      0,
    );
    assert.equal(
      (await db.query("select count(*)::int n from fu_service_decisions"))
        .rows[0].n,
      4,
    );
  } finally {
    await db.close();
  }
});
test("future effective service agrees across directory/profile/roster/canonical reports without editing history", async () => {
  const { db, a, day } = await ready();
  try {
    await grant(a, "service_manage");
    const date = plus(day, 1);
    await a.write("service_state", {
      employee_id: employee(1),
      version: 1,
      employment_status: "resigned",
      valid_from: date,
      reason: "Synthetic future resignation",
    });
    assert.equal(
      (await a.read("profile", { employee_id: employee(1) })).employee
        .employment_status,
      "active",
    );
    assert.equal(
      (await a.read("service_decisions", { employee_id: employee(1) }))[0]
        .valid_from,
      date,
    );
    await db.exec("reset role");
    await db.exec(
      `create or replace function followup_private.today() returns date language sql stable as $$select '${date}'::date$$`,
    );
    await a.who(ids.admin);
    assert.equal(
      (await a.read("profile", { employee_id: employee(1) })).employee
        .employment_status,
      "resigned",
    );
    assert.equal(
      (await a.read("employee_directory")).find((e) => e.id === employee(1))
        .employment_status,
      "resigned",
    );
    assert.equal(
      (await a.read("roster", { department_id: ids.d1, start: date })).some(
        (e) => e.id === employee(1),
      ),
      false,
    );
    assert.equal(
      (
        await a.read("position", {
          employee_id: employee(1),
          start: date,
          end: date,
        })
      )[0].scope_state,
      "outside_roster",
    );
    assert.equal(
      (await a.read("roster", { department_id: ids.d1, start: day })).some(
        (e) => e.id === employee(1),
      ),
      true,
    );
  } finally {
    await db.close();
  }
});
test("service commit validates inputs and live role, capability, department, session including cached retries", async () => {
  const { db, a, day } = await ready();
  try {
    await grant(a, "service_manage", ids.supervisor);
    await a.who(ids.supervisor);
    const p = {
        employee_id: employee(20),
        version: 1,
        employment_status: "long_leave",
        valid_from: day,
        reason: "Synthetic reason",
      },
      rid = crypto.randomUUID();
    for (const delta of [
      { reason: "" },
      { valid_from: "" },
      { employment_status: "unknown" },
      { valid_from: plus(day, -1) },
    ])
      await assert.rejects(a.write("service_state", { ...p, ...delta }));
    await assert.rejects(
      a.write("service_state", { ...p, employee_id: employee(21) }),
      denied,
    );
    await a.write("service_state", p, rid);
    await db.exec("reset role");
    await db.query(
      "update fu_capabilities set granted=false where user_id=$1 and capability='service_manage'",
      [ids.supervisor],
    );
    await a.who(ids.supervisor);
    await assert.rejects(a.write("service_state", p, rid), denied);
    await db.exec("reset role");
    await db.query(
      "update fu_capabilities set granted=true where user_id=$1 and capability='service_manage'",
      [ids.supervisor],
    );
    await db.query("delete from fu_departments where user_id=$1", [
      ids.supervisor,
    ]);
    await a.who(ids.supervisor);
    await assert.rejects(a.write("service_state", p, rid), denied);
    await a.who(ids.viewer);
    await assert.rejects(a.write("service_state", p), denied);
  } finally {
    await db.close();
  }
});
test("QA provenance boundary excludes server reads and keeps legitimate inactive history and explicit archive", async () => {
  const { db, a, day } = await ready();
  try {
    await db.exec("reset role");
    await db.query(
      "insert into fu_quarantined_departments values($1,'Synthetic provenance ledger','Synthetic quarantine')",
      [ids.d2],
    );
    await db.query(
      "update employees set employment_status='inactive' where id=$1",
      [employee(19)],
    );
    await a.who(ids.admin);
    assert.equal(
      (await a.read("bootstrap")).departments.some((d) => d.id === ids.d2),
      false,
    );
    assert.equal(
      (await a.read("employee_directory")).some((e) => e.id === employee(21)),
      false,
    );
    assert.equal(
      (await a.read("employee_directory")).some((e) => e.id === employee(19)),
      true,
    );
    assert.equal(
      (await a.read("search", { query: "Morning" })).employees.length,
      0,
    );
    await assert.rejects(a.read("quarantine_history"), denied);
    await grant(a, "archive_read");
    assert.equal((await a.read("quarantine_history")).departments.length, 1);
    await assert.rejects(
      a.read("profile", { employee_id: employee(21) }),
      denied,
    );
  } finally {
    await db.close();
  }
});
test("identity correction checks duplicate numbers and keeps immutable and historic identities", async () => {
  const { db, a } = await ready();
  try {
    await grant(a, "identity_edit");
    const p = {
      employee_id: employee(20),
      version: 1,
      name: "Synthetic corrected employee",
      employee_number: "OPTIONAL-20",
      reason: "Synthetic identity correction",
    };
    await a.write("employee_identity", p);
    const fresh = (await a.read("profile", { employee_id: employee(20) }))
      .employee;
    assert.equal(fresh.id, p.employee_id);
    assert.equal(fresh.internal_code, "FANU-000020");
    assert.equal(fresh.name, p.name);
    await assert.rejects(
      a.write("employee_identity", { ...p, employee_id: employee(19) }),
    );
    assert.equal(
      (await a.read("employee_duplicates", { name: p.name })).length,
      1,
    );
  } finally {
    await db.close();
  }
});
test("action and linked comment save atomically with authorized readback and retry after revocation", async () => {
  const { db, a, day } = await ready();
  try {
    await db.exec("reset role");
    const doc = (
      await db.query(
        "insert into fu_documents(employee_id,title,kind,file_name,mime_type,byte_size,object_path,uploaded_by,upload_request_id,state) values($1,'Synthetic proof','general','proof.pdf','application/pdf',100,'synthetic-proof',$2,gen_random_uuid(),'active') returning id",
        [employee(20), ids.admin],
      )
    ).rows[0];
    await a.who(ids.admin);
    const p = {
        department_id: ids.d1,
        employee_id: employee(20),
        description: "Synthetic contextual follow-up",
        responsible_id: ids.admin,
        due_date: day,
        state: "open",
        notes: "Current editable note",
        category: "operational",
        priority: "medium",
        comment: "Appended document comment",
        attachment_document_id: doc.id,
      },
      rid = crypto.randomUUID();
    const saved = await a.write("action", p, rid);
    await a.write("action", p, rid);
    const row = (await a.read("actions")).find((a) => a.id === saved.id);
    assert.equal(row.comments.length, 1);
    assert.equal(row.comments[0].document_id, doc.id);
    assert.equal(row.comments[0].body, p.comment);
    assert.ok(row.comments[0].actor_name);
    await assert.rejects(
      a.write("action", { ...p, employee_id: employee(19) }),
      denied,
    );
    await db.exec("reset role");
    await db.query("update fu_documents set state='archived' where id=$1", [
      doc.id,
    ]);
    await a.who(ids.admin);
    await assert.rejects(a.write("action", p, rid), denied);
    const redacted = (await a.read("actions")).find((a) => a.id === saved.id);
    assert.equal(redacted.comments[0].document_id, null);
    assert.equal(redacted.comments[0].document_title, null);
    await db.exec("reset role");
    assert.equal(
      (await db.query("select count(*)::int n from fu_actions")).rows[0].n,
      1,
    );
  } finally {
    await db.close();
  }
});
test("account decisions require meaningful server reasons, including direct requests; viewers remain forbidden", async () => {
  const { db, a } = await ready();
  try {
    const p = {
      user_id: ids.supervisor,
      version: 1,
      role: "SUPERVISOR",
      active: true,
      departments: [ids.d1],
    };
    await assert.rejects(a.write("account", p));
    await a.write("account", {
      ...p,
      reason: "Synthetic genuine administration decision",
    });
    await a.who(ids.viewer);
    await assert.rejects(a.write("account", p), denied);
  } finally {
    await db.close();
  }
});
test("quarantined QA reports/actions never enter canonical operations and remain in explicit archive", async () => {
  const { db, a, day } = await ready();
  try {
    const report = await a.write("submit", {
      department_id: ids.d1,
      work_date: day,
      reporter_id: ids.admin,
      channel: "account",
      entries: [],
    });
    await a.write("action", {
      department_id: ids.d1,
      description: "Synthetic QA action",
      responsible_id: ids.admin,
      due_date: day,
      state: "open",
      notes: "",
    });
    await db.exec("reset role");
    await db.query(
      "insert into fu_quarantined_departments values($1,'Synthetic actual test provenance','Synthetic QA boundary')",
      [ids.d1],
    );
    await a.who(ids.admin);
    for (const kind of ["reports", "actions", "position"])
      assert.equal((await a.read(kind)).length, 0, kind);
    assert.ok(
      (await a.read("completeness")).every((x) => x.department_id !== ids.d1),
    );
    assert.equal((await a.read("reporting_model")).reports.length, 0);
    await grant(a, "archive_read");
    assert.equal((await a.read("quarantine_history")).reports[0].id, report.id);
  } finally {
    await db.close();
  }
});
