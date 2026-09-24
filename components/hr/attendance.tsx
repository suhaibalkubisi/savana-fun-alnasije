"use client";
import { useState } from "react";
import type { parseFingerprint } from "@/lib/hr/fingerprint";
import type { MonthlyPosition } from "@/lib/hr/monthly-position.mjs";
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
import {
  currentImport,
  importActionVersion,
} from "@/lib/hr/import-workflow.mjs";
import {
  baghdadDate,
  daysInMonth,
  departmentLabel,
  type Reference,
} from "@/lib/hr/types";
import { download, tableExcelBytes, tablePdfBytes } from "@/lib/hr/exports";
import { formatClock12 } from "@/lib/hr/time-format.mjs";
import { MonthlyPositionPage } from './monthly-position';
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
  internal_code?: string | null;
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
  attendance_state: string;
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
  cells?: Record<
    string,
    {
      entry: number | null;
      exit: number | null;
      duration: number | null;
      state: string;
    }
  >;
};
type Batch = {
  id: string;
  version: number;
  source_name: string;
  state: string;
  period_start: string;
  period_end: string;
  summary: Record<string, number>;
  import_kind: "daily" | "monthly";
  lifecycle_state?: string;
  lifecycle_version?: number;
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
  reviewed: "تمت المراجعة",
  approved: "معتمد",
  superseded: "مستبدل",
  pending_exit: "بانتظار بصمة الخروج",
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
    <div
      className="table-card overflow-x-auto"
      tabIndex={0}
      role="region"
      aria-label="جدول النتائج، قابل للتمرير أفقياً"
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
  const [manager, setManager] = useState("");
  const query = useData<{
    rows: (DayRow & MonthRow)[];
    approved_import?: {
      id: string;
      source_name: string;
      approved_at: string;
    } | null;
  }>(`attendance.${monthly ? "monthly_fingerprint" : "daily"}`, {
    date,
    department_id: dep,
    manager_id: monthly ? manager : "",
    search: useDebounced(search),
  });
  const title = monthly ? "الحضور الشهري بالبصمة" : "الموقف اليومي";
  const rawRows = query.data?.rows || [];
  const group = (value: string) =>
    value.startsWith("absence") ? "absence" : value;
  const rows = rawRows.filter((r) => {
    if (monthly)
      return !search || `${r.name} ${r.employee_number}`.includes(search);
    if (advanced) return r.status === advanced;
    return quick === null || quick.has(group(r.status));
  });
  const monthDays = monthly ? daysInMonth(date.slice(0, 7)) : 0;
  const headers = monthly
    ? [
        "رقم الموظف",
        "الموظف",
        "القسم",
        "المسؤول بنهاية الشهر",
        ...Array.from({ length: monthDays }, (_, i) => String(i + 1)),
      ]
    : [
        "ت",
        "الكود الوظيفي",
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
          r.manager || "غير محدد",
          ...Array.from({ length: monthDays }, (_, i) => {
            const cell = r.cells?.[String(i + 1)];
            if (cell?.entry == null) return "—";
            return `د ${time(cell.entry)}\nخ ${cell.exit == null ? "بانتظار الخروج" : time(cell.exit)}`;
          }),
        ]
      : [
          rows.indexOf(r) + 1,
          r.internal_code || "",
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
                ? [2, 6, 5, 5, ...Array(monthDays).fill(1)]
                : [4, 12, 8, 8, 15, 16, 13, 9, 9, 8, 9, 24, 11, 18]
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
        {monthly && (
          <Choice
            label="المسؤول بنهاية الشهر"
            value={manager}
            onChange={setManager}
            options={reference.managers.map((m) => ({
              value: m.id,
              label: m.name,
            }))}
          />
        )}
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
                  ["أيام الشهر", monthDays],
                  ["مصدر شهري معتمد", query.data?.approved_import ? 1 : 0],
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

export function FingerprintImport({ monthly = false,reference }: { monthly?: boolean;reference:Reference }) {
  const selectedImportId = useSearchParams().get("import_id") || undefined;
  const [confirmation, setConfirmation] = useState<
    "review" | "approve" | "apply" | "cancel" | null
  >(null);
  const [pending, setPending] = useState<null | {
    parsed: ReturnType<typeof parseFingerprint>;
    name: string;
    hash: string;
    period: string;
  }>(null);
  const [period, setPeriod] = useState(
      monthly ? baghdadDate().slice(0, 7) : baghdadDate(),
    ),
    [busy, setBusy] = useState(false),
    [batch, setBatch] = useState<Batch | null>(null),
    [page, setPage] = useState(0);
  const [coverageFrom,setCoverageFrom]=useState(''),[coverageEnd,setCoverageEnd]=useState('');
  const [localPosition,setLocalPosition]=useState<MonthlyPosition|null>(null);
  const [uploadError,setUploadError]=useState('');
  const list = useData<Batch[]>("attendance.imports", {
    import_kind: monthly ? "monthly" : "daily",
  });
  const preview = useData<{
    batch: Batch;
    review_summary: {
      identities: number;
      matched_identities: number;
      populated_cells: number;
      punch_tokens: number;
      open_issues: number;
    };
    rows: {
      source_name: string;
      person_code: string;
      calendar_date: string;
      employee_name: string | null;
      match_state: string;
      punch_minutes: number[];
    }[];
  }>(
    "attendance.import",
    { id: batch?.id || selectedImportId, page },
    !!(batch || selectedImportId),
  );
  const candidate = currentImport(batch, preview.data?.batch);
  const current =
    candidate?.import_kind === (monthly ? "monthly" : "daily")
      ? candidate
      : null;
  const reviewSummary = preview.data?.review_summary;
  async function upload(file: File) {
    setBusy(true);
    setUploadError('');
    setPending(null);
    setLocalPosition(null);
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
      if (monthly) {
        setPending({ parsed, name: file.name, hash, period });
        const observed=parsed.rows.filter(r=>r.punch_minutes.length).map(r=>r.calendar_date).sort();
        setCoverageFrom(observed[0]||parsed.period_start);
        setCoverageEnd(observed.at(-1)||parsed.period_start);
        setLocalPosition(await mutate<MonthlyPosition>('attendance.import.inspect', {...parsed,source_name:file.name,source_hash:hash,import_kind:'monthly',coverage_start:observed[0]||parsed.period_start,coverage_end:observed.at(-1)||parsed.period_start}));
      }
      else {
        setBatch(
          await mutate<Batch>("attendance.import.preview", {
            ...parsed,
            source_name: file.name,
            source_hash: hash,
            import_kind: "daily",
          }),
        );
        setPage(0);
      }
      for (const warning of parsed.warnings) toast.warning(warning);
    } catch (e) {
      setUploadError((e as Error).message);
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function createPreview() {
    if (!pending || pending.period !== period) return;
    setBusy(true);
    try {
      const next = await mutate<Batch>("attendance.import.preview", {
        ...pending.parsed,
        source_name: pending.name,
        source_hash: pending.hash,
        import_kind: monthly ? "monthly" : "daily",
        ...(monthly?{coverage_start:coverageFrom,coverage_end:coverageEnd}:{}),
      });
      setBatch(next);
      setPage(0);
      setPending(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function transition(action: "review" | "approve" | "apply" | "cancel") {
    if (!current) return;
    setBusy(true);
    try {
      setBatch(
        await mutate<Batch>(`attendance.import.${action}`, {
          id: current.id,
          version: importActionVersion(current, action),
        }),
      );
      toast.success(
        action === "cancel"
          ? "تم إلغاء الاستيراد"
          : action === "review"
            ? "اكتملت مراجعة الملف"
            : "تم اعتماد البصمة",
      );
      setConfirmation(null);
      preview.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle title={monthly ? "البصمة الشهرية" : "البصمة اليومية"} />
      {candidate && !current && (
        <p role="alert" className="workflow-notice">
          هذا الملف يخص{" "}
          {candidate.import_kind === "daily"
            ? "البصمة اليومية"
            : "البصمة الشهرية"}
          .{" "}
          <Link
            href={`/fingerprint-${candidate.import_kind === "daily" ? "daily" : "monthly"}?import_id=${candidate.id}`}
          >
            افتحه في شاشة المصدر الصحيح
          </Link>
        </p>
      )}
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
            onChange={(e) => {
              setPeriod(e.target.value);
              setPending(null);
            }}
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
      {!!uploadError&&<p role="alert" className="workflow-notice">تعذر إكمال قراءة الملف: {uploadError}</p>}
      {pending && (
        <section className="space-y-4" aria-label="تأكيد فترة الملف">
          <h2>
            {pending.name} · الفترة المختارة: {pending.period}
          </h2>
          <p>
            تُفسّر تواريخ الملف حسب السنة المختارة أعلاه، وليس وقت الرفع. إنشاء
            المعاينة يحفظ أدلة البصمة للمراجعة فقط ولا يعتمد الحضور.
          </p>
          <Metrics
            items={[
              ["صفوف المصدر", pending.parsed.source_counts.source_rows],
              ["أكواد الأشخاص", pending.parsed.source_counts.person_codes],
              [
                "خلايا بأدلة بصمة",
                pending.parsed.source_counts.populated_cells,
              ],
              ["البصمات الخام", pending.parsed.source_counts.raw_punch_tokens],
            ]}
          />
          <p>
            تُحفظ الأيام الفارغة دون تحويلها إلى غياب. تُعرض حالات عدم التطابق
            للمراجعة، وتُحسب البصمات المكررة في الدقيقة نفسها مرة واحدة فقط مع
            حفظ الأصل.
          </p>
          <div className="flex flex-wrap gap-3"><Field label="أول تاريخ مغطى"><Input type="date" min={pending.parsed.period_start} max={pending.parsed.period_end} value={coverageFrom} onChange={e=>setCoverageFrom(e.target.value)}/></Field><Field label="آخر تاريخ مغطى"><Input type="date" min={coverageFrom} max={pending.parsed.period_end} value={coverageEnd} onChange={e=>setCoverageEnd(e.target.value)}/></Field></div>
          <p className="scope-note">القيم المقترحة هي أول وآخر بصمة مرصودة، وليست دليلاً على اكتمال جمع البصمات. تحقق من نطاق تصدير الجهاز قبل التأكيد؛ لا تعني الأيام الفارغة غياباً.</p>
          <Button disabled={busy} onClick={createPreview}>
            تأكيد الفترة وإنشاء المعاينة
          </Button>
          {localPosition&&<><p className="scope-note">معاينة فورية للقراءة فقط؛ لم يُحفظ استيراد جديد. عند تأكيد الفترة يُعاد الحساب بنطاق التغطية المختار أعلاه وتُحفظ الأدلة للمراجعة.</p><MonthlyPositionPage key={pending.hash} reference={reference} period={pending.period} localPosition={localPosition} embedded/></>}
        </section>
      )}
      {current && (
        <section className="space-y-4">
          <PageTitle
            title={current.source_name}
            actions={
              (current.lifecycle_state || current.state) === "preview" ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={
                      busy ||
                      preview.loading ||
                      !!preview.error ||
                      (monthly &&
                        (!reviewSummary || reviewSummary.open_issues > 0))
                    }
                    onClick={() =>
                      setConfirmation(monthly ? "review" : "apply")
                    }
                  >
                    {monthly ? "إنهاء المراجعة" : "تأكيد واعتماد الاستيراد"}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => setConfirmation("cancel")}
                  >
                    إلغاء
                  </Button>
                </div>
              ) : (current.lifecycle_state || current.state) === "reviewed" ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={
                      busy ||
                      preview.loading ||
                      !!preview.error ||
                      !reviewSummary ||
                      reviewSummary.open_issues > 0
                    }
                    onClick={() => setConfirmation("approve")}
                  >
                    اعتماد الملف الشهري
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => setConfirmation("cancel")}
                  >
                    إلغاء الملف
                  </Button>
                </div>
              ) : (
                <span>{labels[current.lifecycle_state || current.state]}</span>
              )
            }
          />
          <div className="workflow-notice" role="status">
            <strong>
              {labels[current.lifecycle_state || current.state]} ·{" "}
              {current.period_start} — {current.period_end}
            </strong>
            <p>
              {monthly
                ? "معاينة الأدلة ← معالجة المطابقة ← إنهاء المراجعة ← اعتماد صريح. الموقف الشامل يعرض قرارات HR؛ مصفوفة البصمة تعرض الملف الشهري المعتمد فقط."
                : "هذه أدلة يومية. لا تدخل الملفات الشهرية في حساب الموقف اليومي، وقرار HR اليدوي له الأولوية."}
            </p>
            {reviewSummary && (
              <p>
                {reviewSummary.open_issues
                  ? `متبقٍ ${reviewSummary.open_issues} مشكلة يومية تحتاج معالجة قبل المراجعة والاعتماد.`
                  : "لا توجد مشاكل مطابقة مفتوحة. راجع الأدلة قبل اتخاذ قرار الاعتماد."}
              </p>
            )}
          </div>
          {monthly&&<div className="actions"><Button asChild variant="outline"><Link href={`/fingerprint-issues?import_id=${current.id}&import_kind=monthly`}>مراجعة مطابقة هويات هذا الملف</Link></Button><Button asChild variant="outline"><Link href="/monthly-position">عرض الموقف الشهري المعتمد</Link></Button></div>}
          {monthly&&<MonthlyPositionPage key={current.id} reference={reference} importId={current.id} period={current.period_start.slice(0,7)} embedded/>}
          {!monthly && reviewSummary && (
            <Metrics
              items={[
                ["هويات المصدر", reviewSummary.identities],
                ["هويات مطابقة", reviewSummary.matched_identities],
                ["خلايا ببصمات", reviewSummary.populated_cells],
                [
                  "بصمات محفوظة بعد دمج تكرار الدقيقة",
                  reviewSummary.punch_tokens,
                ],
              ]}
            />
          )}
          <details className="raw-evidence-panel">
          <summary>الأدلة الأصلية بالتفصيل · {current.summary.rows || 0} سجل شخص / يوم</summary>
          <Metrics
            items={[
              ["سجلات الشخص / اليوم", current.summary.rows || 0],
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
                {!monthly && (
                  <Button asChild variant="outline">
                    <Link href="/daily-position">افتح الموقف اليومي</Link>
                  </Button>
                )}
                {!monthly && (
                  <Button asChild variant="outline">
                    <Link href="/daily-position?status=late">
                      راجع المتأخرين
                    </Link>
                  </Button>
                )}
                {!monthly && (
                  <Button asChild variant="outline">
                    <Link href="/daily-position?status=no_entry">
                      راجع بدون بصمة دخول
                    </Link>
                  </Button>
                )}
                <Button asChild variant="outline">
                  <Link
                    href={`/fingerprint-issues?import_id=${current.id}&import_kind=${current.import_kind}`}
                  >
                    معالجة مشاكل هذا الملف
                  </Link>
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
            {preview.refreshing && <p role="status">جار تحديث المعاينة…</p>}
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
          </details>
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
            labels[b.lifecycle_state || b.state],
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
      <Dialog
        open={!!confirmation}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirmation(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmation === "cancel"
                ? "تأكيد إلغاء الملف"
                : confirmation === "review"
                  ? "تأكيد إنهاء المراجعة"
                  : "تأكيد اعتماد البصمة"}
            </DialogTitle>
          </DialogHeader>
          <p>
            {current?.source_name} · {current?.period_start} —{" "}
            {current?.period_end}
          </p>
          <p>
            {confirmation === "review"
              ? "ستصبح المعاينة جاهزة لقرار الاعتماد؛ لن يُطبّق الحضور بهذه الخطوة."
              : confirmation === "cancel"
                ? "سيُستبعد الملف من المعالجة وتُحفظ أدلته وسجل مراجعته. لن تُحذف البيانات."
                : "سيُستخدم هذا الملف في حساب البصمة. تأكد من الفترة والمطابقة قبل الاعتماد."}
          </p>
          <Button
            disabled={busy}
            onClick={() => confirmation && transition(confirmation)}
          >
            {busy ? "جار الحفظ…" : "تأكيد القرار"}
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setConfirmation(null)}
          >
            رجوع للمراجعة
          </Button>
        </DialogContent>
      </Dialog>
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
  punch_minutes: number[];
  raw_values: string[];
  import_id: string;
  import_name: string;
  group_token?: string;
  related_open_count?: number;
  first_date?: string;
  last_date?: string;
  candidates: {
    id: string;
    name: string;
    employee_number: string | null;
    department: string;
  }[];
};
export function FingerprintIssues({
  reference,
  canWrite,
}: {
  reference: Reference;
  canWrite: boolean;
}) {
  const params = useSearchParams();
  const importId = params.get("import_id") || "";
  const [state, setState] = useState("open"),
    [page, setPage] = useState(0),
    [issue, setIssue] = useState<Issue | null>(null),
    [employee, setEmployee] = useState(""),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false);
  const query = useData<{ rows: Issue[]; total: number; issue_count: number }>(
    "attendance.issues",
    {
      state,
      page,
      import_id: importId,
      group_identities: "true",
    },
  );
  const employees = useData<
    {
      id: string;
      name: string;
      employee_number: string | null;
      department: string;
      employment_status: string;
      internal_code?: string;
    }[]
  >("attendance.matching_employees", {}, !!issue && canWrite);
  async function resolve(ignore = false) {
    if (!issue) return;
    setBusy(true);
    try {
      await mutate(
        !ignore && issue.group_token
          ? "attendance.identity.resolve"
          : "attendance.issue.resolve",
        {
          id: issue.id,
          version: issue.version,
          state: ignore ? "ignored" : "resolved",
          employee_id: employee || undefined,
          resolution_note: note,
          group_token: issue.group_token,
        },
      );
      setIssue(null);
      toast.success(
        !ignore && issue.group_token
          ? `تم ربط ${issue.related_open_count} سجل يومي. الملف ما زال بانتظار المراجعة والاعتماد.`
          : "تم حفظ المراجعة",
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        title="مشاكل البصمة"
        actions={
          importId && (
            <Button asChild variant="outline">
              <Link
                href={`/fingerprint-${params.get("import_kind") === "daily" ? "daily" : "monthly"}?import_id=${importId}`}
              >
                العودة لمعاينة الملف
              </Link>
            </Button>
          )
        }
      />
      <div className="workflow-notice">
        <p>
          {importId
            ? "المشاكل المعروضة تخص الملف المختار فقط."
            : "المشاكل المعروضة تخص الملفات غير الملغاة. افتح المشاكل من معاينة الملف لتحديد نطاق العمل."}
        </p>
        <p>
          تُجمع مشاكل المطابقة الشهرية حسب الملف والكود والاسم. لا تختَر موظفاً
          اعتماداً على الاسم وحده؛ تحقق من الرقم والقسم وحالة الخدمة. الربط لا
          يعتمد الحضور.
        </p>
        {query.data && (
          <p>
            {query.data.total} عناصر مراجعة · {query.data.issue_count} مشاكل
            يومية
          </p>
        )}
      </div>
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
          headers={[
            "الملف",
            "الفترة",
            "رمز الشخص",
            "اسم المصدر",
            "المشكلة",
            "سجلات مرتبطة",
            "الإجراء",
          ]}
          rows={(query.data?.rows || []).map((r) => [
            r.import_name,
            r.first_date === r.last_date
              ? r.calendar_date
              : `${r.first_date} — ${r.last_date}`,
            r.person_code,
            r.source_name,
            r.details,
            r.related_open_count || 1,
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
      <Dialog
        open={!!issue}
        onOpenChange={(o) => !o && !busy && setIssue(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{issue?.source_name}</DialogTitle>
          </DialogHeader>
          <div className="text-sm space-y-1">
            <p>كود الشخص: {issue?.person_code || "غير موجود"}</p>
            <p>التاريخ: {issue?.calendar_date}</p>
            <p>
              البصمات:{" "}
              {issue?.punch_minutes?.map(time).join(" / ") || "لا توجد"}
            </p>
            <p>{issue?.details}</p>
            {issue?.group_token && (
              <p className="workflow-notice">
                تأكيد الربط سيعالج {issue.related_open_count} مشاكل يومية لنفس
                الكود والاسم في هذا الملف فقط ({issue.first_date} —{" "}
                {issue.last_date}). الاستبعاد أدناه يخص اليوم المعروض فقط.
              </p>
            )}
          </div>
          <SearchPicker
            label="الموظف الصحيح"
            value={employee}
            onChange={setEmployee}
            disabled={busy || employees.loading}
            options={(employees.data || reference.employees).map((e) => ({
              value: e.id,
              label: `${e.name} — ${'internal_code' in e ? e.internal_code : ''} — ${e.department} — رقم ${e.employee_number || 'غير محدد'}${"employment_status" in e && e.employment_status !== "active" ? " — غير نشط" : ""}${issue?.candidates.some((c) => c.id === e.id) ? " — مرشح للمراجعة" : ""}`,
            }))}
          />
          {employees.error && <p role="alert">{employees.error}</p>}
          <Field label="سبب المعالجة">
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={2000}
            />
          </Field>
          <Button
            disabled={
              busy ||
              employees.loading ||
              !!employees.error ||
              !employee ||
              !note.trim()
            }
            onClick={() => resolve()}
          >
            {busy
              ? "جار الحفظ…"
              : issue?.group_token
                ? `تأكيد ربط ${issue.related_open_count} سجلات يومية`
                : "تأكيد ربط هذا اليوم"}
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
