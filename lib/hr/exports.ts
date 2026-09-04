import { zipSync, strToU8 } from "fflate";
import {
  daysInMonth,
  monthLabel,
  statuses,
  type Report,
  type ReportRow,
  type Totals,
} from "./types";
const keys: (keyof Totals)[] = [
  "absence",
  "absence2",
  "absence3",
  "leave",
  "late",
  "late_minutes",
  "weighted",
];
export const totalHeaders = [
  "غياب",
  "غياب ×2",
  "غياب ×3",
  "إجازات",
  "تأخيرات",
  "دقائق التأخير",
  "إجمالي الغياب المحتسب",
];
export const summaryKeys: (keyof Totals)[] = [
  "absence",
  "absence2",
  "absence3",
  "weighted",
  "leave",
  "late",
  "late_minutes",
];
export const summaryHeaders = [
  "رقم الموظف",
  "اسم الموظف",
  "القسم",
  "الشفت",
  "المسؤول المباشر",
  "غياب",
  "غياب ×2",
  "غياب ×3",
  "إجمالي الغياب المحتسب",
  "الإجازات",
  "عدد التأخيرات",
  "مجموع دقائق التأخير",
];
const values = (r: Totals) => keys.map((k) => Number(r[k]));
const summaryTotals = (r: Totals) => summaryKeys.map((k) => Number(r[k]));
export const summaryValues = (r: ReportRow) => [
  r.employee_number || "",
  r.name,
  r.department,
  r.shift || "غير محدد",
  r.manager || "غير محدد",
  ...summaryTotals(r),
];
function escape(s: unknown) {
  return String(s ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
function col(n: number) {
  let s = "";
  while (n >= 0) {
    s = String.fromCharCode((n % 26) + 65) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}
export function excelBytes(report: Report, title: string, summary = false) {
  const days = daysInMonth(report.month);
  const headers = summary
    ? summaryHeaders
    : [
        "رقم الموظف",
        "اسم الموظف",
        "القسم",
        ...Array.from({ length: days }, (_, i) => i + 1),
        ...totalHeaders,
      ];
  const data: (string | number)[][] = report.rows.map((r) =>
    summary
      ? summaryValues(r)
      : [
          r.employee_number || "",
          r.name,
          r.department,
          ...Array.from({ length: days }, (_, i) =>
            r.cells[i + 1] ? statuses[r.cells[i + 1]].code : "",
          ),
          ...values(r),
        ],
  );
  const total: (string | number)[] = Array(headers.length - 7).fill("");
  total[1] = "الإجمالي";
  total.push(
    ...(summary ? summaryTotals(report.totals) : values(report.totals)),
  );
  data.push(total);
  const grid: (string | number)[][] = [
    [title],
    [`قسم الموارد البشرية · ${monthLabel(report.month)}`],
    [],
    headers,
    ...data,
  ];
  const cells = grid
    .map(
      (r, ri) =>
        `<row r="${ri + 1}" ht="${ri < 2 ? 29 : ri === 3 ? 42 : 24}" customHeight="1">${r
          .map((v, ci) => {
            const style =
              ri < 2
                ? 1
                : ri === 3
                  ? 2
                  : ri === grid.length - 1
                    ? 3
                    : typeof v === "string" &&
                        ["غ", "غ×2", "غ×3", "إ", "ت"].includes(v)
                      ? 4 + ["غ", "غ×2", "غ×3", "إ", "ت"].indexOf(v)
                      : 0;
            return typeof v === "number"
              ? `<c r="${col(ci)}${ri + 1}" s="${style}"><v>${v}</v></c>`
              : `<c r="${col(ci)}${ri + 1}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${escape(v)}</t></is></c>`;
          })
          .join("")}</row>`,
    )
    .join("");
  const last = col(headers.length - 1);
  const lastRow = grid.length;
  const files: Record<string, Uint8Array> = {};
  const add = (name: string, xml: string) =>
    (files[name] = strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${xml}`,
    ));
  add(
    "[Content_Types].xml",
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
  );
  add(
    "_rels/.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  );
  add(
    "xl/workbook.xml",
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="التقرير الشهري" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">'التقرير الشهري'!$1:$4</definedName><definedName name="_xlnm.Print_Area" localSheetId="0">'التقرير الشهري'!$A$1:$${last}$${lastRow}</definedName></definedNames></workbook>`,
  );
  add(
    "xl/_rels/workbook.xml.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
  );
  const fills = [
    "FFFFFF",
    "1E2B4A",
    "EEF1F9",
    "F6F7FB",
    "FDECEC",
    "F9D5D9",
    "ECC0C9",
    "E5EFFD",
    "FFF2D5",
  ];
  add(
    "xl/styles.xml",
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Arial"/><color rgb="FF25324A"/></font><font><b/><sz val="15"/><name val="Arial"/><color rgb="FFFFFFFF"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts><fills count="${fills.length + 2}"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${fills.map((c) => `<fill><patternFill patternType="solid"><fgColor rgb="FF${c}"/><bgColor indexed="64"/></patternFill></fill>`).join("")}</fills><borders count="1"><border><left/><right/><top/><bottom style="hair"><color rgb="FFE2E8F0"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="9">${fills.map((_, i) => `<xf numFmtId="0" fontId="${i === 1 ? 1 : i === 2 || i === 3 ? 2 : 0}" fillId="${i + 2}" borderId="0" xfId="0" applyAlignment="1" applyFill="1"><alignment horizontal="center" vertical="center" wrapText="1" readingOrder="2"/></xf>`).join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
  );
  add(
    "xl/worksheets/sheet1.xml",
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${last}${lastRow}"/><sheetViews><sheetView workbookViewId="0" rightToLeft="1" showGridLines="0"><pane xSplit="3" ySplit="4" topLeftCell="D5" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="24"/><cols>${headers.map((_, i) => `<col min="${i + 1}" max="${i + 1}" width="${i === 1 ? 28 : i === 2 ? 26 : i === 0 ? 14 : summary ? 20 : i < days + 3 ? 5 : 13}" customWidth="1"/>`).join("")}</cols><sheetData>${cells}</sheetData><autoFilter ref="A4:${last}${lastRow - 1}"/><mergeCells count="2"><mergeCell ref="A1:${last}1"/><mergeCell ref="A2:${last}2"/></mergeCells><printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.35" bottom="0.35" header="0.15" footer="0.15"/><pageSetup paperSize="8" orientation="landscape" fitToWidth="1" fitToHeight="0"/><headerFooter><oddFooter>&amp;C&amp;P / &amp;N</oddFooter></headerFooter></worksheet>`,
  );
  return zipSync(files, { level: 6 });
}
export function download(bytes: Uint8Array, name: string, type: string) {
  const blob = new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
export async function pdfBytes(
  report: Report,
  title: string,
  summary = false,
  fontBase64?: string,
) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "pt",
    format: "a3",
    compress: true,
  });
  if (!fontBase64) {
    const r = await fetch("/fonts/DejaVuSans.ttf");
    if (!r.ok) throw new Error("تعذر تحميل خط التقرير");
    const bytes = new Uint8Array(await r.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    fontBase64 = btoa(binary);
  }
  doc.addFileToVFS("Arabic.ttf", fontBase64);
  doc.addFont("Arabic.ttf", "Arabic", "normal");
  doc.setFont("Arabic");
  doc.setProperties({
    title: `${title} ${report.month}`,
    author: "قسم الموارد البشرية",
    subject: "تقرير شهري",
  });
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const margin = 34;
  const usable = width - 2 * margin;
  const dayCount = daysInMonth(report.month);
  const segments = summary
    ? [[0, 0]]
    : [
        [1, 15],
        [16, dayCount],
      ];
  let page = 0;
  const text = (
    s: unknown,
    x: number,
    y: number,
    size = 10,
    align: "left" | "right" | "center" = "center",
  ) => {
    doc.setFontSize(size);
    doc.text(Array.isArray(s) ? s.map(String) : String(s ?? ""), x, y, {
      align,
    });
  };
  for (const [start, end] of segments) {
    const headers = summary
      ? summaryHeaders
      : [
          "رقم الموظف",
          "اسم الموظف",
          "القسم",
          ...Array.from({ length: end - start + 1 }, (_, i) =>
            String(start + i),
          ),
          ...totalHeaders.map((h) =>
            h
              .replace("إجمالي الغياب المحتسب", "المحتسب")
              .replace("دقائق التأخير", "الدقائق"),
          ),
        ];
    const base = summary
      ? [65, 170, 155, 70, 145, ...Array(7).fill((usable - 605) / 7)]
      : [
          55,
          155,
          160,
          ...Array(end - start + 1).fill(25),
          ...Array(7).fill((usable - 370 - (end - start + 1) * 25) / 7),
        ];
    const perPage = 20;
    const allRows = report.rows.map((r) =>
      summary
        ? summaryValues(r)
        : [
            r.employee_number || "—",
            r.name,
            r.department,
            ...Array.from({ length: end - start + 1 }, (_, i) =>
              r.cells[start + i] ? statuses[r.cells[start + i]].code : "",
            ),
            ...values(r),
          ],
    );
    const total: (string | number)[] = Array(headers.length - 7).fill("");
    total[1] = "الإجمالي";
    total.push(
      ...(summary ? summaryTotals(report.totals) : values(report.totals)),
    );
    allRows.push(total);
    for (let offset = 0; offset < allRows.length; offset += perPage) {
      if (page++) doc.addPage();
      doc.setTextColor("#26324A");
      text(title, width - margin, 42, 18, "right");
      text(
        `قسم الموارد البشرية · ${monthLabel(report.month)}`,
        width - margin,
        66,
        12,
        "right",
      );
      if (!summary) text(`الأيام ${start} – ${end}`, margin, 66, 11, "left");
      let x = width - margin;
      headers.forEach((h, i) => {
        x -= base[i];
        doc.setFillColor("#EDF0F7");
        doc.rect(x, 82, base[i], 43, "F");
        doc.setTextColor("#25324A");
        doc.setFontSize(9);
        const lines =
          base[i] < 90
            ? String(h)
                .replace("إجمالي الغياب المحتسب", "الغياب المحتسب")
                .split(" ")
            : [String(h)];
        text(lines as unknown as string, x + base[i] / 2, 100, 9);
      });
      allRows.slice(offset, offset + perPage).forEach((r, ri) => {
        let x = width - margin;
        const y = 125 + ri * 30;
        const last = offset + ri === allRows.length - 1;
        r.forEach((v, ci) => {
          x -= base[ci];
          doc.setFillColor(last ? "#E9EDF8" : ri % 2 ? "#F7F8FC" : "#FFFFFF");
          doc.rect(x, y, base[ci], 30, "F");
          doc.setDrawColor("#E2E6EF");
          doc.line(x, y + 30, x + base[ci], y + 30);
          doc.setTextColor("#25324A");
          doc.setFontSize(10);
          const lines =
            !summary && ci >= 3 && ci < 3 + end - start + 1
              ? [String(v)]
              : doc.splitTextToSize(String(v), base[ci] - 7);
          doc.text(lines, x + base[ci] / 2, y + (lines.length > 1 ? 12 : 19), {
            align: "center",
          });
        });
      });
      text(String(page), width / 2, height - 20, 10);
    }
  }
  return new Uint8Array(doc.output("arraybuffer"));
}
