import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { setup, api, ids } from "./evening-db-fixture.mjs";
test("all operational server reads execute after the proposed repair for each role", async () => {
  const db = await setup();
  try {
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
    for (const actor of [ids.admin, ids.follow, ids.supervisor, ids.viewer]) {
      await a.who(actor);
      for (const kind of [
        "bootstrap",
        "employee_directory",
        "position",
        "completeness",
        "reports",
        "actions",
        "expiring_documents",
        "reporting_model",
      ]) {
        try {
          const result = await a.read(kind);
          assert.ok(result);
        } catch (e) {
          throw Error(actor + " " + kind + ": " + e.message, { cause: e });
        }
      }
    }
  } finally {
    await db.close();
  }
});
