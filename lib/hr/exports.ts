import { zipSync, strToU8 } from "fflate";
import type { jsPDF } from "jspdf";
import { brandAssets, type BrandKind } from "./brand";
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
  "administrative_actions",
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
  "عدد الإجراءات الإدارية",
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
  const metricCount = summary ? summaryKeys.length : keys.length;
  const total: (string | number)[] = Array(headers.length - metricCount).fill(
    "",
  );
  total[1] = "الإجمالي";
  total.push(
    ...(summary ? summaryTotals(report.totals) : values(report.totals)),
  );
  data.push(total);
  const grid: (string | number)[][] = [
    ["قسم الموارد البشرية – مسائي"],
    [title],
    [monthLabel(report.month)],
    [],
    headers,
    ...data,
  ];
  const cells = grid
    .map(
      (r, ri) =>
        `<row r="${ri + 1}" ht="${ri < 3 ? 28 : ri === 4 ? 42 : 24}" customHeight="1">${r
          .map((v, ci) => {
            const style =
              ri < 3
                ? 1
                : ri === 4
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
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="التقرير الشهري" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">'التقرير الشهري'!$1:$5</definedName><definedName name="_xlnm.Print_Area" localSheetId="0">'التقرير الشهري'!$A$1:$${last}$${lastRow}</definedName></definedNames></workbook>`,
  );
  add(
    "xl/_rels/workbook.xml.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
  );
  const fills = [
    "FFFFFF",
    "0B2B55",
    "EAF2FF",
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
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${last}${lastRow}"/><sheetViews><sheetView workbookViewId="0" rightToLeft="1" showGridLines="0"><pane xSplit="3" ySplit="5" topLeftCell="D6" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="24"/><cols>${headers.map((_, i) => `<col min="${i + 1}" max="${i + 1}" width="${i === 1 ? 28 : i === 2 ? 26 : i === 0 ? 14 : summary ? 20 : i < days + 3 ? 5 : 13}" customWidth="1"/>`).join("")}</cols><sheetData>${cells}</sheetData><autoFilter ref="A5:${last}${lastRow - 1}"/><mergeCells count="3"><mergeCell ref="A1:${last}1"/><mergeCell ref="A2:${last}2"/><mergeCell ref="A3:${last}3"/></mergeCells><printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.35" bottom="0.45" header="0.15" footer="0.15"/><pageSetup paperSize="8" orientation="landscape" fitToWidth="1" fitToHeight="0"/><headerFooter><oddFooter>&amp;LDesigned by Suhaib Al-Kubaisi&amp;C&amp;P / &amp;N&amp;Rقسم الموارد البشرية – مسائي</oddFooter></headerFooter></worksheet>`,
  );
  return zipSync(files, { level: 6 });
}
export function triggerDownload(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.hidden = true;
  document.body.appendChild(a);
  try {
    a.click();
  } finally {
    a.remove();
  }
}
export function download(bytes: Uint8Array, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  try {
    triggerDownload(url, name);
  } finally {
    // Give mobile browsers time to take ownership of larger reports.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}
async function webAsset(path: string) {
  try {
    const response = await fetch(path, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const mime = path.endsWith(".png")
      ? "png"
      : path.endsWith(".jpeg")
        ? "jpeg"
        : "webp";
    return `data:image/${mime};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}
function drawBrand(
  doc: jsPDF,
  kind: BrandKind,
  data: string | null,
  x: number,
  y: number,
  width: number,
) {
  if (!data) return;
  const asset = brandAssets[kind];
  const [left, top, cropWidth, cropHeight] = asset.crop;
  const scale = width / cropWidth;
  doc.saveGraphicsState();
  doc.rect(x, y, width, cropHeight * scale);
  doc.clip();
  doc.discardPath();
  doc.addImage(
    data,
    asset.format,
    x - left * scale,
    y - top * scale,
    asset.width * scale,
    asset.height * scale,
    `official-${kind}`,
    "FAST",
  );
  doc.restoreGraphicsState();
}
function fillReportCell(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  doc.saveGraphicsState();
  doc.setGState(doc.GState({ opacity: 0.7 }));
  doc.rect(x, y, width, height, "F");
  doc.restoreGraphicsState();
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
    const r = await fetch("/fonts/DejaVuSans.ttf", {
      signal: AbortSignal.timeout(30000),
    });
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
  const [headerAsset, watermarkAsset, savanaAsset] = await Promise.all([
    webAsset(brandAssets.header.src),
    webAsset(brandAssets.watermark.src),
    webAsset(brandAssets.savana.src),
  ]);
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
      ? [65, 170, 155, 70, 145, ...Array(8).fill((usable - 605) / 8)]
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
    const total: (string | number)[] = Array(
      headers.length - (summary ? summaryKeys.length : keys.length),
    ).fill("");
    total[1] = "الإجمالي";
    total.push(
      ...(summary ? summaryTotals(report.totals) : values(report.totals)),
    );
    allRows.push(total);
    for (let offset = 0; offset < allRows.length; offset += perPage) {
      if (page++) doc.addPage();
      drawBrand(doc, "watermark", watermarkAsset, width / 2 - 90, 270, 180);
      drawBrand(doc, "header", headerAsset, width - 320, 16, 286);
      // SAVANA is the supplied original wordmark, never substitute typed text.
      drawBrand(doc, "savana", savanaAsset, margin, 28, 110);
      doc.setDrawColor("#F2AD21");
      doc.setLineWidth(1.2);
      doc.line(margin, 74, width - margin, 74);
      doc.setTextColor("#26324A");
      text(title, width - margin, 96, 17, "right");
      text(
        `قسم الموارد البشرية – مسائي · ${monthLabel(report.month)}`,
        width - margin,
        118,
        12,
        "right",
      );
      if (!summary) text(`الأيام ${start} – ${end}`, margin, 118, 11, "left");
      let x = width - margin;
      headers.forEach((h, i) => {
        x -= base[i];
        doc.setFillColor("#0B2B55");
        doc.rect(x, 132, base[i], 43, "F");
        doc.setTextColor("#FFFFFF");
        doc.setFontSize(9);
        const lines =
          base[i] < 90
            ? String(h)
                .replace("إجمالي الغياب المحتسب", "الغياب المحتسب")
                .split(" ")
            : [String(h)];
        text(lines as unknown as string, x + base[i] / 2, 150, 9);
      });
      allRows.slice(offset, offset + perPage).forEach((r, ri) => {
        let x = width - margin;
        const y = 175 + ri * 30;
        const last = offset + ri === allRows.length - 1;
        r.forEach((v, ci) => {
          x -= base[ci];
          doc.setFillColor(last ? "#D9E5F3" : ri % 2 ? "#F1F5FA" : "#FFFFFF");
          fillReportCell(doc, x, y, base[ci], 30);
          doc.setDrawColor("#B8C5D6");
          doc.rect(x, y, base[ci], 30, "S");
          doc.setTextColor("#10233F");
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
    }
  }
  const pages = doc.getNumberOfPages();
  for (let index = 1; index <= pages; index++) {
    doc.setPage(index);
    doc.setDrawColor("#DCE5F0");
    doc.line(margin, height - 31, width - margin, height - 31);
    doc.setTextColor("#6E7D92");
    text("Designed by Suhaib Al-Kubaisi", margin, height - 16, 8, "left");
    text(`${index} / ${pages}`, width / 2, height - 16, 9);
    text(
      "قسم الموارد البشرية – مسائي",
      width - margin,
      height - 16,
      8,
      "right",
    );
  }
  return new Uint8Array(doc.output("arraybuffer"));
}

export function tableExcelBytes({
  title,
  period,
  headers,
  rows,
  sheetName = "التقرير",
  columnWeights,
  notesArea = false,
}: {
  title: string;
  period: string;
  headers: string[];
  rows: (string | number)[][];
  sheetName?: string;
  columnWeights?: number[];
  notesArea?: boolean;
}) {
  const safeSheet =
    sheetName.replace(/[\\/*?:\[\]]/g, " ").slice(0, 31) || "التقرير";
  const grid: (string | number)[][] = [
    ["قسم الموارد البشرية – مسائي"],
    [title],
    [period],
    [],
    headers,
    ...rows,
    ...(notesArea ? [[], ["ملاحظات"], [], [], []] : []),
  ];
  const last = col(Math.max(headers.length - 1, 0));
  const files: Record<string, Uint8Array> = {};
  const add = (name: string, xml: string) =>
    (files[name] = strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${xml}`,
    ));
  const sheetRows = grid
    .map(
      (row, ri) =>
        `<row r="${ri + 1}" ht="${ri < 3 ? 28 : ri === 4 ? 42 : 24}" customHeight="1">${row
          .map((value, ci) => {
            const style = ri < 3 ? 1 : ri === 4 ? 2 : 0;
            return typeof value === "number"
              ? `<c r="${col(ci)}${ri + 1}" s="${style}"><v>${value}</v></c>`
              : `<c r="${col(ci)}${ri + 1}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${escape(value)}</t></is></c>`;
          })
          .join("")}</row>`,
    )
    .join("");
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
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="${escape(safeSheet)}" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">'${escape(safeSheet)}'!$1:$5</definedName></definedNames></workbook>`,
  );
  add(
    "xl/_rels/workbook.xml.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
  );
  add(
    "xl/styles.xml",
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Arial"/><color rgb="FF14213D"/></font><font><b/><sz val="15"/><name val="Arial"/><color rgb="FFFFFFFF"/></font><font><b/><sz val="11"/><name val="Arial"/><color rgb="FF0B2B55"/></font></fonts><fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0B2B55"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF2FF"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom style="hair"><color rgb="FFDCE5F0"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1" readingOrder="2"/></xf><xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf><xf numFmtId="0" fontId="2" fillId="4" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1" readingOrder="2"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
  );
  add(
    "xl/worksheets/sheet1.xml",
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${last}${grid.length}"/><sheetViews><sheetView workbookViewId="0" rightToLeft="1" showGridLines="0"><pane xSplit="3" ySplit="5" topLeftCell="D6" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="24"/><cols>${headers.map((h, i) => `<col min="${i + 1}" max="${i + 1}" width="${columnWeights?.[i] ? Math.min(48, Math.max(7, columnWeights[i] * 1.6)) : Math.min(42, Math.max(14, String(h).length + 8))}" customWidth="1"/>`).join("")}</cols><sheetData>${sheetRows}</sheetData><autoFilter ref="A5:${last}${5 + rows.length}"/><mergeCells count="3"><mergeCell ref="A1:${last}1"/><mergeCell ref="A2:${last}2"/><mergeCell ref="A3:${last}3"/></mergeCells><printOptions horizontalCentered="1"/><pageMargins left="0.3" right="0.3" top="0.4" bottom="0.45" header="0.15" footer="0.15"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/><headerFooter><oddFooter>&amp;LDesigned by Suhaib Al-Kubaisi&amp;C&amp;P / &amp;N&amp;Rقسم الموارد البشرية – مسائي</oddFooter></headerFooter></worksheet>`,
  );
  return zipSync(files, { level: 6 });
}

export async function tablePdfBytes({
  title,
  period,
  headers,
  rows,
  fontBase64,
  landscape = true,
  columnWeights,
  notesArea = false,
}: {
  title: string;
  period: string;
  headers: string[];
  rows: (string | number)[][];
  fontBase64?: string;
  landscape?: boolean;
  columnWeights?: number[];
  notesArea?: boolean;
}) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({
    orientation: landscape ? "landscape" : "portrait",
    unit: "pt",
    format: headers.length > 12 ? "a3" : "a4",
    compress: true,
  });
  if (!fontBase64) {
    const response = await fetch("/fonts/DejaVuSans.ttf");
    if (!response.ok) throw new Error("تعذر تحميل خط التقرير");
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    fontBase64 = btoa(binary);
  }
  doc.addFileToVFS("Arabic.ttf", fontBase64);
  doc.addFont("Arabic.ttf", "Arabic", "normal");
  doc.setFont("Arabic");
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const margin = 28;
  const tableWidth = width - margin * 2;
  const weights =
    columnWeights?.length === headers.length
      ? columnWeights
      : Array(headers.length).fill(1);
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const widths = weights.map((value) => (tableWidth * value) / totalWeight);
  const perPage = Math.max(
    10,
    Math.floor((height - (notesArea ? 315 : 185)) / 30),
  );
  const [headerAsset, watermarkAsset] = await Promise.all([
    webAsset(brandAssets.header.src),
    webAsset(brandAssets.watermark.src),
  ]);
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  for (let page = 0; page < pages; page++) {
    if (page) doc.addPage();
    drawBrand(
      doc,
      "watermark",
      watermarkAsset,
      width / 2 - 70,
      height / 2 - 80,
      140,
    );
    drawBrand(doc, "header", headerAsset, width - 270, 12, 240);
    doc.setDrawColor("#F2AD21");
    doc.line(margin, 60, width - margin, 60);
    doc.setTextColor("#14213D");
    doc.setFontSize(15);
    doc.text(title, width - margin, 82, { align: "right" });
    doc.setFontSize(9);
    doc.setTextColor("#637188");
    doc.text(`قسم الموارد البشرية – مسائي · ${period}`, width - margin, 100, {
      align: "right",
    });
    let headerX = width - margin;
    headers.forEach((header, i) => {
      headerX -= widths[i];
      const x = headerX;
      doc.setFillColor("#0B2B55");
      doc.rect(x, 112, widths[i], 40, "F");
      doc.setDrawColor("#FFFFFF");
      doc.rect(x, 112, widths[i], 40, "S");
      doc.setTextColor("#FFFFFF");
      doc.setFontSize(8.5);
      doc.text(
        doc.splitTextToSize(String(header), widths[i] - 7),
        x + widths[i] / 2,
        127,
        { align: "center" },
      );
    });
    const pageRows = rows.slice(page * perPage, (page + 1) * perPage);
    pageRows.forEach((row, ri) => {
      let rowX = width - margin;
      row.forEach((value, ci) => {
        rowX -= widths[ci];
        const x = rowX;
        const y = 152 + ri * 30;
        doc.setFillColor(ri % 2 ? "#F1F5FA" : "#FFFFFF");
        fillReportCell(doc, x, y, widths[ci], 30);
        doc.setDrawColor("#B8C5D6");
        doc.rect(x, y, widths[ci], 30, "S");
        doc.setTextColor("#10233F");
        doc.setFontSize(8.5);
        doc.text(
          doc.splitTextToSize(String(value ?? "—"), widths[ci] - 7),
          x + widths[ci] / 2,
          y + 18,
          { align: "center", maxWidth: widths[ci] - 7 },
        );
      });
    });
    if (notesArea && page === pages - 1) {
      const notesY = 170 + pageRows.length * 30;
      doc.setTextColor("#0B2B55");
      doc.setFontSize(13);
      doc.text("ملاحظات", width - margin, notesY, { align: "right" });
      doc.setDrawColor("#7F91A8");
      doc.setLineWidth(0.8);
      doc.roundedRect(margin, notesY + 12, tableWidth, 112, 4, 4, "S");
      for (let line = 1; line < 4; line++)
        doc.line(
          margin + 12,
          notesY + 12 + line * 26,
          width - margin - 12,
          notesY + 12 + line * 26,
        );
    }
    doc.setDrawColor("#DCE5F0");
    doc.line(margin, height - 28, width - margin, height - 28);
    doc.setTextColor("#6E7D92");
    doc.setFontSize(7.5);
    doc.text("Designed by Suhaib Al-Kubaisi", margin, height - 14, {
      align: "left",
    });
    doc.text(`${page + 1} / ${pages}`, width / 2, height - 14, {
      align: "center",
    });
    doc.text("قسم الموارد البشرية – مسائي", width - margin, height - 14, {
      align: "right",
    });
  }
  return new Uint8Array(doc.output("arraybuffer"));
}
