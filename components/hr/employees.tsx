"use client";
import { useState } from "react";
import Link from "next/link";
import { BrandImage } from "./brand-image";
import { useSearchParams } from "next/navigation";
import {
  Plus,
  Upload,
  PenLine,
  ArrowRight,
  FileDown,
  FileSpreadsheet,
  Printer,
  ScanSearch,
  Merge,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { toast } from "sonner";
import { mutate, useData, useDebounced } from "@/lib/hr/api";
import { employeeSchema } from "@/lib/hr/validation";
import {
  baghdadDate,
  departmentLabel,
  employmentLabels,
  monthLabel,
  statuses,
  actionStateLabels,
  type Employee,
  type Profile,
  type Reference,
  type Paged,
  type StatusRecord,
  type AdministrativeAction,
  type AuditLog,
  type Report,
  auditDate,
} from "@/lib/hr/types";
import {
  Choice,
  EmploymentBadge,
  Field,
  LoadState,
  PageTitle,
  Pager,
  SearchBox,
  SearchPicker,
} from "./shared";
import { RecordTable } from "./status";
import { download, tableExcelBytes, tablePdfBytes } from "@/lib/hr/exports";
import { ActionStateBadge } from "./operations";
export function EmployeesPage({
  reference,
  user,
}: {
  reference: Reference;
  user: Profile;
}) {
  const params = useSearchParams();
  const [search, setSearch] = useState("");
  const [dep, setDep] = useState(
    reference.departments.some((d) => d.id === params.get("department_id"))
      ? params.get("department_id")!
      : "",
  );
  const [shift, setShift] = useState("");
  const [manager, setManager] = useState(
    reference.managers.some((m) => m.id === params.get("manager_id"))
      ? params.get("manager_id")!
      : "",
  );
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [edit, setEdit] = useState<Employee | null | undefined>(
    params.get("new") === "1" ? null : undefined,
  );
  const q = useData<Paged<Employee>>("employees", {
    search: useDebounced(search),
    department_id: dep,
    shift_id: shift,
    manager_id: manager,
    employment_status: status,
    page,
  });
  const write = user.role !== "VIEWER";
  const filter = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setPage(1);
  };
  return (
    <>
      <PageTitle
        title="الموظفون"
        subtitle={q.data ? `${q.data.total} موظف` : undefined}
        actions={
          write && (
            <>
              {user.role === "ADMIN" && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => setDuplicatesOpen(true)}
                  >
                    <ScanSearch size={17} /> كشف التكرار
                  </Button>
                  <Button asChild variant="outline">
                    <Link href="/import">
                      <Upload size={17} />
                      استيراد Excel
                    </Link>
                  </Button>
                </>
              )}
              <Button onClick={() => setEdit(null)}>
                <Plus size={18} />
                إضافة موظف
              </Button>
            </>
          )
        }
      />
      <section className="panel">
        <div className="filterbar">
          <SearchBox value={search} onChange={filter(setSearch)} />
          <Choice
            label="القسم"
            value={dep}
            onChange={filter(setDep)}
            options={reference.departments.map((d) => ({
              value: d.id,
              label: departmentLabel(d),
            }))}
          />
          <Choice
            label="الشفت"
            value={shift}
            onChange={filter(setShift)}
            options={reference.shifts.map((s) => ({
              value: s.id,
              label: s.name,
            }))}
          />
          <Choice
            label="المسؤول المباشر"
            value={manager}
            onChange={filter(setManager)}
            options={reference.managers.map((s) => ({
              value: s.id,
              label: s.name,
            }))}
          />
          <Choice
            label="الحالة"
            value={status}
            onChange={filter(setStatus)}
            options={Object.entries(employmentLabels).map(([value, label]) => ({
              value,
              label,
            }))}
          />
        </div>
        <LoadState
          loading={q.loading && !q.data}
          error={q.error}
          retry={q.refresh}
          empty={!q.data?.rows.length}
          emptyText="لا يوجد موظفون مطابقون للبحث"
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الموظف</TableHead>
                <TableHead>رقم الموظف</TableHead>
                <TableHead>القسم</TableHead>
                <TableHead>الشفت</TableHead>
                <TableHead>المسؤول المباشر</TableHead>
                <TableHead>الحالة</TableHead>
                {write && <TableHead>الإجراء</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data?.rows.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <Link className="employee-link" href={`/employees/${e.id}`}>
                      <span className="employee-mini-avatar">
                        {e.name.slice(0, 1)}
                      </span>
                      {e.name}
                    </Link>
                  </TableCell>
                  <TableCell dir="ltr">{e.employee_number || "—"}</TableCell>
                  <TableCell>
                    <bdi>{e.department}</bdi>
                  </TableCell>
                  <TableCell>{e.shift || "غير محدد"}</TableCell>
                  <TableCell>{e.manager || "غير محدد"}</TableCell>
                  <TableCell>
                    <EmploymentBadge status={e.employment_status} />
                  </TableCell>
                  {write && (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`تعديل ${e.name}`}
                        onClick={() => setEdit(e)}
                      >
                        <PenLine size={16} />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </LoadState>
        <Pager page={page} total={q.data?.total || 0} onChange={setPage} />
      </section>
      {edit !== undefined && (
        <EmployeeEditor
          employee={edit}
          reference={reference}
          onClose={() => setEdit(undefined)}
        />
      )}
      {duplicatesOpen && (
        <DuplicateEmployees onClose={() => setDuplicatesOpen(false)} />
      )}
    </>
  );
}

type DuplicateEmployee = {
  id: string;
  name: string;
  employee_number: string | null;
  person_code: string | null;
  department: string;
  employment_status: string;
  normalized_name: string;
  status_count: number;
  fingerprint_count: number;
  action_count: number;
  note_count: number;
};
function DuplicateEmployees({ onClose }: { onClose: () => void }) {
  const q = useData<{ rows: DuplicateEmployee[] }>(
    "attendance.employee_duplicates",
  );
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const rows = q.data?.rows || [];
  const selected = rows.find((row) => row.id === source);
  const linked = selected
    ? selected.status_count +
      selected.fingerprint_count +
      selected.action_count +
      selected.note_count
    : 0;
  async function execute(action: "merge" | "delete_permanent") {
    if (!source || (action === "merge" && !target)) return;
    const message =
      action === "merge"
        ? "سيتم نقل الروابط الآمنة إلى الموظف الصحيح ثم إزالة السجل المكرر. هل أنت متأكد؟"
        : "سيتم حذف السجل نهائياً لأنه بلا روابط. هل أنت متأكد؟";
    if (!window.confirm(message)) return;
    setBusy(true);
    try {
      await mutate(`attendance.employee.${action}`, {
        source_employee_id: source,
        target_employee_id: action === "merge" ? target : undefined,
        confirmed: true,
      });
      toast.success(
        action === "merge" ? "تم دمج الموظفين" : "تم حذف السجل المكرر",
      );
      setSource("");
      setTarget("");
      await q.refresh();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="employee-dialog" dir="rtl">
        <DialogHeader>
          <DialogTitle>كشف وتنظيف الموظفين المكررين</DialogTitle>
          <DialogDescription>
            التطابق هنا للمراجعة فقط ولا يتم دمج الأسماء تلقائياً.
          </DialogDescription>
        </DialogHeader>
        <LoadState
          loading={q.loading}
          error={q.error}
          retry={q.refresh}
          empty={!rows.length}
          emptyText="لا توجد أسماء مكررة مشتبهة"
        >
          <div className="form-stack">
            <Choice
              label="السجل المكرر"
              value={source}
              onChange={setSource}
              options={rows.map((row) => ({
                value: row.id,
                label: `${row.name} — ${row.employee_number || "بلا رقم"} — ${row.department}`,
              }))}
            />
            {selected && (
              <div className="duplicate-summary">
                <strong>{selected.name}</strong>
                <span>كود البصمة: {selected.person_code || "غير محدد"}</span>
                <span>
                  الحالات: {selected.status_count} · البصمة:{" "}
                  {selected.fingerprint_count} · الإجراءات:{" "}
                  {selected.action_count} · الملاحظات: {selected.note_count}
                </span>
              </div>
            )}
            <Choice
              label="الموظف الصحيح للدمج"
              value={target}
              onChange={setTarget}
              options={rows
                .filter(
                  (row) =>
                    row.id !== source &&
                    (!selected ||
                      row.normalized_name === selected.normalized_name),
                )
                .map((row) => ({
                  value: row.id,
                  label: `${row.name} — ${row.employee_number || "بلا رقم"} — ${row.department}`,
                }))}
            />
            <div className="form-actions">
              <Button
                disabled={busy || !source || !target}
                onClick={() => void execute("merge")}
              >
                <Merge size={17} />
                دمج آمن
              </Button>
              <Button
                variant="destructive"
                disabled={busy || !source || linked > 0}
                onClick={() => void execute("delete_permanent")}
              >
                <Trash2 size={17} />
                حذف نهائي بلا روابط
              </Button>
              <Button variant="outline" onClick={onClose}>
                إلغاء
              </Button>
            </div>
          </div>
        </LoadState>
      </DialogContent>
    </Dialog>
  );
}
export function EmployeeEditor({
  employee,
  reference,
  onClose,
}: {
  employee: Employee | null;
  reference: Reference;
  onClose: () => void;
}) {
  const [data, setData] = useState({
    id: employee?.id,
    version: employee?.version,
    name: employee?.name || "",
    employee_number: employee?.employee_number || "",
    department_id: employee?.department_id || "",
    shift_id: employee?.shift_id || "",
    direct_manager_id: employee?.direct_manager_id || "",
    employment_status: employee?.employment_status || "active",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (key: string, value: string) =>
    setData((v) => ({ ...v, [key]: value }));
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="employee-dialog" dir="rtl">
        <DialogHeader>
          <DialogTitle>
            {employee ? "تعديل بيانات الموظف" : "إضافة موظف"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            بيانات الموظف الأساسية
          </DialogDescription>
        </DialogHeader>
        <form
          className="form-stack"
          onSubmit={async (event) => {
            event.preventDefault();
            setError("");
            const p = employeeSchema.safeParse(data);
            if (!p.success) {
              setError(p.error.issues[0].message);
              return;
            }
            setBusy(true);
            try {
              await mutate("employee.save", p.data);
              toast.success(
                employee ? "تم تحديث بيانات الموظف" : "تمت إضافة الموظف",
              );
              onClose();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="form-grid">
            <Field label="اسم الموظف">
              <Input
                value={data.name}
                onChange={(e) => set("name", e.target.value)}
                required
                maxLength={150}
              />
            </Field>
            <Field label="رقم الموظف">
              <Input
                dir="ltr"
                value={data.employee_number}
                onChange={(e) => set("employee_number", e.target.value)}
                maxLength={50}
              />
            </Field>
            <Choice
              label="القسم"
              value={data.department_id}
              onChange={(v) => set("department_id", v)}
              empty="اختر القسم"
              options={reference.departments
                .filter((d) => d.is_active || d.id === employee?.department_id)
                .map((d) => ({ value: d.id, label: departmentLabel(d) }))}
            />
            <Choice
              label="الشفت"
              value={data.shift_id}
              onChange={(v) => set("shift_id", v)}
              empty="غير محدد"
              options={reference.shifts
                .filter((d) => d.is_active || d.id === employee?.shift_id)
                .map((d) => ({ value: d.id, label: d.name }))}
            />
            <SearchPicker
              label="المسؤول المباشر"
              value={data.direct_manager_id}
              onChange={(v) => set("direct_manager_id", v)}
              options={reference.managers
                .filter(
                  (d) =>
                    (d.is_active || d.id === employee?.direct_manager_id) &&
                    d.employee_id !== employee?.id,
                )
                .map((d) => ({ value: d.id, label: d.name }))}
            />
            <Choice
              label="الحالة"
              value={data.employment_status}
              onChange={(v) => set("employment_status", v)}
              empty="اختر الحالة"
              options={Object.entries(employmentLabels).map(
                ([value, label]) => ({ value, label }),
              )}
            />
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <Button type="submit" disabled={busy}>
              {busy ? "جار الحفظ…" : "حفظ الموظف"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              إلغاء
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export function EmployeeDetail({
  id,
  reference,
  user,
}: {
  id: string;
  reference: Reference;
  user: Profile;
}) {
  const params = useSearchParams();
  const [month, setMonth] = useState(
    /^\d{4}-\d{2}$/.test(params.get("month") || "")
      ? params.get("month")!
      : baghdadDate().slice(0, 7),
  );
  const [tab, setTab] = useState("overview");
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState(false);
  const [exporting, setExporting] = useState(false);
  const q = useData<Employee>("employee", { id });
  const records = useData<Paged<StatusRecord>>("records", {
    employee_id: id,
    month,
    page,
  });
  const actions = useData<Paged<AdministrativeAction>>(
    "employee_actions",
    { employee_id: id, month, page },
    tab === "actions",
  );
  const audits = useData<Paged<AuditLog>>(
    "employee_audit",
    { employee_id: id, page },
    tab === "audit" && user.role === "ADMIN",
  );
  const report = useData<Report>("report", { employee_id: id, month });
  const employeeReport = useData<{
    employee: Employee;
    report: Report;
    records: StatusRecord[];
    actions: AdministrativeAction[];
  }>("employee_report", { employee_id: id, month });
  const rows =
    records.data?.rows.filter(
      (r) =>
        tab === "history" ||
        tab === "overview" ||
        tab === "actions" ||
        tab === "audit" ||
        (tab === "absence"
          ? r.status_type.startsWith("absence")
          : r.status_type === tab),
    ) || [];
  const reportRow = report.data?.rows[0];
  const reportHeaders = [
    "التاريخ",
    "الفئة",
    "الحالة / الإجراء",
    "الدقائق",
    "السبب / الملاحظات",
    "حالة الإجراء",
  ];
  const reportValues: (string | number)[][] = employeeReport.data
    ? [
        [
          month,
          "إجماليات الشهر",
          `غياب محتسب ${reportRow?.weighted || 0} · إجازات ${reportRow?.leave || 0} · تأخيرات ${reportRow?.late || 0}`,
          reportRow?.late_minutes || 0,
          `الإجراءات الإدارية: ${reportRow?.administrative_actions || 0}`,
          "—",
        ],
        ...employeeReport.data.records.map((record) => [
          record.record_date,
          record.status_type === "late"
            ? "تأخير"
            : record.status_type === "leave"
              ? "إجازة"
              : "غياب",
          statuses[record.status_type].label,
          record.late_minutes || "—",
          record.notes || "—",
          "—",
        ]),
        ...employeeReport.data.actions.map((action) => [
          action.action_date,
          "إجراء إداري",
          action.action_type,
          "—",
          action.reason,
          actionStateLabels[action.state],
        ]),
      ].sort((a, b) =>
        a[1] === "إجماليات الشهر"
          ? -1
          : b[1] === "إجماليات الشهر"
            ? 1
            : String(b[0]).localeCompare(String(a[0])),
      )
    : [];
  const exportReport = async (format: "excel" | "pdf") => {
    if (!q.data || !reportRow || !employeeReport.data) return;
    setExporting(true);
    try {
      const title = `تقرير الموظف — ${q.data.name}`;
      const period = `${monthLabel(month)} · رقم ${q.data.employee_number || "غير محدد"} · ${q.data.department} · ${q.data.shift || "شفت غير محدد"} · ${q.data.manager || "مسؤول غير محدد"}`;
      const bytes =
        format === "excel"
          ? tableExcelBytes({
              title,
              period,
              headers: reportHeaders,
              rows: reportValues,
              sheetName: "تقرير الموظف",
            })
          : await tablePdfBytes({
              title,
              period,
              headers: reportHeaders,
              rows: reportValues,
            });
      download(
        bytes,
        `employee_${q.data.employee_number || q.data.id.slice(0, 8)}_${month}.${format === "excel" ? "xlsx" : "pdf"}`,
        format === "excel"
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "application/pdf",
      );
      toast.success("تم تصدير تقرير الموظف");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setExporting(false);
    }
  };
  return (
    <>
      <Button asChild variant="ghost" className="back-link">
        <Link href="/employees">
          <ArrowRight size={17} />
          الموظفون
        </Link>
      </Button>
      <PageTitle
        title={q.data?.name || "بيانات الموظف"}
        actions={
          q.data && (
            <>
              <Button
                variant="outline"
                disabled={exporting || !reportRow || !employeeReport.data}
                onClick={() => void exportReport("excel")}
              >
                <FileSpreadsheet size={16} />
                Excel
              </Button>
              <Button
                variant="outline"
                disabled={exporting || !reportRow || !employeeReport.data}
                onClick={() => void exportReport("pdf")}
              >
                <FileDown size={16} />
                PDF
              </Button>
              <Button variant="outline" onClick={() => window.print()}>
                <Printer size={16} />
                طباعة
              </Button>
              {user.role !== "VIEWER" && (
                <Button variant="outline" onClick={() => setEdit(true)}>
                  <PenLine size={16} />
                  تعديل البيانات
                </Button>
              )}
            </>
          )
        }
      />
      <LoadState
        loading={q.loading && !q.data}
        error={q.error}
        retry={q.refresh}
      >
        <div className="profile-strip">
          {q.data && (
            <>
              <div>
                <small>رقم الموظف</small>
                <strong>{q.data.employee_number || "غير محدد"}</strong>
              </div>
              <div>
                <small>القسم</small>
                <strong>
                  <bdi>{q.data.department}</bdi>
                </strong>
              </div>
              <div>
                <small>الشفت</small>
                <strong>{q.data.shift || "غير محدد"}</strong>
              </div>
              <div>
                <small>المسؤول المباشر</small>
                <strong>{q.data.manager || "غير محدد"}</strong>
              </div>
              <div>
                <small>الحالة</small>
                <EmploymentBadge status={q.data.employment_status} />
              </div>
            </>
          )}
        </div>
      </LoadState>
      <section className="panel employee-detail-panel report-surface">
        <div className="print-brand">
          <BrandImage
            kind="header"
            alt="فن النسيج — قسم الموارد البشرية – مسائي — SAVANA"
          />
          <h1>تقرير الموظف — {q.data?.name}</h1>
          <p>{month}</p>
        </div>
        <div className="history-toolbar">
          <Tabs value={tab} onValueChange={setTab} dir="rtl">
            <TabsList>
              <TabsTrigger value="overview">نظرة عامة</TabsTrigger>
              <TabsTrigger value="history">السجل</TabsTrigger>
              <TabsTrigger value="absence">الغيابات</TabsTrigger>
              <TabsTrigger value="leave">الإجازات</TabsTrigger>
              <TabsTrigger value="late">التأخيرات</TabsTrigger>
              <TabsTrigger value="actions">الإجراءات الإدارية</TabsTrigger>
              {user.role === "ADMIN" && (
                <TabsTrigger value="audit">سجل التعديلات</TabsTrigger>
              )}
            </TabsList>
          </Tabs>
          <Field label="الشهر">
            <Input
              type="month"
              value={month}
              onChange={(e) => {
                setMonth(e.target.value);
                setPage(1);
              }}
              required
            />
          </Field>
        </div>
        {tab === "overview" ? (
          <div className="employee-overview">
            {[
              ["الغياب", reportRow?.absence || 0],
              ["غياب ×2", reportRow?.absence2 || 0],
              ["غياب ×3", reportRow?.absence3 || 0],
              ["الغياب المحتسب", reportRow?.weighted || 0],
              ["الإجازات", reportRow?.leave || 0],
              ["التأخيرات", reportRow?.late || 0],
              ["دقائق التأخير", reportRow?.late_minutes || 0],
              ["الإجراءات الإدارية", reportRow?.administrative_actions || 0],
            ].map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        ) : tab === "actions" ? (
          <LoadState
            loading={actions.loading && !actions.data}
            error={actions.error}
            retry={actions.refresh}
            empty={!actions.data?.rows.length}
            emptyText="لا توجد إجراءات إدارية لهذا الشهر"
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المرجع</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>نوع الإجراء</TableHead>
                  <TableHead>السبب</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>أنشأه</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {actions.data?.rows.map((action) => (
                  <TableRow key={action.id}>
                    <TableCell dir="ltr">{action.reference_number}</TableCell>
                    <TableCell dir="ltr">{action.action_date}</TableCell>
                    <TableCell>{action.action_type}</TableCell>
                    <TableCell className="notes-cell">
                      {action.reason}
                    </TableCell>
                    <TableCell>
                      <ActionStateBadge state={action.state} />
                    </TableCell>
                    <TableCell>{action.created_by_name || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </LoadState>
        ) : tab === "audit" ? (
          <LoadState
            loading={audits.loading && !audits.data}
            error={audits.error}
            retry={audits.refresh}
            empty={!audits.data?.rows.length}
            emptyText="لا توجد تعديلات"
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الوقت — بغداد</TableHead>
                  <TableHead>المستخدم</TableHead>
                  <TableHead>العملية</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {audits.data?.rows.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell>{auditDate(log.created_at)}</TableCell>
                    <TableCell>{log.actor_name}</TableCell>
                    <TableCell>{log.description}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </LoadState>
        ) : (
          <LoadState
            loading={records.loading && !records.data}
            error={records.error}
            retry={records.refresh}
            empty={!rows.length}
            emptyText="لا توجد سجلات لهذا الشهر"
          >
            <RecordTable
              rows={rows}
              reference={reference}
              canWrite={user.role !== "VIEWER"}
              employee={q.data}
            />
          </LoadState>
        )}
        {tab !== "overview" && (
          <Pager
            page={page}
            total={
              tab === "actions"
                ? actions.data?.total || 0
                : tab === "audit"
                  ? audits.data?.total || 0
                  : records.data?.total || 0
            }
            size={50}
            onChange={setPage}
          />
        )}
      </section>
      {edit && q.data && (
        <EmployeeEditor
          employee={q.data}
          reference={reference}
          onClose={() => setEdit(false)}
        />
      )}
    </>
  );
}
