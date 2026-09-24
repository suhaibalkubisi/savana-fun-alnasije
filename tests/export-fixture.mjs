// Isolated UI-test database. Never imported by the application or deployed.
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
const db = new PGlite();
const admin = "11111111-1111-4111-8111-111111111111";
await db.exec(
  `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`,
);
for (const file of (await readdir("supabase/migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort())
  await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
await db.exec("set hr.test_fixture = 'on'");
await db.exec(await readFile("supabase/seed.sql", "utf8"));
await db.query("insert into auth.users values($1,$2,$3)", [
  admin,
  "qa@example.invalid",
  { name: "فحص النظام" },
]);
await db.query("update profiles set role='ADMIN',is_active=true where id=$1", [
  admin,
]);
await db.query("select set_config('request.jwt.claim.sub',$1,false)", [admin]);
await db.exec("set role authenticated");
const read = async (kind, filters = {}) =>
  (await db.query("select hr_read_v2($1,$2) data", [kind, filters])).rows[0]
    .data;
const write = async (action, data) =>
  (await db.query("select hr_write_v2($1,$2) data", [action, data])).rows[0]
    .data;
const ref = await read("reference");
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Baghdad",
}).format(new Date());
for (const [i, status] of [
  "absence",
  "absence2",
  "absence3",
  "leave",
  "late",
].entries()) {
  await write("status.save", {
    employee_id: ref.employees[i].id,
    department_id: ref.employees[i].department_id,
    record_date: today,
    status_type: status,
    late_minutes: status === "late" ? 27 : null,
  });
}
export const report = await read("report", { month: today.slice(0, 7) });
await db.close();
