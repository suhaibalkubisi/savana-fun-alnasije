import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { unzipSync, strFromU8 } from "fflate";
import { report } from "./export-fixture.mjs";
import { formatClock12 } from "../lib/hr/time-format.mjs";
const compiled = new URL("./.export-check.mjs", import.meta.url);
await build({
  entryPoints: ["lib/hr/exports.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: fileURLToPath(compiled),
});
const {
  excelBytes,
  pdfBytes,
  tableExcelBytes,
  tablePdfBytes,
  triggerDownload,
} = await import(compiled.href);
after(() => rm(compiled, { force: true }));
test("browser download attaches its link and leaves the prepared URL available for retry", () => {
  const previous = globalThis.document;
  let attached = false;
  let clicked = false;
  const anchor = {
    click() {
      assert.equal(attached, true);
      assert.equal(this.href, "blob:prepared-monthly-report");
      assert.equal(this.download, "HR_monthly_2026-09.pdf");
      clicked = true;
    },
    remove() {
      attached = false;
    },
  };
  globalThis.document = {
    createElement: () => anchor,
    body: {
      appendChild() {
        attached = true;
      },
    },
  };
  try {
    triggerDownload("blob:prepared-monthly-report", "HR_monthly_2026-09.pdf");
    assert.equal(clicked, true);
    assert.equal(attached, false);
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});
test("daily Excel keeps twelve-hour punch labels and numeric lateness editable", () => {
  const sheet = strFromU8(
    unzipSync(
      tableExcelBytes({
        title: "الموقف اليومي",
        period: "2026-09-08",
        headers: ["وقت الدوام", "وقت الدخول", "وقت الخروج", "دقائق التأخير"],
        rows: [
          [formatClock12(960), formatClock12(987), formatClock12(1518), 27],
        ],
      }),
    )["xl/worksheets/sheet1.xml"],
  );
  assert.ok(sheet.includes("٠٤:٠٠ م"));
  assert.ok(sheet.includes("٠٤:٢٧ م"));
  assert.ok(sheet.includes("٠١:١٨ ص (+١ يوم)"));
  assert.match(sheet, /<v>27<\/v>/);
});
test("Excel matrix exports real active database employees, valid days and weighted totals", () => {
  const zip = unzipSync(excelBytes(report, "الموقف الشامل", false));
  const sheet = strFromU8(zip["xl/worksheets/sheet1.xml"]);
  assert.equal(report.rows.length, 192);
  assert.equal(report.totals.weighted, 6);
  assert.equal(report.totals.late_minutes, 27);
  assert.ok(sheet.includes('rightToLeft="1"'));
  assert.ok(sheet.includes("الالتقاط (Picking)"));
  assert.ok(sheet.includes("غ×2"));
  assert.ok(sheet.includes("غ×3"));
  assert.ok(!sheet.includes("<f>"));
  assert.equal((sheet.match(/<row /g) || []).length, 198);
});
test("Summary and department Excel export use the same filtered report values", () => {
  const zip = unzipSync(excelBytes(report, "ملخص الموظفين", true));
  const sheet = strFromU8(zip["xl/worksheets/sheet1.xml"]);
  const header = sheet.match(/<row r="5".*?<\/row>/s)[0];
  assert.ok(
    header.indexOf("إجمالي الغياب المحتسب") < header.indexOf("الإجازات"),
  );
  assert.ok(
    sheet.includes('I198" s="3"><v>6</v>') ||
      /r="I198"[^>]*><v>6<\/v>/.test(sheet),
  );
  assert.ok(/r="L198"[^>]*><v>27<\/v>/.test(sheet));
  const id = report.rows[0].department_id;
  const rows = report.rows.filter((r) => r.department_id === id);
  const totals = Object.fromEntries(
    Object.keys(report.totals).map((k) => [
      k,
      rows.reduce((n, r) => n + Number(r[k]), 0),
    ]),
  );
  const department = strFromU8(
    unzipSync(excelBytes({ ...report, rows, totals }, "موقف الأقسام", false))[
      "xl/worksheets/sheet1.xml"
    ],
  );
  assert.equal((department.match(/<row /g) || []).length, rows.length + 6);
});
test("Operational exports are genuine branded XLSX and Arabic PDF", async () => {
  const zip = unzipSync(
    tableExcelBytes({
      title: "تقرير التأخيرات",
      period: "سبتمبر 2026",
      headers: ["الموظف", "الدقائق"],
      rows: [["موظف اختبار", 27]],
    }),
  );
  const sheet = strFromU8(zip["xl/worksheets/sheet1.xml"]);
  assert.ok(sheet.includes('rightToLeft="1"'));
  assert.ok(sheet.includes("قسم الموارد البشرية – مسائي"));
  assert.ok(sheet.includes("Designed by Suhaib Al-Kubaisi"));
  const font = (await readFile("public/fonts/DejaVuSans.ttf")).toString(
    "base64",
  );
  const pdf = Buffer.from(
    await tablePdfBytes({
      title: "تقرير التأخيرات",
      period: "سبتمبر 2026",
      headers: ["الموظف", "الدقائق"],
      rows: [["موظف اختبار", 27]],
      fontBase64: font,
    }),
  ).toString("latin1");
  assert.ok(pdf.startsWith("%PDF-"));
  assert.ok(pdf.includes("/FontFile2"));
});
test("Arabic PDF exports use embedded font and paginate full source report", async () => {
  const font = (await readFile("public/fonts/DejaVuSans.ttf")).toString(
    "base64",
  );
  for (const summary of [false, true]) {
    const bytes = await pdfBytes(
      report,
      summary ? "ملخص الموظفين" : "الموقف الشامل",
      summary,
      font,
    );
    const pdf = Buffer.from(bytes).toString("latin1");
    assert.ok(pdf.startsWith("%PDF-"));
    assert.ok(pdf.includes("/FontFile2"));
    assert.ok(
      (pdf.match(/\/Type \/Page\b/g) || []).length >= (summary ? 10 : 20),
    );
  }
});
