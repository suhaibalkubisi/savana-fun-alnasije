"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BrandImage } from "./brand-image";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  ClipboardList,
  FileDown,
  FileSpreadsheet,
  PenLine,
  Plus,
  Printer,
  Search,
  Timer,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { mutate, useData, useDebounced } from "@/lib/hr/api";
import {
  actionStateLabels,
  auditDate,
  baghdadDate,
  departmentLabel,
  monthLabel,
  statuses,
  type AdministrativeAction,
  type AdministrativeActionState,
  type Paged,
  type Reference,
  type StatusRecord,
  type StatusType,
} from "@/lib/hr/types";
import { download, tableExcelBytes, tablePdfBytes } from "@/lib/hr/exports";
import {
  Choice,
  Field,
  LoadState,
  PageTitle,
  Pager,
  SearchBox,
  SearchPicker,
  StatusBadge,
} from "./shared";

function PrintBrand({ title, period }: { title: string; period: string }) {
  return (
    <div className="print-brand">
      <BrandImage
        kind="header"
        alt="فن النسيج — قسم الموارد البشرية – مسائي — SAVANA"
      />
      <h1>{title}</h1>
      <p>{period}</p>
    </div>
  );
}

function Metrics({
  items,
}: {
  items: { label: string; value: number | string; tone?: string }[];
}) {
  return (
    <section className="metric-strip">
      {items.map((item) => (
        <article key={item.label} className={item.tone || ""}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </article>
      ))}
    </section>
  );
}

async function exportTable(
  format: "excel" | "pdf",
  title: string,
  period: string,
  headers: string[],
  rows: (string | number)[][],
  name: string,
) {
  const bytes =
    format === "excel"
      ? tableExcelBytes({ title, period, headers, rows, sheetName: title })
      : await tablePdfBytes({ title, period, headers, rows });
  download(
    bytes,
    `${name}.${format === "excel" ? "xlsx" : "pdf"}`,
    format === "excel"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "application/pdf",
  );
}

interface LatenessData extends Paged<StatusRecord> {
  kpis: {
    occurrences: number;
    minutes: number;
    average: number;
    highest: number;
    employees: number;
  };
  summary: {
    employee_id: string;
    employee_name: string;
    employee_number: string | null;
    department: string;
    occurrences: number;
    total_minutes: number;
    average_minutes: number;
    highest_minutes: number;
    last_late: string;
  }[];
}

export function LatenessPage({ reference }: { reference: Reference }) {
  const [month, setMonth] = useState(baghdadDate().slice(0, 7));
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("");
  const [shift, setShift] = useState("");
  const [manager, setManager] = useState("");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [page, setPage] = useState(1);
  const [summary, setSummary] = useState(false);
  const [exporting, setExporting] = useState(false);
  const q = useData<LatenessData>("lateness", {
    month,
    search: useDebounced(search),
    department_id: department,
    shift_id: shift,
    manager_id: manager,
    min_minutes: min,
    max_minutes: max,
    page,
  });
  const title = summary ? "ملخص التأخيرات حسب الموظف" : "تفاصيل التأخيرات";
  const headers = summary
    ? [
        "رقم الموظف",
        "الموظف",
        "القسم",
        "عدد المرات",
        "إجمالي الدقائق",
        "المتوسط",
        "أعلى تأخير",
        "آخر تأخير",
      ]
    : [
        "التاريخ",
        "رقم الموظف",
        "الموظف",
        "القسم",
        "الشفت",
        "المسؤول المباشر",
        "الدقائق",
        "الملاحظات",
        "مدخل السجل",
        "آخر تعديل",
      ];
  const rows = summary
    ? (q.data?.summary || []).map((r) => [
        r.employee_number || "—",
        r.employee_name,
        r.department,
        r.occurrences,
        r.total_minutes,
        r.average_minutes,
        r.highest_minutes,
        r.last_late,
      ])
    : (q.data?.rows || []).map((r) => [
        r.record_date,
        r.employee_number || "—",
        r.employee_name,
        r.department,
        r.shift || "—",
        r.manager || "—",
        r.late_minutes || 0,
        r.notes || "—",
        r.created_by_name || "—",
        auditDate(r.updated_at),
      ]);
  const doExport = async (format: "excel" | "pdf") => {
    setExporting(true);
    try {
      await exportTable(
        format,
        title,
        monthLabel(month),
        headers,
        rows,
        `lateness_${month}`,
      );
      toast.success("تم تصدير التقرير");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setExporting(false);
    }
  };
  return (
    <>
      <PageTitle
        title="التأخيرات"
        subtitle={monthLabel(month)}
        actions={
          <ReportActions
            disabled={!q.data || exporting}
            excel={() => void doExport("excel")}
            pdf={() => void doExport("pdf")}
          />
        }
      />
      <Metrics
        items={[
          { label: "عدد حالات التأخير", value: q.data?.kpis.occurrences || 0 },
          {
            label: "إجمالي الدقائق",
            value: q.data?.kpis.minutes || 0,
            tone: "amber",
          },
          { label: "متوسط الدقائق", value: q.data?.kpis.average || 0 },
          {
            label: "أعلى تأخير",
            value: q.data?.kpis.highest || 0,
            tone: "red",
          },
          { label: "الموظفون المتأخرون", value: q.data?.kpis.employees || 0 },
        ]}
      />
      <section className="panel report-surface">
        <PrintBrand title={title} period={monthLabel(month)} />
        <div className="filterbar no-print">
          <Field label="الشهر والسنة">
            <Input
              type="month"
              value={month}
              onChange={(e) => {
                setMonth(e.target.value);
                setPage(1);
              }}
            />
          </Field>
          <SearchBox
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
          />
          <Choice
            label="القسم"
            value={department}
            onChange={(v) => {
              setDepartment(v);
              setPage(1);
            }}
            options={reference.departments.map((d) => ({
              value: d.id,
              label: departmentLabel(d),
            }))}
          />
          <Choice
            label="الشفت"
            value={shift}
            onChange={setShift}
            options={reference.shifts.map((s) => ({
              value: s.id,
              label: s.name,
            }))}
          />
          <Choice
            label="المسؤول المباشر"
            value={manager}
            onChange={setManager}
            options={reference.managers.map((m) => ({
              value: m.id,
              label: m.name,
            }))}
          />
          <Field label="الدقائق من">
            <Input
              type="number"
              min={0}
              value={min}
              onChange={(e) => setMin(e.target.value)}
            />
          </Field>
          <Field label="الدقائق إلى">
            <Input
              type="number"
              min={0}
              value={max}
              onChange={(e) => setMax(e.target.value)}
            />
          </Field>
        </div>
        <div className="view-toggle no-print">
          <Tabs
            value={summary ? "summary" : "details"}
            onValueChange={(v) => setSummary(v === "summary")}
            dir="rtl"
          >
            <TabsList>
              <TabsTrigger value="details">تفاصيل التأخيرات</TabsTrigger>
              <TabsTrigger value="summary">ملخص حسب الموظف</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <LoadState
          loading={q.loading && !q.data}
          error={q.error}
          retry={q.refresh}
          empty={!rows.length}
          emptyText="لا توجد حالات تأخير لهذا الشهر"
        >
          <Table>
            <TableHeader>
              <TableRow>
                {headers.map((h) => (
                  <TableHead key={h}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => (
                <TableRow
                  key={
                    summary
                      ? q.data!.summary[i].employee_id
                      : q.data!.rows[i].id
                  }
                >
                  {row.map((value, j) => (
                    <TableCell key={j}>
                      {j === 2 || (summary && j === 1) ? (
                        <Link
                          href={`/employees/${summary ? q.data!.summary[i].employee_id : q.data!.rows[i].employee_id}`}
                        >
                          {value}
                        </Link>
                      ) : (
                        <bdi>{value}</bdi>
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </LoadState>
        {!summary && (
          <Pager
            page={page}
            total={q.data?.total || 0}
            size={50}
            onChange={setPage}
          />
        )}
      </section>
    </>
  );
}

interface AbsenceData extends Paged<StatusRecord> {
  kpis: {
    absence: number;
    absence2: number;
    absence3: number;
    leave: number;
    weighted: number;
  };
}

export function AbsenceLeavePage({ reference }: { reference: Reference }) {
  const [month, setMonth] = useState(baghdadDate().slice(0, 7));
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const q = useData<AbsenceData>("absence_leave", {
    month,
    search: useDebounced(search),
    department_id: department,
    status_type: status,
    page,
  });
  const headers = [
    "التاريخ",
    "رقم الموظف",
    "الموظف",
    "القسم",
    "الحالة",
    "الملاحظات",
    "مدخل السجل",
    "وقت التسجيل",
  ];
  const rows = (q.data?.rows || []).map((r) => [
    r.record_date,
    r.employee_number || "—",
    r.employee_name,
    r.department,
    statuses[r.status_type].label,
    r.notes || "—",
    r.created_by_name || "—",
    auditDate(r.created_at),
  ]);
  const doExport = async (format: "excel" | "pdf") => {
    setExporting(true);
    try {
      await exportTable(
        format,
        "تقرير الغيابات والإجازات",
        monthLabel(month),
        headers,
        rows,
        `absence_leave_${month}`,
      );
      toast.success("تم تصدير التقرير");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setExporting(false);
    }
  };
  return (
    <>
      <PageTitle
        title="الغيابات والإجازات"
        subtitle={monthLabel(month)}
        actions={
          <ReportActions
            disabled={!q.data || exporting}
            excel={() => void doExport("excel")}
            pdf={() => void doExport("pdf")}
          />
        }
      />
      <Metrics
        items={[
          { label: "غياب", value: q.data?.kpis.absence || 0, tone: "red" },
          { label: "غياب ×2", value: q.data?.kpis.absence2 || 0, tone: "red" },
          { label: "غياب ×3", value: q.data?.kpis.absence3 || 0, tone: "red" },
          { label: "الغياب المحتسب", value: q.data?.kpis.weighted || 0 },
          { label: "الإجازات", value: q.data?.kpis.leave || 0, tone: "blue" },
        ]}
      />
      <section className="panel report-surface">
        <PrintBrand
          title="تقرير الغيابات والإجازات"
          period={monthLabel(month)}
        />
        <div className="filterbar no-print">
          <Field label="الشهر والسنة">
            <Input
              type="month"
              value={month}
              onChange={(e) => {
                setMonth(e.target.value);
                setPage(1);
              }}
            />
          </Field>
          <SearchBox
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
          />
          <Choice
            label="القسم"
            value={department}
            onChange={(v) => {
              setDepartment(v);
              setPage(1);
            }}
            options={reference.departments.map((d) => ({
              value: d.id,
              label: departmentLabel(d),
            }))}
          />
          <Choice
            label="الحالة"
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            options={(Object.keys(statuses) as StatusType[])
              .filter((x) => x !== "late")
              .map((value) => ({ value, label: statuses[value].label }))}
          />
        </div>
        <LoadState
          loading={q.loading && !q.data}
          error={q.error}
          retry={q.refresh}
          empty={!rows.length}
          emptyText="لا توجد سجلات لهذا الشهر"
        >
          <Table>
            <TableHeader>
              <TableRow>
                {headers.map((h) => (
                  <TableHead key={h}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data?.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell dir="ltr">{r.record_date}</TableCell>
                  <TableCell dir="ltr">{r.employee_number || "—"}</TableCell>
                  <TableCell>
                    <Link href={`/employees/${r.employee_id}`}>
                      {r.employee_name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <bdi>{r.department}</bdi>
                  </TableCell>
                  <TableCell>
                    <StatusBadge type={r.status_type} />
                  </TableCell>
                  <TableCell className="notes-cell">{r.notes || "—"}</TableCell>
                  <TableCell>{r.created_by_name || "—"}</TableCell>
                  <TableCell>{auditDate(r.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </LoadState>
        <Pager
          page={page}
          total={q.data?.total || 0}
          size={50}
          onChange={setPage}
        />
      </section>
    </>
  );
}

export function ActionStateBadge({
  state,
}: {
  state: AdministrativeActionState;
}) {
  return (
    <span className={`action-state action-${state}`}>
      {actionStateLabels[state]}
    </span>
  );
}

export function AdministrativeActionsPage({
  reference,
  canWrite,
}: {
  reference: Reference;
  canWrite: boolean;
}) {
  const params = useSearchParams();
  const initialEmployee = params.get("employee_id") || "";
  const initialRecord = params.get("record_id") || "";
  const initialDate = params.get("date") || baghdadDate();
  const [month, setMonth] = useState(
    /^\d{4}-(0[1-9]|1[0-2])$/.test(params.get("month") || "")
      ? params.get("month")!
      : initialDate.slice(0, 7),
  );
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("");
  const [type, setType] = useState("");
  const [state, setState] = useState(
    ["active", "closed", "cancelled"].includes(params.get("state") || "")
      ? params.get("state")!
      : "",
  );
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<AdministrativeAction | null | undefined>(
    initialEmployee && canWrite ? null : undefined,
  );
  const [exporting, setExporting] = useState(false);
  const q = useData<Paged<AdministrativeAction>>("administrative_actions", {
    month,
    search: useDebounced(search),
    department_id: department,
    action_type_id: type,
    state,
    page,
  });
  const headers = [
    "المرجع",
    "التاريخ",
    "رقم الموظف",
    "الموظف",
    "القسم",
    "نوع الإجراء",
    "السبب",
    "الحالة",
    "أنشأه",
  ];
  const rows = (q.data?.rows || []).map((a) => [
    a.reference_number,
    a.action_date,
    a.employee_number || "—",
    a.employee_name,
    a.department,
    a.action_type,
    a.reason,
    actionStateLabels[a.state],
    a.created_by_name || "—",
  ]);
  const doExport = async (format: "excel" | "pdf") => {
    setExporting(true);
    try {
      await exportTable(
        format,
        "تقرير الإجراءات الإدارية",
        monthLabel(month),
        headers,
        rows,
        `administrative_actions_${month}`,
      );
      toast.success("تم تصدير التقرير");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setExporting(false);
    }
  };
  return (
    <>
      <PageTitle
        title="الإجراءات الإدارية"
        subtitle={monthLabel(month)}
        actions={
          <>
            <ReportActions
              disabled={!q.data || exporting}
              excel={() => void doExport("excel")}
              pdf={() => void doExport("pdf")}
            />
            {canWrite && (
              <Button onClick={() => setEditor(null)}>
                <Plus size={17} />
                إنشاء إجراء
              </Button>
            )}
          </>
        }
      />
      <section className="panel report-surface">
        <PrintBrand
          title="تقرير الإجراءات الإدارية"
          period={monthLabel(month)}
        />
        <div className="filterbar no-print">
          <Field label="الشهر والسنة">
            <Input
              type="month"
              value={month}
              onChange={(e) => {
                setMonth(e.target.value);
                setPage(1);
              }}
            />
          </Field>
          <SearchBox
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
          />
          <Choice
            label="القسم"
            value={department}
            onChange={setDepartment}
            options={reference.departments.map((d) => ({
              value: d.id,
              label: departmentLabel(d),
            }))}
          />
          <Choice
            label="نوع الإجراء"
            value={type}
            onChange={setType}
            options={reference.action_types.map((t) => ({
              value: t.id,
              label: t.arabic_name,
            }))}
          />
          <Choice
            label="الحالة"
            value={state}
            onChange={setState}
            options={Object.entries(actionStateLabels).map(
              ([value, label]) => ({ value, label }),
            )}
          />
        </div>
        <LoadState
          loading={q.loading && !q.data}
          error={q.error}
          retry={q.refresh}
          empty={!q.data?.rows.length}
          emptyText="لا توجد إجراءات إدارية لهذا الشهر"
        >
          <Table>
            <TableHeader>
              <TableRow>
                {headers.map((h) => (
                  <TableHead key={h}>{h}</TableHead>
                ))}
                {canWrite && (
                  <TableHead className="no-print">الإجراء</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data?.rows.map((a) => (
                <TableRow key={a.id}>
                  <TableCell dir="ltr">{a.reference_number}</TableCell>
                  <TableCell dir="ltr">{a.action_date}</TableCell>
                  <TableCell dir="ltr">{a.employee_number || "—"}</TableCell>
                  <TableCell>
                    <Link href={`/employees/${a.employee_id}`}>
                      {a.employee_name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <bdi>{a.department}</bdi>
                  </TableCell>
                  <TableCell>{a.action_type}</TableCell>
                  <TableCell className="notes-cell">{a.reason}</TableCell>
                  <TableCell>
                    <ActionStateBadge state={a.state} />
                  </TableCell>
                  <TableCell>{a.created_by_name || "—"}</TableCell>
                  {canWrite && (
                    <TableCell className="no-print">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`تعديل ${a.reference_number}`}
                        onClick={() => setEditor(a)}
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
        <Pager
          page={page}
          total={q.data?.total || 0}
          size={50}
          onChange={setPage}
        />
      </section>
      {canWrite && editor !== undefined && (
        <ActionEditor
          reference={reference}
          action={editor}
          initialEmployeeId={editor ? "" : initialEmployee}
          initialRecordId={editor ? "" : initialRecord}
          initialDate={editor ? undefined : initialDate}
          onClose={() => setEditor(undefined)}
        />
      )}
    </>
  );
}

export function ActionEditor({
  reference,
  action,
  initialEmployeeId = "",
  initialRecordId = "",
  initialDate,
  onClose,
}: {
  reference: Reference;
  action: AdministrativeAction | null;
  initialEmployeeId?: string;
  initialRecordId?: string;
  initialDate?: string;
  onClose: () => void;
}) {
  const [data, setData] = useState({
    id: action?.id,
    version: action?.version,
    employee_id: action?.employee_id || initialEmployeeId,
    action_type_id: action?.action_type_id || "",
    action_date: action?.action_date || initialDate || baghdadDate(),
    reason: action?.reason || "",
    description: action?.description || "",
    notes: action?.notes || "",
    related_status_record_id:
      action?.related_status_record_id || initialRecordId || null,
    state: action?.state || ("active" as AdministrativeActionState),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (key: string, value: string | null) =>
    setData((v) => ({ ...v, [key]: value }));
  const employeeOptions = reference.employees.map((e) => ({
    value: e.id,
    label: `${e.name} — ${e.department} — ${e.employee_number || e.id.slice(0, 6)}`,
  }));
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent dir="rtl" className="action-dialog">
        <DialogHeader>
          <DialogTitle>
            {action ? "تعديل الإجراء الإداري" : "إنشاء إجراء إداري"}
          </DialogTitle>
          <DialogDescription>
            {action?.reference_number || ""}
          </DialogDescription>
        </DialogHeader>
        <form
          className="form-stack"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            try {
              await mutate("administrative_action.save", {
                ...data,
                description: data.description || null,
                notes: data.notes || null,
              });
              toast.success("تم حفظ الإجراء الإداري");
              onClose();
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="form-grid">
            <SearchPicker
              label="الموظف"
              value={data.employee_id}
              onChange={(v) => set("employee_id", v)}
              options={employeeOptions}
              disabled={!!action}
            />
            <Choice
              label="نوع الإجراء"
              value={data.action_type_id}
              onChange={(v) => set("action_type_id", v)}
              empty="اختر نوع الإجراء"
              options={reference.action_types
                .filter((t) => t.is_active || t.id === action?.action_type_id)
                .map((t) => ({ value: t.id, label: t.arabic_name }))}
            />
            <Field label="تاريخ الإجراء">
              <Input
                type="date"
                value={data.action_date}
                onChange={(e) => set("action_date", e.target.value)}
                required
              />
            </Field>
            <Choice
              label="حالة الإجراء"
              value={data.state}
              onChange={(v) => set("state", v)}
              options={Object.entries(actionStateLabels).map(
                ([value, label]) => ({ value, label }),
              )}
              empty="اختر الحالة"
            />
          </div>
          <Field label="السبب">
            <Input
              value={data.reason}
              onChange={(e) => set("reason", e.target.value)}
              maxLength={300}
              required
            />
          </Field>
          <Field label="التفاصيل">
            <Textarea
              rows={4}
              value={data.description}
              onChange={(e) => set("description", e.target.value)}
              maxLength={3000}
            />
          </Field>
          <Field label="ملاحظات الموارد البشرية">
            <Textarea
              rows={3}
              value={data.notes}
              onChange={(e) => set("notes", e.target.value)}
              maxLength={2000}
            />
          </Field>
          {data.related_status_record_id && (
            <div className="linked-record">
              <ClipboardList size={16} />
              مرتبط بحالة الموارد البشرية رقم{" "}
              <bdi>{data.related_status_record_id.slice(0, 8)}</bdi>
            </div>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <Button disabled={busy}>
              <Check size={17} />
              {busy ? "جار الحفظ…" : "حفظ الإجراء"}
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

function ReportActions({
  disabled,
  excel,
  pdf,
}: {
  disabled: boolean;
  excel: () => void;
  pdf: () => void;
}) {
  return (
    <>
      <Button variant="outline" disabled={disabled} onClick={excel}>
        <FileSpreadsheet size={17} />
        Excel
      </Button>
      <Button variant="outline" disabled={disabled} onClick={pdf}>
        <FileDown size={17} />
        PDF
      </Button>
      <Button
        variant="outline"
        disabled={disabled}
        onClick={() => window.print()}
      >
        <Printer size={17} />
        طباعة
      </Button>
    </>
  );
}

export function CentralReportsPage({ reference }: { reference: Reference }) {
  const [employee, setEmployee] = useState("");
  const [month, setMonth] = useState(baghdadDate().slice(0, 7));
  const reports = useMemo(
    () =>
      [
        [
          "الموقف الشامل",
          "المصفوفة الشهرية لجميع الموظفين",
          "/monthly",
          CalendarClock,
        ],
        ["موقف قسم", "مصفوفة شهرية لقسم محدد", "/departments", Users],
        [
          "ملخص الموظفين",
          "الإجماليات الشهرية لكل موظف",
          "/summary",
          ClipboardList,
        ],
        ["تقرير التأخيرات", "تفاصيل وملخص دقائق التأخير", "/lateness", Timer],
        [
          "تقرير الغيابات والإجازات",
          "كل الاستثناءات غير المرتبطة بالتأخير",
          "/absence-leave",
          AlertTriangle,
        ],
        [
          "تقرير الإجراءات الإدارية",
          "الإجراءات وحالاتها ومراجعها",
          "/actions",
          ClipboardList,
        ],
      ] as const,
    [],
  );
  return (
    <>
      <PageTitle title="التقارير" subtitle="مركز التقارير التشغيلية" />
      <section className="report-catalog">
        {reports.map(([title, description, href, Icon]) => (
          <Link
            key={href}
            href={`${href}?month=${month}`}
            className="report-card"
          >
            <span className="report-card-icon">
              <Icon size={20} />
            </span>
            <div>
              <strong>{title}</strong>
              <small>{description}</small>
            </div>
            <span>عرض</span>
          </Link>
        ))}
      </section>
      <section className="panel employee-report-launcher">
        <div className="panel-heading">
          <h2>
            <Search size={18} />
            تقرير موظف
          </h2>
        </div>
        <div className="form-grid">
          <SearchPicker
            label="الموظف"
            value={employee}
            onChange={setEmployee}
            options={reference.employees.map((e) => ({
              value: e.id,
              label: `${e.name} — ${e.department} — ${e.employee_number || e.id.slice(0, 6)}`,
            }))}
          />
          <Field label="الشهر والسنة">
            <Input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </Field>
        </div>
        <Button asChild disabled={!employee}>
          <Link href={employee ? `/employees/${employee}?month=${month}` : "#"}>
            عرض تقرير الموظف
          </Link>
        </Button>
      </section>
    </>
  );
}
