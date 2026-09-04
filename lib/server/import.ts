import "server-only";
import { employeeSchema } from "@/lib/hr/validation";
import type { Employee, Reference } from "@/lib/hr/types";
import { departmentLabel } from "@/lib/hr/types";
import type { SourceRow } from "@/lib/hr/xlsx-import";
import { AppError, requireConfig } from "./supabase";
export interface PreviewRow {
  row: number;
  sheet: string;
  name: string;
  department: string;
  mode: "create" | "update";
  error: string;
  warning: string;
  data: Record<string, unknown>;
}
const aliases: Record<string, string[]> = {
  name: ["الاسم", "اسم الموظف", "name", "Employee Name"],
  department: ["القسم", "Department", "department"],
  number: ["رقم الموظف", "Employee Number", "employee_number"],
  shift: ["الشفت", "Shift", "shift"],
  manager: ["المسؤول المباشر", "Direct Manager", "manager"],
  status: ["حالة الموظف", "الحالة", "Employment Status", "employment_status"],
};
const sourceLabels: Record<string, string> = {
  متابعه: "follow-up",
  متابعة: "follow-up",
  خدمات: "service",
  services: "service",
  storage: "put away",
  "cycle count": "cyclecount",
  returns: "return",
};
const norm = (v: string) => v.trim().replace(/\s+/g, " ").toLowerCase();
const statuses: Record<string, string> = {
  نشط: "active",
  مستقيل: "resigned",
  "غير نشط": "inactive",
  "إجازة طويلة": "long_leave",
  active: "active",
  resigned: "resigned",
  inactive: "inactive",
  long_leave: "long_leave",
};
export function previewRows(
  rows: SourceRow[],
  ref: Reference,
  employees: Employee[],
): PreviewRow[] {
  const numbers = new Set<string>();
  return rows.map((r) => {
    const get = (key: string) => {
      const alias = aliases[key].find((a) => Object.hasOwn(r.values, a));
      return alias === undefined ? undefined : r.values[alias];
    };
    const name = get("name")?.trim() || "";
    const rawDept = norm(get("department") || "");
    const dept = ref.departments.find(
      (d) =>
        [
          norm(d.arabic_name),
          norm(d.english_name),
          norm(departmentLabel(d)),
        ].includes(sourceLabels[rawDept] || rawDept) && d.is_active,
    );
    const number = get("number")?.trim() || null;
    const old = number
      ? employees.find((e) => e.employee_number === number)
      : undefined;
    const mode = old ? "update" : "create";
    let error = "";
    const warning = employees.some((e) => e.name === name && e.id !== old?.id)
      ? "اسم موجود — هوية مستقلة"
      : "";
    if (number && numbers.has(number)) error = "رقم الموظف مكرر داخل الملف";
    if (number) numbers.add(number);
    if (!dept) error = "قسم غير معتمد";
    const shiftText = get("shift");
    const managerText = get("manager");
    const shift = shiftText
      ? ref.shifts.filter((s) => s.name === shiftText && s.is_active)
      : [];
    const manager = managerText
      ? ref.managers.filter((s) => s.name === managerText && s.is_active)
      : [];
    if (shiftText && shift.length !== 1) error = "الشفت غير معتمد";
    if (managerText && manager.length !== 1)
      error = "المسؤول المباشر غير معتمد أو مكرر";
    const input = {
      ...(old ? { id: old.id, version: old.version } : {}),
      name,
      employee_number: number,
      department_id: dept?.id || "",
      shift_id: !shiftText ? old?.shift_id || null : shift[0]?.id || null,
      direct_manager_id: !managerText
        ? old?.direct_manager_id || null
        : manager[0]?.id || null,
      employment_status: get("status")
        ? statuses[get("status")!]
        : old?.employment_status || "active",
    };
    const parsed = employeeSchema.safeParse(input);
    if (!parsed.success) error ||= parsed.error.issues[0].message;
    return {
      row: r.row,
      sheet: r.sheet,
      name,
      department: dept ? departmentLabel(dept) : get("department") || "",
      mode,
      error,
      warning,
      data: { ...(parsed.success ? parsed.data : input), mode },
    };
  });
}
async function signingKey() {
  const secret = requireConfig().secretKey;
  if (!secret) throw new AppError("خدمة الاستيراد غير مهيأة", 503);
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
export async function signPreview(value: unknown) {
  const data = Buffer.from(JSON.stringify(value)).toString("base64url");
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      await signingKey(),
      new TextEncoder().encode(data),
    ),
  );
  return `${data}.${Buffer.from(sig).toString("base64url")}`;
}
export async function verifyPreview(token: string) {
  const [data, sig] = token.split(".");
  if (
    !data ||
    !sig ||
    !(await crypto.subtle.verify(
      "HMAC",
      await signingKey(),
      Buffer.from(sig, "base64url"),
      new TextEncoder().encode(data),
    ))
  )
    throw new AppError("المعاينة غير صالحة");
  return JSON.parse(Buffer.from(data, "base64url").toString());
}
