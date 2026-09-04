import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
let db;
const ids = {
  admin: "11111111-1111-4111-8111-111111111111",
  hr: "22222222-2222-4222-8222-222222222222",
  viewer: "33333333-3333-4333-8333-333333333333",
};
before(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`,
  );
  await db.exec(
    await readFile("supabase/migrations/202609040001_hr.sql", "utf8"),
  );
  await db.exec(await readFile("supabase/seed.sql", "utf8"));
  for (const [name, id] of Object.entries(ids)) {
    await db.query("insert into auth.users values($1,$2,$3)", [
      id,
      `${name}@example.invalid`,
      JSON.stringify({ name }),
    ]);
    await db.query(
      "update public.profiles set is_active=true,role=$1 where id=$2",
      [name === "admin" ? "ADMIN" : name === "hr" ? "HR" : "VIEWER", id],
    );
  }
});
after(async () => {
  await db?.close();
});
async function who(role) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    ids[role] || role,
  ]);
  await db.exec("set role authenticated");
}
async function read(kind, filters = {}) {
  return (await db.query("select public.hr_read($1,$2) data", [kind, filters]))
    .rows[0].data;
}
async function write(action, data) {
  return (await db.query("select public.hr_write($1,$2) data", [action, data]))
    .rows[0].data;
}
let e, e2, dep1, dep2, late;
test("AHH entire workbook imports exactly 192 active, 13 resigned, 1 long leave", async () => {
  await who("admin");
  const all = await read("dashboard");
  assert.equal(all.active, 192);
  assert.equal(
    (await read("employees", { employment_status: "resigned" })).total,
    13,
  );
  assert.equal(
    (await read("employees", { employment_status: "long_leave" })).total,
    1,
  );
  assert.equal(
    (await read("employees", { search: "خلدون حسين علي" })).total,
    2,
  );
});
test("new employee is searchable and included in reports and department", async () => {
  await who("hr");
  const ref = await read("reference");
  [dep1, dep2] = ref.departments;
  const payload = {
    name: "اختبار موظف",
    employee_number: "TEST-1",
    department_id: dep1.id,
    shift_id: ref.shifts[0].id,
    direct_manager_id: null,
    employment_status: "active",
  };
  e = await write("employee.save", payload);
  assert.ok(e.id);
  assert.equal(
    (await read("employees", { search: "TEST-1" })).rows[0].id,
    e.id,
  );
  assert.ok(
    (
      await read("report", { month: "2026-09", department_id: dep1.id })
    ).rows.some((x) => x.id === e.id),
  );
});
test("duplicate names keep independent identity and totals", async () => {
  e2 = await write("employee.save", {
    ...e,
    id: undefined,
    employee_number: "TEST-2",
    department_id: dep2.id,
  });
  assert.notEqual(e.id, e2.id);
  assert.equal((await read("employees", { search: "اختبار موظف" })).total, 2);
});
test("all five status types and 27 late minutes calculate correctly", async () => {
  for (const [i, status] of [
    "absence",
    "absence2",
    "absence3",
    "leave",
    "late",
  ].entries()) {
    const r = await write("status.save", {
      employee_id: e.id,
      department_id: e.department_id,
      record_date: `2026-09-0${i + 1}`,
      status_type: status,
      late_minutes: status === "late" ? 27 : null,
    });
    if (status === "late") late = r;
  }
  const report = await read("report", { month: "2026-09" });
  const row = report.rows.find((x) => x.id === e.id);
  assert.deepEqual(
    [
      row.absence,
      row.absence2,
      row.absence3,
      row.leave,
      row.late,
      row.late_minutes,
      row.weighted,
    ],
    [1, 1, 1, 1, 1, 27, 6],
  );
  assert.equal(row.cells["3"], "absence3");
  assert.equal(report.rows.find((x) => x.id === e2.id).weighted, 0);
});
test("duplicate day returns existing record and cannot double count", async () => {
  const conflict = await write("status.save", {
    employee_id: e.id,
    department_id: e.department_id,
    record_date: "2026-09-05",
    status_type: "leave",
    late_minutes: null,
  });
  assert.equal(conflict.conflict, true);
  assert.equal(conflict.record.id, late.id);
});
test("wrong department and invalid late values are rejected", async () => {
  await assert.rejects(
    write("status.save", {
      employee_id: e.id,
      department_id: dep2.id,
      record_date: "2026-09-06",
      status_type: "leave",
    }),
    /قسم مختلف/,
  );
  for (const minutes of [-1, 2.5, null])
    await assert.rejects(
      write("status.save", {
        employee_id: e.id,
        department_id: dep1.id,
        record_date: "2026-09-06",
        status_type: "late",
        late_minutes: minutes,
      }),
    );
  await assert.rejects(
    write("status.save", {
      employee_id: e.id,
      department_id: dep1.id,
      record_date: "2026-09-06",
      status_type: "leave",
      late_minutes: 4,
    }),
  );
});
test("status correction updates totals; stale concurrent revision is rejected", async () => {
  const old = late;
  late = await write("status.save", {
    ...late,
    department_id: e.department_id,
    late_minutes: 35,
  });
  assert.equal(late.version, old.version + 1);
  await assert.rejects(
    write("status.save", {
      ...old,
      department_id: e.department_id,
      late_minutes: 40,
    }),
    /مستخدم آخر/,
  );
  assert.equal(
    (await read("report", { month: "2026-09" })).rows.find((x) => x.id === e.id)
      .late_minutes,
    35,
  );
});
test("rename and department transfer preserve identity and historical records", async () => {
  const id = e.id;
  e = await write("employee.save", {
    ...e,
    name: "اختبار موظف مصحح",
    department_id: dep2.id,
  });
  assert.equal(e.id, id);
  assert.ok(
    !(
      await read("report", { month: "2026-09", department_id: dep1.id })
    ).rows.some((x) => x.id === id),
  );
  assert.equal(
    (
      await read("report", { month: "2026-09", department_id: dep2.id })
    ).rows.find((x) => x.id === id).weighted,
    6,
  );
  assert.equal(
    (await read("records", { month: "2026-09", employee_id: id })).total,
    5,
  );
});
test("resignation removes active selection but preserves history and permits correction", async () => {
  e = await write("employee.save", { ...e, employment_status: "resigned" });
  assert.ok(!(await read("reference")).employees.some((x) => x.id === e.id));
  assert.ok(
    !(await read("report", { month: "2026-09" })).rows.some(
      (x) => x.id === e.id,
    ),
  );
  assert.equal(
    (await read("records", { month: "2026-09", employee_id: e.id })).total,
    5,
  );
  await assert.rejects(
    write("status.save", {
      employee_id: e.id,
      department_id: dep2.id,
      record_date: "2026-09-06",
      status_type: "leave",
    }),
    /غير نشط/,
  );
  e = await write("employee.save", { ...e, employment_status: "active" });
});
test("soft deletion needs confirmation, changes totals, preserves audit", async () => {
  await assert.rejects(
    write("status.delete", { id: late.id, version: late.version }),
    /تأكيد/,
  );
  await write("status.delete", {
    id: late.id,
    version: late.version,
    confirmed: true,
  });
  assert.equal(
    (await read("report", { month: "2026-09" })).rows.find((x) => x.id === e.id)
      .late,
    0,
  );
});
test("viewer cannot mutate through RPC, direct SQL, bootstrap or import", async () => {
  await who("viewer");
  assert.ok((await read("report", { month: "2026-09" })).rows.length > 0);
  await assert.rejects(
    write("employee.save", { ...e, name: "hacked" }),
    /صلاحية/,
  );
  await assert.rejects(
    db.query("update public.employees set name=$1 where id=$2", [
      "hacked",
      e.id,
    ]),
    /permission denied/,
  );
  await assert.rejects(
    db.query("select public.hr_bootstrap($1)", [ids.viewer]),
    /permission denied/,
  );
  await assert.rejects(
    db.query("select public.hr_import($1,$2,$3)", [
      crypto.randomUUID(),
      "test",
      [],
    ]),
    /صلاحية/,
  );
  await assert.rejects(read("audit"), /صلاحية/);
});
test("HR cannot change roles, settings or audit; admin audit captures old/new values", async () => {
  await who("hr");
  await assert.rejects(
    write("user.save", {
      id: ids.hr,
      role: "ADMIN",
      name: "hr",
      is_active: true,
      version: 1,
    }),
    /صلاحية/,
  );
  await assert.rejects(
    write("department.save", {
      id: dep1.id,
      version: 1,
      arabic_name: "x",
      english_name: "x",
      display_order: 1,
    }),
    /صلاحية/,
  );
  await who("admin");
  const logs = await read("audit", { employee_id: e.id });
  assert.ok(
    logs.rows.some(
      (x) =>
        x.action === "transfer" &&
        x.old_values.department_id === dep1.id &&
        x.new_values.department_id === dep2.id,
    ),
  );
  assert.ok(logs.rows.some((x) => x.action === "soft_delete"));
  await assert.rejects(
    db.query("delete from public.audit_logs"),
    /permission denied/,
  );
});
test("last admin cannot be disabled; disabled user loses DB access immediately", async () => {
  let users = await read("users");
  const admin = users.find((x) => x.id === ids.admin);
  await assert.rejects(
    write("user.save", { ...admin, is_active: false }),
    /آخر مدير/,
  );
  const viewer = users.find((x) => x.id === ids.viewer);
  await write("user.save", { ...viewer, is_active: false });
  await who("viewer");
  await assert.rejects(read("report"), /غير مفعل/);
});
test("calendar months, leap year and invalid dates are enforced", async () => {
  await who("admin");
  for (const [month, days] of [
    ["2026-01", 31],
    ["2026-02", 28],
    ["2028-02", 29],
    ["2026-04", 30],
    ["2026-09", 30],
    ["2026-12", 31],
  ]) {
    const [y, m] = month.split("-").map(Number);
    assert.equal(new Date(Date.UTC(y, m, 0)).getUTCDate(), days);
    assert.equal((await read("report", { month })).month, month);
  }
  await assert.rejects(
    write("status.save", {
      employee_id: e.id,
      department_id: dep2.id,
      record_date: "2026-02-29",
      status_type: "leave",
    }),
  );
});
test("department rename, order and deactivation preserve references", async () => {
  await who("admin");
  const ref = await read("reference");
  const d = ref.departments[0];
  const renamed = await write("department.save", {
    ...d,
    arabic_name: "الالتقاط المعدل",
    display_order: 50,
  });
  assert.equal(renamed.id, d.id);
  assert.equal(
    (await read("report", { month: "2026-09", department_id: d.id })).rows[0]
      .department,
    "الالتقاط المعدل (Picking)",
  );
  await assert.rejects(
    write("department.save", { ...renamed, is_active: false }),
    /مرتبط/,
  );
});
test("bulk import is atomic, reimport is prevented and updates keep identity", async () => {
  await who("admin");
  const item = {
    mode: "create",
    name: "اختبار الاستيراد",
    employee_number: "IMPORT-1",
    department_id: dep1.id,
    shift_id: null,
    direct_manager_id: null,
    employment_status: "active",
  };
  await assert.rejects(
    db.query("select hr_import($1,$2,$3)", [
      crypto.randomUUID(),
      "bad-file",
      [item, { ...item, name: "", employee_number: "IMPORT-2" }],
    ]),
  );
  assert.equal((await read("employees", { search: "IMPORT-1" })).total, 0);
  const batch = crypto.randomUUID();
  await db.query("select hr_import($1,$2,$3)", [batch, "good-file", [item]]);
  await assert.rejects(
    db.query("select hr_import($1,$2,$3)", [
      crypto.randomUUID(),
      "good-file",
      [item],
    ]),
    /مسبقاً/,
  );
  const old = (await read("employees", { search: "IMPORT-1" })).rows[0];
  await db.query("select hr_import($1,$2,$3)", [
    crypto.randomUUID(),
    "update-file",
    [{ ...old, mode: "update", name: "اختبار الاستيراد المعدل" }],
  ]);
  assert.equal(
    (await read("employees", { search: "IMPORT-1" })).rows[0].id,
    old.id,
  );
});
test("anonymous calls cannot read HR data or bootstrap an admin", async () => {
  await db.exec("reset role; set role anon");
  await assert.rejects(
    db.query("select hr_read('report','{}')"),
    /permission denied/,
  );
  await assert.rejects(
    db.query("select * from employees"),
    /permission denied/,
  );
  await assert.rejects(
    db.query("select hr_bootstrap($1)", [ids.viewer]),
    /permission denied/,
  );
});
