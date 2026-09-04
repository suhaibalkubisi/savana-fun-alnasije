"use client";
import { useState } from "react";
import Link from "next/link";
import { Check, PenLine, Trash2, CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { toast } from "sonner";
import { mutate, useData } from "@/lib/hr/api";
import { statusSchema } from "@/lib/hr/validation";
import {
  baghdadDate,
  departmentLabel,
  statuses,
  type StatusRecord,
  type Reference,
  type StatusType,
  type Paged,
  type Employee,
} from "@/lib/hr/types";
import {
  Choice,
  Field,
  LoadState,
  PageTitle,
  Pager,
  SearchPicker,
  StatusBadge,
} from "./shared";
export function StatusPage({ reference }: { reference: Reference }) {
  const [date, setDate] = useState(baghdadDate());
  const [page, setPage] = useState(1);
  const q = useData<Paged<StatusRecord>>("records", { date, page });
  return (
    <>
      <PageTitle
        title="تسجيل الحالة"
        subtitle="الغيابات والإجازات والتأخيرات"
      />
      <div className="status-layout">
        <section className="panel entry-panel">
          <div className="panel-heading">
            <h2>
              <CalendarPlus size={19} />
              حالة جديدة
            </h2>
          </div>
          <StatusForm
            reference={reference}
            initialDate={date}
            onDate={(v) => {
              setDate(v);
              setPage(1);
            }}
          />
        </section>
        <section className="panel daily-panel">
          <div className="panel-heading">
            <h2>حالات اليوم المحدد</h2>
            <span dir="ltr">{date}</span>
          </div>
          <LoadState
            loading={q.loading && !q.data}
            error={q.error}
            retry={q.refresh}
            empty={!q.data?.rows.length}
            emptyText="لا توجد حالات مسجلة لهذا اليوم"
          >
            <RecordTable
              rows={q.data?.rows || []}
              reference={reference}
              canWrite
            />
          </LoadState>
          <Pager
            size={50}
            total={q.data?.total || 0}
            page={page}
            onChange={setPage}
          />
        </section>
      </div>
    </>
  );
}
export function StatusForm({
  reference,
  record,
  employee,
  initialDate,
  onDate,
  onSaved,
}: {
  reference: Reference;
  record?: StatusRecord;
  employee?: Employee;
  initialDate?: string;
  onDate?: (v: string) => void;
  onSaved?: () => void;
}) {
  const [data, setData] = useState({
    id: record?.id,
    version: record?.version,
    record_date: record?.record_date || initialDate || baghdadDate(),
    department_id: record?.department_id || "",
    employee_id: record?.employee_id || "",
    status_type: record?.status_type || ("absence" as StatusType),
    late_minutes:
      record?.late_minutes === null || record?.late_minutes === undefined
        ? ""
        : String(record.late_minutes),
    notes: record?.notes || "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState<StatusRecord | null>(null);
  let employees = reference.employees;
  if (employee && !employees.some((e) => e.id === employee.id))
    employees = [...employees, employee];
  const options = employees
    .filter((e) => e.department_id === data.department_id)
    .map((e) => ({
      value: e.id,
      label: `${e.name} — ${e.department} — ${e.employee_number || "سجل " + e.id.slice(0, 6)}`,
    }));
  if (record && !options.some((e) => e.value === record.employee_id))
    options.push({
      value: record.employee_id,
      label: `${record.employee_name} — ${record.department} — ${record.employee_number || "سجل " + record.employee_id.slice(0, 6)}`,
    });
  function editExisting() {
    if (!conflict) return;
    setData({
      id: conflict.id,
      version: conflict.version,
      record_date: conflict.record_date,
      department_id: conflict.department_id,
      employee_id: conflict.employee_id,
      status_type: conflict.status_type,
      late_minutes:
        conflict.late_minutes === null ? "" : String(conflict.late_minutes),
      notes: conflict.notes || "",
    });
    setConflict(null);
    setError("");
  }
  return (
    <>
      <form
        className="form-stack status-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          const p = statusSchema.safeParse({
            ...data,
            late_minutes:
              data.status_type === "late"
                ? data.late_minutes === ""
                  ? null
                  : Number(data.late_minutes)
                : null,
          });
          if (!p.success) {
            setError(p.error.issues[0].message);
            return;
          }
          setBusy(true);
          try {
            const result = await mutate<
              StatusRecord | { conflict: true; record: StatusRecord }
            >("status.save", p.data);
            if ("conflict" in result) {
              setConflict(result.record);
              return;
            }
            toast.success("تم حفظ الحالة بنجاح");
            if (onSaved) onSaved();
            else
              setData((v) => ({
                ...v,
                id: undefined,
                version: undefined,
                employee_id: "",
                notes: "",
                late_minutes: "",
              }));
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="التاريخ">
          <Input
            type="date"
            value={data.record_date}
            required
            onChange={(e) => {
              setData((v) => ({ ...v, record_date: e.target.value }));
              onDate?.(e.target.value);
            }}
          />
        </Field>
        <Choice
          label="القسم"
          value={data.department_id}
          onChange={(v) =>
            setData((d) => ({ ...d, department_id: v, employee_id: "" }))
          }
          empty="اختر القسم"
          disabled={!!data.id}
          options={reference.departments
            .filter((d) => d.is_active || d.id === data.department_id)
            .map((d) => ({ value: d.id, label: departmentLabel(d) }))}
        />
        <SearchPicker
          label="الموظف"
          value={data.employee_id}
          onChange={(v) => setData((d) => ({ ...d, employee_id: v }))}
          options={options}
          disabled={!data.department_id || !!data.id}
        />
        <Choice
          label="الحالة"
          value={data.status_type}
          onChange={(v) =>
            setData((d) => ({
              ...d,
              status_type: v as StatusType,
              late_minutes: "",
            }))
          }
          options={Object.entries(statuses).map(([value, s]) => ({
            value,
            label: s.label,
          }))}
          empty="اختر الحالة"
        />
        {data.status_type === "late" && (
          <Field label="دقائق التأخير">
            <Input
              type="number"
              min={0}
              max={10080}
              step={1}
              inputMode="numeric"
              required
              value={data.late_minutes}
              onChange={(e) =>
                setData((v) => ({ ...v, late_minutes: e.target.value }))
              }
            />
          </Field>
        )}
        <Field label="ملاحظات">
          <Textarea
            rows={3}
            value={data.notes}
            onChange={(e) => setData((v) => ({ ...v, notes: e.target.value }))}
            maxLength={1000}
          />
        </Field>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy} className="w-full">
          <Check size={18} />
          {busy ? "جار الحفظ…" : data.id ? "حفظ التعديل" : "حفظ الحالة"}
        </Button>
      </form>
      <AlertDialog
        open={!!conflict}
        onOpenChange={(v) => !v && setConflict(null)}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>توجد حالة مسجلة بهذا التاريخ</AlertDialogTitle>
            <AlertDialogDescription>
              {conflict &&
                `${conflict.employee_name} · ${statuses[conflict.status_type].label}${conflict.late_minutes !== null ? " · " + conflict.late_minutes + " دقيقة" : ""}`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={editExisting}>
              تعديل الحالة المسجلة
            </AlertDialogAction>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
export function RecordTable({
  rows,
  reference,
  canWrite,
  employee,
}: {
  rows: StatusRecord[];
  reference: Reference;
  canWrite: boolean;
  employee?: Employee;
}) {
  const [edit, setEdit] = useState<StatusRecord | null>(null);
  const [remove, setRemove] = useState<StatusRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>الموظف</TableHead>
            <TableHead>التاريخ</TableHead>
            <TableHead>الحالة</TableHead>
            <TableHead>الدقائق</TableHead>
            <TableHead>ملاحظات</TableHead>
            {canWrite && <TableHead>الإجراء</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <Link
                  href={`/employees/${r.employee_id}`}
                  className="font-medium"
                >
                  {r.employee_name}
                </Link>
                <small className="cell-secondary">
                  <bdi>{r.department}</bdi>
                </small>
              </TableCell>
              <TableCell dir="ltr">{r.record_date}</TableCell>
              <TableCell>
                <StatusBadge type={r.status_type} />
              </TableCell>
              <TableCell>{r.late_minutes ?? "—"}</TableCell>
              <TableCell className="notes-cell">{r.notes || "—"}</TableCell>
              {canWrite && (
                <TableCell>
                  <div className="row-actions">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`تعديل حالة ${r.employee_name}`}
                      onClick={() => setEdit(r)}
                    >
                      <PenLine size={16} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`حذف حالة ${r.employee_name}`}
                      onClick={() => setRemove(r)}
                    >
                      <Trash2 size={16} />
                    </Button>
                  </div>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {edit && (
        <Dialog open onOpenChange={(v) => !v && setEdit(null)}>
          <DialogContent dir="rtl">
            <DialogHeader>
              <DialogTitle>تعديل الحالة</DialogTitle>
              <DialogDescription>{edit.employee_name}</DialogDescription>
            </DialogHeader>
            <StatusForm
              reference={reference}
              record={edit}
              employee={employee}
              onSaved={() => setEdit(null)}
            />
          </DialogContent>
        </Dialog>
      )}
      <AlertDialog
        open={!!remove}
        onOpenChange={(v) => !v && !deleting && setRemove(null)}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف الحالة المسجلة؟</AlertDialogTitle>
            <AlertDialogDescription>
              {remove?.employee_name} · {remove?.record_date}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              disabled={deleting}
              onClick={async (e) => {
                e.preventDefault();
                if (!remove) return;
                setDeleting(true);
                try {
                  await mutate("status.delete", {
                    id: remove.id,
                    version: remove.version,
                    confirmed: true,
                  });
                  setRemove(null);
                  toast.success("تم حذف الحالة");
                } catch (e) {
                  toast.error((e as Error).message);
                } finally {
                  setDeleting(false);
                }
              }}
            >
              حذف الحالة
            </AlertDialogAction>
            <AlertDialogCancel disabled={deleting}>إلغاء</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
