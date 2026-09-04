"use client";
import { useState } from "react";
import Link from "next/link";
import { Plus, Upload, PenLine, ArrowRight } from "lucide-react";
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
  type Employee,
  type Profile,
  type Reference,
  type Paged,
  type StatusRecord,
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
export function EmployeesPage({
  reference,
  user,
}: {
  reference: Reference;
  user: Profile;
}) {
  const [search, setSearch] = useState("");
  const [dep, setDep] = useState("");
  const [shift, setShift] = useState("");
  const [manager, setManager] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<Employee | null | undefined>(undefined);
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
                <Button asChild variant="outline">
                  <Link href="/import">
                    <Upload size={17} />
                    استيراد Excel
                  </Link>
                </Button>
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
    </>
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
  const [month, setMonth] = useState(baghdadDate().slice(0, 7));
  const [tab, setTab] = useState("all");
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState(false);
  const q = useData<Employee>("employee", { id });
  const records = useData<Paged<StatusRecord>>("records", {
    employee_id: id,
    month,
    page,
  });
  const rows =
    records.data?.rows.filter(
      (r) =>
        tab === "all" ||
        (tab === "absence"
          ? r.status_type.startsWith("absence")
          : r.status_type === tab),
    ) || [];
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
          q.data &&
          user.role !== "VIEWER" && (
            <Button variant="outline" onClick={() => setEdit(true)}>
              <PenLine size={16} />
              تعديل البيانات
            </Button>
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
      <section className="panel">
        <div className="history-toolbar">
          <Tabs value={tab} onValueChange={setTab} dir="rtl">
            <TabsList>
              <TabsTrigger value="all">السجل</TabsTrigger>
              <TabsTrigger value="absence">الغيابات</TabsTrigger>
              <TabsTrigger value="leave">الإجازات</TabsTrigger>
              <TabsTrigger value="late">التأخيرات</TabsTrigger>
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
        <Pager
          page={page}
          total={records.data?.total || 0}
          size={50}
          onChange={setPage}
        />
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
