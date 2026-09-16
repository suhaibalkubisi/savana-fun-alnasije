"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Check,
  Gavel,
  Keyboard,
  LayoutList,
  PenLine,
  Plus,
  Trash2,
  Zap,
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { mutate, useData } from "@/lib/hr/api";
import { statusSchema } from "@/lib/hr/validation";
import {
  baghdadDate,
  departmentLabel,
  statuses,
  type Employee,
  type Paged,
  type Reference,
  type StatusRecord,
  type StatusType,
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

const statusKeys = Object.keys(statuses) as StatusType[];

export function StatusPage({ reference }: { reference: Reference }) {
  const [date, setDate] = useState(baghdadDate());
  const [department, setDepartment] = useState(() => {
    if (typeof window === "undefined") return "";
    const saved = window.localStorage.getItem("hr-fast-department") || "";
    return reference.departments.some(
      (item) => item.id === saved && item.is_active,
    )
      ? saved
      : "";
  });
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [page, setPage] = useState(1);
  const chooseDepartment = (value: string) => {
    setDepartment(value);
    setPage(1);
    if (value) window.localStorage.setItem("hr-fast-department", value);
  };
  const q = useData<Paged<StatusRecord>>("records", {
    date,
    department_id: department,
    page,
  });
  return (
    <>
      <PageTitle
        title="تسجيل الحالة"
        subtitle="إدخال سريع للاستثناءات اليومية"
      />
      <div className="entry-mode no-print">
        <Tabs
          value={mode}
          onValueChange={(value) => setMode(value as typeof mode)}
          dir="rtl"
        >
          <TabsList>
            <TabsTrigger value="single">
              <Zap size={16} />
              إدخال فردي
            </TabsTrigger>
            <TabsTrigger value="bulk">
              <LayoutList size={16} />
              الإدخال السريع
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <span>
          <Keyboard size={15} />
          يدعم اختصارات لوحة المفاتيح
        </span>
      </div>
      {mode === "single" ? (
        <div className="status-layout">
          <section className="panel entry-panel fast-entry-panel">
            <div className="panel-heading">
              <h2>
                <Zap size={19} />
                حالة جديدة
              </h2>
              <span>حفظ وإدخال التالي</span>
            </div>
            <StatusForm
              reference={reference}
              initialDate={date}
              departmentId={department}
              onDepartment={chooseDepartment}
              onDate={(value) => {
                setDate(value);
                setPage(1);
              }}
            />
          </section>
          <RecentEntries
            date={date}
            department={department}
            data={q}
            reference={reference}
            page={page}
            setPage={setPage}
          />
        </div>
      ) : (
        <QuickBulkEntry
          key={`${date}:${department}`}
          reference={reference}
          date={date}
          department={department}
          onDate={setDate}
          onDepartment={chooseDepartment}
        />
      )}
    </>
  );
}

function RecentEntries({
  date,
  department,
  data,
  reference,
  page,
  setPage,
}: {
  date: string;
  department: string;
  data: ReturnType<typeof useData<Paged<StatusRecord>>>;
  reference: Reference;
  page: number;
  setPage: (value: number) => void;
}) {
  return (
    <section className="panel daily-panel">
      <div className="panel-heading">
        <h2>آخر الإدخالات</h2>
        <span dir="ltr">{date}</span>
      </div>
      <LoadState
        loading={data.loading && !data.data}
        error={data.error}
        retry={data.refresh}
        empty={!data.data?.rows.length}
        emptyText={
          department
            ? "لا توجد حالات مسجلة لهذا القسم"
            : "اختر القسم لعرض الإدخالات"
        }
      >
        <RecordTable
          rows={data.data?.rows || []}
          reference={reference}
          canWrite
        />
      </LoadState>
      <Pager
        size={50}
        total={data.data?.total || 0}
        page={page}
        onChange={setPage}
      />
    </section>
  );
}

function StatusButtons({
  value,
  onChange,
}: {
  value: StatusType | "";
  onChange: (value: StatusType) => void;
}) {
  return (
    <div className="status-button-grid" role="radiogroup" aria-label="الحالة">
      {statusKeys.map((key) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={value === key}
          className={`${statuses[key].className} ${value === key ? "selected" : ""}`}
          onClick={() => onChange(key)}
        >
          <span>{statuses[key].code}</span>
          <strong>{statuses[key].label}</strong>
        </button>
      ))}
    </div>
  );
}

export function StatusForm({
  reference,
  record,
  employee,
  initialDate,
  departmentId,
  onDepartment,
  onDate,
  onSaved,
}: {
  reference: Reference;
  record?: StatusRecord;
  employee?: Employee;
  initialDate?: string;
  departmentId?: string;
  onDepartment?: (value: string) => void;
  onDate?: (value: string) => void;
  onSaved?: () => void;
}) {
  const [data, setData] = useState({
    id: record?.id,
    version: record?.version,
    record_date: record?.record_date || initialDate || baghdadDate(),
    department_id: record?.department_id || departmentId || "",
    employee_id: record?.employee_id || "",
    status_type: record?.status_type || ("" as StatusType | ""),
    late_minutes:
      record?.late_minutes == null ? "" : String(record.late_minutes),
    notes: record?.notes || "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState<StatusRecord | null>(null);
  const [notesOpen, setNotesOpen] = useState(!!record?.notes);
  const formRef = useRef<HTMLFormElement>(null);
  const minutesRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (data.status_type === "late")
      window.setTimeout(() => minutesRef.current?.focus(), 30);
  }, [data.status_type]);
  useEffect(() => {
    if (record) return;
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
        target.isContentEditable
      )
        return;
      if (event.key === "/") {
        event.preventDefault();
        document.getElementById("fast-employee")?.focus();
        return;
      }
      const map: Record<string, StatusType> = {
        a: "absence",
        "2": "absence2",
        "3": "absence3",
        l: "leave",
        t: "late",
      };
      const selected = map[event.key.toLowerCase()];
      if (selected) {
        event.preventDefault();
        setData((current) => ({
          ...current,
          status_type: selected,
          late_minutes: selected === "late" ? current.late_minutes : "",
        }));
      }
      if (event.key === "Enter") {
        event.preventDefault();
        formRef.current?.requestSubmit();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [record]);
  let employees = reference.employees;
  if (employee && !employees.some((item) => item.id === employee.id))
    employees = [...employees, employee];
  const options = employees
    .filter((item) => item.department_id === data.department_id)
    .map((item) => ({
      value: item.id,
      label: `${item.name} — ${item.department} — ${item.employee_number || "سجل " + item.id.slice(0, 6)}`,
    }));
  if (record && !options.some((option) => option.value === record.employee_id))
    options.push({
      value: record.employee_id,
      label: `${record.employee_name} — ${record.department} — ${record.employee_number || "سجل " + record.employee_id.slice(0, 6)}`,
    });
  const selectStatus = (value: StatusType) =>
    setData((current) => ({
      ...current,
      status_type: value,
      late_minutes: value === "late" ? current.late_minutes : "",
    }));
  const editExisting = () => {
    if (!conflict) return;
    setData({
      id: conflict.id,
      version: conflict.version,
      record_date: conflict.record_date,
      department_id: conflict.department_id,
      employee_id: conflict.employee_id,
      status_type: conflict.status_type,
      late_minutes:
        conflict.late_minutes == null ? "" : String(conflict.late_minutes),
      notes: conflict.notes || "",
    });
    setConflict(null);
    setError("");
  };
  return (
    <>
      <form
        ref={formRef}
        className="form-stack status-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          const parsed = statusSchema.safeParse({
            ...data,
            status_type: data.status_type,
            late_minutes:
              data.status_type === "late"
                ? data.late_minutes === ""
                  ? null
                  : Number(data.late_minutes)
                : null,
            notes: data.notes || null,
          });
          if (!parsed.success) {
            setError(parsed.error.issues[0].message);
            return;
          }
          setBusy(true);
          try {
            const result = await mutate<
              StatusRecord | { conflict: true; record: StatusRecord }
            >("status.save", parsed.data);
            if ("conflict" in result) {
              setConflict(result.record);
              return;
            }
            toast.success(record ? "تم تحديث الحالة" : "تم حفظ الحالة بنجاح");
            if (onSaved) onSaved();
            else {
              setData((current) => ({
                ...current,
                id: undefined,
                version: undefined,
                employee_id: "",
                status_type: "",
                late_minutes: "",
                notes: "",
              }));
              setNotesOpen(false);
              window.setTimeout(
                () => document.getElementById("fast-employee")?.focus(),
                40,
              );
            }
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="status-core-fields">
          <Field label="التاريخ">
            <Input
              type="date"
              value={data.record_date}
              required
              onChange={(event) => {
                setData((current) => ({
                  ...current,
                  record_date: event.target.value,
                }));
                onDate?.(event.target.value);
              }}
            />
          </Field>
          <Choice
            label="القسم"
            value={data.department_id}
            onChange={(value) => {
              setData((current) => ({
                ...current,
                department_id: value,
                employee_id: "",
              }));
              onDepartment?.(value);
            }}
            empty="اختر القسم"
            disabled={!!data.id}
            options={reference.departments
              .filter(
                (department) =>
                  department.is_active || department.id === data.department_id,
              )
              .map((department) => ({
                value: department.id,
                label: departmentLabel(department),
              }))}
          />
        </div>
        <SearchPicker
          inputId="fast-employee"
          label="الموظف"
          value={data.employee_id}
          onChange={(value) =>
            setData((current) => ({ ...current, employee_id: value }))
          }
          options={options}
          disabled={!data.department_id || !!data.id}
        />
        <div className="field">
          <span className="field-label">الحالة</span>
          <StatusButtons value={data.status_type} onChange={selectStatus} />
        </div>
        {data.status_type === "late" && (
          <Field label="دقائق التأخير" className="late-minutes-field">
            <Input
              ref={minutesRef}
              type="number"
              min={0}
              max={10080}
              step={1}
              inputMode="numeric"
              required
              value={data.late_minutes}
              onChange={(event) =>
                setData((current) => ({
                  ...current,
                  late_minutes: event.target.value,
                }))
              }
              placeholder="مثال: 27"
            />
          </Field>
        )}
        {!notesOpen ? (
          <Button
            type="button"
            variant="ghost"
            className="notes-toggle"
            onClick={() => setNotesOpen(true)}
          >
            <Plus size={16} />
            إضافة ملاحظة
          </Button>
        ) : (
          <Field label="ملاحظات">
            <Textarea
              rows={2}
              value={data.notes}
              onChange={(event) =>
                setData((current) => ({
                  ...current,
                  notes: event.target.value,
                }))
              }
              maxLength={1000}
            />
          </Field>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy} className="w-full save-next">
          <Check size={18} />
          {busy ? "جار الحفظ…" : data.id ? "حفظ التعديل" : "حفظ وإدخال التالي"}
        </Button>
        {!record && (
          <div className="shortcut-hint">
            <kbd>/</kbd> بحث <kbd>A</kbd> غياب <kbd>2</kbd> غ×2 <kbd>3</kbd> غ×3{" "}
            <kbd>L</kbd> إجازة <kbd>T</kbd> تأخير
          </div>
        )}
      </form>
      <AlertDialog
        open={!!conflict}
        onOpenChange={(open) => !open && setConflict(null)}
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

type QuickValue = { status_type: StatusType | ""; late_minutes: string };
type BulkOperation =
  | {
      operation: "delete";
      data: { id: string; version: number; confirmed: true };
    }
  | {
      operation: "save";
      data: {
        id?: string;
        version?: number;
        employee_id: string;
        department_id: string;
        record_date: string;
        status_type: StatusType;
        late_minutes: number | null;
        notes: string | null;
      };
    };

function QuickBulkEntry({
  reference,
  date,
  department,
  onDate,
  onDepartment,
}: {
  reference: Reference;
  date: string;
  department: string;
  onDate: (value: string) => void;
  onDepartment: (value: string) => void;
}) {
  const q = useData<Paged<StatusRecord>>(
    "records",
    { date, department_id: department },
    !!department,
  );
  const employees = useMemo(
    () =>
      reference.employees.filter(
        (employee) => employee.department_id === department,
      ),
    [reference.employees, department],
  );
  const [values, setValues] = useState<Record<string, QuickValue>>({});
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const initial = useMemo(
    () =>
      Object.fromEntries(
        (q.data?.rows || []).map((record) => [
          record.employee_id,
          {
            status_type: record.status_type,
            late_minutes:
              record.late_minutes == null ? "" : String(record.late_minutes),
          },
        ]),
      ),
    [q.data],
  );
  const visible = employees.filter(
    (employee) =>
      !search ||
      employee.name.includes(search) ||
      (employee.employee_number || "")
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const hasInvalidLate = employees.some((employee) => {
    const value = values[employee.id] || initial[employee.id];
    if (value?.status_type !== "late") return false;
    const minutes = Number(value.late_minutes);
    return (
      value.late_minutes.trim() === "" ||
      !Number.isInteger(minutes) ||
      minutes < 0 ||
      minutes > 10080
    );
  });
  const changedItems = employees.reduce<BulkOperation[]>((items, employee) => {
    const before = initial[employee.id] || {
      status_type: "",
      late_minutes: "",
    };
    const after = values[employee.id] || before;
    if (
      before.status_type === after.status_type &&
      before.late_minutes === after.late_minutes
    )
      return items;
    const existing = q.data?.rows.find(
      (record) => record.employee_id === employee.id,
    );
    if (!after.status_type && existing) {
      items.push({
        operation: "delete",
        data: { id: existing.id, version: existing.version, confirmed: true },
      });
      return items;
    }
    if (!after.status_type) return items;
    items.push({
      operation: "save",
      data: {
        id: existing?.id,
        version: existing?.version,
        employee_id: employee.id,
        department_id: department,
        record_date: date,
        status_type: after.status_type,
        late_minutes:
          after.status_type === "late" ? Number(after.late_minutes) : null,
        notes: existing?.notes || null,
      },
    });
    return items;
  }, []);
  return (
    <section className="panel quick-entry-panel">
      <div className="quick-entry-head no-print">
        <Field label="التاريخ">
          <Input
            type="date"
            value={date}
            onChange={(event) => onDate(event.target.value)}
          />
        </Field>
        <Choice
          label="القسم"
          value={department}
          onChange={onDepartment}
          empty="اختر القسم"
          options={reference.departments
            .filter((item) => item.is_active)
            .map((item) => ({ value: item.id, label: departmentLabel(item) }))}
        />
        <Field label="بحث">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="اسم أو رقم الموظف"
          />
        </Field>
        <Button
          disabled={busy || !changedItems.length || hasInvalidLate}
          onClick={async () => {
            setBusy(true);
            try {
              await mutate("status.bulk", { items: changedItems });
              toast.success(`تم حفظ ${changedItems.length} تغيير`);
            } catch (error) {
              toast.error((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Check size={17} />
          {busy ? "جار الحفظ…" : `حفظ كل التغييرات (${changedItems.length})`}
        </Button>
        {hasInvalidLate && <p className="form-error">دقائق التأخير مطلوبة</p>}
      </div>
      <LoadState
        loading={q.loading && !q.data}
        error={q.error}
        retry={q.refresh}
        empty={!department || !visible.length}
        emptyText={
          department
            ? "لا يوجد موظفون مطابقون للبحث"
            : "اختر القسم لبدء الإدخال السريع"
        }
      >
        <div className="quick-employee-list">
          {visible.map((employee) => {
            const value = values[employee.id] ||
              initial[employee.id] || { status_type: "", late_minutes: "" };
            return (
              <div
                className={`quick-employee-row ${value.status_type ? "has-status" : ""}`}
                key={employee.id}
              >
                <div className="quick-person">
                  <span className="employee-mini-avatar">
                    {employee.name.slice(0, 1)}
                  </span>
                  <div>
                    <strong>{employee.name}</strong>
                    <small>
                      <bdi>
                        {employee.employee_number || employee.id.slice(0, 6)}
                      </bdi>
                    </small>
                  </div>
                </div>
                <div className="quick-statuses">
                  {statusKeys.map((key) => (
                    <button
                      type="button"
                      key={key}
                      aria-label={`${employee.name} ${statuses[key].label}`}
                      className={`${statuses[key].className} ${value.status_type === key ? "selected" : ""}`}
                      onClick={() =>
                        setValues((current) => ({
                          ...current,
                          [employee.id]: {
                            status_type: value.status_type === key ? "" : key,
                            late_minutes:
                              key === "late" ? value.late_minutes : "",
                          },
                        }))
                      }
                    >
                      {statuses[key].code}
                    </button>
                  ))}
                </div>
                {value.status_type === "late" ? (
                  <Input
                    className="quick-minutes"
                    type="number"
                    min={0}
                    max={10080}
                    inputMode="numeric"
                    placeholder="دقيقة"
                    value={value.late_minutes}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [employee.id]: {
                          ...value,
                          late_minutes: event.target.value,
                        },
                      }))
                    }
                  />
                ) : (
                  <span className="normal-label">
                    {value.status_type
                      ? statuses[value.status_type].label
                      : "حضور طبيعي"}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </LoadState>
    </section>
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
          {rows.map((record) => (
            <TableRow key={record.id}>
              <TableCell>
                <Link
                  href={`/employees/${record.employee_id}`}
                  className="font-medium"
                >
                  {record.employee_name}
                </Link>
                <small className="cell-secondary">
                  <bdi>{record.department}</bdi>
                </small>
              </TableCell>
              <TableCell dir="ltr">{record.record_date}</TableCell>
              <TableCell>
                <StatusBadge type={record.status_type} />
              </TableCell>
              <TableCell>{record.late_minutes ?? "—"}</TableCell>
              <TableCell className="notes-cell">
                {record.notes || "—"}
              </TableCell>
              {canWrite && (
                <TableCell>
                  <div className="row-actions">
                    <Button
                      asChild
                      variant="ghost"
                      size="icon"
                      aria-label={`إنشاء إجراء إداري لـ ${record.employee_name}`}
                    >
                      <Link
                        href={`/actions?employee_id=${record.employee_id}&record_id=${record.id}&date=${record.record_date}`}
                      >
                        <Gavel size={16} />
                      </Link>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`تعديل حالة ${record.employee_name}`}
                      onClick={() => setEdit(record)}
                    >
                      <PenLine size={16} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`حذف حالة ${record.employee_name}`}
                      onClick={() => setRemove(record)}
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
        <Dialog open onOpenChange={(open) => !open && setEdit(null)}>
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
        onOpenChange={(open) => !open && !deleting && setRemove(null)}
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
              onClick={async (event) => {
                event.preventDefault();
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
                } catch (error) {
                  toast.error((error as Error).message);
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
