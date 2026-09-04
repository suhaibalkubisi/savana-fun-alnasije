"use client";
import { useState } from "react";
import Link from "next/link";
import { Plus, PenLine, ArrowUpLeft, Eye, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
  TableRow,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { api, changed, mutate, useData, useDebounced } from "@/lib/hr/api";
import {
  auditDate,
  departmentLabel,
  employmentLabels,
  statuses,
  type AuditLog,
  type Department,
  type Lookup,
  type Paged,
  type Profile,
  type Reference,
  type ReviewIssue,
} from "@/lib/hr/types";
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
export function ReviewPage() {
  const q = useData<ReviewIssue[]>("review");
  return (
    <>
      <PageTitle
        title="المراجعة"
        subtitle={
          q.data ? `${q.data.length} سجل يحتاج استكمال البيانات` : undefined
        }
      />
      <section className="panel">
        <LoadState
          loading={q.loading && !q.data}
          error={q.error}
          retry={q.refresh}
          empty={!q.data?.length}
          emptyText="لا توجد حالات تحتاج مراجعة"
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الموظف</TableHead>
                <TableHead>القسم</TableHead>
                <TableHead>نوع المشكلة</TableHead>
                <TableHead>الإجراء</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data?.map((x) => (
                <TableRow key={x.employee_id}>
                  <TableCell>{x.name}</TableCell>
                  <TableCell>
                    <bdi>{x.department}</bdi>
                  </TableCell>
                  <TableCell>
                    <span className="review-label">{x.issue}</span>
                  </TableCell>
                  <TableCell>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/employees/${x.employee_id}`}>
                        استكمال البيانات
                        <ArrowUpLeft size={15} />
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </LoadState>
      </section>
    </>
  );
}
const auditLabels: Record<string, string> = {
  name: "الاسم",
  employee_number: "رقم الموظف",
  department_id: "القسم",
  shift_id: "الشفت",
  direct_manager_id: "المسؤول المباشر",
  employment_status: "حالة الموظف",
  record_date: "التاريخ",
  status_type: "الحالة",
  late_minutes: "دقائق التأخير",
  notes: "ملاحظات",
  deleted_at: "تاريخ الحذف",
  arabic_name: "الاسم العربي",
  english_name: "الاسم الإنجليزي",
  display_order: "الترتيب",
  is_active: "نشط",
  role: "الصلاحية",
  email: "البريد الإلكتروني",
  employee_id: "الموظف المرتبط",
  value: "القيمة",
};
export function AuditPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AuditLog | null>(null);
  const q = useData<Paged<AuditLog>>("audit", {
    search: useDebounced(search),
    page,
  });
  const ref = useData<Reference>("reference");
  function display(key: string, value: unknown) {
    if (value === null || value === undefined || value === "") return "—";
    if (typeof value === "boolean") return value ? "نعم" : "لا";
    if (key === "department_id")
      return ref.data?.departments.find((x) => x.id === value)
        ? departmentLabel(ref.data!.departments.find((x) => x.id === value)!)
        : String(value);
    if (key === "shift_id")
      return (
        ref.data?.shifts.find((x) => x.id === value)?.name || String(value)
      );
    if (key === "direct_manager_id")
      return (
        ref.data?.managers.find((x) => x.id === value)?.name || String(value)
      );
    if (key === "employee_id")
      return (
        ref.data?.employees.find((x) => x.id === value)?.name || String(value)
      );
    if (key === "employment_status")
      return (
        employmentLabels[value as keyof typeof employmentLabels] ||
        String(value)
      );
    if (key === "status_type")
      return statuses[value as keyof typeof statuses]?.label || String(value);
    return String(value);
  }
  return (
    <>
      <PageTitle title="سجل التعديلات" />
      <section className="panel">
        <div className="filterbar">
          <SearchBox
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
          />
        </div>
        <LoadState
          loading={q.loading && !q.data}
          error={q.error}
          retry={q.refresh}
          empty={!q.data?.rows.length}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الوقت — بغداد</TableHead>
                <TableHead>المستخدم</TableHead>
                <TableHead>العملية</TableHead>
                <TableHead>التفاصيل</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data?.rows.map((x) => (
                <TableRow key={x.id}>
                  <TableCell>{auditDate(x.created_at)}</TableCell>
                  <TableCell>{x.actor_name}</TableCell>
                  <TableCell>{x.description}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="عرض تفاصيل التعديل"
                      onClick={() => setSelected(x)}
                    >
                      <Eye size={17} />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </LoadState>
        <Pager
          page={page}
          size={50}
          total={q.data?.total || 0}
          onChange={setPage}
        />
      </section>
      <Dialog open={!!selected} onOpenChange={(v) => !v && setSelected(null)}>
        <DialogContent dir="rtl" className="audit-dialog">
          <DialogHeader>
            <DialogTitle>{selected?.description}</DialogTitle>
            <DialogDescription>
              {selected?.actor_name} ·{" "}
              {selected && auditDate(selected.created_at)}
            </DialogDescription>
          </DialogHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الحقل</TableHead>
                <TableHead>قبل التعديل</TableHead>
                <TableHead>بعد التعديل</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {selected &&
                Object.entries(auditLabels)
                  .filter(
                    ([key]) =>
                      JSON.stringify(selected.old_values?.[key]) !==
                      JSON.stringify(selected.new_values?.[key]),
                  )
                  .map(([key, label]) => (
                    <TableRow key={key}>
                      <TableCell>{label}</TableCell>
                      <TableCell className="audit-value">
                        <bdi>{display(key, selected.old_values?.[key])}</bdi>
                      </TableCell>
                      <TableCell className="audit-value">
                        <bdi>{display(key, selected.new_values?.[key])}</bdi>
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
          <small className="muted">
            مرجع السجل: <bdi>{selected?.entity_id}</bdi>
          </small>
        </DialogContent>
      </Dialog>
    </>
  );
}
export function UsersPage() {
  const q = useData<Profile[]>("users");
  const [edit, setEdit] = useState<Profile | null | undefined>(undefined);
  return (
    <>
      <PageTitle
        title="المستخدمون"
        actions={
          <Button onClick={() => setEdit(null)}>
            <Plus size={18} />
            إضافة مستخدم
          </Button>
        }
      />
      <section className="panel">
        <LoadState
          loading={q.loading && !q.data}
          error={q.error}
          retry={q.refresh}
          empty={!q.data?.length}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الاسم</TableHead>
                <TableHead>البريد الإلكتروني</TableHead>
                <TableHead>الصلاحية</TableHead>
                <TableHead>الوصول</TableHead>
                <TableHead>الإجراء</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data?.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>{u.name}</TableCell>
                  <TableCell>
                    <bdi>{u.email}</bdi>
                  </TableCell>
                  <TableCell>
                    {u.role === "ADMIN"
                      ? "مدير النظام"
                      : u.role === "HR"
                        ? "موارد بشرية"
                        : "مشاهدة فقط"}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`employment-badge employment-${u.is_active ? "active" : "inactive"}`}
                    >
                      {u.is_active ? "مفعل" : "معطل"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`تعديل المستخدم ${u.name}`}
                      onClick={() => setEdit(u)}
                    >
                      <PenLine size={16} />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </LoadState>
      </section>
      {edit !== undefined && (
        <UserEditor user={edit} onClose={() => setEdit(undefined)} />
      )}
    </>
  );
}
function UserEditor({
  user,
  onClose,
}: {
  user: Profile | null;
  onClose: () => void;
}) {
  const [role, setRole] = useState(user?.role || "HR");
  const [active, setActive] = useState(user?.is_active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle>{user ? "تعديل المستخدم" : "إضافة مستخدم"}</DialogTitle>
          <DialogDescription className="sr-only">
            بيانات حساب المستخدم وصلاحياته
          </DialogDescription>
        </DialogHeader>
        <form
          className="form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            setError("");
            try {
              if (user)
                await mutate("user.save", {
                  ...user,
                  name: f.get("name"),
                  role,
                  is_active: active,
                });
              else {
                await api("/api/users", {
                  name: f.get("name"),
                  email: f.get("email"),
                  password: f.get("password"),
                  role,
                });
                changed();
              }
              toast.success("تم حفظ المستخدم");
              onClose();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="الاسم">
            <Input
              name="name"
              defaultValue={user?.name}
              required
              maxLength={150}
            />
          </Field>
          <Field label="البريد الإلكتروني">
            <Input
              type="email"
              name="email"
              dir="ltr"
              defaultValue={user?.email}
              readOnly={!!user}
              required
              autoComplete="off"
            />
          </Field>
          {!user && (
            <Field label="كلمة المرور">
              <Input
                type="password"
                name="password"
                dir="ltr"
                minLength={12}
                maxLength={200}
                autoComplete="new-password"
                required
              />
            </Field>
          )}
          <Choice
            label="الصلاحية"
            value={role}
            onChange={(v) => setRole(v as Profile["role"])}
            empty="اختر الصلاحية"
            options={[
              { value: "ADMIN", label: "مدير النظام" },
              { value: "HR", label: "موارد بشرية" },
              { value: "VIEWER", label: "مشاهدة فقط" },
            ]}
          />
          {user && (
            <label className="switch-label">
              الوصول مفعل
              <Switch checked={active} onCheckedChange={setActive} />
            </label>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <Button disabled={busy}>حفظ</Button>
            <Button type="button" variant="outline" onClick={onClose}>
              إلغاء
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
type SettingKind = "department" | "shift" | "manager";
export function SettingsPage({ reference }: { reference: Reference }) {
  const [tab, setTab] = useState<SettingKind | "app" | "status">("department");
  const [edit, setEdit] = useState<{
    kind: SettingKind;
    item?: Department | Lookup;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const list =
    tab === "department"
      ? reference.departments
      : tab === "shift"
        ? reference.shifts
        : reference.managers;
  return (
    <>
      <PageTitle title="الإعدادات" />
      <section className="panel settings-panel">
        <div className="settings-tabs">
          <Tabs
            dir="rtl"
            value={tab}
            onValueChange={(v) => setTab(v as typeof tab)}
          >
            <TabsList>
              <TabsTrigger value="department">الأقسام</TabsTrigger>
              <TabsTrigger value="shift">الشفتات</TabsTrigger>
              <TabsTrigger value="manager">المسؤولون المباشرون</TabsTrigger>
              <TabsTrigger value="status">أنواع الحالات</TabsTrigger>
              <TabsTrigger value="app">عام</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        {["department", "shift", "manager"].includes(tab) ? (
          <>
            <div className="panel-heading">
              <h2>
                {tab === "department"
                  ? "الأقسام وترتيب العرض"
                  : tab === "shift"
                    ? "الشفتات"
                    : "المسؤولون المباشرون"}
              </h2>
              <Button
                size="sm"
                onClick={() => setEdit({ kind: tab as SettingKind })}
              >
                <Plus size={16} />
                إضافة
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    {tab === "department" ? "القسم" : "الاسم"}
                  </TableHead>
                  {tab === "department" && <TableHead>ترتيب العرض</TableHead>}
                  <TableHead>الحالة</TableHead>
                  <TableHead>الإجراء</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <bdi>
                        {"arabic_name" in item
                          ? departmentLabel(item)
                          : item.name}
                      </bdi>
                    </TableCell>
                    {"display_order" in item && (
                      <TableCell>{item.display_order}</TableCell>
                    )}
                    <TableCell>{item.is_active ? "نشط" : "غير نشط"}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="تعديل الإعداد"
                        onClick={() =>
                          setEdit({ kind: tab as SettingKind, item })
                        }
                      >
                        <PenLine size={16} />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {list.length === 0 && <p className="empty-simple">لا توجد سجلات</p>}
          </>
        ) : tab === "status" ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الحالة</TableHead>
                <TableHead>الرمز</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.keys(statuses).map((key) => (
                <TableRow key={key}>
                  <TableCell>
                    <StatusBadge type={key as keyof typeof statuses} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge type={key as keyof typeof statuses} code />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <form
            className="settings-general form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await mutate("app.save", {
                  version: reference.app_version,
                  name: new FormData(e.currentTarget).get("name"),
                });
                toast.success("تم حفظ الإعدادات");
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="اسم النظام">
              <Input
                name="name"
                defaultValue={reference.app_name}
                required
                maxLength={150}
              />
            </Field>
            <Button disabled={busy}>
              <Check size={17} />
              حفظ الإعدادات
            </Button>
          </form>
        )}
      </section>
      {edit && (
        <SettingEditor
          kind={edit.kind}
          item={edit.item}
          reference={reference}
          onClose={() => setEdit(null)}
        />
      )}
    </>
  );
}
function SettingEditor({
  kind,
  item,
  reference,
  onClose,
}: {
  kind: SettingKind;
  item?: Department | Lookup;
  reference: Reference;
  onClose: () => void;
}) {
  const [active, setActive] = useState(item?.is_active ?? true);
  const [linked, setLinked] = useState(
    item && "employee_id" in item ? item.employee_id || "" : "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const department = item && "arabic_name" in item ? item : undefined;
  const lookup = item && "name" in item ? item : undefined;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle>
            {item ? "تعديل" : "إضافة"}{" "}
            {kind === "department"
              ? "قسم"
              : kind === "shift"
                ? "شفت"
                : "مسؤول مباشر"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            إعدادات النظام
          </DialogDescription>
        </DialogHeader>
        <form
          className="form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const data = {
              id: item?.id,
              version: item?.version,
              is_active: active,
              ...(kind === "department"
                ? {
                    arabic_name: f.get("arabic_name"),
                    english_name: f.get("english_name"),
                    display_order: Number(f.get("display_order")),
                  }
                : {
                    name:
                      kind === "manager" && linked
                        ? reference.employees.find((e) => e.id === linked)!.name
                        : f.get("name"),
                    ...(kind === "manager"
                      ? { employee_id: linked || null }
                      : {}),
                  }),
            };
            setBusy(true);
            setError("");
            try {
              await mutate(`${kind}.save`, data);
              toast.success("تم حفظ الإعدادات");
              onClose();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {kind === "department" ? (
            <>
              <Field label="اسم القسم بالعربي">
                <Input
                  name="arabic_name"
                  defaultValue={department?.arabic_name}
                  required
                  maxLength={100}
                />
              </Field>
              <Field label="اسم القسم بالإنجليزي">
                <Input
                  name="english_name"
                  dir="ltr"
                  defaultValue={department?.english_name}
                  required
                  maxLength={100}
                />
              </Field>
              <Field label="ترتيب العرض">
                <Input
                  name="display_order"
                  type="number"
                  min={0}
                  max={10000}
                  defaultValue={
                    department?.display_order ??
                    reference.departments.length + 1
                  }
                  required
                />
              </Field>
            </>
          ) : (
            <>
              {kind === "manager" && (
                <SearchPicker
                  label="ربط بموظف"
                  value={linked}
                  onChange={setLinked}
                  options={reference.employees.map((e) => ({
                    value: e.id,
                    label: `${e.name} — ${e.department}`,
                  }))}
                />
              )}
              <Field label="الاسم">
                <Input
                  name="name"
                  key={linked}
                  defaultValue={
                    linked
                      ? reference.employees.find((e) => e.id === linked)?.name
                      : lookup?.name
                  }
                  required
                  readOnly={kind === "manager" && !!linked}
                  maxLength={150}
                />
              </Field>
            </>
          )}
          <label className="switch-label">
            نشط
            <Switch checked={active} onCheckedChange={setActive} />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <Button disabled={busy}>حفظ</Button>
            <Button type="button" variant="outline" onClick={onClose}>
              إلغاء
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
