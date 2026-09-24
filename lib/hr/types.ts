export type Role = "ADMIN" | "HR" | "VIEWER";
export type EmploymentStatus =
  "active" | "resigned" | "inactive" | "long_leave";
export type StatusType = "absence" | "absence2" | "absence3" | "leave" | "late";
export type AdministrativeActionState = "active" | "closed" | "cancelled";
export interface Profile {
  id: string;
  name: string;
  email: string;
  role: Role;
  is_active: boolean;
  version: number;
}
export interface Department {
  id: string;
  arabic_name: string;
  english_name: string;
  display_order: number;
  is_active: boolean;
  version: number;
}
export interface Lookup {
  id: string;
  name: string;
  is_active: boolean;
  version: number;
  employee_id?: string | null;
}
export interface Employee {
  id: string;
  internal_code?: string;
  employee_number: string | null;
  name: string;
  department_id: string;
  shift_id: string | null;
  direct_manager_id: string | null;
  employment_status: EmploymentStatus;
  version: number;
  department: string;
  shift: string | null;
  manager: string | null;
  created_at: string;
  updated_at: string;
}
export interface StatusRecord {
  id: string;
  employee_id: string;
  record_date: string;
  status_type: StatusType;
  late_minutes: number | null;
  notes: string | null;
  version: number;
  employee_name: string;
  employee_number: string | null;
  department: string;
  department_id: string;
  shift_id?: string | null;
  direct_manager_id?: string | null;
  shift?: string | null;
  manager?: string | null;
  created_by_name?: string | null;
  updated_by_name?: string | null;
  created_at: string;
  updated_at: string;
}
export interface Totals {
  absence: number;
  absence2: number;
  absence3: number;
  leave: number;
  late: number;
  late_minutes: number;
  weighted: number;
  administrative_actions: number;
}
export interface ReportRow extends Employee, Totals {
  cells: Record<string, StatusType>;
}
export interface Report {
  rows: ReportRow[];
  month: string;
  totals: Totals;
}
export interface Reference {
  departments: Department[];
  shifts: Lookup[];
  managers: Lookup[];
  action_types: AdministrativeActionType[];
  employees: Employee[];
  app_name: string;
  app_version: number;
}
export interface AdministrativeActionType {
  id: string;
  arabic_name: string;
  display_order: number;
  is_active: boolean;
  version: number;
}
export interface AdministrativeAction {
  id: string;
  reference_number: string;
  employee_id: string;
  employee_name: string;
  employee_number: string | null;
  department_id: string;
  department: string;
  shift_id: string | null;
  shift: string | null;
  direct_manager_id: string | null;
  manager: string | null;
  action_type_id: string;
  action_type: string;
  action_date: string;
  reason: string;
  description: string | null;
  notes: string | null;
  related_status_record_id: string | null;
  state: AdministrativeActionState;
  version: number;
  created_by_name: string | null;
  created_at: string;
  updated_by_name: string | null;
  updated_at: string;
}
export interface ReviewIssue {
  employee_id: string;
  name: string;
  department: string;
  issue: string;
  created_at: string;
}
export interface AuditLog {
  id: string;
  actor_name: string;
  created_at: string;
  action: string;
  entity_type: string;
  entity_id: string;
  description: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
}
export interface Paged<T> {
  rows: T[];
  total: number;
}
export const employmentLabels: Record<EmploymentStatus, string> = {
  active: "نشط",
  resigned: "مستقيل",
  inactive: "غير نشط",
  long_leave: "إجازة طويلة",
};
export const statuses: Record<
  StatusType,
  { label: string; code: string; className: string }
> = {
  absence: { label: "غياب", code: "غ", className: "status-absence" },
  absence2: { label: "غياب ×2", code: "غ×2", className: "status-absence2" },
  absence3: { label: "غياب ×3", code: "غ×3", className: "status-absence3" },
  leave: { label: "إجازة", code: "إ", className: "status-leave" },
  late: { label: "تأخير", code: "ت", className: "status-late" },
};
export const departmentLabel = (d: Department) =>
  `${d.arabic_name} (${d.english_name})`;
export const zeroTotals = (): Totals => ({
  absence: 0,
  absence2: 0,
  absence3: 0,
  leave: 0,
  late: 0,
  late_minutes: 0,
  weighted: 0,
  administrative_actions: 0,
});
export const actionStateLabels: Record<AdministrativeActionState, string> = {
  active: "فعال",
  closed: "مغلق",
  cancelled: "ملغي",
};
export function baghdadDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Baghdad",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function daysInMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
export function monthLabel(month: string) {
  return new Intl.DateTimeFormat("ar-IQ", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T12:00:00Z`));
}
export function auditDate(value: string) {
  return new Intl.DateTimeFormat("ar-IQ", {
    dateStyle: "medium",
    timeStyle: "short",
    hour12: true,
    timeZone: "Asia/Baghdad",
  }).format(new Date(value));
}
