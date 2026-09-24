import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migration = "202609170001_attendance_core.sql";
const cases = [
  { name: "older applied survives newer preview", states: ["applied", "preview"], expected: ["approved", "preview"] },
  { name: "older applied survives newer cancelled", states: ["applied", "cancelled"], expected: ["approved", "cancelled"] },
  { name: "newest applied supersedes older applied", states: ["applied", "applied"], expected: ["superseded", "approved"] },
  { name: "preview and cancelled alone never imply approval", states: ["preview", "cancelled"], expected: ["preview", "cancelled"] },
];

for (const scenario of cases) {
  test(`migration backfill: ${scenario.name}`, async () => {
    const db = new PGlite();
    try {
      await db.exec(`
        create role anon; create role authenticated; create role service_role;
        create schema auth;
        create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
        create function auth.uid() returns uuid language sql stable as
          $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      `);
      const preceding = (await readdir("supabase/migrations"))
        .filter(name => name.endsWith(".sql") && name < migration).sort();
      for (const name of preceding) await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
      await db.exec("set hr.test_fixture = 'on'");
      await db.exec(await readFile("supabase/seed.sql", "utf8"));
      const employee = (await db.query("select id,department_id from public.employees where employment_status='active' order by id limit 1")).rows[0];
      await db.query(`insert into public.attendance_department_rules
        (department_id,effective_from,start_minute,entry_window_start,entry_window_end)
        values($1,'2026-09-01',960,720,1439)`, [employee.department_id]);

      // Disposable legacy fixture only: retain explicit historical timestamps.
      // Re-enable the touch trigger before applying the migration under test.
      await db.exec("alter table public.attendance_imports disable trigger touch_attendance");
      for (const [index, state] of scenario.states.entries()) {
        await db.query(`insert into public.attendance_imports
          (id,source_name,source_hash,import_kind,period_start,period_end,state,updated_at)
          values($1,$2,$3,'monthly','2026-09-01','2026-09-30',$4,$5)`, [
          `00000000-0000-4000-8000-00000000000${index + 1}`,
          `legacy-${index}.xls`, String(index + 1).repeat(64), state,
          `2026-10-0${index + 1}T12:00:00Z`,
        ]);
      }
      await db.exec("alter table public.attendance_imports enable trigger touch_attendance");
      const legacy = (await db.query("select * from public.attendance_imports order by id")).rows;
      for (const [index, row] of legacy.entries()) {
        await db.query(`insert into public.fingerprint_source_rows
          (import_id,source_sheet,source_row,calendar_date,source_name,raw_values,punch_minutes,employee_id,match_state)
          values($1,'Legacy',2,'2026-09-06','Legacy evidence','[]',$2,$3,'confirmed')`,
        [row.id, [1000 + index * 20], employee.id]);
      }
      assert.ok(new Date(legacy[0].updated_at) < new Date(legacy[1].updated_at));

      await db.exec(await readFile(`supabase/migrations/${migration}`, "utf8"));
      const reviews = (await db.query(`select import_id,lifecycle_state,
        to_char(period_month,'YYYY-MM-DD') as month,approved_at,reviewed_at
        from public.attendance_import_reviews order by import_id`)).rows;
      assert.deepEqual(reviews.map(row => row.lifecycle_state), scenario.expected);
      assert.equal(reviews.filter(row => row.lifecycle_state === "approved").length,
        scenario.states.includes("applied") ? 1 : 0);
      for (const [index, row] of reviews.entries()) {
        assert.equal(row.import_id, legacy[index].id);
        assert.equal(row.month, "2026-09-01");
        assert.deepEqual(row.approved_at, row.lifecycle_state === "approved" ? legacy[index].updated_at : null);
        assert.deepEqual(row.reviewed_at, scenario.states[index] === "applied" ? legacy[index].updated_at : null);
      }
      assert.deepEqual((await db.query("select * from public.attendance_imports order by id")).rows, legacy);
      const daily = (await db.query("select * from hr_private.attendance_session('2026-09-06',null,false) where employee_id=$1", [employee.id])).rows[0];
      assert.equal(daily.entry_minute, null, "daily attendance must ignore every legacy monthly source, including superseded applied imports");
      const monthly = (await db.query("select * from hr_private.attendance_session('2026-09-06',null,true) where employee_id=$1", [employee.id])).rows[0];
      const approvedIndex = scenario.expected.indexOf("approved");
      assert.equal(monthly.entry_minute, approvedIndex < 0 ? null : 1000 + approvedIndex * 20);
    } finally {
      await db.close();
    }
  });
}
