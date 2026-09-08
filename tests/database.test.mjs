import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
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
  for (const file of (await readdir("supabase/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
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
  return (
    await db.query("select public.hr_read_v2($1,$2) data", [kind, filters])
  ).rows[0].data;
}
async function write(action, data) {
  return (
    await db.query("select public.hr_write_v2($1,$2) data", [action, data])
  ).rows[0].data;
}
let e, e2, dep1, dep2, late;
const attendanceWrite = async (action, data) =>
  (await db.query("select public.attendance_write($1,$2) data", [action, data]))
    .rows[0].data;
const attendanceRead = async (kind, filters) =>
  (await db.query("select public.attendance_read($1,$2) data", [kind, filters]))
    .rows[0].data;
const attendanceWriteV2 = async (action, data) =>
  (await db.query("select public.attendance_write_v2($1,$2) data", [action, data]))
    .rows[0].data;
const attendanceReadV2 = async (kind, filters = {}) =>
  (await db.query("select public.attendance_read_v2($1,$2) data", [kind, filters]))
    .rows[0].data;

test("phase 2 daily position exposes schedule, person code and review fields", async () => {
  await who("admin");
  const ref = await read("reference");
  const person = await write("employee.save", {
    name: "اختبار موقف يومي مرحلة ثانية",
    employee_number: "PH2-DAY",
    department_id: ref.departments[0].id,
    employment_status: "active",
  });
  const report = await attendanceReadV2("daily", { date: "2099-01-01", search: "PH2-DAY" });
  assert.equal(report.rows.length, 1);
  assert.ok("scheduled_start_minute" in report.rows[0]);
  assert.ok("person_code" in report.rows[0]);
  assert.ok("needs_review" in report.rows[0]);
  await write("employee.save", { ...person, employment_status: "inactive" });
});

test("duplicate cleanup is ADMIN-only and hard delete refuses linked history", async () => {
  await who("admin");
  const ref = await read("reference");
  const first = await write("employee.save", { name: "اسم تنظيف مكرر", employee_number: "PH2-DUP-A", department_id: ref.departments[0].id, employment_status: "active" });
  const second = await write("employee.save", { name: "اسم تنظيف مكرر", employee_number: "PH2-DUP-B", department_id: ref.departments[0].id, employment_status: "active" });
  const suspects = await attendanceReadV2("employee_duplicates");
  assert.equal(suspects.rows.filter((row) => row.normalized_name === "اسمتنظيفمكرر").length, 2);
  await who("viewer");
  await assert.rejects(attendanceWriteV2("employee.delete_permanent", { source_employee_id: second.id, confirmed: true }), /صلاحية/);
  await who("admin");
  await attendanceWriteV2("employee.delete_permanent", { source_employee_id: second.id, confirmed: true });
  await write("status.save", { employee_id: first.id, department_id: first.department_id, record_date: "2099-02-01", status_type: "absence", late_minutes: null, notes: null });
  await assert.rejects(attendanceWriteV2("employee.delete_permanent", { source_employee_id: first.id, confirmed: true }), /سجلات مرتبطة/);
  await write("employee.save", { ...first, employment_status: "inactive" });
});
test("attendance foundations preserve employee data and deny direct writes", async () => {
  await who("viewer");
  for (const table of [
    "attendance_imports",
    "fingerprint_identities",
    "fingerprint_source_rows",
    "fingerprint_issues",
    "attendance_department_rules",
    "attendance_daily_notes",
  ]) {
    await assert.rejects(
      db.query(`select * from public.${table}`),
      /permission denied/,
    );
  }
  await assert.rejects(attendanceWrite("import.apply", {}), /صلاحية/);
});
test("fingerprint preview is atomic, idempotent and excludes unapplied punches", async () => {
  await who("admin");
  const ref = await read("reference");
  const department = ref.departments[0];
  const person = await write("employee.save", {
    name: "اختبار بصمة فريد",
    employee_number: "FP-TEST",
    department_id: department.id,
    employment_status: "active",
  });
  await attendanceWrite("rule.save", {
    department_id: department.id,
    effective_from: "2098-01-01",
    start_minute: 960,
    grace_minutes: 5,
    entry_window_start: 720,
    entry_window_end: 1439,
    working_weekdays: [0, 1, 2, 3, 4, 5, 6],
    default_manager_id: null,
  });
  const payload = {
    source_name: "test.xls",
    source_hash: "a".repeat(64),
    import_kind: "daily",
    period_start: "2098-09-06",
    period_end: "2098-09-07",
    rows: [
      {
        source_sheet: "Punch Record",
        source_row: 2,
        calendar_date: "2098-09-06",
        person_code: "FP-TEST",
        source_name: person.name,
        raw_values: ["01:31", "16:27"],
        punch_minutes: [91, 987],
        invalid: false,
      },
      {
        source_sheet: "Punch Record",
        source_row: 3,
        calendar_date: "2098-09-07",
        person_code: "FP-TEST",
        source_name: person.name,
        raw_values: ["01:35"],
        punch_minutes: [95],
        invalid: false,
      },
    ],
  };
  let batch = await attendanceWrite("import.preview", payload);
  assert.equal(batch.summary.matched, 2);
  assert.equal(
    (await attendanceWrite("import.preview", payload)).duplicate,
    true,
  );
  let row = (await attendanceRead("daily", { date: "2098-09-06" })).rows.find(
    (x) => x.employee_id === person.id,
  );
  assert.equal(row.status, "no_entry");
  assert.equal(row.late_minutes, 0);
  await assert.rejects(
    attendanceWrite("import.apply", { id: batch.id }),
    /الإصدار/,
  );
  batch = await attendanceWrite("import.apply", {
    id: batch.id,
    version: batch.version,
  });
  row = (await attendanceRead("daily", { date: "2098-09-06" })).rows.find(
    (x) => x.employee_id === person.id,
  );
  assert.equal(row.status, "late");
  assert.equal(row.late_minutes, 27);
  assert.equal(row.entry_minute, 987);
  assert.equal(row.exit_minute, 95);
  assert.equal(row.duration_minutes, 548);
  await write("status.save", {
    employee_id: person.id,
    department_id: department.id,
    record_date: "2098-09-06",
    status_type: "leave",
    late_minutes: null,
  });
  row = (await attendanceRead("daily", { date: "2098-09-06" })).rows.find(
    (x) => x.employee_id === person.id,
  );
  assert.equal(row.status, "leave");
  assert.equal(row.late_minutes, 0);
  const monthly = (
    await attendanceRead("monthly", { date: "2098-09-01" })
  ).rows.find((x) => x.employee_id === person.id);
  assert.equal(monthly.leave, 1);
  assert.equal(monthly.weighted, 0);
  await write("employee.save", { ...person, employment_status: "inactive" });
  await who("hr");
  await assert.rejects(attendanceWrite("rule.save", {}), /صلاحية/);
});
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

test("premium reference keeps existing data and seeds configurable action types", async () => {
  await who("admin");
  const reference = await read("reference");
  assert.ok(reference.employees.length >= 192);
  assert.deepEqual(
    reference.action_types.map((item) => item.arabic_name),
    [
      "تنبيه",
      "لفت نظر",
      "إنذار",
      "إنذار نهائي",
      "تعهد",
      "خصم إداري",
      "إجراء آخر",
    ],
  );
  assert.equal(reference.app_name, "قسم الموارد البشرية – مسائي");
});

test("quick bulk entry is atomic and stores exceptions only", async () => {
  await who("hr");
  const items = [
    {
      operation: "save",
      data: {
        employee_id: e2.id,
        department_id: dep2.id,
        record_date: "2099-09-20",
        status_type: "absence",
        late_minutes: null,
      },
    },
    {
      operation: "save",
      data: {
        employee_id: e2.id,
        department_id: dep2.id,
        record_date: "2099-09-21",
        status_type: "leave",
        late_minutes: null,
      },
    },
  ];
  assert.equal((await write("status.bulk", { items })).count, 2);
  assert.equal(
    (await read("records", { employee_id: e2.id, month: "2099-09" })).total,
    2,
  );
  await assert.rejects(
    write("status.bulk", {
      items: [
        { ...items[0], data: { ...items[0].data, record_date: "2099-09-22" } },
        {
          ...items[1],
          data: {
            ...items[1].data,
            record_date: "2099-09-23",
            department_id: dep1.id,
          },
        },
      ],
    }),
    /قسم مختلف/,
  );
  assert.equal(
    (await read("records", { employee_id: e2.id, month: "2099-09" })).total,
    2,
  );
});

let linkedStatus, administrativeAction;
test("lateness detail, summary and shared report update from 27 to 35", async () => {
  await who("hr");
  linkedStatus = await write("status.save", {
    employee_id: e2.id,
    department_id: dep2.id,
    record_date: "2099-09-24",
    status_type: "late",
    late_minutes: 27,
  });
  let lateness = await read("lateness", {
    month: "2099-09",
    employee_id: e2.id,
  });
  assert.equal(lateness.kpis.minutes, 27);
  assert.equal(lateness.summary[0].total_minutes, 27);
  linkedStatus = await write("status.save", {
    ...linkedStatus,
    department_id: dep2.id,
    late_minutes: 35,
  });
  lateness = await read("lateness", { month: "2099-09", employee_id: e2.id });
  assert.equal(lateness.rows[0].late_minutes, 35);
  assert.equal(lateness.summary[0].highest_minutes, 35);
  assert.equal(
    (await read("report", { month: "2099-09", employee_id: e2.id })).rows[0]
      .late_minutes,
    35,
  );
});

test("administrative action create, update, linkage and employee report stay consistent", async () => {
  await who("hr");
  const actionType = (await read("reference")).action_types.find(
    (item) => item.arabic_name === "إنذار",
  );
  administrativeAction = await write("administrative_action.save", {
    employee_id: e2.id,
    action_type_id: actionType.id,
    action_date: "2099-09-24",
    reason: "اختبار",
    description: "اختبار تكامل الإجراء",
    notes: null,
    related_status_record_id: linkedStatus.id,
    state: "active",
  });
  assert.match(administrativeAction.reference_number, /^ADM-/);
  let actions = await read("employee_actions", {
    month: "2099-09",
    employee_id: e2.id,
  });
  assert.equal(actions.total, 1);
  assert.equal(actions.rows[0].related_status_record_id, linkedStatus.id);
  administrativeAction = await write("administrative_action.save", {
    ...administrativeAction,
    state: "closed",
    reason: "اختبار محدث",
  });
  assert.equal(administrativeAction.version, 2);
  assert.equal(
    (await read("report", { month: "2099-09", employee_id: e2.id })).rows[0]
      .administrative_actions,
    1,
  );
  const employeeReport = await read("employee_report", {
    month: "2099-09",
    employee_id: e2.id,
  });
  assert.equal(employeeReport.actions.length, 1);
  assert.equal(
    employeeReport.records.find((item) => item.id === linkedStatus.id)
      .late_minutes,
    35,
  );
});

test("administrative action permissions are enforced by RPC and RLS", async () => {
  await who("admin");
  const users = await read("users");
  const viewer = users.find((item) => item.id === ids.viewer);
  await write("user.save", { ...viewer, is_active: true });
  await who("viewer");
  assert.equal(
    (await read("administrative_actions", { month: "2099-09" })).total,
    1,
  );
  await assert.rejects(
    write("administrative_action.save", {
      ...administrativeAction,
      reason: "اختراق",
    }),
    /صلاحية/,
  );
  await assert.rejects(
    db.query("select * from public.administrative_actions"),
    /permission denied/,
  );
  await who("hr");
  await assert.rejects(
    write("administrative_action_type.save", {
      arabic_name: "اختبار ممنوع",
      display_order: 99,
      is_active: true,
    }),
    /صلاحية/,
  );
  await assert.rejects(
    write("administrative_action.delete", {
      id: administrativeAction.id,
      version: administrativeAction.version,
      confirmed: true,
    }),
    /صلاحية/,
  );
});

test("administrative action audit is immutable and test data is soft deleted", async () => {
  await who("admin");
  const before = await read("audit", { employee_id: e2.id });
  assert.ok(
    before.rows.some(
      (item) =>
        item.entity_type === "administrative_actions" &&
        item.action === "create",
    ),
  );
  assert.ok(
    before.rows.some(
      (item) =>
        item.entity_type === "administrative_actions" &&
        item.action === "update",
    ),
  );
  await write("administrative_action.delete", {
    id: administrativeAction.id,
    version: administrativeAction.version,
    confirmed: true,
  });
  assert.equal(
    (await read("administrative_actions", { month: "2099-09" })).total,
    0,
  );
  await assert.rejects(
    db.query("delete from public.audit_logs"),
    /permission denied/,
  );
});
