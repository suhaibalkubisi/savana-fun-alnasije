import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { ready, grant, ids, employee } from "./staff-round2-fixture.mjs";
import { compileFollowupReports } from "../scripts/compile-followup-reports.mjs";
test("R2-FLOW profile/service -> independent reporter -> return/correction/partial review -> no-shift action/comment/document -> daily/monthly -> real export functions", async () => {
  const { db, a } = await ready();
  const day = "2026-10-19",
    dir = path.resolve("work/round2-flow");
  try {
    await grant(a, "service_manage");
    const p = await a.read("profile", { employee_id: employee(20) });
    assert.equal(p.employee.shift_id, null);
    const decision = await a.write("service_state", {
      employee_id: employee(20),
      version: p.employee.version,
      employment_status: "long_leave",
      valid_from: day,
      reason: "Synthetic daily-flow decision",
    });
    assert.ok(decision.id);
    await a.who(ids.follow);
    const reporter = await a.write("reporter", {
      department_id: ids.d1,
      name: "مسؤول تبليغ اصطناعي مستقل",
      channel: "phone",
      active: true,
    });
    const roster = await a.read("roster", {
      department_id: ids.d1,
      start: day,
    });
    const source = {
      department_id: ids.d1,
      work_date: day,
      reporter_id: null,
      reporter_registry_id: reporter.id,
      channel: "phone",
      reported_at: null,
      evidence_reference: "Isolated phone statement",
    };
    const entries = roster.map((e, i) => ({
      employee_id: e.id,
      status: i === 0 ? "absent3" : i === 1 ? "present" : "unresolved",
    }));
    let report = await a.write("submit", { ...source, entries });
    assert.equal(report.entered_by, ids.follow);
    assert.equal(report.reporter_id, null);
    assert.equal(report.reporter_registry_id, reporter.id);
    assert.equal(report.reported_at, null);
    await a.who(ids.admin);
    report = await a.write("return", {
      ...source,
      id: report.id,
      version: report.version,
      reason: "سبب اصطناعي لاستكمال التبليغ",
    });
    assert.equal(report.state, "returned");
    await a.who(ids.follow);
    report = await a.write("save", {
      ...source,
      id: report.id,
      version: report.version,
      entries: entries.map((e, i) =>
        i === 2 ? { ...e, status: "present" } : e,
      ),
    });
    report = await a.write("submit", {
      ...source,
      id: report.id,
      version: report.version,
    });
    await a.who(ids.admin);
    report = await a.write("review", {
      ...source,
      id: report.id,
      version: report.version,
      reason: "مراجعة جزئية؛ المعلومة الناقصة باقية",
    });
    assert.equal(report.state, "reviewed");
    assert.ok(report.entries.some((x) => x.status === "unresolved"));
    assert.ok((await a.read("revisions", { id: report.id })).length >= 3);
    const bytes = Buffer.from(
      "%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF",
    );
    const digest = createHash("sha256").update(bytes).digest("hex");
    let document = await a.write("document", {
      employee_id: employee(20),
      title: "مرفق اصطناعي للدورة",
      kind: "general",
      file_name: "synthetic-proof.pdf",
      mime_type: "application/pdf",
      byte_size: bytes.length,
      original_sha256: digest,
    });
    await db.query(
      "insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)",
      [
        document.bucket,
        document.object_path,
        { size: bytes.length, mimetype: "application/pdf" },
      ],
    );
    document = await a.write("document_activate", {
      id: document.id,
      version: document.version,
    });
    const action = await a.write("action", {
      department_id: ids.d1,
      employee_id: employee(20),
      description: "متابعة موظف بلا شفت",
      responsible_id: ids.supervisor,
      due_date: day,
      state: "open",
      notes: "ملاحظة اصطناعية",
      comment: "تعليق مع مرفق مخوّل",
      attachment_document_id: document.id,
    });
    assert.equal(
      (await a.read("actions", { employee_id: employee(20) }))[0].comments[0]
        .document_id,
      document.id,
    );
    await a.who(ids.supervisor);
    const updated = await a.write("action", {
      ...action,
      state: "progress",
      notes: "متابعة مخوّلة",
      comment: "تعليق المشرف",
    });
    assert.equal(updated.state, "progress");
    await assert.rejects(
      a.write("action", {
        ...updated,
        description: "تغيير وصف غير مخوّل",
        state: "completed",
      }),
    );
    await a.who(ids.viewer);
    const daily = await a.read("reporting_model", {
      department_id: ids.d1,
      start: day,
      end: day,
    });
    const monthly = await a.read("reporting_model", {
      department_id: ids.d1,
      start: "2026-10-01",
      end: "2026-10-31",
    });
    await compileFollowupReports(dir);
    const { reportTable, reportCounts } = await import(
      new URL("file:///" + dir.replaceAll("\\", "/") + "/report-model.mjs")
    );
    const { excelBytes, pdfDocument } = await import(
      new URL("file:///" + dir.replaceAll("\\", "/") + "/exports.mjs")
    );
    const boot = await a.read("bootstrap");
    const counts = reportCounts(daily.positions, boot.statuses);
    assert.equal(counts.absent, 1);
    assert.equal(counts.weighted, 3);
    assert.ok(counts.unresolved > 0);
    const dailyTable = reportTable(
      { kind: "daily", start: day, end: day, department_id: ids.d1 },
      { ...boot, ...daily },
      daily.positions,
      daily.employees,
      daily.reports,
      daily.actions,
    );
    const monthlyTable = reportTable(
      {
        kind: "monthly",
        start: "2026-10-01",
        end: "2026-10-31",
        department_id: ids.d1,
      },
      { ...boot, ...monthly },
      monthly.positions,
      monthly.employees,
      monthly.reports,
      monthly.actions,
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
    await fs.writeFile(
      dir + "/synthetic-daily.xlsx",
      await excelBytes(dailyTable, assets),
    );
    await fs.writeFile(
      dir + "/synthetic-monthly.xlsx",
      await excelBytes(monthlyTable, assets),
    );
    await fs.writeFile(
      dir + "/synthetic-daily.pdf",
      (await pdfDocument(dailyTable, assets)).bytes,
    );
    await fs.writeFile(
      dir + "/flow-evidence.json",
      JSON.stringify(
        {
          environment:
            "PGlite and synthetic object fixture; not native Auth/Storage",
          reporter_is_independent: true,
          received_time_null: true,
          review_is_partial: true,
          counts,
          action_without_shift_readback: true,
          document_linked: true,
          exports: ["daily.xlsx", "monthly.xlsx", "daily.pdf"],
        },
        null,
        2,
      ),
    );
  } finally {
    await db.close();
  }
});
