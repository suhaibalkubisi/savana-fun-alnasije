"use client";
import { useState, useEffect } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { BrandImage } from "./brand-image";
import { FileSpreadsheet, FileDown, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableFooter,
} from "@/components/ui/table";
import { toast } from "sonner";
import { useData, useDebounced } from "@/lib/hr/api";
import {
  baghdadDate,
  daysInMonth,
  departmentLabel,
  monthLabel,
  statuses,
  type Reference,
  type Report,
  type Totals,
} from "@/lib/hr/types";
import {
  triggerDownload,
  excelBytes,
  pdfBytes,
  summaryHeaders,
  summaryKeys,
  summaryValues,
  totalHeaders,
} from "@/lib/hr/exports";
import {
  Choice,
  Field,
  LoadState,
  PageTitle,
  SearchBox,
  StatusBadge,
} from "./shared";
const totalKeys: (keyof Totals)[] = [
  "absence",
  "absence2",
  "absence3",
  "leave",
  "late",
  "late_minutes",
  "weighted",
];
export function ReportPage({
  mode,
  reference,
}: {
  mode: "monthly" | "department" | "summary";
  reference: Reference;
}) {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const [month, setMonth] = useState(
    /^\d{4}-(0[1-9]|1[0-2])$/.test(params.get("month") || "")
      ? params.get("month")!
      : baghdadDate().slice(0, 7),
  );
  const [dep, setDep] = useState(
    reference.departments.find((d) => d.id === params.get("department_id"))
      ?.id || (mode === "department" ? reference.departments[0]?.id || "" : ""),
  );
  const [search, setSearch] = useState(params.get("search") || "");
  const [shift, setShift] = useState(params.get("shift_id") || "");
  const [manager, setManager] = useState(params.get("manager_id") || "");
  const [inactive, setInactive] = useState(
    params.get("include_inactive") === "true",
  );
  const [exporting, setExporting] = useState<"excel" | "pdf" | null>(null);
  const [readyFile, setReadyFile] = useState<{
    url: string;
    name: string;
    label: string;
  } | null>(null);
  useEffect(() => {
    return () => {
      if (readyFile) URL.revokeObjectURL(readyFile.url);
    };
  }, [readyFile]);
  const delayed = useDebounced(search);
  const title =
    mode === "summary"
      ? "ملخص الموظفين"
      : mode === "department"
        ? "موقف الأقسام"
        : "الموقف الشامل";
  const summary = mode === "summary";
  const filters = {
    month,
    department_id: dep,
    search: delayed,
    shift_id: shift,
    manager_id: manager,
    include_inactive: inactive ? "true" : undefined,
  };
  const q = useData<Report>("report", filters, !!month);
  useEffect(() => {
    const qp = new URLSearchParams(
      Object.fromEntries(
        Object.entries({
          month,
          department_id: dep,
          search: delayed,
          shift_id: shift,
          manager_id: manager,
          include_inactive: inactive ? "true" : "",
        }).filter(([, v]) => v),
      ),
    );
    const target = `${path}?${qp}`;
    if (`${window.location.pathname}${window.location.search}` !== target)
      router.replace(target, { scroll: false });
  }, [month, dep, delayed, shift, manager, inactive, path, router]);
  async function exportFile(format: "excel" | "pdf") {
    if (!q.data || exporting) return;
    setExporting(format);
    try {
      const reportTitle = dep
        ? `${title} · ${reference.departments.find((d) => d.id === dep) ? departmentLabel(reference.departments.find((d) => d.id === dep)!) : ""}`
        : title;
      const bytes =
        format === "excel"
          ? excelBytes(q.data, reportTitle, summary)
          : await pdfBytes(q.data, reportTitle, summary);
      const name = `HR_${mode}_${month}.${format === "excel" ? "xlsx" : "pdf"}`;
      const type =
        format === "excel"
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "application/pdf";
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
      setReadyFile({
        url,
        name,
        label: `${reportTitle} · ${monthLabel(month)}`,
      });
      // Keep a real user-clickable link when automatic downloads are blocked.
      try {
        triggerDownload(url, name);
      } catch {
        /* The direct link remains available. */
      }
      toast.success("التقرير جاهز. إذا لم يبدأ التنزيل اضغط رابط الملف أدناه");
    } catch {
      toast.error(
        "تعذر تجهيز التقرير. تحقق من الاتصال واضغط Excel أو PDF للمحاولة مجدداً",
      );
    } finally {
      setExporting(null);
    }
  }
  const days = month ? daysInMonth(month) : 0;
  const colspan = 3 + days + 7;
  return (
    <>
      <PageTitle
        title={title}
        subtitle={month ? monthLabel(month) : ""}
        actions={
          <>
            <Button
              variant="outline"
              disabled={!q.data || !!exporting || q.loading}
              onClick={() => void exportFile("excel")}
            >
              <FileSpreadsheet size={17} />
              {exporting === "excel" ? "جار تجهيز Excel…" : "Excel"}
            </Button>
            <Button
              variant="outline"
              disabled={!q.data || !!exporting || q.loading}
              onClick={() => void exportFile("pdf")}
            >
              <FileDown size={17} />
              {exporting === "pdf" ? "جار تجهيز PDF…" : "PDF"}
            </Button>
            <Button
              variant="outline"
              disabled={!q.data || q.loading}
              onClick={() => window.print()}
            >
              <Printer size={17} />
              طباعة
            </Button>
          </>
        }
      />
      {readyFile && (
        <div
          className="panel no-print flex flex-wrap items-center justify-between gap-3 p-4"
          role="status"
        >
          <div>
            <p className="font-bold">الملف جاهز للتنزيل</p>
            <p className="text-sm">{readyFile.label}</p>
          </div>
          <a
            href={readyFile.url}
            download={readyFile.name}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 font-bold text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          >
            <FileDown size={18} />
            تنزيل {readyFile.name.endsWith(".pdf") ? "PDF" : "Excel"}
          </a>
        </div>
      )}
      <section className="panel report-panel report-surface">
        <div className="print-brand">
          <BrandImage
            kind="header"
            alt="فن النسيج — قسم الموارد البشرية – مسائي — SAVANA"
          />
          <h1>{title}</h1>
          <p>
            {month ? monthLabel(month) : ""}
            {dep
              ? ` · ${departmentLabel(reference.departments.find((d) => d.id === dep)!)}`
              : ""}
          </p>
        </div>
        <div className="filterbar no-print">
          <Field label="الشهر والسنة">
            <Input
              type="month"
              required
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </Field>
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
          {summary && (
            <>
              <Choice
                label="الشفت"
                value={shift}
                onChange={setShift}
                options={reference.shifts.map((d) => ({
                  value: d.id,
                  label: d.name,
                }))}
              />
              <Choice
                label="المسؤول المباشر"
                value={manager}
                onChange={setManager}
                options={reference.managers.map((d) => ({
                  value: d.id,
                  label: d.name,
                }))}
              />
            </>
          )}
        </div>
        <div className="report-toolbar no-print">
          <div className="status-legend">
            {Object.entries(statuses).map(([key]) => (
              <StatusBadge key={key} type={key as keyof typeof statuses} />
            ))}
          </div>
          <label className="checkbox-label">
            <Checkbox
              checked={inactive}
              onCheckedChange={(v) => setInactive(v === true)}
            />
            تضمين غير النشطين
          </label>
        </div>
        <LoadState
          loading={q.loading && !q.data}
          error={q.error}
          retry={q.refresh}
          empty={!q.data?.rows.length}
          emptyText="لا يوجد موظفون مطابقون للبحث"
        >
          {summary ? (
            <Table className="summary-table">
              <TableHeader>
                <TableRow>
                  {summaryHeaders.map((h) => (
                    <TableHead key={h}>{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.data?.rows.map((r) => (
                  <TableRow key={r.id}>
                    {summaryValues(r).map((v, i) => (
                      <TableCell
                        key={i}
                        className={i === 1 ? "sticky-name" : ""}
                      >
                        {i === 1 ? (
                          <Link href={`/employees/${r.id}`}>{v}</Link>
                        ) : (
                          <bdi>{v}</bdi>
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={5}>الإجمالي</TableCell>
                  {summaryKeys.map((k) => (
                    <TableCell key={k}>{q.data?.totals[k]}</TableCell>
                  ))}
                </TableRow>
              </TableFooter>
            </Table>
          ) : (
            <Table className="monthly-matrix">
              <TableHeader>
                <TableRow>
                  <TableHead>رقم الموظف</TableHead>
                  <TableHead className="sticky-name">اسم الموظف</TableHead>
                  <TableHead>القسم</TableHead>
                  {Array.from({ length: days }, (_, i) => (
                    <TableHead key={i} className="day-heading">
                      {i + 1}
                    </TableHead>
                  ))}
                  {totalHeaders.map((h) => (
                    <TableHead key={h} className="total-heading">
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.data?.rows.flatMap((r, i, all) => {
                  const group =
                    i === 0 || r.department_id !== all[i - 1].department_id;
                  return [
                    ...(group
                      ? [
                          <TableRow
                            key={`group-${r.department_id}`}
                            className="department-separator"
                          >
                            <TableCell colSpan={colspan}>
                              <bdi>{r.department}</bdi>
                            </TableCell>
                          </TableRow>,
                        ]
                      : []),
                    <TableRow key={r.id}>
                      <TableCell dir="ltr">
                        {r.employee_number || "—"}
                      </TableCell>
                      <TableCell className="sticky-name">
                        <Link href={`/employees/${r.id}`}>{r.name}</Link>
                      </TableCell>
                      <TableCell>
                        <bdi>{r.department}</bdi>
                      </TableCell>
                      {Array.from({ length: days }, (_, i) => (
                        <TableCell key={i} className="day-cell">
                          {r.cells[i + 1] && (
                            <StatusBadge type={r.cells[i + 1]} code />
                          )}
                        </TableCell>
                      ))}
                      {totalKeys.map((k) => (
                        <TableCell
                          key={k}
                          className={
                            k === "weighted" ? "weighted-cell" : "numeric"
                          }
                        >
                          {r[k] || "—"}
                        </TableCell>
                      ))}
                    </TableRow>,
                  ];
                })}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3 + days}>الإجمالي</TableCell>
                  {totalKeys.map((k) => (
                    <TableCell key={k}>{q.data?.totals[k]}</TableCell>
                  ))}
                </TableRow>
              </TableFooter>
            </Table>
          )}
        </LoadState>
        <div className="report-footer">
          <span>{q.data?.rows.length || 0} موظف</span>
          <span>{month && monthLabel(month)}</span>
        </div>
      </section>
    </>
  );
}
