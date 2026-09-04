"use client";
import { useEffect, useState, type FormEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard,
  Users,
  CalendarPlus,
  Table2,
  Building2,
  ChartNoAxesCombined,
  ShieldCheck,
  History,
  Settings,
  LogOut,
  Plus,
  ArrowUpLeft,
  LockKeyhole,
  KeyRound,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { api, useData } from "@/lib/hr/api";
import {
  baghdadDate,
  monthLabel,
  type Profile,
  type Reference,
  type StatusRecord,
} from "@/lib/hr/types";
import { LoadState, PageTitle, StatusBadge, Field } from "./shared";
import { EmployeesPage, EmployeeDetail } from "./employees";
import { StatusPage } from "./status";
import { ReportPage } from "./reports";
import {
  AuditPage,
  ReviewPage,
  SettingsPage,
  UsersPage,
} from "./administration";
import { ImportPage } from "./import";
const navigation = [
  { path: "/", label: "الرئيسية", icon: LayoutDashboard },
  { path: "/employees", label: "الموظفون", icon: Users },
  { path: "/status", label: "تسجيل الحالة", icon: CalendarPlus, write: true },
  { path: "/monthly", label: "الموقف الشامل", icon: Table2 },
  { path: "/departments", label: "موقف الأقسام", icon: Building2 },
  { path: "/summary", label: "ملخص الموظفين", icon: ChartNoAxesCombined },
  { path: "/review", label: "المراجعة", icon: ShieldCheck, write: true },
  { path: "/audit", label: "سجل التعديلات", icon: History, admin: true },
  { path: "/users", label: "المستخدمون", icon: Users, admin: true },
  { path: "/settings", label: "الإعدادات", icon: Settings, admin: true },
];
export function HRApp() {
  const [user, setUser] = useState<Profile | null>(null);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [password, setPassword] = useState(false);
  async function load() {
    try {
      const r = await api<{ configured: boolean; user: Profile | null }>(
        "/api/auth",
      );
      setConfigured(r.configured);
      setUser(r.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let mounted = true;
    api<{ configured: boolean; user: Profile | null }>("/api/auth")
      .then((r) => {
        if (mounted) {
          setConfigured(r.configured);
          setUser(r.user);
        }
      })
      .catch((e: Error) => {
        if (mounted) setError(e.message);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    const expired = () => setUser(null);
    window.addEventListener("hr-session-expired", expired);
    return () => {
      mounted = false;
      window.removeEventListener("hr-session-expired", expired);
    };
  }, []);
  if (loading)
    return (
      <div className="auth-loading">
        <div className="brand-icon">HR</div>
        <LoadState loading>{null}</LoadState>
      </div>
    );
  if (!user)
    return (
      <>
        <Login
          configured={configured}
          error={error}
          onLogin={setUser}
          retry={load}
        />
        <Toaster position="top-center" dir="rtl" />
      </>
    );
  return (
    <>
      <SidebarProvider>
        <Navigation
          user={user}
          onLogout={async () => {
            await api("/api/auth", { action: "logout" });
            setUser(null);
          }}
          onPassword={() => setPassword(true)}
        />
        <main className="app-main">
          <Workspace user={user} />
        </main>
      </SidebarProvider>
      <PasswordDialog open={password} onClose={() => setPassword(false)} />
      <Toaster position="top-center" dir="rtl" richColors />
    </>
  );
}
function Login({
  configured,
  error,
  onLogin,
  retry,
}: {
  configured: boolean;
  error: string;
  onLogin: (u: Profile) => void;
  retry: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [localError, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const r = await api<{ user: Profile }>("/api/auth", {
        email: form.get("email"),
        password: form.get("password"),
      });
      onLogin(r.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <div className="login-brand">
        <div className="brand-icon">HR</div>
        <span>إدارة الموارد البشرية</span>
      </div>
      <section className="login-card">
        <div className="login-lock">
          <LockKeyhole size={27} />
        </div>
        <p className="eyebrow">HR MANAGEMENT SYSTEM</p>
        <h1>تسجيل الدخول</h1>
        <form onSubmit={submit}>
          <Field label="البريد الإلكتروني">
            <Input
              name="email"
              type="email"
              dir="ltr"
              autoComplete="username"
              placeholder="name@company.com"
              required
            />
          </Field>
          <Field label="كلمة المرور">
            <Input
              name="password"
              type="password"
              dir="ltr"
              autoComplete="current-password"
              required
            />
          </Field>
          {(!configured || localError || error) && (
            <p role="alert" className="form-error">
              {!configured ? "الخدمة غير مهيأة حالياً" : localError || error}
            </p>
          )}
          <Button
            className="w-full"
            type="submit"
            disabled={busy || !configured}
          >
            {busy ? "جار تسجيل الدخول…" : "تسجيل الدخول"}
            <ArrowUpLeft size={17} />
          </Button>
        </form>
        {error && (
          <Button variant="ghost" onClick={retry}>
            إعادة المحاولة
          </Button>
        )}
      </section>
      <p className="login-footer">قسم الموارد البشرية</p>
    </main>
  );
}
function Navigation({
  user,
  onLogout,
  onPassword,
}: {
  user: Profile;
  onLogout: () => Promise<void>;
  onPassword: () => void;
}) {
  const path = usePathname();
  const { setOpenMobile } = useSidebar();
  return (
    <Sidebar side="right" className="hr-sidebar">
      <SidebarHeader>
        <Link href="/" className="brand">
          <div className="brand-icon">HR</div>
          <div>
            <strong>الموارد البشرية</strong>
            <small>مساحة العمل</small>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <p className="nav-heading">إدارة العمل</p>
        <SidebarMenu>
          {navigation
            .filter(
              (n) =>
                (!n.admin || user.role === "ADMIN") &&
                (!n.write || user.role !== "VIEWER"),
            )
            .map((n) => (
              <SidebarMenuItem key={n.path}>
                <SidebarMenuButton
                  asChild
                  isActive={
                    path === n.path ||
                    (n.path === "/employees" && path.startsWith("/employees/"))
                  }
                  className="nav-item"
                >
                  <Link href={n.path} onClick={() => setOpenMobile(false)}>
                    <n.icon size={19} />
                    <span>{n.label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter>
        <div className="sidebar-user">
          <div className="avatar">{user.name.slice(0, 1)}</div>
          <div>
            <strong>{user.name}</strong>
            <small>
              {user.role === "ADMIN"
                ? "مدير النظام"
                : user.role === "HR"
                  ? "الموارد البشرية"
                  : "عرض فقط"}
            </small>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onPassword}
            aria-label="تغيير كلمة المرور"
          >
            <KeyRound size={17} />
          </Button>
        </div>
        <Button
          variant="ghost"
          onClick={() => void onLogout().catch((e) => toast.error(e.message))}
          className="logout"
        >
          <LogOut size={17} />
          تسجيل الخروج
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
function Workspace({ user }: { user: Profile }) {
  const path = usePathname();
  const router = useRouter();
  const ref = useData<Reference>("reference");
  const nav = navigation.find((n) => n.path === path);
  let content;
  if (
    (nav?.admin && user.role !== "ADMIN") ||
    (nav?.write && user.role === "VIEWER") ||
    (path === "/import" && user.role !== "ADMIN")
  )
    content = <div className="error-state">ليست لديك صلاحية لهذه الصفحة</div>;
  else if (!ref.data)
    content = (
      <LoadState loading={ref.loading} error={ref.error} retry={ref.refresh}>
        {null}
      </LoadState>
    );
  else if (path === "/")
    content = <Dashboard canWrite={user.role !== "VIEWER"} />;
  else if (path === "/employees")
    content = <EmployeesPage reference={ref.data} user={user} />;
  else if (path.startsWith("/employees/"))
    content = (
      <EmployeeDetail
        id={path.split("/")[2]}
        reference={ref.data}
        user={user}
      />
    );
  else if (path === "/status") content = <StatusPage reference={ref.data} />;
  else if (["/monthly", "/departments", "/summary"].includes(path))
    content = (
      <ReportPage
        mode={
          path === "/summary"
            ? "summary"
            : path === "/departments"
              ? "department"
              : "monthly"
        }
        reference={ref.data}
      />
    );
  else if (path === "/review") content = <ReviewPage />;
  else if (path === "/audit") content = <AuditPage />;
  else if (path === "/settings")
    content = <SettingsPage reference={ref.data} />;
  else if (path === "/users") content = <UsersPage />;
  else if (path === "/import") content = <ImportPage />;
  else
    content = (
      <div className="error-state">
        <h1>الصفحة غير موجودة</h1>
        <Button onClick={() => router.push("/")}>الرئيسية</Button>
      </div>
    );
  return (
    <>
      <header className="topbar no-print">
        <div className="topbar-title">
          <SidebarTrigger aria-label="القائمة" className="mobile-toggle" />
          <span>{ref.data?.app_name || "إدارة الموارد البشرية"}</span>
          <span className="topbar-divider" />
          <span className="topbar-muted">{nav?.label || "الموظفون"}</span>
        </div>
        <div className="header-date">
          {new Intl.DateTimeFormat("ar-IQ", {
            dateStyle: "full",
            timeZone: "Asia/Baghdad",
          }).format(new Date())}
        </div>
      </header>
      <div className="workspace" key={path}>
        {content}
      </div>
    </>
  );
}
interface DashboardData {
  active: number;
  absence: number;
  leave: number;
  late: number;
  review: number;
  today: string;
  recent: StatusRecord[];
  departments: { id: string; name: string; count: number }[];
}
function Dashboard({ canWrite }: { canWrite: boolean }) {
  const q = useData<DashboardData>("dashboard");
  const cards = [
    ["الموظفون النشطون", "active", Users, "indigo"],
    ["الغيابات اليوم", "absence", CalendarPlus, "red"],
    ["الإجازات اليوم", "leave", CalendarPlus, "blue"],
    ["التأخيرات اليوم", "late", History, "amber"],
    ["تحتاج مراجعة", "review", ShieldCheck, "gray"],
  ] as const;
  return (
    <>
      <PageTitle
        title="نظرة عامة"
        subtitle={monthLabel(baghdadDate().slice(0, 7))}
        actions={
          canWrite && (
            <Button asChild>
              <Link href="/status">
                <Plus size={18} />
                تسجيل حالة
              </Link>
            </Button>
          )
        }
      />
      <LoadState
        loading={q.loading && !q.data}
        error={q.error}
        retry={q.refresh}
      >
        <section className="kpi-grid">
          {cards.map(([label, key, Icon, color]) => (
            <article className="kpi-card" key={key}>
              <div className={`kpi-icon ${color}`}>
                <Icon size={20} />
              </div>
              <p>{label}</p>
              <strong>{q.data?.[key] ?? 0}</strong>
              <span className="kpi-caption">
                {key === "active" ? "موظف" : key === "review" ? "سجل" : "حالة"}
              </span>
            </article>
          ))}
        </section>
        <div className="dashboard-grid">
          <section className="panel">
            <div className="panel-heading">
              <h2>آخر الحالات المسجلة</h2>
              <Link href="/monthly">
                عرض الموقف
                <ArrowUpLeft size={15} />
              </Link>
            </div>
            <LoadState
              loading={false}
              empty={!q.data?.recent.length}
              emptyText="لا توجد حالات مسجلة"
            >
              {q.data?.recent.map((r) => (
                <div className="recent-row" key={r.id}>
                  <div className="employee-mini-avatar">
                    {r.employee_name.slice(0, 1)}
                  </div>
                  <div className="recent-person">
                    <Link href={`/employees/${r.employee_id}`}>
                      {r.employee_name}
                    </Link>
                    <span>
                      <bdi>{r.department}</bdi>
                    </span>
                  </div>
                  <StatusBadge type={r.status_type} />
                  <time>{r.record_date}</time>
                </div>
              ))}
            </LoadState>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>توزيع الموظفين</h2>
              <span>حسب القسم</span>
            </div>
            <div className="department-counts">
              {q.data?.departments.map((d) => (
                <Link
                  href={`/departments?department_id=${d.id}`}
                  className="department-count"
                  key={d.id}
                >
                  <div>
                    <bdi>{d.name}</bdi>
                    <strong>{d.count}</strong>
                  </div>
                  <div className="count-track">
                    <span
                      style={{
                        width: `${(d.count / Math.max(...q.data!.departments.map((x) => x.count), 1)) * 100}%`,
                      }}
                    />
                  </div>
                </Link>
              ))}
            </div>
          </section>
        </div>
      </LoadState>
    </>
  );
}
function PasswordDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle>تغيير كلمة المرور</DialogTitle>
        </DialogHeader>
        <form
          className="form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            setBusy(true);
            try {
              await api("/api/auth", {
                action: "password",
                password: data.get("password"),
              });
              toast.success("تم تغيير كلمة المرور");
              onClose();
            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="كلمة المرور الجديدة">
            <Input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={200}
              required
            />
          </Field>
          <Button disabled={busy}>حفظ</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
