import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const seed = await readFile("supabase/seed.sql", "utf8");

test("test seed refuses execution without explicit test opt-in", async () => {
  const db = new PGlite();
  try {
    await assert.rejects(db.exec(seed), /TEST ONLY seed: set hr.test_fixture/);
    await db.exec("rollback");
  } finally {
    await db.close();
  }
});

for (const occupied of ["public.employees", "auth.users"]) {
  test(`test seed refuses an existing ${occupied} record even with opt-in`, async () => {
    const db = new PGlite();
    try {
      await db.exec(`
        create schema auth;
        create table public.employees(id integer);
        create table auth.users(id integer);
        insert into ${occupied} values(1);
        set hr.test_fixture = 'on';
      `);
      await assert.rejects(db.exec(seed), /refusing a database with existing employees or accounts/);
      await db.exec("rollback");
      assert.equal((await db.query(`select count(*)::int as count from ${occupied}`)).rows[0].count, 1);
    } finally {
      await db.close();
    }
  });
}
