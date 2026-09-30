import { zipSync, strToU8 } from "fflate";
import {loadExcelBrands, addExcelBrands, type ExcelBrands} from "./excel-brand";
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
export const dailyColumnWeights = [3, 12, 7, 7, 16, 14, 10, 7, 7, 7, 8, 7, 16, 10, 10, 12];

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
const generatedAt = () => new Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Baghdad',dateStyle:'medium',timeStyle:'short'}).format(new Date());
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
// Preserve spreadsheet arithmetic while displaying the same 12-hour evidence.
// Only a complete clock label is converted; employee codes and arbitrary text
// remain inline strings, including text beginning with spreadsheet operators.
function excelClock(value: unknown) {
  if(typeof value !== 'string')return null;
  const label=value.replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)));
  const m=label.match(/^(\d{1,2}):(\d{2})\s*([صم])(?:\s*\(\+(1)(?: يوم)?\))?(?:\s*·\s*(\d{4}-\d{2}-\d{2}))?$/);
  if(!m||+m[1]<1||+m[1]>12||+m[2]>59)return null;
  const fraction=((+m[1]%12+(m[3]==='م'?12:0))*60+(+m[2]))/1440;
  if(m[5]){
    const timestamp=Date.parse(m[5]);
    if(!Number.isFinite(timestamp)||new Date(timestamp).toISOString().slice(0,10)!==m[5])return null;
    return {value:timestamp/86400000+25569+fraction,style:5};
  }
  return {value:fraction+(m[4]?1:0),style:m[4]?6:4};
}
function codedReportTable(report: Report, summary: boolean, from=1, through=daysInMonth(report.month)) {
  const headers=summary?['الكود الوظيفي',...summaryHeaders]:['الكود الوظيفي','رقم الموظف','اسم الموظف','القسم',...Array.from({length:through-from+1},(_,i)=>String(i+from)),...totalHeaders];
  const rows=report.rows.map(r=>summary?[r.internal_code||'',...summaryValues(r)]:[r.internal_code||'',r.employee_number||'',r.name,r.department,...Array.from({length:through-from+1},(_,i)=>r.cells[i+from]?statuses[r.cells[i+from]].code:''),...values(r)]);
  const total:(string|number)[]=Array(headers.length-(summary?summaryKeys.length:keys.length)).fill('');total[2]='الإجمالي';total.push(...(summary?summaryTotals(report.totals):values(report.totals)));rows.push(total);
  return {headers,rows,columnWeights:summary?[11,8,21,16,8,16,...Array(8).fill(7)]:[11,8,21,16,...Array(through-from+1).fill(5),...Array(7).fill(7)]};
}
export function excelBytes(report: Report, title: string, summary = false, scope = '', brands?: ExcelBrands) {
  return tableExcelBytes({title,period:scope || monthLabel(report.month),brands,...codedReportTable(report,summary)});
}
export async function brandedReportExcelBytes(report: Report, title: string, summary = false, scope = '') {
  return excelBytes(report,title,summary,scope,await loadExcelBrands());
}
export async function brandedExcelBytes(report: Parameters<typeof tableExcelBytes>[0]) {
  return tableExcelBytes({...report,brands:await loadExcelBrands()});
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
    if (!response.ok) throw new Error('تعذر تحميل شعار التقرير؛ أعد المحاولة');
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
    if(typeof window !== 'undefined') throw new Error('تعذر تحميل شعار التقرير؛ أعد المحاولة');
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
export async function pdfBytes(report: Report,title: string,summary = false,fontBase64?: string,scope = '') {
  return tablePdfBytes({title,period:scope || monthLabel(report.month),fontBase64,...codedReportTable(report,summary),...(!summary?{segments:Array.from({length:Math.ceil(daysInMonth(report.month)/10)},(_,i)=>codedReportTable(report,false,i*10+1,Math.min(daysInMonth(report.month),i*10+10)))}:{})});
}

export function tableExcelBytes({
  title,
  period,
  headers,
  rows,
  sheetName = "التقرير",
  brands,
  columnWeights,
  notesArea = false,
}: {
  title: string;
  period: string;
  headers: string[];
  rows: (string | number)[][];
  sheetName?: string;
  brands?: ExcelBrands;
  columnWeights?: number[];
  notesArea?: boolean;
}) {
  const safeSheet =
    sheetName.replace(/[\\/*?:\[\]]/g, " ").slice(0, 31) || "التقرير";
  const grid: (string | number)[][] = [
    ["قسم الموارد البشرية – مسائي"],
    [title],
    [period],
    [`تاريخ الإصدار: ${generatedAt()} · بغداد`],
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
  const widths=headers.map((h,i)=>columnWeights?.[i]?Math.min(48,Math.max(9,columnWeights[i]*1.6)):Math.min(42,Math.max(14,String(h).length+8)));
  if(brands)addExcelBrands(files,brands,widths.reduce((n,w)=>n+w*7+5,0));
  const sheetRows = grid
    .map(
      (row, ri) =>
        `<row r="${ri + 1}" ht="${ri === 0 && brands ? 66 : ri === 2 ? 46 : ri < 3 ? 30 : ri === 4 ? 46 : Math.min(120,Math.max(30,...row.map((v,i)=>Math.ceil(String(v).length / Math.max(6,widths[i]-3))*16+10)))}" customHeight="1">${row
          .map((value, ci) => {
            const style = ri < 3 ? 1 : ri === 4 ? 2 : 0;
            const clock=ri>4?excelClock(value):null;
            if(clock)return `<c r="${col(ci)}${ri+1}" s="${clock.style}"><v>${clock.value}</v></c>`;
            const isDate=ri>4 && typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
            if(isDate)return `<c r="${col(ci)}${ri+1}" s="3"><v>${Date.parse(String(value))/86400000+25569}</v></c>`;
            return typeof value === "number"
              ? `<c r="${col(ci)}${ri + 1}" s="${style}"><v>${value}</v></c>`
              : `<c r="${col(ci)}${ri + 1}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${escape(value)}</t></is></c>`;
          })
          .join("")}</row>`,
    )
    .join("");
  add(
    "[Content_Types].xml",
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'.replace('</Types>',brands?'<Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>':'</Types>'),
  );
  add(
    "_rels/.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  );
  add(
    "xl/workbook.xml",
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="${escape(safeSheet)}" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">'${escape(safeSheet.replaceAll("'","''"))}'!$1:$5,'${escape(safeSheet.replaceAll("'","''"))}'!$A:$C</definedName></definedNames></workbook>`,
  );
  add(
    "xl/_rels/workbook.xml.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
  );
  add(
    "xl/styles.xml",
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="4"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="[$-ar-IQ]hh:mm AM/PM"/><numFmt numFmtId="166" formatCode="[$-ar-IQ]hh:mm AM/PM &quot;(+1)&quot; yyyy-mm-dd"/><numFmt numFmtId="167" formatCode="[$-ar-IQ]hh:mm AM/PM &quot;(+1)&quot;"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Cairo"/><color rgb="FF14213D"/></font><font><b/><sz val="15"/><name val="Cairo"/><color rgb="FF0B2B55"/></font><font><b/><sz val="11"/><name val="Cairo"/><color rgb="FF0B2B55"/></font></fonts><fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0B2B55"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF2FF"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom style="hair"><color rgb="FFDCE5F0"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1" readingOrder="2"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1" readingOrder="2"/></xf><xf numFmtId="0" fontId="2" fillId="4" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1" readingOrder="2"/></xf><xf numFmtId="164" fontId="0" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="165" fontId="0" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="166" fontId="0" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="167" fontId="0" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
  );
  add(
    "xl/worksheets/sheet1.xml",
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><pageSetUpPr fitToPage="${headers.length>16?0:1}"/></sheetPr><dimension ref="A1:${last}${grid.length}"/><sheetViews><sheetView workbookViewId="0" rightToLeft="1" showGridLines="0"><pane xSplit="3" ySplit="5" topLeftCell="D6" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="24"/><cols>${headers.map((h, i) => `<col min="${i + 1}" max="${i + 1}" width="${widths[i]}" customWidth="1"/>`).join("")}</cols><sheetData>${sheetRows}</sheetData><autoFilter ref="A5:${last}${5 + rows.length}"/><mergeCells count="3"><mergeCell ref="A1:${last}1"/><mergeCell ref="A2:${last}2"/><mergeCell ref="A3:${last}3"/></mergeCells><printOptions horizontalCentered="1"/><pageMargins left="0.3" right="0.3" top="0.4" bottom="0.45" header="0.15" footer="0.15"/><pageSetup paperSize="${headers.length>12?8:9}" orientation="landscape" scale="100" fitToWidth="${headers.length>16?0:1}" fitToHeight="0"/><headerFooter><oddFooter>&amp;Lصنع من قبل صهيب الكبيسي&amp;C&amp;P / &amp;N&amp;Rقسم الموارد البشرية – مسائي</oddFooter></headerFooter>${brands?'<drawing r:id="rIdBrand"/>':''}</worksheet>`,
  );
  return zipSync(files, { level: 6 });
}

// Wrap once and paginate by measured text height, never by a fixed row count.
export function layoutTablePdf(
  doc: jsPDF,
  headers: string[],
  rows: (string | number)[][],
  columnWeights?: number[],
  notesArea = false,
  headerTop = 112,
) {
  const tableWidth = doc.internal.pageSize.getWidth() - 56;
  const weights = columnWeights?.length === headers.length
    ? columnWeights : Array(headers.length).fill(1);
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const widths = weights.map((value) => tableWidth * value / totalWeight);
  const lineHeight = 12;
  doc.setFontSize(10);
  doc.setLineHeightFactor(lineHeight / 10);
  const wrap = (row: (string | number)[]) => headers.map((_, i) =>
    doc.splitTextToSize(String(row[i] ?? "—"), widths[i] - 7) as string[]);
  const headerLines = wrap(headers);
  const headerHeight = Math.max(40, ...headerLines.map(lines => lines.length * lineHeight + 16));
  const bodyTop = headerTop + headerHeight;
  const bodyBottom = doc.internal.pageSize.getHeight() - (notesArea ? 175 : 50);
  const pages: { lines: string[][]; height: number }[][] = [[]];
  let y = bodyTop;
  for (const row of rows) {
    const lines = wrap(row);
    const height = Math.max(30, ...lines.map(cell => cell.length * lineHeight + 12));
    if (height > bodyBottom - bodyTop)
      throw new Error("نص خلية التقرير أطول من مساحة الصفحة");
    if (y + height > bodyBottom) {
      pages.push([]);
      y = bodyTop;
    }
    pages[pages.length - 1].push({ lines, height });
    y += height;
  }
  return { widths, headerLines, headerHeight, bodyTop, bodyBottom, pages };
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
  segments,
}: {
  title: string;
  period: string;
  headers: string[];
  rows: (string | number)[][];
  fontBase64?: string;
  landscape?: boolean;
  columnWeights?: number[];
  notesArea?: boolean;
  segments?: {headers: string[]; rows: (string | number)[][]; columnWeights?: number[]}[];
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
  doc.setFontSize(15);
  const titleLines=doc.splitTextToSize(title,tableWidth) as string[];
  const titleExtra=Math.max(0,titleLines.length-1)*18;
  doc.setFontSize(9);
  const periodLines = doc.splitTextToSize(`قسم الموارد البشرية – مسائي · ${period}`, tableWidth) as string[];
  const headerTop = 112 + titleExtra + Math.max(0, periodLines.length - 1) * 11;
  const generationLabel = `تاريخ الإصدار: ${generatedAt()} · بغداد`;
  const sections = segments?.length ? segments : [{headers, rows, columnWeights}];
  const allPages = sections.flatMap(section => {
    const layout = layoutTablePdf(doc, section.headers, section.rows, section.columnWeights, notesArea, headerTop);
    return layout.pages.map(pageRows => ({layout, pageRows, headers: section.headers}));
  });
  const [companyAsset,savanaAsset] = await Promise.all([webAsset(brandAssets.company.src),webAsset(brandAssets.savana.src)]);
  const pages = allPages.length;
  for (let page = 0; page < pages; page++) {
    const {layout, pageRows, headers: pageHeaders} = allPages[page];
    const {widths, headerLines, headerHeight} = layout;
    if (page) doc.addPage();
    drawBrand(doc,"company",companyAsset,width-154,5,126);
    drawBrand(doc,"savana",savanaAsset,margin,25,130);
    doc.setDrawColor("#F2AD21");
    doc.line(margin, 60, width - margin, 60);
    doc.setTextColor("#14213D");
    doc.setFontSize(15);
    doc.text(titleLines, width - margin, 82, { align: "right",lineHeightFactor:1.2 });
    doc.setFontSize(9);
    doc.setTextColor("#637188");
    doc.text(periodLines, width - margin, 100 + titleExtra, {
      align: "right",
      lineHeightFactor: 11 / 9,
    });
    let headerX = width - margin;
    pageHeaders.forEach((header, i) => {
      headerX -= widths[i];
      const x = headerX;
      doc.setFillColor("#0B2B55");
      doc.rect(x, headerTop, widths[i], headerHeight, "F");
      doc.setDrawColor("#FFFFFF");
      doc.rect(x, headerTop, widths[i], headerHeight, "S");
      doc.setTextColor("#FFFFFF");
      doc.setFontSize(10);
      doc.text(
        headerLines[i],
        x + widths[i] / 2,
        headerTop + 15,
        { align: "center" },
      );
    });
    let y = layout.bodyTop;
    pageRows.forEach((row, ri) => {
      let rowX = width - margin;
      row.lines.forEach((lines, ci) => {
        rowX -= widths[ci];
        const x = rowX;
        doc.setFillColor(ri % 2 ? "#F1F5FA" : "#FFFFFF");
        fillReportCell(doc, x, y, widths[ci], row.height);
        doc.setDrawColor("#B8C5D6");
        doc.rect(x, y, widths[ci], row.height, "S");
        doc.setTextColor("#10233F");
        doc.setFontSize(10);
        doc.text(
          lines,
          x + widths[ci] / 2,
          y + 18,
          { align: "center", maxWidth: widths[ci] - 7 },
        );
      });
      y += row.height;
    });
    if (notesArea && page === pages - 1) {
      const notesY = y + 18;
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
    doc.text(generationLabel, margin, height - 34, {align: "left"});
    doc.text("صنع من قبل صهيب الكبيسي", margin, height - 14, {
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
