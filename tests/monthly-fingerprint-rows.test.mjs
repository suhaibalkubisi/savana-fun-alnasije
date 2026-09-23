import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const admin = "11111111-1111-4111-8111-111111111111";
let db;
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as
    $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
  for (const file of (await readdir("supabase/migrations")).filter(f => f.endsWith(".sql")).sort())
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  await db.exec("set hr.test_fixture='on'");
  await db.exec(await readFile("supabase/seed.sql", "utf8"));
  await db.query("insert into auth.users values($1,'monthly@example.invalid','{}')", [admin]);
  await db.query("update public.profiles set role='ADMIN',is_active=true where id=$1", [admin]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [admin]);
});
after(async () => db?.close());

async function fixture(run) {
  await db.exec("begin");
  try {
    const departments = (await db.query("select id from public.departments order by id limit 2")).rows;
    const managers = (await db.query("insert into public.managers(name) values('Early manager'),('Late manager') returning id,name")).rows;
    for (const d of departments) {
      await db.query(`insert into public.attendance_department_rules
        (department_id,effective_from,start_minute,entry_window_start,entry_window_end,default_manager_id)
        values($1,'2099-09-01',960,720,1439,$2),($1,'2099-09-16',960,720,1439,$3)`,
      [d.id, managers[0].id, managers[1].id]);
    }
    const people = (await db.query(`insert into public.employees(name,employee_number,department_id,employment_status)
      values('Same name','MONTH-ONE',$1,'active'),('Same name','MONTH-TWO',$1,'active') returning *`, [departments[0].id])).rows;
    const rpc = async (action, data) => (await db.query("select public.attendance_write_v3($1,$2) data", [action, data])).rows[0].data;
    const monthly = async (filters = {}) => (await db.query("select public.attendance_read_v3('monthly_fingerprint',$1) data", [{date:"2099-09-01",...filters}])).rows[0].data;
    const payload = {
      source_name:"monthly-rows.xls",source_hash:"7".repeat(64),import_kind:"monthly",period_start:"2099-09-01",period_end:"2099-09-30",
      rows:people.flatMap((p, i) => [5,20].map((day, j) => ({source_sheet:"Test",source_row:2+i*2+j,
        calendar_date:`2099-09-${String(day).padStart(2,"0")}`,source_name:p.name,person_code:p.employee_number,
        raw_values:["16:00","22:00"],punch_minutes:[960+i*5,1320+j*10],invalid:false}))),
    };
    // These same-name employees intentionally match by unique Person Code.
    // Confirmed mappings avoid the legacy name/code ambiguity guard.
    for (const p of people)
      await db.query("insert into public.fingerprint_identities(person_code,employee_id,source_name) values($1,$2,$3)", [p.employee_number,p.id,p.name]);
    await db.exec("set local role authenticated");
    const batch = await rpc("import.preview", payload);
    const approve = async () => {
      const reviewed = await rpc("import.review", {id:batch.id,version:batch.lifecycle_version});
      await rpc("import.approve", {id:batch.id,version:reviewed.lifecycle_version});
      await db.exec("set constraints all immediate");
    };
    await run({people,departments,managers,rpc,monthly,approve,batch});
  } finally { await db.exec("rollback"); }
}

test("monthly matrix: mid-month manager changes keep one complete UUID row", () => fixture(async ({people,managers,monthly,approve}) => {
  await approve();
  const result = await monthly();
  for (const p of people) {
    const rows = result.rows.filter(r => r.employee_id === p.id);
    assert.equal(rows.length, 1);
    assert.equal(Object.keys(rows[0].cells).length, 30);
    assert.equal(rows[0].manager_id, managers[1].id);
    assert.equal(rows[0].manager, managers[1].name);
    assert.notEqual(rows[0].cells["5"].entry, null);
    assert.notEqual(rows[0].cells["20"].entry, null);
  }
}));

test("monthly matrix: same-name UUIDs and every daily value/total remain separate", () => fixture(async ({people,monthly,approve}) => {
  await approve();
  const result = await monthly();
  assert.equal(new Set(result.rows.map(r => r.employee_id)).size, result.rows.length);
  await db.exec("reset role");
  for (const p of people) {
    const row = result.rows.find(r => r.employee_id === p.id);
    const daily = (await db.query(`select extract(day from d)::int as workday_number,a.*
      from generate_series('2099-09-01'::date,'2099-09-30'::date,'1 day') d
      cross join lateral hr_private.attendance_session(d::date,null,true) a where a.employee_id=$1`, [p.id])).rows;
    assert.equal(daily.length,30);
    for (const a of daily) assert.deepEqual(row.cells[String(a.workday_number)], {
      entry:a.entry_minute,exit:a.exit_minute,duration:a.duration_minutes,state:a.attendance_state,
    });
    assert.equal(Object.values(row.cells).reduce((n,c) => n+(c.duration||0),0), daily.reduce((n,a) => n+(a.duration_minutes||0),0));
  }
  assert.equal(result.rows.find(r => r.employee_id === people[0].id).cells["5"].entry,960);
  assert.equal(result.rows.find(r => r.employee_id === people[1].id).cells["5"].entry,965);
}));

test("monthly matrix: current department transfer keeps all days under the same UUID", () => fixture(async ({people,departments,monthly,approve}) => {
  await approve();
  const before = (await monthly()).rows.find(r => r.employee_id === people[0].id);
  await db.exec("reset role");
  // Employee transfers are current-state updates: the schema has no dated transfer ledger.
  await db.query("update public.employees set department_id=$1 where id=$2", [departments[1].id,people[0].id]);
  await db.exec("set local role authenticated");
  const after = (await monthly({department_id:departments[1].id})).rows.filter(r => r.employee_id === people[0].id);
  assert.equal(after.length,1);
  assert.equal(after[0].department_id, departments[1].id);
  assert.deepEqual(after[0].cells,before.cells);
  assert.equal((await monthly({department_id:departments[0].id})).rows.some(r => r.employee_id === people[0].id),false);
}));

test("monthly matrix: manager filters use month-end assignment and direct override without truncating days", () => fixture(async ({people,departments,managers,monthly,approve}) => {
  await approve();
  const unfiltered = await monthly();
  assert.equal((await monthly({manager_id:managers[0].id})).rows.some(r => r.employee_id === people[0].id),false);
  const filtered = await monthly({manager_id:managers[1].id,department_id:departments[0].id});
  assert.deepEqual(filtered.rows.find(r => r.employee_id === people[0].id).cells,unfiltered.rows.find(r => r.employee_id === people[0].id).cells);
  await db.exec("reset role");
  await db.query("update public.employees set direct_manager_id=$1 where id=$2",[managers[0].id,people[0].id]);
  await db.exec("set local role authenticated");
  const direct = (await monthly({manager_id:managers[0].id})).rows.find(r => r.employee_id === people[0].id);
  assert.equal(direct.manager,managers[0].name);
  assert.equal(Object.keys(direct.cells).length,30);
}));

test("monthly matrix: preview and reviewed evidence stay hidden until explicit approval", () => fixture(async ({people,rpc,monthly,batch}) => {
  const entry = async () => (await monthly()).rows.find(r => r.employee_id === people[0].id).cells["5"].entry;
  assert.equal(await entry(),null);
  const reviewed = await rpc("import.review",{id:batch.id,version:batch.lifecycle_version});
  assert.equal(await entry(),null);
  await rpc("import.approve",{id:batch.id,version:reviewed.lifecycle_version});
  await db.exec("set constraints all immediate");
  assert.equal(await entry(),960);
  assert.equal((await monthly()).approved_import.id,batch.id);
}));

test("monthly UI and Excel/PDF share filtered values and month-end manager semantics", async () => {
  const source = await readFile("components/hr/attendance.tsx","utf8");
  assert.match(source,/manager_id: monthly \? manager : ""/);
  assert.match(source,/المسؤول بنهاية الشهر/);
  assert.match(source,/rows=\{values\}/);
  assert.match(source,/rows=\{values\.map/);
  assert.match(source,/pdf \? await tablePdfBytes\(report\) : tableExcelBytes\(report\)/);
});
