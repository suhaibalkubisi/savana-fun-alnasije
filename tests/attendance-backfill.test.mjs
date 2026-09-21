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
    } finally {
      await db.close();
    }
  });
}
