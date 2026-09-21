import { read, utils } from "xlsx";

export type FingerprintRow = {
  source_sheet: string;
  source_row: number;
  calendar_date: string;
  person_code: string;
  source_name: string;
  punch_minutes: number[];
  raw_values: string[];
  invalid: boolean;
};
const clean = (v: unknown) => String(v ?? "").trim();
const normalizedHeader = (v: unknown) =>
  clean(v).replace(/\s+/g, " ").toLowerCase();
const headerAliases = {
  code: ["person code", "person id", "employee code", "رقم الشخص", "كود الشخص"],
  name: ["name", "employee name", "اسم الموظف", "الاسم"],
  date: ["punch date", "date", "تاريخ البصمة", "التاريخ"],
  first: ["first time punch", "first punch", "وقت اول بصمة", "أول بصمة"],
  last: ["last time punch", "last punch", "وقت اخر بصمة", "آخر بصمة"],
} as const;
function headerIndex(headers: string[], aliases: readonly string[]) {
  const normalized = headers.map(normalizedHeader);
  return normalized.findIndex((header) => aliases.includes(header));
}
function dateValue(v: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    new Date(v + "T12:00:00Z").toISOString().slice(0, 10) !== v
  )
    throw new Error("تاريخ غير صالح في الملف");
  return v;
}
function punches(values: string[]) {
  const result: number[] = [];
  let invalid = false;
  for (const value of values) {
    if (!value || value === "-" || value === "--") continue;
    const normalized = value.replace(/(\d{1,2}:\d{2}(?::\d{2})?)\s+(am|pm)/gi, "$1$2");
    for (const token of normalized.split(/[\s,;،|]+/).filter(Boolean)) {
      const m = token.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i);
      if (!m || +m[1] > (m[3] ? 12 : 23) || +m[2] > 59) invalid = true;
      else {
        let hour = +m[1];
        if (m[3]) hour = (hour % 12) + (m[3].toLowerCase() === "pm" ? 12 : 0);
        result.push(hour * 60 + +m[2]);
      }
    }
  }
  return { punch_minutes: [...new Set(result)].sort((a, b) => a - b), invalid };
}
// BIFF .xls and OpenXML .xlsx are parsed from bytes, never from file extension.
// A monthly MM-DD header intentionally requires an explicit selected year.
export function parseFingerprint(
  bytes: ArrayBuffer,
  kind: "daily" | "monthly",
  period: string,
) {
  if (bytes.byteLength > 8_000_000)
    throw new Error("حجم الملف أكبر من 8 ميغابايت");
  const workbook = read(bytes, {
    type: "array",
    cellDates: false,
    cellFormula: false,
    cellHTML: false,
  });
  const rows: FingerprintRow[] = [];
  const warnings: string[] = [];
  const year = Number(period.slice(0, 4));
  if (!Number.isInteger(year) || year < 2000 || year > 2100)
    throw new Error("السنة غير صالحة");
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet["!ref"]) continue;
    const range = utils.decode_range(sheet["!ref"]);
    if (range.e.r > 20000 || range.e.c > 100)
      throw new Error("الملف يتجاوز الحد المسموح");
    const grid = utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      raw: false,
      defval: "",
    });
    const headerRow = grid.findIndex((r) => {
      const values = r.map(clean);
      return (
        headerIndex(values, headerAliases.code) >= 0 &&
        headerIndex(values, headerAliases.name) >= 0
      );
    });
    if (headerRow < 0) {
      warnings.push(`تعذر العثور على عمودي كود الشخص واسم الموظف في ورقة ${sheetName}`);
      continue;
    }
    const headers = grid[headerRow].map(clean);
    const code = headerIndex(headers, headerAliases.code),
      name = headerIndex(headers, headerAliases.name),
      date = headerIndex(headers, headerAliases.date);
    if (kind === "daily" && date < 0)
      throw new Error("اختر ملف البصمة اليومية");
    if (kind === "monthly" && date >= 0)
      throw new Error("اختر ملف البصمة الشهرية");
    const dayColumns = headers
      .map((h, i) => {
        const match = h.match(/^(\d{1,2})[-\/]([0-3]?\d)$/);
        return match
          ? { h: `${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`, i }
          : null;
      })
      .filter((value): value is { h: string; i: number } => !!value);
    if (kind === "monthly" && !dayColumns.length)
      throw new Error("أعمدة أيام الشهر غير موجودة");
    const first = headerIndex(headers, headerAliases.first),
      last = headerIndex(headers, headerAliases.last);
    if (kind === "daily" && (first < 0 || last < 0))
      throw new Error("أعمدة البصمة غير موجودة");
    for (let i = headerRow + 1; i < grid.length; i++) {
      const raw = grid[i].map(clean);
      if (!raw[code] && !raw[name]) continue;
      const cells =
        kind === "daily"
          ? [
              {
                day: dateValue(raw[date]),
                values: [raw[first], raw[last]],
                raw,
              },
            ]
          : dayColumns.map((x) => ({
              day: dateValue(`${year}-${x.h}`),
              values: [raw[x.i] || ""],
              raw: [raw[code], raw[name], x.h, raw[x.i] || ""],
            }));
      for (const cell of cells) {
        if (
          kind === "daily"
            ? cell.day !== period
            : cell.day.slice(0, 7) !== period
        )
          throw new Error("فترة الملف لا تطابق الفترة المختارة");
        rows.push({
          source_sheet: sheetName,
          source_row: i + 1,
          calendar_date: cell.day,
          person_code: raw[code],
          source_name: raw[name],
          raw_values: cell.raw,
          ...punches(cell.values),
        });
      }
    }
  }
  if (!rows.length || rows.length > 20000)
    throw new Error(
      warnings.length
        ? `لم تتم قراءة أي صف من ملف البصمة. ${warnings.join("؛ ")}`
        : "لا توجد صفوف صالحة أو الملف كبير جداً",
    );
  const dates = rows.map((r) => r.calendar_date).sort();
  return {
    rows,
    warnings,
    period_start: dates[0],
    period_end: dates[dates.length - 1],
  };
}
