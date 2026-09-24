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
  layoutTablePdf,
  triggerDownload,
} = await import(compiled.href);
after(() => rm(compiled, { force: true }));

test('segmented monthly PDF repeats identity and separates all day ranges without losing subrows',async()=>{
 const fontBase64=(await readFile('public/fonts/DejaVuSans.ttf')).toString('base64');
 const segments=Array.from({length:3},(_,segment)=>({headers:['الكود الوظيفي','الموظف','الحركة',...Array.from({length:10},(_,d)=>String(segment*10+d+1))],rows:[['FANU-000001','موظف اصطناعي ذو اسم عربي طويل','دخول',...Array(10).fill('16:05')],['FANU-000001','موظف اصطناعي ذو اسم عربي طويل','خروج',...Array(10).fill('01:30 (+1)')]],columnWeights:[12,22,8,...Array(10).fill(7)]}));
 const bytes=await tablePdfBytes({title:'الموقف الشهري',period:'سبتمبر 2026 · معاينة غير معتمدة · نطاق 10–12 سبتمبر',...segments[0],segments,fontBase64});
 assert.equal((Buffer.from(bytes).toString('latin1').match(/\/Type \/Page\b/g)||[]).length,3);
 const sheet=strFromU8(unzipSync(tableExcelBytes({title:'الموقف الشهري',period:'سبتمبر 2026',...segments[0]}))['xl/worksheets/sheet1.xml']);
 assert.ok(sheet.includes('(+1)'));assert.ok(sheet.includes('دخول'));assert.ok(sheet.includes('خروج'));assert.ok(sheet.includes('FANU-000001'));
});

test("monthly PDF wraps Arabic identity columns and paginates without row overlap or lost day cells", async () => {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a3" });
  const font = (await readFile("public/fonts/DejaVuSans.ttf")).toString("base64");
  doc.addFileToVFS("Arabic.ttf", font);
  doc.addFont("Arabic.ttf", "Arabic", "normal");
  doc.setFont("Arabic");
  const headers = ["رقم الموظف", "الموظف", "القسم", "المسؤول بنهاية الشهر", ...Array.from({ length: 30 }, (_, i) => String(i + 1))];
  const rows = Array.from({ length: 57 }, (_, i) => [String(i), "موظف اختباري ذو اسم عربي طويل متعدد الأجزاء", "قسم اختبار (Test department)", "مسؤول اختبار متعدد الأجزاء", ...Array(30).fill(i % 2 ? "د ٠٤:٠٠ م\nخ بانتظار الخروج" : "—")]);
  const weights = [2, 6, 5, 5, ...Array(30).fill(1)];
  const layout = layoutTablePdf(doc, headers, rows, weights);
  assert.ok(layout.widths[1] >= layout.widths[4] * 6 - 0.001);
  assert.ok(layout.pages.length > 1);
  assert.equal(layout.pages.flat().length, rows.length);
  assert.equal(layout.pages.flat().reduce((n, r) => n + r.lines.length - 4, 0), 57 * 30);
  assert.ok(layout.pages.flat().some(r => r.height > 30));
  assert.deepEqual(layout.pages.flat().map(r => r.lines[0].join("")), rows.map(r => r[0]));
  for (const page of layout.pages) {
    assert.ok(layout.bodyTop + page.reduce((n, r) => n + r.height, 0) <= layout.bodyBottom);
    for (const row of page) for (const lines of row.lines)
      assert.ok(lines.length * 10 + 12 <= row.height);
  }
});

test("wrapped daily PDF rows reserve the notes box and footer", async () => {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const layout = layoutTablePdf(doc, ["Employee", "Notes"], Array.from({ length: 35 }, (_, i) => [String(i), "Long review note ".repeat(50)]), [1, 2], true);
  assert.equal(layout.pages.flat().length, 35);
  for (const page of layout.pages) {
    const end = layout.bodyTop + page.reduce((n, r) => n + r.height, 0);
    assert.ok(end + 18 + 12 + 112 < doc.internal.pageSize.getHeight() - 28);
  }
});
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
  const coded=report.rows.some(r=>r.internal_code);
  assert.match(sheet,new RegExp(`r="${coded?'J':'I'}198"[^>]*><v>6</v>`));
  assert.match(sheet,new RegExp(`r="${coded?'M':'L'}198"[^>]*><v>27</v>`));
  if(coded){assert.ok(header.includes('الكود الوظيفي'));for(const r of report.rows)assert.ok(sheet.includes(r.internal_code));}
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
