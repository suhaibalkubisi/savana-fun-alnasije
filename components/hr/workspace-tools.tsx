"use client";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowUpLeft,
  Search,
  Plus,
  Fingerprint,
  Timer,
  Users,
  ClipboardCheck,
  CalendarDays,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useData, useDebounced } from "@/lib/hr/api";
import {
  baghdadDate,
  departmentLabel,
  type Reference,
  type Employee,
  type Paged,
  type AdministrativeAction,
} from "@/lib/hr/types";
import {
  operationalSummary,
  effectiveDepartmentRule,
} from "@/lib/hr/operational-summary.mjs";
import { Field, LoadState, PageTitle } from "./shared";
import { formatClock12 } from "@/lib/hr/time-format.mjs";

type DailyPerson = {
  employee_id: string;
  internal_code?: string | null;
  name: string;
  employee_number: string | null;
  person_code: string | null;
  department: string;
  status: string;
  expected: boolean;
  late_minutes: number;
  needs_review: boolean;
};
type Rule = {
  department_id: string;
  effective_from: string;
  default_manager_id: string | null;
  start_minute: number;
  grace_minutes: number;
  working_weekdays: number[];
};

export function WorkspaceTools({
  reference,
  canWrite,
}: {
  reference: Reference;
  canWrite: boolean;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [search, setSearch] = useState("");
  const delayed = useDebounced(search.trim());
  const enabled = searchOpen && delayed.length >= 2;
  const employees = useData<Paged<Employee>>(
    "employees",
    { search: delayed },
    enabled,
  );
  const identities = useData<{ rows: DailyPerson[] }>(
    "attendance.daily",
    { date: baghdadDate(), search: delayed },
    enabled,
  );
  const matching = (name: string) =>
    delayed.length >= 2 &&
    name.toLocaleLowerCase().includes(delayed.toLocaleLowerCase());
  const byId = new Map(
    (employees.data?.rows || []).map((e) => [
      e.id,
      {
        id: e.id,
        name: e.name,
        internal_code: e.internal_code,
        number: e.employee_number,
        department: e.department,
      },
    ]),
  );
  for (const e of identities.data?.rows || [])
    if (!byId.has(e.employee_id))
      byId.set(e.employee_id, {
        id: e.employee_id,
        name: e.name,
        internal_code: e.internal_code || undefined,
        number: e.person_code || e.employee_number,
        department: e.department,
      });
  const people = [...byId.values()].slice(0, 25);
  const departments = reference.departments.filter((d) =>
    matching(departmentLabel(d)),
  );
  const managers = reference.managers.filter((m) => matching(m.name));
  return (
    <div className="workspace-tools">
      <Button
        variant="outline"
        className="global-search-trigger"
        onClick={() => setSearchOpen(true)}
        aria-label="البحث العام"
      >
        <Search size={18} />
        <span className="tools-label">ابحث عن موظف، قسم أو مسؤول…</span>
      </Button>
      {canWrite && (
        <>
          <Button variant="outline" asChild aria-label="مهام الموارد البشرية">
            <Link href="/tasks">
              <ClipboardCheck size={18} />
            </Link>
          </Button>
          <Button aria-label="إجراء سريع" onClick={() => setQuickOpen(true)}>
            <Plus size={18} />
            <span className="tools-label">إجراء سريع</span>
          </Button>
        </>
      )}
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="global-search-dialog" dir="rtl">
          <DialogHeader>
            <DialogTitle>البحث العام</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            aria-label="البحث عن موظف أو قسم أو مسؤول"
            placeholder="اسم الموظف، رقمه، كود البصمة، القسم أو المسؤول"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {delayed.length < 2 ? (
            <p className="empty-simple">اكتب حرفين على الأقل</p>
          ) : (
            <LoadState
              loading={employees.loading || identities.loading}
              error={employees.error || identities.error}
              retry={() => {
                employees.refresh();
                identities.refresh();
              }}
              empty={!people.length && !departments.length && !managers.length}
              emptyText="لا توجد نتائج مطابقة"
            >
              <div className="search-results">
                {!!people.length && <h3>الموظفون</h3>}
                {people.map((e) => (
                  <Link
                    key={e.id}
                    href={`/employees/${e.id}`}
                    onClick={() => setSearchOpen(false)}
                  >
                    <Users size={17} />
                    <div>
                      <strong>{e.name}</strong>
                      {e.internal_code&&<bdi className="internal-code">{e.internal_code}</bdi>}
                      <small>
                        <bdi>{e.department}</bdi> · {e.number || "بلا رقم موظف"}
                      </small>
                    </div>
                    <ArrowUpLeft size={16} />
                  </Link>
                ))}
                {!!departments.length && <h3>الأقسام</h3>}
                {departments.map((d) => (
                  <Link
                    key={d.id}
                    href={`/employees?department_id=${d.id}`}
                    onClick={() => setSearchOpen(false)}
                  >
                    <bdi>{departmentLabel(d)}</bdi>
                    <ArrowUpLeft size={16} />
                  </Link>
                ))}
                {!!managers.length && <h3>المسؤولون</h3>}
                {managers.map((m) => (
                  <Link
                    key={m.id}
                    href={`/employees?manager_id=${m.id}`}
                    onClick={() => setSearchOpen(false)}
                  >
                    {m.name}
                    <ArrowUpLeft size={16} />
                  </Link>
                ))}
              </div>
            </LoadState>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={quickOpen} onOpenChange={setQuickOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>إجراء سريع — المسائي</DialogTitle>
          </DialogHeader>
          <div className="quick-action-grid">
            {[
              ["/employees?new=1", "إضافة موظف"],
              ["/fingerprint-daily", "رفع بصمة يومية"],
              ["/status", "تسجيل غياب أو إجازة أو تأخير"],
              ["/actions", "إجراء إداري"],
              ["/daily-position", "مراجعة الموقف اليومي"],
              ["/reports", "إنشاء تقرير"],
            ].map(([href, label]) => (
              <Button key={href} variant="outline" asChild>
                <Link href={href} onClick={() => setQuickOpen(false)}>
                  {label}
                  <ArrowUpLeft size={16} />
                </Link>
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function OperationsCenter() {
  const [date, setDate] = useState(baghdadDate());
  const daily = useData<{ rows: DailyPerson[] }>("attendance.daily", { date });
  const issues = useData<{ total: number }>("attendance.issues", {
    state: "open",
  });
  const actions = useData<Paged<AdministrativeAction>>(
    "administrative_actions",
    { month: date.slice(0, 7), state: "active" },
  );
  const totals = operationalSummary(daily.data?.rows || []);
  const cards = [
    {
      title: "بلا بصمة دخول",
      value: totals.noEntry,
      icon: Fingerprint,
      href: `/daily-position?date=${date}&status=no_entry`,
      description: "تحتاج مراجعة؛ لا تُعد غياباً تلقائياً",
    },
    {
      title: "المتأخرون",
      value: totals.late,
      icon: Timer,
      href: `/daily-position?date=${date}&status=late`,
      description: `${totals.lateMinutes} دقيقة تأخير`,
    },
    {
      title: "مشاكل المطابقة المفتوحة",
      value: issues.data?.total,
      icon: Users,
      href: "/fingerprint-issues",
      description: "جميع الاستيرادات غير المحسومة",
    },
    {
      title: "إجراءات مفتوحة هذا الشهر",
      value: actions.data?.total,
      icon: ClipboardCheck,
      href: `/actions?month=${date.slice(0, 7)}&state=active`,
      description: "متابعة الإجراءات الإدارية",
    },
  ];
  return (
    <>
      <PageTitle
        title="مركز مهام الموارد البشرية"
        subtitle="متابعة الشفت المسائي"
        actions={
          <Button asChild>
            <Link href="/fingerprint-daily">
              <Plus size={17} />
              رفع بصمة
            </Link>
          </Button>
        }
      />
      <section className="panel task-date">
        <Field label="تاريخ العمل">
          <Input
            type="date"
            value={date}
            onChange={(e) => {
              if (e.target.value) setDate(e.target.value);
            }}
          />
        </Field>
        <Button variant="outline" onClick={() => setDate(baghdadDate())}>
          اليوم
        </Button>
        <span>قرارات HR المعتمدة لها الأولوية</span>
      </section>
      <LoadState
        loading={
          (daily.loading && !daily.data) ||
          (issues.loading && !issues.data) ||
          (actions.loading && !actions.data)
        }
        error={daily.error || issues.error || actions.error}
        retry={() => {
          daily.refresh();
          issues.refresh();
          actions.refresh();
        }}
      >
        <div className="task-grid">
          {cards.map((c) => (
            <Link className="task-card" href={c.href} key={c.title}>
              <div className="task-card-top">
                <c.icon size={22} />
                <ArrowUpLeft size={18} />
              </div>
              <strong className="task-number">{c.value ?? "—"}</strong>
              <h2>{c.title}</h2>
              <p>{c.description}</p>
            </Link>
          ))}
        </div>
        <section className="panel">
          <div className="panel-heading">
            <h2>متابعة اليوم</h2>
            <Button variant="outline" asChild>
              <Link href={`/daily-position?date=${date}`}>
                فتح الموقف اليومي
              </Link>
            </Button>
          </div>
          <div className="operational-snapshot">
            <span>
              المتوقعون <b>{totals.expected}</b>
            </span>
            <span>
              الحاضرون <b>{totals.present}</b>
            </span>
            <span>
              الغياب <b>{totals.absence}</b>
            </span>
            <span>
              الإجازات <b>{totals.leave}</b>
            </span>
            <span>
              يحتاج مراجعة <b>{totals.review}</b>
            </span>
          </div>
        </section>
      </LoadState>
    </>
  );
}

export function OrganizationPage({
  reference,
  canConfigure,
}: {
  reference: Reference;
  canConfigure: boolean;
}) {
  const [date, setDate] = useState(baghdadDate());
  const rules = useData<Rule[]>("attendance.rules");
  return (
    <>
      <PageTitle
        title="الأقسام والمسؤولون"
        subtitle="توزيع الموظفين الحالي · الشفت المسائي"
        actions={
          canConfigure && (
            <Button asChild>
              <Link href="/attendance-settings">
                <CalendarDays size={17} />
                ضبط الدوام والمسؤول
              </Link>
            </Button>
          )
        }
      />
      <section className="panel task-date">
        <Field label="تاريخ سريان إعداد المسؤول والدوام">
          <Input
            type="date"
            value={date}
            onChange={(e) => {
              if (e.target.value) setDate(e.target.value);
            }}
          />
        </Field>
      </section>
      <LoadState
        loading={rules.loading && !rules.data}
        error={rules.error}
        retry={rules.refresh}
      >
        <div className="organization-grid">
          {reference.departments
            .filter((d) => d.is_active)
            .map((d) => {
              const r = effectiveDepartmentRule(
                rules.data || [],
                d.id,
                date,
              ) as Rule | null;
              const people = reference.employees.filter(
                (e) => e.department_id === d.id,
              );
              const manager = reference.managers.find(
                (m) => m.id === r?.default_manager_id,
              );
              return (
                <article className="panel organization-card" key={d.id}>
                  <div className="panel-heading">
                    <h2>
                      <bdi>{departmentLabel(d)}</bdi>
                    </h2>
                    <span className="department-total">
                      {people.length} موظف
                    </span>
                  </div>
                  <dl>
                    <div>
                      <dt>المسؤول الافتراضي</dt>
                      <dd>{manager?.name || "غير محدد"}</dd>
                    </div>
                    <div>
                      <dt>بداية الدوام</dt>
                      <dd dir="ltr">
                        {r ? formatClock12(r.start_minute) : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>دقائق السماح</dt>
                      <dd>{r ? r.grace_minutes : "—"}</dd>
                    </div>
                    <div>
                      <dt>استثناءات مسؤول الموظف</dt>
                      <dd>
                        {people.filter((e) => e.direct_manager_id).length}
                      </dd>
                    </div>
                  </dl>
                  <Button variant="outline" asChild>
                    <Link href={`/employees?department_id=${d.id}`}>
                      عرض الموظفين
                      <ArrowUpLeft size={17} />
                    </Link>
                  </Button>
                </article>
              );
            })}
        </div>
      </LoadState>
    </>
  );
}
