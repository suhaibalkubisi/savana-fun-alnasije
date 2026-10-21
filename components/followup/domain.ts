export type Status = {
  code: string;
  label: string;
  category: string;
  weight: number;
  enabled: boolean;
};
export type Department = {
  id: string;
  arabic_name: string;
  is_active: boolean;
  display_order?: number;
  version?: number;
};
export type Employee = {
  id: string;
  name: string;
  internal_code: string;
  employee_number?: string;
  department_id: string;
  shift_id?: string;
  department_name?: string;
  employment_status: string;
  version?: number;
  phone?: string | null;
  secondary_phone?: string | null;
  emergency_name?: string | null;
  emergency_phone?: string | null;
  emergency_relation?: string | null;
  education?: string | null;
  specialization?: string | null;
  institution?: string | null;
  graduation_year?: number | null;
  group_name?: string | null;
  reference_number?: string | null;
  photo_document_id?: string | null;
  updated_at?: string;
  supervisor_name?: string;
  shift_name?: string | null;
  evening_verified?: boolean;
  roster_scope?: string;
  scheduled_service?: {employment_status:string;valid_from:string;reason:string}[];
};
export type Entry = {
  employee_id: string;
  employee_name: string;
  permanent_code: string;
  status: string;
};
export type Report = {
  id: string;
  work_date: string;
  department_id: string;
  shift_id: string | null;
  reporter_id: string | null;
  reporter_registry_id?: string | null;
  entered_by: string;
  reporter_name?: string;
  entered_by_name?: string;
  channel: string;
  note: string;
  state: string;
  version: number;
  entries: Entry[];
  submitted_at?: string;
  reported_at?: string;
  evidence_reference?: string;
  return_reason?: string;
};
export type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  followup_role?: string;
  active: boolean;
  version: number;
  departments: string[];
  current_departments?: string[];
  assignment_needed?: boolean;
  capabilities?: Record<string, boolean>;
};
export type DeclarationPayload = {
  id?: string;
  version?: number;
  work_date: string;
  department_id: string;
  reporter_id: string | null;
  reporter_registry_id: string | null;
  channel: string;
  note: string;
  reported_at: string | null;
  evidence_reference: string | null;
  entries: { employee_id: string; status: string }[];
};
// Only reconcile the entire intended change, never just an unchanged headcount.
export function declarationMatchesSaved(
  saved: Report | null | undefined,
  p: DeclarationPayload,
  kind: "save" | "submit",
  actor: string,
): boolean {
  if (
    !saved ||
    !saved.id ||
    !Number.isInteger(saved.version) ||
    saved.version <= (p.version ?? 0) ||
    !Array.isArray(saved.entries)
  )
    return false;
  if (p.id ? saved.id !== p.id : saved.entered_by !== actor) return false;
  if (
    !(
      kind === "save" ? ["draft", "returned"] : ["submitted", "reviewed"]
    ).includes(saved.state)
  )
    return false;
  const nullable = (v: unknown) => (v == null || v === "" ? null : v);
  if (
    saved.work_date !== p.work_date ||
    saved.department_id !== p.department_id ||
    saved.channel !== p.channel ||
    saved.note !== p.note ||
    nullable(saved.reporter_id) !== nullable(p.reporter_id) ||
    nullable(saved.reporter_registry_id) !== nullable(p.reporter_registry_id) ||
    nullable(saved.evidence_reference) !== nullable(p.evidence_reference)
  )
    return false;
  const actual = nullable(saved.reported_at),
    expected = nullable(p.reported_at);
  if (actual === null || expected === null) {
    if (actual !== expected) return false;
  } else if (
    !Number.isFinite(Date.parse(String(actual))) ||
    Date.parse(String(actual)) !== Date.parse(String(expected))
  )
    return false;
  if (saved.entries.length !== p.entries.length) return false;
  const intended = new Map(p.entries.map((e) => [e.employee_id, e.status])),
    received = new Set(saved.entries.map((e) => e.employee_id));
  return (
    intended.size === p.entries.length &&
    received.size === saved.entries.length &&
    saved.entries.every((e) => intended.get(e.employee_id) === e.status)
  );
}
export type Position = {
  employee_id: string;
  name: string;
  internal_code: string;
  work_date: string;
  department_id: string;
  department_name: string;
  shift_id?: string;
  status: string;
  review_state: string;
  completeness: string;
  report_id?: string;
  scope_state?: string;
  source?: string;
  display_order?: number;
  category?: string;
  absence_weight?: number;
  version?: number;
};
export type Action = {
  id: string;
  department_id: string;
  employee_id?: string;
  description: string;
  responsible_id: string;
  due_date: string;
  state: string;
  notes: string;
  completion?: string;
  version: number;
  category?: string;
  priority?: string;
  attachment_document_id?: string;
  comments?: {id:string;body:string;actor_name?:string;created_at:string;document_id?:string;document_title?:string}[];
  activity: {
    at: string;
    actor: string;
    actor_name?: string;
    details: unknown;
  }[];
};
export type Reporter = {
  id: string;
  version: number;
  department_id: string;
  name: string;
  channel: string;
  contact?: string;
  backup_contact?: string;
  active: boolean;
  linked_user_id?: string;
};
export type Communication = {
  id: string;
  version: number;
  department_id: string;
  reporter_id?: string;
  work_date: string;
  kind: string;
  channel: string;
  summary: string;
  outcome?: string;
  created_at?: string;
  entered_by_name?: string;
};
export type Handover = {
  id: string;
  version: number;
  work_date: string;
  department_id?: string;
  owner_id: string;
  next_action: string;
  completed: string;
  remaining: string;
  state: string;
  created_at?: string;
};
export type Document = {
  id: string;
  version: number;
  name: string;
  type: string;
  mime: string;
  size: number;
  title?: string;
  description?: string;
  state?: string;
  issued_on?: string;
  expires_on?: string;
  created_at?: string;
  previous_id?: string;
  previous_document_id?: string;
};
export type PhotoCrop = { x: number; y: number; width: number; height: number };
export type PendingDocument = Document & {
  employee_id: string;
  file_name: string;
  kind: string;
  mime_type: string;
  byte_size: number;
  uploaded_by: string;
  upload_request_id: string;
  photo_crop?: PhotoCrop | null;
};
export type Capability = {
  user_id: string;
  capability: string;
  granted: boolean;
  version: number;
  reason: string;
};
export type SavedView = {
  id: string;
  version: number;
  name: string;
  page: string;
  start_date?: string | null;
  end_date?: string | null;
  department_id?: string | null;
  employee_id?: string | null;
  state?: string | null;
};
export type Profile = {
  read_only?: boolean;
  employee: Employee;
  assignments: Record<string, unknown>[];
  history: Record<string, unknown>[];
  service_decisions?: import("./service-state").ServiceDecision[];
  documents: Document[];
};
export type Boot = {
  user: User;
  departments: Department[];
  shifts: { id: string; name: string }[];
  statuses: Status[];
  users: User[];
  reporters?: Reporter[];
  capabilities?: Record<string, boolean>;
  evening_shift_id?: string;
};
export type Revision = {
  version: number;
  actor: string;
  at: string;
  reason: string;
  actor_name?: string;
  snapshot: Report;
};
export const states: Record<string, string> = {
  draft: "مسودة",
  submitted: "بانتظار المراجعة",
  returned: "معاد للتصحيح",
  reviewed: "تمت المراجعة",
  missing: "لم يرد تبليغ",
  not_configured: "القائمة غير موثّقة",
};
export const actionStates: Record<string, string> = {
  open: "مفتوح",
  progress: "قيد التنفيذ",
  decision: "بانتظار قرار",
  completed: "مكتمل",
};
export const channels: Record<string, string> = {
  account: "حساب المسؤول",
  message: "رسالة",
  phone: "اتصال",
  person: "حضوري",
};
export const roles: Record<string, string> = {
  ADMIN: "مدير النظام",
  SUPERVISOR: "مسؤول قسم",
  FOLLOWUP: "موظف المتابعة",
  VIEWER: "مشاهد",
};
export function counts(
  rows: {
    status: string;
    scope_state?: string;
    category?: string;
    absence_weight?: number;
    status_category?: string;
    status_weight?: number;
  }[],
  statuses: Status[],
) {
  const c = {
    expected: 0,
    present: 0,
    absent: 0,
    leave: 0,
    other: 0,
    unresolved: 0,
    weighted: 0,
  };
  for (const row of rows) {
    if (
      ["future", "outside", "outside_roster", "assignment_unverified"].includes(
        row.scope_state || "",
      )
    )
      continue;
    c.expected++;
    const s = statuses.find((x) => x.code === row.status);
    const category =
      row.status_category ?? row.category ?? s?.category ?? "unresolved";
    const key = ["present", "absent", "leave", "other"].includes(category)
      ? (category as "present" | "absent" | "leave" | "other")
      : "unresolved";
    c[key]++;
    if (key === "absent")
      c.weighted += row.status_weight ?? row.absence_weight ?? s?.weight ?? 1;
  }
  return c;
}
export function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Baghdad",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function monthEnd(month: string) {
  return (
    month +
    "-" +
    new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()
  );
}
export function addDays(date: string, days: number) {
  const value = new Date(date + "T12:00:00Z");
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function baghdadLocalDateTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Baghdad",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (name: string) =>
    parts.find((p) => p.type === name)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}
export function order<
  T extends { department_name?: string; name?: string; display_order?: number },
>(rows: T[]) {
  return [...rows].sort(
    (a, b) =>
      (a.display_order ?? 9999) - (b.display_order ?? 9999) ||
      (a.department_name || "").localeCompare(b.department_name || "", "ar") ||
      (a.name || "").localeCompare(b.name || "", "ar"),
  );
}
export function eligibleOwners(users: User[], department: string) {
  return users.filter(
    (u) =>
      u.active &&
      ["ADMIN", "FOLLOWUP", "SUPERVISOR"].includes(u.followup_role || u.role) &&
      ((u.followup_role || u.role) === "ADMIN" ||
        u.departments.includes(department)),
  );
}
export function revisionDiff(before: Entry[], after: Entry[]) {
  const old = new Map(before.map((e) => [e.employee_id, e]));
  const current = new Map(after.map((e) => [e.employee_id, e]));
  return [...new Set([...old.keys(), ...current.keys()])].flatMap((id) => {
    const a = old.get(id),
      b = current.get(id);
    return a?.status === b?.status && !!a === !!b
      ? []
      : [
          {
            id,
            name: b?.employee_name || a?.employee_name || id,
            before: a?.status || null,
            after: b?.status || null,
          },
        ];
  });
}
export function visibleSelection(
  selected: string[],
  visible: { id: string }[],
) {
  const ids = new Set(visible.map((e) => e.id));
  return selected.filter((id) => ids.has(id));
}
export function canEditDeclaration(role: string, report: Report | null, userId: string) {
  return ["ADMIN", "FOLLOWUP"].includes(role) || (role === "SUPERVISOR" && (!report || report.reporter_id === userId));
}
export function membershipLabel(employee: Employee) {
  if (employee.evening_verified) return "قائمة مسائية موثّقة";
  if (employee.shift_name === "مسائي") return "مسائي — لم يُوثّق الانتماء المؤرّخ";
  return employee.shift_name ? "الوجبة المسجّلة: " + employee.shift_name + " — خارج القائمة المسائية الموثّقة" : "لم تُوثّق عضوية مسائية";
}
export function setupSelection(selected: string[], visible: Employee[], department: string) {
  const wanted = new Set(visibleSelection(selected, visible));
  const rows = visible.filter(employee => wanted.has(employee.id));
  if (!rows.length) throw Error("حدّد الموظفين الفعليين الظاهرين للمعاينة.");
  if (new Set(rows.map(employee => employee.id)).size !== rows.length) throw Error("تكررت هوية الموظف في قائمة المصدر. أعد تحميل غير الموثّقين.");
  if (rows.some(employee => employee.department_id !== department || employee.evening_verified || !Number.isInteger(employee.version) || Number(employee.version) < 1)) throw Error("تغير نطاق الاختيار أو نسخته. أعد تحميل قائمة غير الموثّقين.");
  return rows.map(employee => ({ employee_id: employee.id, version: employee.version! }));
}
export const primaryViews = ["dashboard","directory","reporting","review","daily","monthly","reports","settings"];
export const viewLabels: Record<string, string> = {
  dashboard: "مكتب المتابعة",
  reporting: "تبليغ الأقسام",
  review: "المراجعة",
  daily: "الموقف اليومي",
  monthly: "الموقف الشهري",
  employee: "ملخص الموظف",
  directory: "الموظفون",
  actions: "الإجراءات",
  contacts: "جهات اتصال الأقسام",
  communications: "سجل التواصل",
  handover: "التسليم المسائي",
  reports: "التقارير",
  settings: "الإعدادات",
};
export type ViewContext = {
  view: string;
  date: string;
  month: string;
  department: string;
  query: string;
  employee: string;
  review: string;
  actionFilter: string;
  reportKind: string;
};
export const reportKindIds = [
  "daily",
  "reporting",
  "monthly",
  "department-monthly",
  "employee",
  "actions",
  "completeness",
  "handover",
  "directory",
];
export function parseContext(search: string): ViewContext {
  const p = new URLSearchParams(search);
  const validDate = (v: string | null, f: string) =>
    v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : f;
  return {
    view:
      p.has("view") && p.get("view")! in viewLabels
        ? p.get("view")!
        : "dashboard",
    date: validDate(p.get("date"), today()),
    month: /^\d{4}-\d{2}$/.test(p.get("month") || "")
      ? p.get("month")!
      : today().slice(0, 7),
    department: p.get("department") || "",
    query: p.get("q") || "",
    employee: p.get("employee") || "",
    review: p.get("review") || "",
    actionFilter: p.get("actions") || "all",
    reportKind: reportKindIds.includes(p.get("report") || "")
      ? p.get("report")!
      : "monthly",
  };
}
export function contextSearch(c: ViewContext) {
  const p = new URLSearchParams({ view: c.view, date: c.date, month: c.month });
  if (c.department) p.set("department", c.department);
  if (c.query) p.set("q", c.query);
  if (c.employee) p.set("employee", c.employee);
  if (c.review) p.set("review", c.review);
  if (c.actionFilter !== "all") p.set("actions", c.actionFilter);
  if (c.view === "reports") p.set("report", c.reportKind);
  return "?" + p;
}
export const savedPages: Record<string, string> = {
  dashboard: "dashboard",
  daily: "daily",
  monthly: "monthly",
  review: "review",
  actions: "actions",
  directory: "employees",
  reports: "reports",
};
export function savedViewContext(row: SavedView): ViewContext {
  const date = row.start_date || today();
  return parseContext(
    "?" +
      new URLSearchParams({
        view: row.page === "employees" ? "directory" : row.page,
        date,
        month: date.slice(0, 7),
        department: row.department_id || "",
        employee: row.employee_id || "",
        actions: row.page === "reports" ? "all" : row.state || "all",
        report: row.page === "reports" ? row.state || "monthly" : "monthly",
      }),
  );
}
export function savedViewInput(context: ViewContext, name: string) {
  const page = savedPages[context.view];
  if (!page) throw Error("هذا العرض لا يدعم حفظ اختصار للقراءة.");
  const monthly =
    context.view === "monthly" ||
    (context.view === "reports" &&
      ["monthly", "department-monthly", "employee"].includes(
        context.reportKind,
      ));
  return {
    name: name.trim().slice(0, 100),
    page,
    start: monthly ? context.month + "-01" : context.date,
    end: monthly ? monthEnd(context.month) : context.date,
    department_id: context.department || null,
    employee_id: context.employee || null,
    state:
      context.view === "reports" ? context.reportKind : context.actionFilter,
  };
}
