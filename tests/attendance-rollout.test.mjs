import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const admin = "11111111-1111-4111-8111-111111111111";
async function fixture(run) {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
    for (const name of (await readdir("supabase/migrations")).filter(n => n.endsWith(".sql")).sort())
      await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
    await db.exec("set hr.test_fixture='on'");
    await db.exec(await readFile("supabase/seed.sql", "utf8"));
    await db.query("insert into auth.users values($1,'rollout@example.invalid','{}')", [admin]);
    await db.query("update public.profiles set role='ADMIN',is_active=true where id=$1", [admin]);
    const person = (await db.query("select * from public.employees where employment_status='active' order by id limit 1")).rows[0];
    await db.query(`insert into public.attendance_department_rules(department_id,effective_from,start_minute,entry_window_start,entry_window_end)
      values($1,'2099-01-01',960,720,1439)`, [person.department_id]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [admin]);
    await db.exec("set role authenticated");
    const rpc = async (version, action, data) => (await db.query(`select public.attendance_write${version}($1,$2) data`, [action, data])).rows[0].data;
    const payload = {source_name:"rollout.xls",source_hash:"e".repeat(64),import_kind:"monthly",period_start:"2099-01-01",period_end:"2099-01-31",
      rows:[{source_sheet:"Test",source_row:2,calendar_date:"2099-01-05",source_name:person.name,person_code:person.employee_number,raw_values:["16:05","22:00"],punch_minutes:[965,1320],invalid:false}]};
    const reviews = async () => (await db.query("select public.attendance_read_v3('imports','{}') data")).rows[0].data;
    const monthly = async () => (await db.query("select public.attendance_read_v3('monthly_fingerprint',$1) data", [{date:"2099-01-01",department_id:person.department_id}])).rows[0].data;
    await run({db,rpc,payload,reviews,monthly,person});
  } finally { await db.close(); }
}

test("rollout: V2 preview after backfill awaits explicit V3 review and approval", () => fixture(async ({rpc,payload,reviews,monthly,person}) => {
  const legacy = await rpc("_v2","import.preview",payload);
  let review = (await reviews()).find(r => r.id === legacy.id);
  assert.equal(review.lifecycle_state,"preview");
  assert.equal(review.reviewed_at,null);
  assert.equal(review.approved_at,null);
  assert.equal((await monthly()).approved_import,null);
  await assert.rejects(rpc("_v2","import.apply",{id:legacy.id,version:legacy.version}), /مراجعة ثم اعتماد/);
  review = (await reviews()).find(r => r.id === legacy.id);
  assert.equal(review.state,"preview");
  assert.equal(review.lifecycle_state,"preview");
  const reviewed = await rpc("_v3","import.review",{id:legacy.id,version:review.lifecycle_version});
  await rpc("_v3","import.approve",{id:legacy.id,version:reviewed.lifecycle_version});
  const result = await monthly();
  assert.equal(result.approved_import.id,legacy.id);
  assert.equal(result.rows.find(r => r.employee_id === person.id).cells["5"].entry,965);
}));

test("rollout: V1 and V2 cannot bypass approval and V3 duplicates preserve one review", () => fixture(async ({rpc,payload,reviews}) => {
  const legacy = await rpc("","import.preview",payload);
  await assert.rejects(rpc("","import.apply",{id:legacy.id,version:legacy.version}), /مراجعة ثم اعتماد/);
  const duplicate = await rpc("_v3","import.preview",payload);
  assert.equal(duplicate.id,legacy.id);
  assert.equal(duplicate.duplicate,true);
  assert.equal(duplicate.lifecycle_state,"preview");
  assert.equal((await reviews()).filter(r => r.id === legacy.id).length,1);
}));

test("rollout: legacy cancellation synchronizes the pending review without approval", () => fixture(async ({rpc,payload,reviews,monthly}) => {
  const legacy = await rpc("_v2","import.preview",payload);
  await rpc("_v2","import.cancel",{id:legacy.id,version:legacy.version});
  const review = (await reviews()).find(r => r.id === legacy.id);
  assert.equal(review.lifecycle_state,"cancelled");
  assert.equal(review.approved_at,null);
  assert.equal((await monthly()).approved_import,null);
}));

test("rollout: daily V2 imports coexist with V3 monthly imports", () => fixture(async ({rpc,payload,reviews}) => {
  const daily = await rpc("_v2","import.preview",{...payload,import_kind:"daily",source_hash:"f".repeat(64)});
  assert.equal((await rpc("_v2","import.apply",{id:daily.id,version:daily.version})).state,"applied");
  const monthly = await rpc("_v3","import.preview",payload);
  assert.equal((await reviews()).find(r => r.id === monthly.id).lifecycle_state,"preview");
}));

test("rollout: new triggers add no anonymous, viewer, or direct table privileges", () => fixture(async ({db,rpc,payload}) => {
  await db.exec("reset role");
  const checks = (await db.query(`select
    has_function_privilege('anon','public.attendance_write_v3(text,jsonb)','execute') anon_rpc,
    has_function_privilege('authenticated','hr_private.sync_monthly_import_review()','execute') sync_rpc,
    has_function_privilege('authenticated','hr_private.require_monthly_import_approval()','execute') guard_rpc,
    has_table_privilege('authenticated','public.attendance_import_reviews','insert') direct_insert,
    (select relrowsecurity from pg_class where oid='public.attendance_import_reviews'::regclass) rls`)).rows[0];
  assert.deepEqual(checks,{anon_rpc:false,sync_rpc:false,guard_rpc:false,direct_insert:false,rls:true});
  await db.query("update public.profiles set role='VIEWER' where id=$1",[admin]);
  await db.exec("set role authenticated");
  await assert.rejects(rpc("_v2","import.preview",payload), /صلاحية/);
  await assert.rejects(rpc("_v3","import.preview",payload), /صلاحية/);
}));
