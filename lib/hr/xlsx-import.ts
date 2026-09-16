import { unzipSync, strFromU8 } from "fflate";
export interface SourceRow {
  sheet: string;
  row: number;
  values: Record<string, string>;
}
export async function parseXlsx(
  file: File,
): Promise<{ rows: SourceRow[]; hash: string }> {
  if (!file.name.toLowerCase().endsWith(".xlsx"))
    throw new Error("الملف يجب أن يكون بصيغة xlsx");
  if (file.size > 3 * 1024 * 1024) throw new Error("حجم الملف يتجاوز 3 MB");
  const buffer = new Uint8Array(await file.arrayBuffer());
  let unpacked = 0;
  let tooLarge = false;
  const zip = unzipSync(buffer, {
    filter: (f) => {
      if (
        !/^(xl\/(workbook\.xml|_rels\/workbook\.xml.rels|sharedStrings\.xml|worksheets\/sheet\d+\.xml))$/.test(
          f.name,
        )
      )
        return false;
      unpacked += f.originalSize;
      if (f.originalSize > 8 * 1024 * 1024 || unpacked > 20 * 1024 * 1024) {
        tooLarge = true;
        return false;
      }
      return true;
    },
  });
  if (tooLarge) throw new Error("محتوى الملف أكبر من المسموح");
  const xml = (path: string) => {
    if (!zip[path]) throw new Error("بنية ملف Excel غير صالحة");
    const doc = new DOMParser().parseFromString(
      strFromU8(zip[path]),
      "application/xml",
    );
    if (doc.querySelector("parsererror"))
      throw new Error("تعذر قراءة ملف Excel");
    return doc;
  };
  const strings = zip["xl/sharedStrings.xml"]
    ? [...xml("xl/sharedStrings.xml").getElementsByTagName("si")].map((si) =>
        [...si.getElementsByTagName("t")]
          .map((t) => t.textContent || "")
          .join(""),
      )
    : [];
  const book = xml("xl/workbook.xml");
  const relations = xml("xl/_rels/workbook.xml.rels");
  const targets = new Map(
    [...relations.getElementsByTagName("Relationship")].map((r) => [
      r.getAttribute("Id"),
      r.getAttribute("Target") || "",
    ]),
  );
  const rows: SourceRow[] = [];
  for (const sheet of [...book.getElementsByTagName("sheet")]) {
    let target = targets.get(sheet.getAttribute("r:id"));
    if (!target) throw new Error("تعذر قراءة ورقة العمل");
    target = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    if (target.includes("..")) throw new Error("مسار ورقة غير صالح");
    const doc = xml(target);
    let headers: string[] | null = null;
    for (const row of [...doc.getElementsByTagName("row")]) {
      const values: string[] = [];
      for (const cell of [...row.getElementsByTagName("c")]) {
        if (cell.getElementsByTagName("f").length)
          throw new Error("ملف الاستيراد يجب أن يحتوي قيماً بدون صيغ");
        const letters = (cell.getAttribute("r") || "A").replace(/\d/g, "");
        let col = 0;
        for (const c of letters) col = col * 26 + c.charCodeAt(0) - 64;
        col--;
        if (col > 100) throw new Error("عدد الأعمدة أكبر من المسموح");
        const type = cell.getAttribute("t");
        const v = cell.getElementsByTagName("v")[0]?.textContent || "";
        values[col] =
          type === "s"
            ? strings[Number(v)] || ""
            : type === "inlineStr"
              ? [...cell.getElementsByTagName("t")]
                  .map((t) => t.textContent || "")
                  .join("")
              : v;
      }
      if (!values.some(Boolean)) continue;
      if (!headers) {
        if (
          values.some((v) =>
            ["الاسم", "اسم الموظف", "name", "Employee Name"].includes(v.trim()),
          ) &&
          values.some((v) =>
            ["القسم", "Department", "department"].includes(v.trim()),
          )
        )
          headers = values.map((v) => v?.trim() || "");
        continue;
      }
      const record: Record<string, string> = {};
      headers.forEach((h, i) => {
        if (h) record[h] = (values[i] || "").trim().replace(/\s+/g, " ");
      });
      rows.push({
        sheet: sheet.getAttribute("name") || "",
        row: Number(row.getAttribute("r")),
        values: record,
      });
      if (rows.length > 2000)
        throw new Error("الحد الأقصى 2000 موظف لكل استيراد");
    }
    if (!headers)
      throw new Error(
        `عمود الاسم والقسم مطلوبان في ${sheet.getAttribute("name")}`,
      );
  }
  if (!rows.length) throw new Error("الملف لا يحتوي على موظفين");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
  return {
    rows,
    hash: [...digest].map((x) => x.toString(16).padStart(2, "0")).join(""),
  };
}
