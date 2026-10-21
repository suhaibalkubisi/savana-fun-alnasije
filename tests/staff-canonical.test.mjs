import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { setup, api, ids, employee } from "./evening-db-fixture.mjs";
import { compileFollowupReports } from "../scripts/compile-followup-reports.mjs";
import { unzipSync, strFromU8 } from "fflate";
async function ready() {
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
  const day = (await db.query("select followup_private.today()::text task_day"))
    .rows[0].task_day;
  const a = api(db);
  await a.who(ids.admin);
  return { db, a, day };
}
async function grant(a, cap) {
  await a.write("capability", {
    user_id: ids.admin,
    capability: cap,
    granted: true,
    version: 0,
    reason: "Synthetic explicit permission",
  });
}
const plus = (d, n) =>
  new Date(Date.parse(d + "T12:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
test("canonical screen dataset and PDF/XLSX retain snapshot identity and one absent3 day after identity/service changes", async () => {
  const { db, a, day } = await ready();
  try {
    const roster = await a.read("roster", {
      department_id: ids.d1,
      start: day,
    });
    const old = roster.find((e) => e.id === employee(1));
    const report = await a.write("submit", {
      department_id: ids.d1,
      work_date: day,
      reporter_id: ids.admin,
      channel: "account",
      entries: roster.map((e) => ({
        employee_id: e.id,
        status: e.id === old.id ? "absent3" : "unresolved",
      })),
    });
    await grant(a, "identity_edit");
    await grant(a, "service_manage");
    await a.write("employee_identity", {
      employee_id: old.id,
      version: 1,
      name: "Synthetic corrected current name",
      employee_number: "IDENTITY-1",
      reason: "Synthetic deliberate name correction",
    });
    await a.write("service_state", {
      employee_id: old.id,
      version: 2,
      employment_status: "inactive",
      valid_from: day,
      reason: "Synthetic current service decision",
    });
    const p = await a.read("profile", { employee_id: old.id });
    assert.equal(p.employee.employment_status, "inactive");
    assert.equal(p.employee.name, "Synthetic corrected current name");
    assert.equal(
      (await a.read("roster", { department_id: ids.d1, start: day })).some(
        (e) => e.id === old.id,
      ),
      false,
    );
    const data = await a.read("reporting_model", {
      start: day,
      end: day,
      department_id: ids.d1,
    });
    const row = data.positions.find((e) => e.employee_id === old.id);
    assert.equal(row.name, old.name);
    assert.equal(row.status, "absent3");
    assert.equal(
      data.reports
        .find((r) => r.id === report.id)
        .entries.find((e) => e.employee_id === old.id).employee_name,
      old.name,
    );
    const dir = path.resolve("work/staff-canonical-exports");
    await compileFollowupReports(dir);
    const { reportTable, reportCounts } = await import(
      new URL("file:///" + dir.replaceAll("\\", "/") + "/report-model.mjs")
    );
    const { excelBytes, pdfDocument } = await import(
      new URL("file:///" + dir.replaceAll("\\", "/") + "/exports.mjs")
    );
    const boot = await a.read("bootstrap"),
      context = { ...boot, ...data };
    const table = reportTable(
      { kind: "daily", start: day, end: day, department_id: ids.d1 },
      context,
      data.positions,
      data.employees,
      data.reports,
      data.actions,
    );
    const c = reportCounts(data.positions, boot.statuses);
    assert.equal(c.absent, 1);
    assert.equal(c.weighted, 3);
    assert.ok(table.rows.some((r) => r.includes(old.name)));
    assert.ok(
      !table.rows.some((r) => r.includes("Synthetic corrected current name")),
    );
    const assets = {
      bodyFont: (await fs.readFile("public/fonts/FANUArabic.ttf")).toString(
        "base64",
      ),
      titleFont: (await fs.readFile("public/fonts/Cairo-750.ttf")).toString(
        "base64",
      ),
      company: new Uint8Array(
        await fs.readFile("public/brand/fanu-official-20260908.jpeg"),
      ),
      savana: new Uint8Array(
        await fs.readFile("public/brand/savana-official-20260908.png"),
      ),
    };
    const xlsx = await excelBytes(table, assets),
      files = unzipSync(xlsx),
      xml = Object.entries(files)
        .filter(([k]) => k.endsWith(".xml"))
        .map(([, v]) => strFromU8(v))
        .join("");
    assert.ok(xml.includes(old.name));
    assert.ok(!xml.includes("Synthetic corrected current name"));
    const pdf = await pdfDocument(table, assets);
    assert.ok(pdf.pageCount > 0);
    assert.ok(Buffer.from(pdf.bytes).toString("latin1").startsWith("%PDF-"));
    await fs.writeFile(path.join(dir, "synthetic-current-source.xlsx"), xlsx);
    await fs.writeFile(
      path.join(dir, "synthetic-current-source.pdf"),
      pdf.bytes,
    );
  } finally {
    await db.close();
  }
});
test("dated roster setup preserves independent service and refuses a later inactive service date", async () => {
  const { db, a, day } = await ready();
  try {
    await grant(a, "service_manage");
    await grant(a, "roster_manage");
    await a.write("service_state", {
      employee_id: employee(20),
      version: 1,
      employment_status: "long_leave",
      valid_from: day,
      reason: "Synthetic independent long leave",
    });
    const date = plus(day, 2),
      preview = await a.write("roster_setup_preview", {
        department_id: ids.d1,
        valid_from: date,
        reason: "Synthetic deliberate roster decision",
        employees: [{ employee_id: employee(20), version: 2 }],
      });
    await a.write("roster_setup_commit", { preview_id: preview.id });
    assert.equal(
      (await a.read("roster", { department_id: ids.d1, start: date })).find(
        (e) => e.id === employee(20),
      ).employment_status,
      "long_leave",
    );
    assert.equal(
      (await a.read("profile", { employee_id: employee(20) })).employee
        .shift_id,
      null,
    );
    await a.write("service_state", {
      employee_id: employee(19),
      version: 1,
      employment_status: "resigned",
      valid_from: plus(day, 1),
      reason: "Synthetic future resignation",
    });
    assert.equal(
      (
        await a.read("roster_setup_candidates", {
          department_id: ids.d1,
          start: date,
        })
      ).some((e) => e.id === employee(19)),
      false,
    );
    await assert.rejects(
      a.write("roster_setup_preview", {
        department_id: ids.d1,
        valid_from: date,
        reason: "Synthetic refused inactive selection",
        employees: [{ employee_id: employee(19), version: 2 }],
      }),
    );
    await db.exec("reset role");
    assert.equal(
      (await db.query("select count(*)::int n from fu_reports")).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});
