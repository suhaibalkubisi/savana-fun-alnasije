"use client";
import {
  useEffect,
  useState,
  lazy,
  Suspense,
  Component,
  type ReactNode,
  type FormEvent,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
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
  Timer,
  CalendarX2,
  Gavel,
  FileBarChart,
  Eye,
  EyeOff,
  ListChecks,
  Network,
  Fingerprint,
  ClipboardCheck,
  Moon,
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
  type AdministrativeAction,
} from "@/lib/hr/types";
import { LoadState, PageTitle, StatusBadge, Field } from "./shared";
import { WorkspaceTools } from "./workspace-tools";
import { BrandImage } from "./brand-image";
const EmployeesPage = lazy(() =>
  import("./employees").then((m) => ({ default: m.EmployeesPage })),
);
const EmployeeDetail = lazy(() =>
  import("./employees").then((m) => ({ default: m.EmployeeDetail })),
);
const StatusPage = lazy(() =>
  import("./status").then((m) => ({ default: m.StatusPage })),
);
const ReportPage = lazy(() =>
  import("./reports").then((m) => ({ default: m.ReportPage })),
);
const AuditPage = lazy(() =>
  import("./administration").then((m) => ({ default: m.AuditPage })),
);
const ReviewPage = lazy(() =>
  import("./administration").then((m) => ({ default: m.ReviewPage })),
);
const SettingsPage = lazy(() =>
  import("./administration").then((m) => ({ default: m.SettingsPage })),
);
const UsersPage = lazy(() =>
  import("./administration").then((m) => ({ default: m.UsersPage })),
);
const ImportPage = lazy(() =>
  import("./import").then((m) => ({ default: m.ImportPage })),
);
const OperationsCenter = lazy(() =>
  import("./workspace-tools").then((m) => ({ default: m.OperationsCenter })),
);
const OrganizationPage = lazy(() =>
  import("./workspace-tools").then((m) => ({ default: m.OrganizationPage })),
);
const AttendanceReport = lazy(() =>
  import("./attendance").then((m) => ({ default: m.AttendanceReport })),
);
const FingerprintImport = lazy(() =>
  import("./attendance").then((m) => ({ default: m.FingerprintImport })),
);
const FingerprintIssues = lazy(() =>
  import("./attendance").then((m) => ({ default: m.FingerprintIssues })),
);
const AttendanceRules = lazy(() =>
  import("./attendance").then((m) => ({ default: m.AttendanceRules })),
);
const AbsenceLeavePage = lazy(() =>
  import("./operations").then((m) => ({ default: m.AbsenceLeavePage })),
);
const AdministrativeActionsPage = lazy(() =>
  import("./operations").then((m) => ({
    default: m.AdministrativeActionsPage,
  })),
);
const CentralReportsPage = lazy(() =>
  import("./operations").then((m) => ({ default: m.CentralReportsPage })),
);
const LatenessPage = lazy(() =>
  import("./operations").then((m) => ({ default: m.LatenessPage })),
);

class PageBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="error-state" role="alert">
        <p>تعذر عرض الصفحة. أعد تحميلها للمحاولة مجدداً</p>
        <Button onClick={() => window.location.reload()}>إعادة التحميل</Button>
      </div>
    ) : (
      this.props.children
    );
  }
}
const navigation = [
  { path: "/", label: "الرئيسية", icon: LayoutDashboard, group: "مساحة العمل" },
  {
    path: "/tasks",
    label: "مهام الموارد البشرية",
    icon: ListChecks,
    group: "مساحة العمل",
    write: true,
  },
  {
    path: "/organization",
    label: "الأقسام والمسؤولون",
    icon: Network,
    group: "مساحة العمل",
  },
  {
    path: "/daily-dashboard",
    label: "الداشبورد اليومي",
    icon: LayoutDashboard,
    group: "مساحة العمل",
  },
  {
    path: "/monthly-dashboard",
    label: "الداشبورد الشهري",
    icon: ChartNoAxesCombined,
    group: "مساحة العمل",
  },
  { path: "/employees", label: "الموظفون", icon: Users, group: "مساحة العمل" },
  {
    path: "/status",
    label: "تسجيل الحالة",
    icon: CalendarPlus,
    write: true,
    group: "العمليات",
  },
  { path: "/lateness", label: "التأخيرات", icon: Timer, group: "العمليات" },
  {
    path: "/fingerprint-daily",
    label: "البصمة اليومية",
    icon: CalendarPlus,
    group: "العمليات",
    write: true,
  },
  {
    path: "/fingerprint-monthly",
    label: "البصمة الشهرية",
    icon: CalendarPlus,
    group: "العمليات",
    write: true,
  },
  {
    path: "/daily-position",
    label: "الموقف اليومي",
    icon: Table2,
    group: "التقارير",
  },
  {
    path: "/fingerprint-issues",
    label: "مشاكل البصمة",
    icon: ShieldCheck,
    group: "المراجعة",
  },
  {
    path: "/attendance-settings",
    label: "دوام الأقسام",
    icon: Timer,
    group: "الإدارة",
    admin: true,
  },
  {
    path: "/absence-leave",
    label: "الغيابات والإجازات",
    icon: CalendarX2,
    group: "العمليات",
  },
  {
    path: "/actions",
    label: "الإجراءات الإدارية",
    icon: Gavel,
    group: "العمليات",
  },
  { path: "/monthly", label: "الموقف الشامل", icon: Table2, group: "التقارير" },
  {
    path: "/departments",
    label: "موقف الأقسام",
    icon: Building2,
    group: "التقارير",
  },
  {
    path: "/summary",
    label: "ملخص الموظفين",
    icon: ChartNoAxesCombined,
    group: "التقارير",
  },
  {
    path: "/reports",
    label: "التقارير",
    icon: FileBarChart,
    group: "التقارير",
  },
  {
    path: "/review",
    label: "المراجعة",
    icon: ShieldCheck,
    write: true,
    group: "الرقابة",
  },
  {
    path: "/audit",
    label: "سجل التعديلات",
    icon: History,
    admin: true,
    group: "الرقابة",
  },
  {
    path: "/users",
    label: "المستخدمون",
    icon: Users,
    admin: true,
    group: "الإدارة",
  },
  {
    path: "/settings",
    label: "الإعدادات",
    icon: Settings,
    admin: true,
    group: "الإدارة",
  },
];
const navigationSections = [
  { label: "مساحة العمل", paths: ["/", "/tasks"] },
  {
    label: "التشغيل اليومي",
    paths: ["/daily-dashboard", "/daily-position", "/status"],
  },
  {
    label: "البصمة والحضور",
    paths: [
      "/fingerprint-daily",
      "/fingerprint-monthly",
      "/fingerprint-issues",
    ],
  },
  { label: "الموظفون", paths: ["/employees", "/organization", "/actions"] },
  {
    label: "التقارير الشهرية",
    paths: ["/monthly-dashboard", "/monthly", "/departments", "/summary"],
  },
  {
    label: "التقارير والمتابعة",
    paths: ["/lateness", "/absence-leave", "/reports", "/review"],
  },
  {
    label: "الإدارة",
    paths: ["/attendance-settings", "/audit", "/users", "/settings"],
  },
];
const organizedNavigation = navigationSections.flatMap((section) =>
  section.paths.flatMap((path) => {
    const item = navigation.find((n) => n.path === path);
    return item ? [{ ...item, group: section.label }] : [];
  }),
);
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
        <BrandImage kind="symbol" alt="فن النسيج" className="auth-brand-art" priority />
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
      <SidebarProvider
        style={
          {
            "--sidebar-width": "17rem",
            "--sidebar-width-icon": "4.75rem",
          } as React.CSSProperties
        }
      >
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
  const [showPassword, setShowPassword] = useState(false);
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
      <aside className="login-company" aria-label="فن النسيج">
        <div className="login-company-top">
          <span dir="ltr">FANU ALNASIJ</span>
          <span className="evening-tag">
            <Moon size={15} /> مسائي
          </span>
        </div>
        <div className="login-company-identity">
          <div className="login-brand">
            <BrandImage
              kind="company"
              alt="فن النسيج — FANU ALNASIJ BY ZMC"
              priority
            />
          </div>
          <h2>قسم الموارد البشرية</h2>
          <p>الشفت المسائي</p>
        </div>
        <div className="login-company-footer">
          <span>فن النسيج</span>
          <span dir="ltr">BY ZMC</span>
        </div>
      </aside>
      <div className="login-workspace">
        <section className="login-card">
          <div className="login-identity">
            <BrandImage
              kind="title"
              alt="قسم الموارد البشرية — مسائي"
              priority
            />
            <BrandImage
              kind="savana"
              alt="SAVANA"
              className="savana-wordmark"
              priority
            />
          </div>
          <div className="login-heading">
            <div className="login-lock">
              <LockKeyhole size={21} />
            </div>
            <h1>تسجيل الدخول</h1>
          </div>
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
            <div className="password-field">
              <Field label="كلمة المرور">
                <Input
                  name="password"
                  type={showPassword ? "text" : "password"}
                  dir="ltr"
                  autoComplete="current-password"
                  required
                />
              </Field>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="password-toggle"
                aria-label={
                  showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"
                }
                aria-pressed={showPassword}
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </Button>
            </div>
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
        <Image
          className="login-credit"
          src="/brand/designed-by.webp"
          alt="Designed by Suhaib Al-Kubaisi"
          width={640}
          height={23}
          unoptimized
        />
      </div>
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
    <Sidebar side="right" collapsible="icon" className="hr-sidebar">
      <SidebarHeader>
        <Link href="/" className="brand">
          <BrandImage
            kind="company"
            alt="فن النسيج — FANU ALNASIJ BY ZMC"
            className="sidebar-company-art"
          />
          <BrandImage
            kind="symbol"
            alt="فن النسيج"
            className="sidebar-symbol-art"
          />
        </Link>
        <div className="sidebar-shift">
          <Moon size={15} />
          <span>الشفت المسائي</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          {organizedNavigation
            .filter(
              (n) =>
                (!n.admin || user.role === "ADMIN") &&
                (!n.write || user.role !== "VIEWER"),
            )
            .map((n, index, visible) => (
              <SidebarMenuItem key={n.path}>
                {(index === 0 || visible[index - 1].group !== n.group) && (
                  <p className="nav-heading">{n.group}</p>
                )}
                <SidebarMenuButton
                  asChild
                  isActive={
                    path === n.path ||
                    (n.path === "/employees" && path.startsWith("/employees/"))
                  }
                  className="nav-item"
                  tooltip={n.label}
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
        <BrandImage kind="savana" alt="SAVANA" className="sidebar-savana-art" />
        <div className="sidebar-user">
          <div className="avatar">{user.name.slice(0, 1)}</div>
          <div>
            <strong>{user.name}</strong>
            <small>
              {user.role === "ADMIN"
                ? "الموارد البشرية · صلاحية كاملة"
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
  else if (path === "/tasks") content = <OperationsCenter />;
  else if (path === "/organization")
    content = (
      <OrganizationPage
        reference={ref.data}
        canConfigure={user.role === "ADMIN"}
      />
    );
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
  else if (
    ["/daily-position", "/daily-dashboard", "/monthly-dashboard"].includes(path)
  )
    content = (
      <AttendanceReport
        reference={ref.data}
        monthly={path === "/monthly-dashboard"}
        canWrite={user.role !== "VIEWER"}
      />
    );
  else if (["/fingerprint-daily", "/fingerprint-monthly"].includes(path))
    content = <FingerprintImport monthly={path === "/fingerprint-monthly"} />;
  else if (path === "/fingerprint-issues")
    content = (
      <FingerprintIssues
        reference={ref.data}
        canWrite={user.role !== "VIEWER"}
      />
    );
  else if (path === "/attendance-settings")
    content = <AttendanceRules reference={ref.data} />;
  else if (path === "/lateness")
    content = <LatenessPage reference={ref.data} />;
  else if (path === "/absence-leave")
    content = <AbsenceLeavePage reference={ref.data} />;
  else if (path === "/actions")
    content = (
      <AdministrativeActionsPage
        reference={ref.data}
        canWrite={user.role !== "VIEWER"}
      />
    );
  else if (path === "/reports")
    content = <CentralReportsPage reference={ref.data} />;
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
          <SidebarTrigger aria-label="فتح أو طي القائمة" />
          <div className="topbar-context">
            <span>{ref.data?.app_name || "قسم الموارد البشرية – مسائي"}</span>
            <strong>{nav?.label || "الموظفون"}</strong>
          </div>
        </div>
        <div className="header-date">
          {new Intl.DateTimeFormat("ar-IQ", {
            dateStyle: "full",
            timeZone: "Asia/Baghdad",
          }).format(new Date())}
        </div>
        {ref.data && (
          <WorkspaceTools
            reference={ref.data}
            canWrite={user.role !== "VIEWER"}
          />
        )}
        <div className="topbar-account">
          <span className="avatar">{user.name.slice(0, 1)}</span>
          <div>
            <strong>{user.name}</strong>
            <small>
              {user.role === "VIEWER" ? "عرض فقط" : "الموارد البشرية"}
            </small>
          </div>
        </div>
      </header>
      <div className="workspace" key={path}>
        <PageBoundary>
          <Suspense fallback={<LoadState loading>{null}</LoadState>}>
            {content}
          </Suspense>
        </PageBoundary>
      </div>
    </>
  );
}
interface DashboardData {
  active: number;
  absence: number;
  leave: number;
  late: number;
  late_minutes: number;
  actions_month: number;
  review: number;
  today: string;
  recent: StatusRecord[];
  recent_actions: AdministrativeAction[];
  top_late: {
    employee_id: string;
    employee_name: string;
    department: string;
    occurrences: number;
    minutes: number;
  }[];
  departments: { id: string; name: string; count: number }[];
}
function Dashboard({ canWrite }: { canWrite: boolean }) {
  const q = useData<DashboardData>("dashboard");
  const cards = [
    ["الموظفون النشطون", "active", Users, "indigo"],
    ["الغيابات اليوم", "absence", CalendarPlus, "red"],
    ["الإجازات اليوم", "leave", CalendarPlus, "blue"],
    ["التأخيرات اليوم", "late", History, "amber"],
    ["دقائق التأخير اليوم", "late_minutes", Timer, "amber"],
    ["الإجراءات هذا الشهر", "actions_month", Gavel, "indigo"],
    ["تحتاج مراجعة", "review", ShieldCheck, "gray"],
  ] as const;
  return (
    <>
      <PageTitle
        title="مساحة العمل"
        subtitle={monthLabel(baghdadDate().slice(0, 7))}
        actions={
          canWrite && (
            <>
              <Button asChild>
                <Link href="/status">
                  <Plus size={18} />
                  تسجيل حالة
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/employees?new=1">إضافة موظف</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/actions">
                  <Gavel size={17} />
                  إجراء إداري
                </Link>
              </Button>
            </>
          )
        }
      />
      <LoadState
        loading={q.loading && !q.data}
        error={q.error}
        retry={q.refresh}
      >
        <div className="operation-launchpad">
          <div className="operation-launchpad-heading">
            <span className="evening-tag">
              <Moon size={16} /> الشفت المسائي
            </span>
            <h2>التشغيل اليومي</h2>
          </div>
          <div className="operation-launchpad-links">
            {canWrite && (
              <Link href="/fingerprint-daily">
                <Fingerprint size={24} />
                <span>
                  رفع البصمة اليومية<small>استيراد ومراجعة الحضور</small>
                </span>
                <ArrowUpLeft size={18} />
              </Link>
            )}
            <Link href="/daily-position">
              <Table2 size={24} />
              <span>
                الموقف اليومي<small>الحضور وقرارات HR</small>
              </span>
              <ArrowUpLeft size={18} />
            </Link>
            {canWrite && (
              <Link href="/tasks">
                <ClipboardCheck size={24} />
                <span>
                  مهام الموارد البشرية<small>الحالات التي تحتاج متابعة</small>
                </span>
                <ArrowUpLeft size={18} />
              </Link>
            )}
          </div>
        </div>
        <section className="kpi-grid">
          {cards.map(([label, key, Icon, color]) => (
            <article className={`kpi-card metric-${color}`} key={key}>
              <div className={`kpi-icon ${color}`}>
                <Icon size={20} />
              </div>
              <p>{label}</p>
              <strong>{q.data?.[key] ?? 0}</strong>
              <span className="kpi-caption">
                {key === "active"
                  ? "موظف"
                  : key === "late_minutes"
                    ? "دقيقة"
                    : key === "actions_month" || key === "review"
                      ? "سجل"
                      : "حالة"}
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
        <div className="dashboard-grid dashboard-secondary">
          <section className="panel">
            <div className="panel-heading">
              <h2>آخر الإجراءات الإدارية</h2>
              <Link href="/actions">
                عرض الكل
                <ArrowUpLeft size={15} />
              </Link>
            </div>
            <LoadState
              loading={false}
              empty={!q.data?.recent_actions.length}
              emptyText="لا توجد إجراءات إدارية"
            >
              {q.data?.recent_actions.map((action) => (
                <div className="recent-row" key={action.id}>
                  <div className="employee-mini-avatar">
                    {action.employee_name.slice(0, 1)}
                  </div>
                  <div className="recent-person">
                    <Link href={`/employees/${action.employee_id}`}>
                      {action.employee_name}
                    </Link>
                    <span>
                      {action.action_type} · {action.reason}
                    </span>
                  </div>
                  <span className={`action-state action-${action.state}`}>
                    {action.state === "active"
                      ? "فعال"
                      : action.state === "closed"
                        ? "مغلق"
                        : "ملغي"}
                  </span>
                  <time>{action.action_date}</time>
                </div>
              ))}
            </LoadState>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>أكثر الموظفين تأخيراً</h2>
              <Link href="/lateness">
                التفاصيل
                <ArrowUpLeft size={15} />
              </Link>
            </div>
            <div className="top-late-list">
              {q.data?.top_late.map((item, index) => (
                <Link
                  href={`/employees/${item.employee_id}`}
                  key={item.employee_id}
                >
                  <span>{index + 1}</span>
                  <div>
                    <strong>{item.employee_name}</strong>
                    <small>
                      <bdi>{item.department}</bdi>
                    </small>
                  </div>
                  <b>{item.minutes} دقيقة</b>
                </Link>
              ))}
            </div>
            {!q.data?.top_late.length && (
              <p className="empty-simple">لا توجد تأخيرات لهذا الشهر</p>
            )}
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
