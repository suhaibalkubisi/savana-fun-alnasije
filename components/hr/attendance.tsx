"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { BrandImage } from "./brand-image";
import Link from "next/link";
import { toast } from "sonner";
import {
  Upload,
  FileSpreadsheet,
  FileDown,
  Printer,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  PencilLine,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
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
import { mutate, useData, useDebounced } from "@/lib/hr/api";
import { baghdadDate, departmentLabel, type Reference } from "@/lib/hr/types";
import { download, tableExcelBytes, tablePdfBytes } from "@/lib/hr/exports";
import { formatClock12 } from "@/lib/hr/time-format.mjs";
import {
  Choice,
  Field,
  LoadState,
  PageTitle,
  SearchBox,
  SearchPicker,
  Pager,
  TimeField,
} from "./shared";

type DayRow = {
  employee_id: string;
  employee_number: string | null;
  person_code: string | null;
  name: string;
  department_id: string;
  department: string;
  manager: string | null;
  scheduled_start_minute: number | null;
  entry_minute: number | null;
  exit_minute: number | null;
  duration_minutes: number | null;
  status: string;
  late_minutes: number;
  manual_status: string | null;
  status_record_id: string | null;
  status_record_version: number | null;
  notes: string;
  procedure_text: string;
  note_id: string | null;
  note_version: number | null;
  expected: boolean;
  daily_note_text: string;
  needs_review: boolean;
};
type MonthRow = {
  employee_id: string;
  employee_number: string | null;
  name: string;
  department: string;
  manager: string | null;
  present: number;
  late: number;
  late_minutes: number;
  absence: number;
  absence2: number;
  absence3: number;
  weighted: number;
  leave: number;
  no_entry: number;
  missing_schedule: number;
};
type Batch = {
  id: string;
  version: number;
  source_name: string;
  state: string;
  period_start: string;
  period_end: string;
  summary: Record<string, number>;
};
const labels: Record<string, string> = {
  present: "حاضر",
  late: "تأخير",
  absence: "غياب",
  absence2: "غياب ×2",
  absence3: "غياب ×3",
  leave: "إجازة",
  no_entry: "بلا بصمة دخول",
  missing_schedule: "الدوام غير محدد",
  off_day: "يوم راحة",
  preview: "معاينة",
  applied: "تم الاعتماد",
  cancelled: "ملغي",
  code: "رمز الشخص",
  unique_name: "اسم مطابق",
  confirmed: "ربط معتمد",
  unmatched: "غير مطابق",
  ambiguous: "ملتبس",
  invalid: "غير صالح",
};
const time = formatClock12;
function PrintHeader({ title, period }: { title: string; period: string }) {
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
function ExportButtons({
  title,
  period,
  headers,
  rows,
  columnWeights,
  notesArea = false,
}: {
  title: string;
  period: string;
  headers: string[];
  rows: (string | number)[][];
  columnWeights?: number[];
  notesArea?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  async function run(pdf: boolean) {
    setBusy(true);
    try {
      const report = { title, period, headers, rows, columnWeights, notesArea };
      download(
        pdf ? await tablePdfBytes(report) : tableExcelBytes(report),
        `${title}-${period}.${pdf ? "pdf" : "xlsx"}`,
        pdf
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
    } catch {
      toast.error("تعذر تصدير التقرير");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex gap-2 no-print">
      <Button variant="outline" disabled={busy} onClick={() => run(false)}>
        <FileSpreadsheet size={16} />
        Excel
      </Button>
      <Button variant="outline" disabled={busy} onClick={() => run(true)}>
        <FileDown size={16} />
        PDF
      </Button>
      <Button variant="outline" onClick={() => window.print()}>
        <Printer size={16} />
        طباعة
      </Button>
    </div>
  );
}
function Grid({
  headers,
  rows,
}: {
  headers: string[];
  rows: (string | number | React.ReactNode)[][];
}) {
  return (
    <div className="table-card overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {headers.map((h) => (
              <TableHead key={h}>{h}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length ? (
            rows.map((r, i) => (
              <TableRow key={i}>
                {r.map((v, j) => (
                  <TableCell key={j}>{v}</TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={headers.length} className="text-center py-12">
                لا توجد سجلات مطابقة
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
function Metrics({ items }: { items: [string, number][] }) {
  return (
    <section className="metric-strip attendance-metrics">
      {items.map(([label, value]) => (
        <article
          key={label}
          data-tone={
            label.includes("غياب")
              ? "red"
              : label.includes("تأخير") || label.includes("متأخر")
                ? "amber"
                : label.includes("حاضر")
                  ? "green"
                  : label.includes("بصمة") || label.includes("مراجعة")
                    ? "gray"
                    : "blue"
          }
        >
          <span>{label}</span>
          <strong>{value}</strong>
        </article>
      ))}
    </section>
  );
}

export function AttendanceReport({
  reference,
  monthly = false,
  canWrite = false,
}: {
  reference: Reference;
  monthly?: boolean;
  canWrite?: boolean;
}) {
  const params = useSearchParams();
  const [date, setDate] = useState(
      /^\d{4}-\d{2}-\d{2}$/.test(params.get("date") || "")
        ? params.get("date")!
        : baghdadDate(),
    ),
    [dep, setDep] = useState(
      reference.departments.some((d) => d.id === params.get("department_id"))
        ? params.get("department_id")!
        : "",
    ),
    [search, setSearch] = useState(""),
    [quick, setQuick] = useState<Set<string> | null>(null),
    [advanced, setAdvanced] = useState(
      Object.hasOwn(labels, params.get("status") || "")
        ? params.get("status")!
        : "",
    );
  const [edit, setEdit] = useState<DayRow | null>(null),
    [notes, setNotes] = useState(""),
    [procedure, setProcedure] = useState(""),
    [decision, setDecision] = useState(""),
    [decisionMinutes, setDecisionMinutes] = useState(""),
    [busy, setBusy] = useState(false);
  const query = useData<{ rows: (DayRow & MonthRow)[] }>(
    `attendance.${monthly ? "monthly" : "daily"}`,
    { date, department_id: dep, search: useDebounced(search) },
  );
  const title = monthly ? "الداشبورد الشهري" : "الموقف اليومي";
  const rawRows = query.data?.rows || [];
  const group = (value: string) =>
    value.startsWith("absence") ? "absence" : value;
  const rows = rawRows.filter((r) => {
    if (monthly)
      return !search || `${r.name} ${r.employee_number}`.includes(search);
    if (advanced) return r.status === advanced;
    return quick === null || quick.has(group(r.status));
  });
  const headers = monthly
    ? [
        "رقم الموظف",
        "الموظف",
        "القسم",
        "المسؤول",
        "حضور",
        "تأخيرات",
        "دقائق التأخير",
        "غياب",
        "غياب ×2",
        "غياب ×3",
        "الغياب المحتسب",
        "إجازة",
        "بلا دخول",
        "دوام غير محدد",
      ]
    : [
        "ت",
        "رقم الموظف",
        "كود البصمة",
        "الموظف",
        "القسم",
        "المسؤول",
        "وقت الدوام",
        "الدخول",
        "دقائق التأخير",
        "الحالة",
        "الإجراء",
        "قرار HR",
        "الملاحظات",
      ];
  const values = rows.map((r) =>
    monthly
      ? [
          r.employee_number || "",
          r.name,
          r.department,
          r.manager || "",
          r.present,
          r.late,
          r.late_minutes,
          r.absence,
          r.absence2,
          r.absence3,
          r.weighted,
          r.leave,
          r.no_entry,
          r.missing_schedule,
        ]
      : [
          rows.indexOf(r) + 1,
          r.employee_number || "",
          r.person_code || "",
          r.name,
          r.department,
          r.manager || "غير محدد",
          time(r.scheduled_start_minute),
          time(r.entry_minute),
          r.late_minutes,
          labels[r.status] || r.status,
          r.procedure_text,
          labels[r.manual_status || ""] || "",
          r.notes,
        ],
  );
  const total = (key: keyof MonthRow) =>
    rows.reduce((n, r) => n + Number(r[key] || 0), 0);
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  function move(n: number) {
    const d = new Date(date + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    setDate(d.toISOString().slice(0, 10));
  }
  async function save() {
    if (!edit) return;
    setBusy(true);
    try {
      await mutate("attendance.note.save", {
        id: edit.note_id || undefined,
        version: edit.note_version || undefined,
        employee_id: edit.employee_id,
        work_date: date,
        notes,
        procedure_text: procedure,
      });
      if (decision) {
        await mutate("status.save", {
          id: edit.status_record_id || undefined,
          version: edit.status_record_version || undefined,
          employee_id: edit.employee_id,
          department_id: edit.department_id,
          record_date: date,
          status_type: decision,
          late_minutes: decision === "late" ? Number(decisionMinutes) : null,
          notes: notes || null,
        });
      } else if (edit.status_record_id && edit.status_record_version) {
        await mutate("status.delete", {
          id: edit.status_record_id,
          version: edit.status_record_version,
          confirmed: true,
        });
      }
      setEdit(null);
      await query.refresh();
      toast.success("تم حفظ التعديل");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        title={title}
        actions={
          <ExportButtons
            title={title}
            period={monthly ? date.slice(0, 7) : date}
            headers={headers}
            rows={values}
            columnWeights={
              monthly
                ? undefined
                : [4, 8, 8, 15, 16, 13, 9, 9, 8, 9, 24, 11, 18]
            }
            notesArea={!monthly}
          />
        }
      />
      <PrintHeader title={title} period={date} />
      <div className="filter-bar no-print">
        <Field label={monthly ? "الشهر" : "التاريخ"}>
          <Input
            type={monthly ? "month" : "date"}
            value={monthly ? date.slice(0, 7) : date}
            onChange={(e) =>
              e.target.value &&
              setDate(monthly ? e.target.value + "-01" : e.target.value)
            }
          />
        </Field>
        {!monthly && (
          <div className="flex gap-1 items-end">
            <Button
              variant="outline"
              aria-label="اليوم السابق"
              onClick={() => move(-1)}
            >
              <ChevronRight />
            </Button>
            <Button variant="outline" onClick={() => setDate(baghdadDate())}>
              اليوم
            </Button>
            <Button
              variant="outline"
              aria-label="اليوم التالي"
              onClick={() => move(1)}
            >
              <ChevronLeft />
            </Button>
          </div>
        )}
        <Choice
          label="القسم"
          value={dep}
          onChange={setDep}
          options={reference.departments.map((d) => ({
            value: d.id,
            label: departmentLabel(d),
          }))}
        />
        <SearchBox value={search} onChange={setSearch} />
        {!monthly && (
          <div className="daily-filter-card">
            <span>التصفية السريعة</span>
            <div className="quick-filter-row">
              {[
                ["present", "حاضر"],
                ["late", "تأخير"],
                ["absence", "غياب"],
              ].map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={quick?.has(value) ? "default" : "outline"}
                  onClick={() =>
                    setQuick((current) => {
                      const next = new Set(current || []);
                      if (next.has(value)) next.delete(value);
                      else next.add(value);
                      return next;
                    })
                  }
                >
                  {label}
                </Button>
              ))}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setQuick(null)}
              >
                تحديد الكل
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setQuick(new Set())}
              >
                مسح الكل
              </Button>
            </div>
          </div>
        )}
        {!monthly && (
          <Choice
            label="تصفية متقدمة"
            value={advanced}
            onChange={setAdvanced}
            options={Object.entries(labels)
              .slice(0, 9)
              .map(([value, label]) => ({ value, label }))}
          />
        )}
      </div>
      <LoadState
        loading={query.loading}
        error={query.error}
        retry={query.refresh}
      >
        <Metrics
          items={
            monthly
              ? [
                  ["الموظفون", rows.length],
                  ["التأخيرات", total("late")],
                  ["دقائق التأخير", total("late_minutes")],
                  ["الغياب المحتسب", total("weighted")],
                  ["الإجازات", total("leave")],
                  ["بلا دخول", total("no_entry")],
                ]
              : [
                  ["المتوقعون", rows.filter((r) => r.expected).length],
                  ["حاضر", count("present")],
                  ["تأخير", count("late")],
                  ["دقائق التأخير", total("late_minutes")],
                  [
                    "غياب",
                    count("absence") + count("absence2") + count("absence3"),
                  ],
                  ["إجازة", count("leave")],
                  ["بلا بصمة دخول", count("no_entry")],
                  [
                    "يحتاج مراجعة",
                    rawRows.filter((r) => r.needs_review).length,
                  ],
                ]
          }
        />
        <Grid
          headers={canWrite && !monthly ? [...headers, "تعديل"] : headers}
          rows={values.map((v, i) =>
            canWrite && !monthly
              ? [
                  ...v,
                  <Button
                    key="edit"
                    variant="ghost"
                    onClick={() => {
                      setEdit(rows[i]);
                      setNotes(rows[i].daily_note_text);
                      setProcedure(rows[i].procedure_text);
                      setDecision(rows[i].manual_status || "");
                      setDecisionMinutes(String(rows[i].late_minutes || ""));
                    }}
                  >
                    <PencilLine size={15} /> تعديل
                  </Button>,
                ]
              : v,
          )}
        />
      </LoadState>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{edit?.name}</DialogTitle>
          </DialogHeader>
          <Field label="ملاحظة الموقف">
            <Input
              value={notes}
              maxLength={2000}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
          <Field label="الإجراء / متابعة مسؤول الوجبة">
            <Input
              value={procedure}
              maxLength={2000}
              onChange={(e) => setProcedure(e.target.value)}
            />
          </Field>
          <Field label="قرار HR النهائي">
            <div className="status-choice-grid">
              {[
                ["", "بدون قرار"],
                ["absence", "غياب"],
                ["absence2", "غياب ×2"],
                ["absence3", "غياب ×3"],
                ["leave", "إجازة"],
                ["late", "تأخير"],
              ].map(([value, label]) => (
                <Button
                  key={value || "none"}
                  type="button"
                  size="sm"
                  variant={decision === value ? "default" : "outline"}
                  onClick={() => setDecision(value)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </Field>
          {decision === "late" && (
            <Field label="دقائق التأخير">
              <Input
                type="number"
                min={0}
                max={10080}
                value={decisionMinutes}
                onChange={(e) => setDecisionMinutes(e.target.value)}
                required
              />
            </Field>
          )}
          <Button
            disabled={busy || (decision === "late" && !decisionMinutes)}
            onClick={save}
          >
            <CheckCircle2 size={17} /> {busy ? "جار الحفظ…" : "حفظ التعديلات"}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function FingerprintImport({ monthly = false }: { monthly?: boolean }) {
  const [period, setPeriod] = useState(
      monthly ? baghdadDate().slice(0, 7) : baghdadDate(),
    ),
    [busy, setBusy] = useState(false),
    [batch, setBatch] = useState<Batch | null>(null),
    [page, setPage] = useState(0);
  const list = useData<Batch[]>("attendance.imports");
  const preview = useData<{
    batch: Batch;
    rows: {
      source_name: string;
      person_code: string;
      calendar_date: string;
      employee_name: string | null;
      match_state: string;
      punch_minutes: number[];
    }[];
  }>("attendance.import", { id: batch?.id, page }, !!batch);
  async function upload(file: File) {
    setBusy(true);
    try {
      const bytes = await file.arrayBuffer();
      const { parseFingerprint } = await import("@/lib/hr/fingerprint");
      const parsed = parseFingerprint(
        bytes,
        monthly ? "monthly" : "daily",
        period,
      );
      const hash = [
        ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      ]
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("");
      const next = await mutate<Batch>("attendance.import.preview", {
        ...parsed,
        source_name: file.name,
        source_hash: hash,
        import_kind: monthly ? "monthly" : "daily",
      });
      setBatch(next);
      setPage(0);
      for (const warning of parsed.warnings) toast.warning(warning);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function apply(cancel = false) {
    if (!batch) return;
    setBusy(true);
    try {
      setBatch(
        await mutate<Batch>(
          `attendance.import.${cancel ? "cancel" : "apply"}`,
          {
            id: batch.id,
            version: preview.data?.batch.version || batch.version,
          },
        ),
      );
      toast.success(cancel ? "تم إلغاء الاستيراد" : "تم اعتماد البصمة");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const current = preview.data?.batch || batch;
  return (
    <>
      <PageTitle title={monthly ? "البصمة الشهرية" : "البصمة اليومية"} />
      <section className="attendance-upload">
        <Upload size={30} />
        <div>
          <h2>استيراد سجل البصمة</h2>
          <span>XLS / XLSX</span>
        </div>
        <Field label={monthly ? "الشهر والسنة" : "التاريخ"}>
          <Input
            type={monthly ? "month" : "date"}
            value={period}
            disabled={busy}
            onChange={(e) => setPeriod(e.target.value)}
          />
        </Field>
        <Field label="ملف البصمة">
          <Input
            type="file"
            accept=".xls,.xlsx"
            disabled={busy}
            onChange={(e) => {
              if (e.target.files?.[0]) void upload(e.target.files[0]);
              e.target.value = "";
            }}
          />
        </Field>
        {busy && <span role="status">جاري المعالجة…</span>}
      </section>
      {current && (
        <section className="space-y-4">
          <PageTitle
            title={current.source_name}
            actions={
              current.state === "preview" ? (
                <div className="flex gap-2">
                  <Button
                    disabled={busy || preview.loading}
                    onClick={() => apply()}
                  >
                    تأكيد واعتماد الاستيراد
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => apply(true)}
                  >
                    إلغاء
                  </Button>
                </div>
              ) : (
                <span>{labels[current.state]}</span>
              )
            }
          />
          <Metrics
            items={[
              ["صفوف الملف", current.summary.rows || 0],
              ["مطابق", current.summary.matched || 0],
              ["غير مطابق", current.summary.unmatched || 0],
              ["ملتبس", current.summary.ambiguous || 0],
              ["غير صالح", current.summary.invalid || 0],
              ["الأيام", current.summary.days || 0],
            ]}
          />
          {(current.state === "applied" || current.state === "preview") && (
            <section className="attendance-next-actions">
              <h2>
                {current.state === "applied"
                  ? "تمت معالجة البصمة"
                  : "راجع النتائج قبل الاعتماد"}
              </h2>
              <div className="actions">
                <Button asChild variant="outline">
                  <Link href="/daily-position">افتح الموقف اليومي</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/daily-position?status=late">راجع المتأخرين</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/daily-position?status=no_entry">
                    راجع بدون بصمة دخول
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/fingerprint-issues">راجع مشاكل المطابقة</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/status">عدّل حالات HR</Link>
                </Button>
              </div>
            </section>
          )}
          <LoadState
            loading={preview.loading}
            error={preview.error}
            retry={preview.refresh}
          >
            <Grid
              headers={[
                "رمز الشخص",
                "اسم المصدر",
                "التاريخ",
                "البصمات",
                "الموظف",
                "المطابقة",
              ]}
              rows={(preview.data?.rows || []).map((r) => [
                r.person_code,
                r.source_name,
                r.calendar_date,
                r.punch_minutes.map(time).join(" / "),
                r.employee_name || "—",
                labels[r.match_state],
              ])}
            />
          </LoadState>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={!page}
              onClick={() => setPage(page - 1)}
            >
              السابق
            </Button>
            <span>{page + 1}</span>
            <Button
              variant="outline"
              disabled={(page + 1) * 250 >= (current.summary.rows || 0)}
              onClick={() => setPage(page + 1)}
            >
              التالي
            </Button>
          </div>
        </section>
      )}
      <h2 className="mt-8 mb-4">سجل الاستيراد</h2>
      <LoadState loading={list.loading} error={list.error} retry={list.refresh}>
        <Grid
          headers={["الملف", "من", "إلى", "الحالة", "عرض"]}
          rows={(list.data || []).map((b) => [
            b.source_name,
            b.period_start,
            b.period_end,
            labels[b.state],
            <Button
              key={b.id}
              variant="ghost"
              onClick={() => {
                setBatch(b);
                setPage(0);
              }}
            >
              عرض
            </Button>,
          ])}
        />
      </LoadState>
    </>
  );
}

type Issue = {
  id: string;
  version: number;
  source_name: string;
  person_code: string;
  calendar_date: string;
  details: string;
  state: string;
};
export function FingerprintIssues({
  reference,
  canWrite,
}: {
  reference: Reference;
  canWrite: boolean;
}) {
  const [state, setState] = useState("open"),
    [page, setPage] = useState(0),
    [issue, setIssue] = useState<Issue | null>(null),
    [employee, setEmployee] = useState(""),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false);
  const query = useData<{ rows: Issue[]; total: number }>("attendance.issues", {
    state,
    page,
  });
  async function resolve(ignore = false) {
    if (!issue) return;
    setBusy(true);
    try {
      await mutate("attendance.issue.resolve", {
        id: issue.id,
        version: issue.version,
        state: ignore ? "ignored" : "resolved",
        employee_id: employee || undefined,
        resolution_note: note,
      });
      setIssue(null);
      toast.success("تم حفظ المراجعة");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle title="مشاكل البصمة" />
      <div className="filter-bar">
        <Choice
          label="الحالة"
          value={state}
          onChange={(v) => {
            setState(v || "open");
            setPage(0);
          }}
          options={[
            { value: "open", label: "تحتاج مراجعة" },
            { value: "resolved", label: "تم الحل" },
            { value: "ignored", label: "مستبعدة" },
          ]}
        />
      </div>
      <LoadState
        loading={query.loading}
        error={query.error}
        retry={query.refresh}
      >
        <Grid
          headers={["التاريخ", "رمز الشخص", "اسم المصدر", "المشكلة", "الإجراء"]}
          rows={(query.data?.rows || []).map((r) => [
            r.calendar_date,
            r.person_code,
            r.source_name,
            r.details,
            canWrite && state === "open" ? (
              <Button
                key={r.id}
                variant="outline"
                onClick={() => {
                  setIssue(r);
                  setEmployee("");
                  setNote("");
                }}
              >
                مراجعة
              </Button>
            ) : (
              "—"
            ),
          ])}
        />
        <Pager
          page={page + 1}
          total={query.data?.total || 0}
          size={100}
          onChange={(v) => setPage(v - 1)}
        />
      </LoadState>
      <Dialog open={!!issue} onOpenChange={(o) => !o && setIssue(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{issue?.source_name}</DialogTitle>
          </DialogHeader>
          <SearchPicker
            label="الموظف الصحيح"
            value={employee}
            onChange={setEmployee}
            options={reference.employees.map((e) => ({
              value: e.id,
              label: `${e.name} — ${e.department} — ${e.employee_number || e.id.slice(0, 8)}`,
            }))}
          />
          <Field label="سبب المعالجة">
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={2000}
            />
          </Field>
          <Button
            disabled={busy || !employee || !note.trim()}
            onClick={() => resolve()}
          >
            تأكيد الربط
          </Button>
          <Button
            variant="outline"
            disabled={busy || !note.trim()}
            onClick={() => resolve(true)}
          >
            استبعاد من المعالجة
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

type Rule = {
  id: string;
  version: number;
  department_id: string;
  effective_from: string;
  start_minute: number;
  grace_minutes: number;
  entry_window_start: number;
  entry_window_end: number;
  default_manager_id: string | null;
  working_weekdays: number[];
};
export function AttendanceRules({ reference }: { reference: Reference }) {
  const query = useData<Rule[]>("attendance.rules");
  const [rule, setRule] = useState<Partial<Rule> | null>(null),
    [busy, setBusy] = useState(false);
  const update = (key: keyof Rule, value: unknown) =>
    setRule((r) => ({ ...r, [key]: value }));
  async function save() {
    setBusy(true);
    try {
      await mutate("attendance.rule.save", rule);
      setRule(null);
      toast.success("تم حفظ إعداد الدوام");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        title="دوام الأقسام"
        actions={
          <Button
            onClick={() =>
              setRule({
                effective_from: baghdadDate(),
                start_minute: 960,
                grace_minutes: 0,
                entry_window_start: 720,
                entry_window_end: 1439,
                working_weekdays: [0, 1, 2, 3, 4, 5, 6],
                default_manager_id: null,
              })
            }
          >
            إضافة إعداد بتاريخ
          </Button>
        }
      />
      <LoadState
        loading={query.loading}
        error={query.error}
        retry={query.refresh}
      >
        <Grid
          headers={[
            "القسم",
            "ساري من",
            "بداية الدوام",
            "السماح",
            "نافذة الدخول",
            "تعديل",
          ]}
          rows={(query.data || []).map((r) => [
            departmentLabel(
              reference.departments.find((d) => d.id === r.department_id)!,
            ),
            r.effective_from,
            time(r.start_minute),
            r.grace_minutes,
            `${time(r.entry_window_start)} — ${time(r.entry_window_end)}`,
            <Button key={r.id} variant="ghost" onClick={() => setRule(r)}>
              تعديل
            </Button>,
          ])}
        />
      </LoadState>
      <Dialog open={!!rule} onOpenChange={(o) => !o && setRule(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إعداد دوام القسم</DialogTitle>
          </DialogHeader>
          <Choice
            label="القسم"
            disabled={!!rule?.id}
            value={rule?.department_id || ""}
            onChange={(v) => update("department_id", v)}
            options={reference.departments
              .filter((d) => d.is_active)
              .map((d) => ({ value: d.id, label: departmentLabel(d) }))}
          />
          <Field label="ساري من">
            <Input
              type="date"
              disabled={!!rule?.id}
              value={rule?.effective_from || ""}
              onChange={(e) => update("effective_from", e.target.value)}
            />
          </Field>
          {(
            [
              ["start_minute", "بداية الدوام"],
              ["entry_window_start", "بداية نافذة الدخول"],
              ["entry_window_end", "نهاية نافذة الدخول"],
            ] as const
          ).map(([key, label]) => (
            <TimeField
              key={key}
              label={label}
              value={rule?.[key] ?? 0}
              onChange={(v) => update(key, v)}
            />
          ))}
          <Field label="دقائق السماح">
            <Input
              type="number"
              min={0}
              max={180}
              value={rule?.grace_minutes ?? 0}
              onChange={(e) => update("grace_minutes", Number(e.target.value))}
            />
          </Field>
          <Choice
            label="المسؤول الافتراضي"
            empty="بدون"
            value={rule?.default_manager_id || ""}
            onChange={(v) => update("default_manager_id", v || null)}
            options={reference.managers.map((m) => ({
              value: m.id,
              label: m.name,
            }))}
          />
          <div className="flex flex-wrap gap-1">
            {[
              "الأحد",
              "الاثنين",
              "الثلاثاء",
              "الأربعاء",
              "الخميس",
              "الجمعة",
              "السبت",
            ].map((label, i) => (
              <Button
                key={label}
                size="sm"
                variant={
                  rule?.working_weekdays?.includes(i) ? "default" : "outline"
                }
                aria-pressed={rule?.working_weekdays?.includes(i)}
                onClick={() =>
                  update(
                    "working_weekdays",
                    rule?.working_weekdays?.includes(i)
                      ? rule.working_weekdays.filter((v) => v !== i)
                      : [...(rule?.working_weekdays || []), i],
                  )
                }
              >
                {label}
              </Button>
            ))}
          </div>
          <Button disabled={busy || !rule?.department_id} onClick={save}>
            حفظ
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
