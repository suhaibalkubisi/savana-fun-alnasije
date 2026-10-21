"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Home,
  Megaphone,
  ClipboardCheck,
  CalendarDays,
  BarChart3,
  Users,
  ListChecks,
  FileText,
  Settings as SettingsIcon,
  Phone,
  MessagesSquare,
  ArrowRightLeft,
  Menu,
  Search,
  LogOut,
  RefreshCw,
  Bookmark,
  ChevronLeft,
} from "lucide-react";
import { BrandImage } from "@/components/hr/brand-image";
import {
  get,
  request,
  write,
  message,
  isAbort,
  clearRetryKeys,
  clearSessionDrafts,
  prepareLogoutRecovery,
  activateRecoveryActor,
  confirmRecoverySignedOut,
} from "./client";
import {
  counts,
  today,
  monthEnd,
  order,
  states,
  roles,
  actionStates,
  viewLabels,
  primaryViews,
  parseContext,
  contextSearch,
  addDays,
  savedPages,
  savedViewContext,
  savedViewInput,
  membershipLabel,
  type Boot,
  type Employee,
  type Report,
  type Position,
  type Action,
  type ViewContext,
  type Document,
  type SavedView,
} from "./domain";
import { Field, Chip, Empty, Metrics, DataTable, ExportButtons } from "./ui";
import { Declaration, Review } from "./declarations";
import { EmployeeProfile } from "./profile";
import { ServiceStateDialog, serviceLabels } from "./service-state";
import { RosterSetup } from "./roster-setup";
import { ActionWorkspace, ContactWorkspace, Settings } from "./operations";
import {
  reportTable,
  type Selection,
  type ExportTable,
  type Completeness,
} from "./report-model";
import { clearDownloads } from "./exports";
import {
  prepareExport,
  exportProgressText,
  type ExportProgress,
} from "./export-client";
const icons = {
  dashboard: Home,
  reporting: Megaphone,
  review: ClipboardCheck,
  daily: CalendarDays,
  monthly: BarChart3,
  employee: FileText,
  directory: Users,
  actions: ListChecks,
  contacts: Phone,
  communications: MessagesSquare,
  handover: ArrowRightLeft,
  reports: FileText,
  settings: SettingsIcon,
};
type Data = {
  reports: Report[];
  position: Position[];
  actions: Action[];
  employees: Employee[];
  completeness: Completeness[];
  expiring_documents: (Document & {
    employee_id: string;
    employee_name: string;
  })[];
};
const emptyData: Data = {
  reports: [],
  position: [],
  actions: [],
  employees: [],
  completeness: [],
  expiring_documents: [],
};
const reportKinds: Record<string, string> = {
  daily: "الموقف اليومي الشامل",
  reporting: "سجل التبليغ اليومي",
  monthly: "الموقف الشهري الشامل",
  "department-monthly": "ملخص القسم الشهري",
  employee: "ملخص موظف",
  actions: "الإجراءات والمواعيد",
  completeness: "الاكتمال والاستثناءات",

  directory: "دليل الموظفين",
};
function sourceLabel(p: Position) {
  return p.scope_state === "assignment_unverified"
    ? "الانتماء المسائي غير موثّق"
    : p.scope_state === "future"
      ? "لم يحن التاريخ"
      : p.scope_state === "outside" || p.scope_state === "outside_roster"
        ? "خارج القائمة المؤرّخة"
        : p.completeness === "exception"
          ? "تعارض يحتاج تسوية"
          : p.completeness === "complete"
            ? "تبليغ مكتمل"
            : p.completeness === "partial"
              ? "تبليغ جزئي"
              : "لم يرد تبليغ";
}

export function FollowupApp() {
  const [boot, setBoot] = useState<Boot | null>(null),
    [session, setSession] = useState<"loading" | "login" | "ready">("loading"),
    [context, setContext] = useState<ViewContext>(() => parseContext("")),
    [hydrated, setHydrated] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [searchBusy, setSearchBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [loadFailed, setLoadFailed] = useState(false),
    [data, setData] = useState<Data>(emptyData),
    [dirty, setDirty] = useState(false),
    [serviceEmployee, setServiceEmployee] = useState<Employee | null>(null),
    [serviceFilter, setServiceFilter] = useState(""),
    [directoryPage, setDirectoryPage] = useState(0),
    [revision, setRevision] = useState(0),
    [drawer, setDrawer] = useState(false),
    [collapsed, setCollapsed] = useState(false),
    [search, setSearch] = useState(""),
    [results, setResults] = useState<{
      employees: Employee[];
      reports: Report[];
      actions: Action[];
    } | null>(null),
    [saved, setSaved] = useState<SavedView[]>([]),
    [addEmployee, setAddEmployee] = useState(false),
    [addPreview, setAddPreview] = useState<Record<string, unknown> | null>(
      null,
    );
  const currentContext = useRef(context),
    dirtyRef = useRef(false),
    returnContext = useRef<ViewContext | null>(null),
    requestVersion = useRef(0),
    searchLifetime = useRef({
      sequence: 0,
      controller: null as AbortController | null,
    }),
    dirtyOwners = useRef(new Set<string>()),
    dirtyHandlers = useRef(new Map<string, (v: boolean) => void>());
  function dirtyFor(owner: string) {
    if (!dirtyHandlers.current.has(owner))
      dirtyHandlers.current.set(owner, (v) => {
        if (v) dirtyOwners.current.add(owner);
        else dirtyOwners.current.delete(owner);
        dirtyRef.current = dirtyOwners.current.size > 0;
        setDirty(dirtyRef.current);
      });
    return dirtyHandlers.current.get(owner)!;
  }
  function cancelSearch() {
    searchLifetime.current.sequence++;
    searchLifetime.current.controller?.abort();
    searchLifetime.current.controller = null;
    setSearchBusy(false);
    setResults(null);
  }
  useEffect(() => {
    cancelSearch();
    return () => searchLifetime.current.controller?.abort();
  }, [boot?.user.id, session, context.view, context.department, search]);
  const bootUserId = boot?.user.id;
  const directoryQuery =
    context.view === "directory" && !context.employee ? context.query : "";
  useEffect(
    () => setDirectoryPage(0),
    [directoryQuery, context.department, serviceFilter],
  );
  useEffect(() => {
    let day = today();
    const timer = setInterval(() => {
      if (today() !== day) {
        if (dirtyRef.current) return;
        day = today();
        setRevision((v) => v + 1);
      }
    }, 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    currentContext.current = context;
    dirtyRef.current = dirty;
  }, [context, dirty]);
  const role = boot?.user.followup_role || boot?.user.role || "",
    canReview = ["ADMIN", "FOLLOWUP"].includes(role),
    dept = (id: string) =>
      boot?.departments.find((d) => d.id === id)?.arabic_name || "—";
  const notify = useCallback((v: string, knownSuccess = false) => {
      if (knownSuccess) setError("");
      setNotice(v);
    }, []),
    fail = useCallback((v: string) => {
      if (v) setNotice("");
      setError(v);
    }, []),
    markDirty = useCallback((v: boolean) => {
      if (v) dirtyOwners.current.add("directory");
      else dirtyOwners.current.delete("directory");
      dirtyRef.current = dirtyOwners.current.size > 0;
      setDirty(dirtyRef.current);
    }, []),
    refresh = useCallback(() => setRevision((v) => v + 1), []);
  const normalize = (b: Boot) => ({
    ...b,
    user: {
      ...b.user,
      departments: b.user.departments || [],
      current_departments:
        b.user.current_departments ?? b.user.departments ?? [],
    },
    users: (b.users || []).map((user) => ({
      ...user,
      departments: user.departments || [],
    })),
    statuses: b.statuses || [],
    shifts: b.shifts || [],
    departments: [...(b.departments || [])].sort(
      (a, c) => (a.display_order ?? 9999) - (c.display_order ?? 9999),
    ),
    reporters: b.reporters || [],
    capabilities: b.capabilities || {},
  });
  useEffect(() => {
    const controller = new AbortController();
    request<{ user: unknown }>("/api/auth", undefined, controller.signal)
      .then(async (s) => {
        if (s.user) {
          const b = await get<Boot>("bootstrap", {}, controller.signal);
          activateRecoveryActor(b.user.id);
          setBoot(normalize(b));
          setSession("ready");
        } else {
          confirmRecoverySignedOut();
          setSession("login");
        }
      })
      .catch((e) => {
        if (!isAbort(e)) {
          setError(message(e));
          setSession("login");
        }
      });
    Promise.resolve().then(() => {
      setContext(parseContext(window.location.search));
      setHydrated(true);
      sessionStorage.removeItem("fu-saved-views");
    });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    window.history.replaceState(
      null,
      "",
      window.location.pathname + contextSearch(context),
    );
  }, [context, hydrated]);
  useEffect(() => {
    if (!bootUserId) return;
    const controller = new AbortController();
    get<SavedView[]>("saved_views", {}, controller.signal)
      .then(setSaved)
      .catch((e) => {
        if (!isAbort(e)) {
          setSaved([]);
          setError(message(e));
        }
      });
    return () => controller.abort();
  }, [bootUserId, revision]);
  useEffect(() => {
    const onPop = () => {
      if (dirtyRef.current) {
        setError("احفظ التعديلات أو ألغِها قبل العودة.");
        window.history.pushState(
          null,
          "",
          window.location.pathname + contextSearch(currentContext.current),
        );
        return;
      }
      setData(emptyData);
      setContext(parseContext(window.location.search));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const prevent = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  useEffect(() => {
    if (session !== "ready" || !bootUserId) return;
    const controller = new AbortController(),
      id = ++requestVersion.current;
    const f: Record<string, string> = {
      start: ["monthly", "employee"].includes(context.view)
        ? context.month + "-01"
        : context.date,
      end: ["monthly", "employee"].includes(context.view)
        ? monthEnd(context.month)
        : context.date,
      ...(context.department ? { department_id: context.department } : {}),
      ...(context.view === "employee" && context.employee
        ? { employee_id: context.employee }
        : {}),
    };
    const kinds =
      context.view === "dashboard"
        ? [
            "reports",
            "position",
            "actions",
            "completeness",
            ...(boot?.capabilities?.documents_read ||
            boot?.capabilities?.documents_sensitive_read
              ? ["expiring_documents"]
              : []),
          ]
        : context.view === "review"
          ? ["reports", "actions", "employee_directory"]
          : ["daily", "monthly"].includes(context.view)
            ? ["position"]
            : context.view === "employee"
              ? context.employee
                ? ["position", "actions"]
                : []
              : context.view === "directory"
                ? context.employee
                  ? []
                  : ["employee_directory"]
                : context.view === "actions"
                  ? ["actions", "employee_directory"]
                  : [];
    Promise.resolve().then(() => {
      if (controller.signal.aborted) return;
      setLoadFailed(false);
      setLoading(kinds.length > 0);
      setData(emptyData);
    });
    Promise.all(
      kinds.map(async (kind) => {
        const filters =
          kind === "expiring_documents"
            ? { ...f, end: addDays(context.date, 30), include_expired: "true" }
            : kind === "employees" ||
                kind === "actions" ||
                kind === "employee_directory"
              ? {
                  ...(context.department
                    ? { department_id: context.department }
                    : {}),
                  ...(context.view === "employee" && context.employee
                    ? { employee_id: context.employee }
                    : {}),
                  ...(kind === "employee_directory"
                    ? { start: today(), end: today(), query: directoryQuery }
                    : {}),
                }
              : f;
        return [
          kind === "employee_directory" ? "employees" : kind,
          await get(kind, filters, controller.signal),
        ] as const;
      }),
    )
      .then((rows) => {
        if (id !== requestVersion.current || controller.signal.aborted) return;
        setData({ ...emptyData, ...Object.fromEntries(rows) });
        setLoading(false);
      })
      .catch((e) => {
        if (!isAbort(e) && id === requestVersion.current) {
          setData(emptyData);
          setLoading(false);
          setLoadFailed(true);
          setError(message(e) + " · أعد التحميل للتحقق من البيانات.");
        }
      });
    if (context.view === "settings")
      get<Boot>("bootstrap", {}, controller.signal)
        .then((b) => setBoot(normalize(b)))
        .catch((e) => {
          if (!isAbort(e)) setError(message(e));
        });
    return () => controller.abort();
  }, [
    session,
    bootUserId,
    context.view,
    context.date,
    context.month,
    context.department,
    context.employee,
    directoryQuery,
    revision,
    boot?.capabilities?.documents_read,
    boot?.capabilities?.documents_sensitive_read,
  ]);
  function change(patch: Partial<ViewContext>, push = false) {
    if (dirtyRef.current) {
      setError("احفظ المسودة أو التعديل، أو ألغِه، قبل الانتقال.");
      return false;
    }
    cancelSearch();
    const next = { ...context, ...patch };
    if (push)
      window.history.pushState(
        null,
        "",
        window.location.pathname + contextSearch(next),
      );
    setContext(next);
    if (
      (["view", "date", "month", "department", "employee"] as const).some(
        (key) => context[key] !== next[key],
      )
    )
      setData(emptyData);
    setResults(null);
    setDrawer(false);
    setError("");
    setNotice("");
    return true;
  }
  function navigate(view: string) {
    change({ view, employee: "", review: "", query: "" }, true);
  }
  function profile(id: string) {
    if (dirty) {
      setError("احفظ التعديل قبل فتح ملف الموظف.");
      return;
    }
    returnContext.current = context;
    change({ view: "directory", employee: id }, true);
  }
  function returnToList() {
    const next = returnContext.current || {
      ...context,
      view: "directory",
      employee: "",
    };
    change(next, true);
    returnContext.current = null;
  }
  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      await request("/api/auth", {
        email: f.get("email"),
        password: f.get("password"),
      });
      const b = await get<Boot>("bootstrap");
      activateRecoveryActor(b.user.id);
      const nextRole = b.user.followup_role || b.user.role;
      if (
        (context.view === "settings" &&
          !["ADMIN", "FOLLOWUP"].includes(nextRole)) ||
        (context.view === "reporting" && nextRole === "VIEWER")
      )
        setContext((v) => ({
          ...v,
          view: "dashboard",
          employee: "",
          review: "",
          query: "",
        }));
      setBoot(normalize(b));
      setSession("ready");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    if (dirty) {
      setError("احفظ التعديلات أو ألغِها قبل تسجيل الخروج.");
      return;
    }
    cancelSearch();
    setBusy(true);
    try {
      if (boot) await prepareLogoutRecovery(boot.user.id);
      await request("/api/auth", { action: "logout" });
      try {
        if (boot) clearSessionDrafts(boot.user.id);
      } catch {
        setError(
          "تم تسجيل الخروج؛ تعذر تنظيف تخزين التبويب. أغلقه لحماية المحتوى المحلي.",
        );
      }
      clearRetryKeys();
      clearDownloads();
      setBoot(null);
      setData(emptyData);
      setResults(null);
      setSession("login");
      setSaved([]);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function globalSearch(e: FormEvent) {
    e.preventDefault();
    if (!search.trim() || !boot) return;
    cancelSearch();
    const lifetime = searchLifetime.current,
      sequence = lifetime.sequence,
      owner = boot.user.id,
      query = search.trim(),
      scope = context.department,
      controller = new AbortController();
    lifetime.controller = controller;
    setSearchBusy(true);
    try {
      const fresh = await get<{
        employees: Employee[];
        reports: Report[];
        actions: Action[];
      }>(
        "search",
        { query, ...(scope ? { department_id: scope } : {}) },
        controller.signal,
      );
      if (
        !controller.signal.aborted &&
        sequence === lifetime.sequence &&
        owner === bootUserId
      )
        setResults(fresh);
    } catch (e) {
      if (!isAbort(e) && sequence === lifetime.sequence) {
        setResults(null);
        setError(message(e));
      }
    } finally {
      if (sequence === lifetime.sequence) {
        lifetime.controller = null;
        setSearchBusy(false);
      }
    }
  }
  async function saveView() {
    const name =
      viewLabels[context.view] +
      " · " +
      (context.department ? dept(context.department) : "كل الأقسام") +
      " · " +
      (["monthly", "employee"].includes(context.view) ||
      (context.view === "reports" &&
        ["monthly", "department-monthly", "employee"].includes(
          context.reportKind,
        ))
        ? context.month
        : context.date);
    setBusy(true);
    try {
      const item = await write<SavedView>(
        "saved_view",
        savedViewInput(context, name),
      );
      setSaved((v) => [item, ...v.filter((s) => s.id !== item.id)]);
      setNotice(
        "حُفظ اختصار القراءة في حسابك. يُفحص نطاقك مجدداً عند فتحه، ولا تُحفظ عمليات تحرير أو مستمسكات داخله.",
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function removeView(item: SavedView) {
    setBusy(true);
    try {
      await write("saved_view", {
        id: item.id,
        version: item.version,
        remove: true,
      });
      setSaved((v) => v.filter((s) => s.id !== item.id));
      setNotice("أُزيل الاختصار من حسابك.");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  if (session === "loading")
    return (
      <main className="fu-loading" dir="rtl">
        <BrandImage kind="company" alt="FANU ALNASIJ BY ZMC" />
        <p role="status">جارٍ فتح قسم المتابعة…</p>
      </main>
    );
  if (session === "login")
    return (
      <main className="fu-login" dir="rtl">
        <header>
          <BrandImage kind="company" alt="FANU ALNASIJ BY ZMC" />
          <BrandImage kind="savana" alt="SAVANA" />
        </header>
        <div className="fu-login-content">
          <section className="fu-login-brand">
            <span className="fu-eyebrow">FANU ALNASIJ / SAVANA</span>
            <h1 className="fu-title">قسم المتابعة</h1>
            <span className="fu-evening">مسائي</span>
            <p>
              تبليغ واضح.
              <br />
              مراجعة مسؤولة.
              <br />
              متابعة حتى الإنجاز.
            </p>
            <div className="fu-login-features">
              <span>
                <Megaphone />
                تبليغ الأقسام
              </span>
              <span>
                <ListChecks />
                متابعة الإجراءات
              </span>
              <span>
                <FileText />
                تقارير رسمية
              </span>
            </div>
          </section>
          <form onSubmit={login}>
            <span className="fu-eyebrow">منصة المتابعة المسائية</span>
            <h2>تسجيل الدخول</h2>
            <p>أدخل بيانات حسابك للوصول إلى نطاقك المخوّل.</p>
            <Field label="البريد الإلكتروني">
              <input
                name="email"
                type="email"
                dir="ltr"
                required
                autoComplete="username"
                placeholder="name@company.com"
              />
            </Field>
            <Field label="كلمة المرور">
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
              />
            </Field>
            {error && (
              <div className="fu-error" role="alert">
                {error}
              </div>
            )}
            <button className="primary" disabled={busy}>
              {busy ? "جارٍ الدخول…" : "تسجيل الدخول ←"}
            </button>
            <small>وصول آمن · صلاحيات بحسب الحساب والقسم</small>
          </form>
        </div>
        <footer>فن النسيج · بغداد · قسم المتابعة — مسائي</footer>
      </main>
    );
  if (!boot) return null;
  const allDepartments = boot.departments.filter(
      (d) =>
        d.is_active && (!context.department || context.department === d.id),
    ),
    departmentRows = allDepartments.filter((d) =>
      data.completeness.some((c) => c.department_id === d.id && !!c.expected),
    ),
    submitted = departmentRows.filter((d) =>
      data.completeness.some((c) => c.department_id === d.id && !!c.submitted),
    ),
    reviewed = departmentRows.filter((d) =>
      data.completeness.some((c) => c.department_id === d.id && !!c.reviewed),
    ),
    missing = departmentRows.filter(
      (d) =>
        !data.completeness.some(
          (c) => c.department_id === d.id && !!c.reported,
        ),
    );
  return (
    <div
      className={
        "fu-shell " +
        (collapsed ? "fu-collapsed" : "") +
        (drawer ? " fu-drawer-open" : "")
      }
      dir="rtl"
    >
      <a className="fu-skip" href="#fu-content">
        الانتقال إلى المحتوى
      </a>
      <aside className="fu-sidebar">
        <div className="fu-sidebar-heading">
          <span className="fu-title">قسم المتابعة</span>
          <span className="fu-evening">مسائي</span>
          <button
            aria-label="طيّ قائمة التنقل"
            className="fu-collapse"
            onClick={() => setCollapsed((v) => !v)}
          >
            <ChevronLeft />
          </button>
        </div>
        <nav aria-label="التنقل الرئيسي">
          {primaryViews
            .map((id) => [id, viewLabels[id]])
            .filter(
              ([id]) =>
                (id !== "settings" || canReview) &&
                (id !== "reporting" || role !== "VIEWER"),
            )
            .map(([id, name]) => {
              const Icon = icons[id as keyof typeof icons];
              return (
                <button
                  title={name}
                  key={id}
                  className={context.view === id ? "active" : ""}
                  aria-current={context.view === id ? "page" : undefined}
                  onClick={() => navigate(id)}
                >
                  <Icon size={20} />
                  <span>{name}</span>
                </button>
              );
            })}
        </nav>
        <div className="fu-sidebar-bottom">
          <div className="fu-avatar">{boot.user.name.slice(0, 1)}</div>
          <div>
            <strong>{boot.user.name}</strong>
            <small>{roles[role] || role}</small>
          </div>
          <button
            aria-label="تسجيل الخروج"
            title="تسجيل الخروج"
            disabled={busy}
            onClick={logout}
          >
            <LogOut size={19} />
          </button>
        </div>
      </aside>
      {drawer && (
        <button
          className="fu-drawer-overlay"
          aria-label="إغلاق قائمة التنقل"
          onClick={() => setDrawer(false)}
        />
      )}
      <div className="fu-main">
        <header className="fu-top">
          <button
            className="fu-mobile-menu"
            aria-label="فتح قائمة التنقل"
            aria-expanded={drawer}
            onClick={() => setDrawer((v) => !v)}
          >
            <Menu />
          </button>
          <div className="fu-brand-lockup">
            <BrandImage kind="company" alt="FANU ALNASIJ BY ZMC" />
            <i />
            <BrandImage kind="savana" alt="SAVANA" />
          </div>
          <form className="fu-global-search" onSubmit={globalSearch}>
            <Search size={19} />
            <input
              aria-label="البحث المخوّل في الموظفين والتبليغات والإجراءات"
              value={search}
              onChange={(e) => {
                cancelSearch();
                setSearch(e.target.value);
              }}
              placeholder="البحث عن موظف أو رمز أو مرجع…"
            />
            <button disabled={searchBusy}>بحث</button>
          </form>
          <div className="fu-top-date">
            <CalendarDays size={20} />
            <div>
              <strong>
                {new Intl.DateTimeFormat("ar-IQ", {
                  timeZone: "Asia/Baghdad",
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                }).format(new Date())}
              </strong>
              <small>بغداد · الخدمة المسائية</small>
            </div>
          </div>
        </header>
        <main id="fu-content">
          <div className="fu-heading">
            <div>
              <p className="fu-breadcrumb">
                الرئيسية / قسم المتابعة / {viewLabels[context.view]}
              </p>
              <h1>
                {context.employee && context.view === "directory"
                  ? "ملف الموظف"
                  : viewLabels[context.view]}
              </h1>
              <p>
                {context.view === "dashboard"
                  ? "التبليغات، الاستثناءات والأعمال التي تتطلب متابعة."
                  : context.view === "reporting"
                    ? "سجّل تقرير المسؤول الفعلي عن قائمة مسائية مؤرّخة."
                    : "بيانات مخوّلة ومصادر قابلة للتتبّع."}
              </p>
            </div>
            <div className="fu-bulk">
              <button
                disabled={busy || !savedPages[context.view]}
                onClick={saveView}
                title={
                  savedPages[context.view]
                    ? "حفظ نطاق التاريخ والقسم والموظف للقراءة"
                    : "حفظ الاختصارات متاح لشاشات القراءة"
                }
              >
                <Bookmark size={17} />
                حفظ العرض
              </button>
              <button
                disabled={loading}
                onClick={() => {
                  if (dirty) {
                    fail("احفظ التعديلات أو ألغها قبل التحديث.");
                    return;
                  }
                  refresh();
                }}
              >
                <RefreshCw size={17} />
                تحديث
              </button>
            </div>
          </div>
          {error && (
            <div className="fu-error" role="alert">
              <span>{error}</span>
              <button onClick={() => setError("")}>إغلاق</button>
            </div>
          )}
          {notice && (
            <div className="fu-notice" role="status">
              {notice}
            </div>
          )}
          {loading && (
            <div className="fu-loading-line" role="status">
              جارٍ تحميل النطاق المحدد…
            </div>
          )}
          {role === "SUPERVISOR" &&
            (boot.user.assignment_needed ??
              !(boot.user.current_departments ?? boot.user.departments ?? [])
                .length) && (
              <div className="fu-warning">
                لم يُعيّن قسم لهذا الحساب. يحتاج مسؤول مخوّل إلى تعيين القسم قبل
                بدء التبليغ.
              </div>
            )}
          {results && (
            <section className="fu-panel fu-search-results">
              <div className="fu-section-title">
                <h3>نتائج البحث المخوّل</h3>
                <button onClick={() => setResults(null)}>إغلاق</button>
              </div>
              {results.employees.map((e) => (
                <button
                  className="fu-summary-link"
                  key={e.id}
                  onClick={() => profile(e.id)}
                >
                  <span>
                    {e.name} · <bdi>{e.internal_code}</bdi>
                  </span>
                  <span>ملف الموظف ←</span>
                </button>
              ))}
              {results.reports.map((r) => (
                <button
                  className="fu-summary-link"
                  key={r.id}
                  onClick={() =>
                    change(
                      {
                        view: "review",
                        date: r.work_date,
                        department: r.department_id,
                        review: r.id,
                        employee: "",
                      },
                      true,
                    )
                  }
                >
                  <span>
                    {dept(r.department_id)} · {r.work_date} · {states[r.state]}
                  </span>
                  <bdi>{r.id}</bdi>
                </button>
              ))}
              {results.actions.map((a) => (
                <button
                  className="fu-summary-link"
                  key={a.id}
                  onClick={() =>
                    change(
                      {
                        view: "actions",
                        department: a.department_id,
                        employee: "",
                        actionFilter: "all",
                      },
                      true,
                    )
                  }
                >
                  <span>
                    {a.description} · {actionStates[a.state]}
                  </span>
                  <bdi>{a.id}</bdi>
                </button>
              ))}
              {!results.employees.length &&
                !results.reports.length &&
                !results.actions.length && <Empty />}
            </section>
          )}
          {!["settings", "reports"].includes(context.view) &&
            !(context.view === "directory" && context.employee) && (
              <div className="fu-command">
                <Field label="القسم">
                  <select
                    disabled={dirty}
                    value={context.department}
                    onChange={(e) =>
                      change({
                        department: e.target.value,
                        review: "",
                        employee:
                          context.view === "employee" ? context.employee : "",
                      })
                    }
                  >
                    <option value="">
                      {context.view === "reporting"
                        ? "اختر القسم"
                        : "جميع الأقسام المخوّلة"}
                    </option>
                    {boot.departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.arabic_name}
                      </option>
                    ))}
                  </select>
                </Field>
                {!["actions", "directory", "contacts"].includes(
                  context.view,
                ) && (
                  <Field
                    label={
                      ["monthly", "employee"].includes(context.view)
                        ? "الشهر"
                        : "تاريخ الخدمة"
                    }
                  >
                    <input
                      disabled={dirty}
                      type={
                        ["monthly", "employee"].includes(context.view)
                          ? "month"
                          : "date"
                      }
                      value={
                        ["monthly", "employee"].includes(context.view)
                          ? context.month
                          : context.date
                      }
                      onChange={(e) =>
                        change(
                          ["monthly", "employee"].includes(context.view)
                            ? { month: e.target.value }
                            : { date: e.target.value, review: "" },
                        )
                      }
                    />
                  </Field>
                )}
                {[
                  "reporting",
                  "directory",
                  "daily",
                  "monthly",
                  "employee",
                ].includes(context.view) && (
                  <Field label="بحث في النتائج">
                    <input
                      value={context.query}
                      onChange={(e) => {
                        setContext((v) => ({ ...v, query: e.target.value }));
                      }}
                      placeholder="اسم الموظف أو الرمز الدائم"
                    />
                  </Field>
                )}
                <Chip value="submitted">مسائي</Chip>
              </div>
            )}
          {context.view === "dashboard" && !loading && !loadFailed && (
            <>
              <Metrics rows={data.position} statuses={boot.statuses} />
              {data.completeness.some(
                (c) => Number(c.unverified_assignments) > 0 || !c.expected,
              ) && (
                <div className="fu-warning">
                  يوجد انتماء مسائي غير موثّق أو قسم دون قائمة مؤرّخة. لا يدخل
                  غير الموثّق في مقام اكتمال التبليغات.
                  {boot.capabilities?.roster_manage && (
                    <button onClick={() => navigate("directory")}>
                      فتح الموظفين لتوثيق الانتماء المؤرّخ
                    </button>
                  )}
                </div>
              )}
              <div className="fu-dashboard">
                <div>
                  <section className="fu-panel">
                    <div className="fu-section-title">
                      <h3>موقف الأقسام</h3>
                      <button
                        className="primary"
                        onClick={() => navigate("reporting")}
                      >
                        + تبليغ جديد
                      </button>
                    </div>
                    <div className="fu-completeness">
                      <div>
                        <span>التبليغات</span>
                        <strong>
                          {departmentRows.length
                            ? submitted.length + " / " + departmentRows.length
                            : "بانتظار التهيئة"}
                        </strong>
                        <progress
                          value={submitted.length}
                          max={Math.max(1, departmentRows.length)}
                        />
                      </div>
                      <div>
                        <span>تمت المراجعة</span>
                        <strong>
                          {departmentRows.length
                            ? reviewed.length + " / " + departmentRows.length
                            : "بانتظار التهيئة"}
                        </strong>
                        <progress
                          value={reviewed.length}
                          max={Math.max(1, departmentRows.length)}
                        />
                      </div>
                    </div>
                    <div className="fu-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>القسم</th>
                            <th>القائمة</th>
                            <th>حاضر</th>
                            <th>غياب</th>
                            <th>إجازة</th>
                            <th>غير محسوم</th>
                            <th>التبليغ / المراجعة</th>
                            <th>فتح</th>
                          </tr>
                        </thead>
                        <tbody>
                          {allDepartments.map((d) => {
                            const p = data.position.filter(
                                (x) => x.department_id === d.id,
                              ),
                              c = counts(p, boot.statuses),
                              r = data.reports.find(
                                (x) => x.department_id === d.id,
                              );
                            return (
                              <tr key={d.id}>
                                <td>
                                  <strong>{d.arabic_name}</strong>
                                </td>
                                <td>{c.expected}</td>
                                <td>{c.present}</td>
                                <td>{c.absent}</td>
                                <td>{c.leave}</td>
                                <td>{c.unresolved}</td>
                                <td>
                                  <Chip
                                    value={
                                      r?.state ||
                                      (departmentRows.some((x) => x.id === d.id)
                                        ? "missing"
                                        : "not_configured")
                                    }
                                  >
                                    {
                                      states[
                                        r?.state ||
                                          (departmentRows.some(
                                            (x) => x.id === d.id,
                                          )
                                            ? "missing"
                                            : "not_configured")
                                      ]
                                    }
                                  </Chip>
                                </td>
                                <td>
                                  <button
                                    onClick={() =>
                                      change(
                                        {
                                          view: r ? "review" : "reporting",
                                          department: d.id,
                                          review: r?.id || "",
                                        },
                                        true,
                                      )
                                    }
                                  >
                                    فتح ←
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>
                  <section className="fu-panel">
                    <h3>الاختصارات المحفوظة</h3>
                    <div className="fu-bulk">
                      {saved.map((s) => (
                        <div className="fu-saved-view" key={s.id}>
                          <button
                            onClick={() => change(savedViewContext(s), true)}
                          >
                            {s.name}
                          </button>
                          <button
                            disabled={busy}
                            aria-label={"إزالة الاختصار: " + s.name}
                            onClick={() => removeView(s)}
                          >
                            إزالة
                          </button>
                        </div>
                      ))}
                      {!saved.length && (
                        <p className="fu-muted">
                          احفظ نطاق القراءة للعودة إليه من حسابك في جلسة لاحقة.
                        </p>
                      )}
                    </div>
                  </section>
                </div>
                <aside>
                  <section className="fu-panel">
                    <h3>تحتاج متابعة</h3>
                    <button
                      className="fu-summary-link"
                      onClick={() => navigate("reporting")}
                    >
                      <strong>{missing.length}</strong>
                      <span>قسم دون تبليغ</span>
                    </button>
                    <button
                      className="fu-summary-link"
                      onClick={() => navigate("review")}
                    >
                      <strong>
                        {
                          data.reports.filter((r) => r.state === "submitted")
                            .length
                        }
                      </strong>
                      <span>تبليغ بانتظار المراجعة</span>
                    </button>
                    <button
                      className="fu-summary-link"
                      onClick={() =>
                        change(
                          { view: "actions", actionFilter: "overdue" },
                          true,
                        )
                      }
                    >
                      <strong>
                        {
                          data.actions.filter(
                            (a) =>
                              a.state !== "completed" &&
                              a.due_date < context.date,
                          ).length
                        }
                      </strong>
                      <span>إجراء متأخر</span>
                    </button>
                    <button
                      className="fu-summary-link"
                      onClick={() =>
                        change(
                          { view: "actions", actionFilter: "outstanding" },
                          true,
                        )
                      }
                    >
                      <strong>
                        {
                          data.actions.filter(
                            (a) =>
                              a.state !== "completed" &&
                              a.due_date === context.date,
                          ).length
                        }
                      </strong>
                      <span>إجراء مستحق في التاريخ المختار</span>
                    </button>
                    <p className="fu-muted">
                      غياب التبليغ فجوة تشغيلية؛ لا يثبت غياب الموظفين.
                    </p>
                  </section>
                  {(boot.capabilities?.documents_read ||
                    boot.capabilities?.documents_sensitive_read) && (
                    <section className="fu-panel">
                      <h3>تذكيرات انتهاء المستمسكات</h3>
                      <p className="fu-muted">
                        تواريخ مسجّلة فقط: المنتهية وما يحين خلال 30 يوماً من{" "}
                        {context.date}. تظهر المستمسكات ضمن صلاحيتك.
                      </p>
                      {data.expiring_documents.map((d) => (
                        <button
                          className="fu-summary-link"
                          key={d.id}
                          onClick={() => profile(d.employee_id)}
                        >
                          <span>
                            {d.employee_name}
                            <small>{d.title || d.name}</small>
                          </span>
                          <span>
                            <Chip
                              value={
                                (d.expires_on || "") < context.date
                                  ? "absent"
                                  : "leave"
                              }
                            >
                              {(d.expires_on || "") < context.date
                                ? "منتهي"
                                : "قريب الانتهاء"}
                            </Chip>
                            <small>{d.expires_on}</small>
                          </span>
                        </button>
                      ))}
                      {!data.expiring_documents.length && (
                        <p className="fu-muted">
                          لا توجد مستمسكات مخوّلة بتواريخ انتهاء ضمن هذا النطاق.
                        </p>
                      )}
                    </section>
                  )}
                </aside>
              </div>
            </>
          )}
          {context.view === "reporting" && (
            <Declaration
              key={context.department + context.date}
              boot={boot}
              date={context.date}
              department={context.department}
              query={context.query}
              onError={fail}
              onNotice={notify}
              onDirty={dirtyFor("declaration")}
              onRefresh={refresh}
              onProfile={profile}
            />
          )}
          {context.view === "review" && (
            <Review
              boot={boot}
              reports={data.reports}
              selectedId={context.review}
              onSelect={(id) => change({ review: id })}
              onDirty={dirtyFor("review")}
              onRefresh={refresh}
              onError={fail}
              onNotice={notify}
              onProfile={profile}
            />
          )}
          {["daily", "monthly", "employee"].includes(context.view) && (
            <>
              {context.view === "employee" && (
                <EmployeePicker
                  boot={boot}
                  value={context.employee}
                  onChange={(id) => change({ employee: id })}
                  onError={fail}
                />
              )}{" "}
              {context.view === "employee" && !context.employee ? (
                <Empty>اختر موظفاً لقراءة ملخصه فقط من الخادم.</Empty>
              ) : (
                !loading &&
                !loadFailed && (
                  <>
                    <Metrics
                      rows={data.position.filter(
                        (p) =>
                          !context.query ||
                          (p.name + " " + p.internal_code).includes(
                            context.query,
                          ),
                      )}
                      statuses={boot.statuses}
                      period={context.view !== "daily"}
                    />
                    <ExportButtons
                      table={reportTable(
                        {
                          kind: context.view,
                          start:
                            context.view === "daily"
                              ? context.date
                              : context.month + "-01",
                          end:
                            context.view === "daily"
                              ? context.date
                              : monthEnd(context.month),
                          department_id: context.department || undefined,
                          employee_id:
                            context.view === "employee"
                              ? context.employee
                              : undefined,
                          query: context.query,
                        },
                        boot,
                        data.position,
                        [],
                        data.reports,
                        data.actions,
                      )}
                      onError={fail}
                    />
                    <PositionTable
                      rows={data.position}
                      boot={boot}
                      month={context.month}
                      monthly={context.view === "monthly"}
                      query={context.query}
                      onProfile={profile}
                    />
                    {context.view === "monthly" && (
                      <Trend
                        rows={data.position}
                        statuses={boot.statuses}
                        month={context.month}
                      />
                    )}
                  </>
                )
              )}
            </>
          )}
          {context.view === "directory" &&
            (context.employee ? (
              <EmployeeProfile
                key={context.employee}
                employeeId={context.employee}
                boot={boot}
                month={context.month}
                onBack={returnToList}
                onError={fail}
                onNotice={notify}
                onDirty={dirtyFor("profile")}
              />
            ) : (
              <>
                <div className="fu-command">
                  <p>
                    {loading
                      ? "جارٍ تحميل الدليل المخوّل…"
                      : loadFailed
                        ? "تعذر تحميل الدليل. أعد المحاولة من زر التحديث."
                        : data.employees.filter(
                            (e) =>
                              !serviceFilter ||
                              e.employment_status === serviceFilter,
                          ).length + " موظف ضمن نتائج البحث والقسم والحالة"}
                  </p>
                  {boot.capabilities?.roster_manage && (
                    <button
                      className="primary"
                      onClick={() => {
                        if (dirty) {
                          fail(
                            "احفظ قرار التهيئة أو ألغِ الاختيار والمعاينة قبل إضافة سجل آخر.",
                          );
                          return;
                        }
                        setAddEmployee(true);
                      }}
                    >
                      + إضافة موظف مخوّلة
                    </button>
                  )}
                </div>
                <div className="fu-command">
                  <Field label="حالة الخدمة">
                    <select
                      value={serviceFilter}
                      onChange={(e) => {
                        setServiceFilter(e.target.value);
                        setDirectoryPage(0);
                      }}
                    >
                      <option value="">جميع الحالات</option>
                      {Object.entries(serviceLabels).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                {addEmployee && (
                  <form
                    className="fu-panel fu-form"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const f = Object.fromEntries(
                        new FormData(e.currentTarget),
                      );
                      setBusy(true);
                      try {
                        const duplicates = await get<Employee[]>(
                          "employee_duplicates",
                          {
                            name: String(f.name || ""),
                            employee_number: String(f.employee_number || ""),
                          },
                        );
                        if (duplicates.length) {
                          fail(
                            "يوجد سجل مطابق: " +
                              duplicates
                                .map((e) => e.name + " · " + e.internal_code)
                                .join("، "),
                          );
                          setAddPreview(null);
                          return;
                        }
                        setAddPreview(f);
                      } catch (e) {
                        fail(message(e));
                      } finally {
                        setBusy(false);
                      }
                    }}
                    onChange={() => {
                      markDirty(true);
                      setAddPreview(null);
                    }}
                  >
                    <h3>إضافة موظف جديد</h3>
                    <Field label="الاسم الكامل">
                      <input name="name" required maxLength={150} />
                    </Field>
                    <Field label="القسم">
                      <select name="department_id" required defaultValue="">
                        <option value="">اختر القسم</option>
                        {boot.departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.arabic_name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="تاريخ بداية السريان">
                      <input
                        name="work_date"
                        type="date"
                        min={today()}
                        required
                      />
                    </Field>
                    <Field label="مصدر الإضافة وسببها">
                      <textarea name="reason" required />
                    </Field>
                    <div className="fu-bulk">
                      <button>معاينة الإضافة وفحص التكرار</button>
                      <button
                        type="button"
                        onClick={() => {
                          setAddEmployee(false);
                          setAddPreview(null);
                          markDirty(false);
                        }}
                      >
                        إلغاء
                      </button>
                    </div>
                    {addPreview && (
                      <div className="fu-form-full fu-warning">
                        <p>
                          سيُضاف: {String(addPreview.name)} ·{" "}
                          {dept(String(addPreview.department_id))} ·{" "}
                          {String(addPreview.work_date)}. يخصص الخادم رمزاً
                          دائماً جديداً ويمنع إعادة استخدام الرموز.
                        </p>
                        <button
                          type="button"
                          className="primary"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            try {
                              await write<Employee>(
                                "employee_add",
                                addPreview,
                                async (receipt) => {
                                  if (!receipt?.id || !receipt.internal_code)
                                    return false;
                                  const fresh = (
                                    await get<Employee[]>(
                                      "employee_directory",
                                      { employee_id: receipt.id },
                                    )
                                  ).find((e) => e.id === receipt.id);
                                  return (
                                    !!fresh &&
                                    fresh.internal_code ===
                                      receipt.internal_code &&
                                    fresh.name === addPreview.name &&
                                    fresh.department_id ===
                                      addPreview.department_id
                                  );
                                },
                              );
                              setAddEmployee(false);
                              setAddPreview(null);
                              markDirty(false);
                              refresh();
                              notify(
                                "أُضيف السجل مع معرّفه ورمزه الدائم وسجل المصدر.",
                              );
                            } catch (e) {
                              fail(message(e));
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          تأكيد الإضافة المخوّلة
                        </button>
                      </div>
                    )}
                  </form>
                )}
                {!loading && !loadFailed && (
                  <section className="fu-panel">
                    <div className="fu-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>الموظف</th>
                            <th>الرمز الدائم</th>
                            <th>القسم الحالي</th>
                            <th>الحالة</th>
                            <th>العضوية المسائية</th>
                            <th>الملف</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.employees
                            .filter(
                              (e) =>
                                !serviceFilter ||
                                e.employment_status === serviceFilter,
                            )
                            .slice(directoryPage * 30, directoryPage * 30 + 30)
                            .map((e) => (
                              <tr key={e.id}>
                                <td>
                                  <button
                                    className="fu-name"
                                    onClick={() => profile(e.id)}
                                  >
                                    {e.name}
                                  </button>
                                </td>
                                <td>
                                  <bdi>{e.internal_code}</bdi>
                                </td>
                                <td>
                                  {e.department_name || dept(e.department_id)}
                                </td>
                                <td>
                                  {{
                                    active: "نشط",
                                    inactive: "غير نشط",
                                    resigned: "مستقيل",
                                    long_leave: "إجازة طويلة",
                                  }[e.employment_status] || e.employment_status}
                                  {e.scheduled_service?.map((s) => (
                                    <small
                                      key={
                                        s.valid_from + ":" + s.employment_status
                                      }
                                    >
                                      مجدول:{" "}
                                      {serviceLabels[s.employment_status]} من{" "}
                                      {s.valid_from}
                                    </small>
                                  ))}
                                </td>
                                <td>
                                  <Chip
                                    value={
                                      e.evening_verified
                                        ? "present"
                                        : "unresolved"
                                    }
                                  >
                                    {membershipLabel(e)}
                                  </Chip>
                                </td>
                                <td>
                                  <button onClick={() => profile(e.id)}>
                                    فتح الملف ←
                                  </button>
                                  {boot.capabilities?.service_manage && (
                                    <button
                                      onClick={() => {
                                        if (dirty) {
                                          fail(
                                            "احفظ التعديل الحالي أو ألغِه أولاً.",
                                          );
                                          return;
                                        }
                                        setServiceEmployee(e);
                                      }}
                                    >
                                      تغيير الحالة
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                    {!data.employees.length && <Empty />}
                    <div className="fu-bulk">
                      <button
                        disabled={!directoryPage}
                        onClick={() => setDirectoryPage((p) => p - 1)}
                      >
                        السابق
                      </button>
                      <span>صفحة {directoryPage + 1}</span>
                      <button
                        disabled={
                          (directoryPage + 1) * 30 >=
                          data.employees.filter(
                            (e) =>
                              !serviceFilter ||
                              e.employment_status === serviceFilter,
                          ).length
                        }
                        onClick={() => setDirectoryPage((p) => p + 1)}
                      >
                        التالي
                      </button>
                    </div>
                  </section>
                )}
                {!addEmployee && boot.capabilities?.roster_manage && (
                  <RosterSetup
                    key={context.department}
                    boot={boot}
                    department={context.department}
                    onError={fail}
                    onNotice={notify}
                    onDirty={markDirty}
                    onRefresh={refresh}
                    onProfile={profile}
                  />
                )}
                {!boot.capabilities?.roster_manage && (
                  <section className="fu-panel">
                    <h3>تهيئة القائمة المسائية</h3>
                    <p>
                      الدليل يعرض الموظفين المخوّلين، والقائمة التشغيلية لا تشمل
                      إلا انتماءً مسائياً موثّقاً. التوثيق يحتاج صلاحية مستقلة
                      وقراراً صريحاً من المسؤول؛ لا يُعيّن أحد تلقائياً.
                    </p>
                    {role === "ADMIN" && (
                      <button onClick={() => navigate("settings")}>
                        فتح الإعدادات لاتخاذ قرار الصلاحية وتعيينات الأقسام
                      </button>
                    )}
                  </section>
                )}
              </>
            ))}
          {(context.view === "actions" ||
            (context.view === "review" && !context.review)) && (
            <ActionWorkspace
              boot={boot}
              department={context.department}
              date={context.date}
              actions={data.actions}
              employees={data.employees}
              filter={context.actionFilter}
              onFilter={(actionFilter) => change({ actionFilter })}
              onProfile={profile}
              onError={fail}
              onNotice={notify}
              onDirty={dirtyFor("actions")}
              onRefresh={refresh}
            />
          )}
          {["contacts", "communications", "handover"].includes(
            context.view,
          ) && (
            <ContactWorkspace
              key={context.view + context.department + context.date}
              view={context.view}
              boot={boot}
              department={context.department}
              date={context.date}
              onError={fail}
              onNotice={notify}
              onDirty={dirtyFor("contacts")}
              onRefresh={refresh}
            />
          )}
          {context.view === "reports" && (
            <ReportingCenter
              boot={boot}
              context={context}
              onChange={change}
              onError={fail}
            />
          )}
          {context.view === "settings" && (
            <>
              <Settings
                boot={boot}
                department={context.department}
                date={context.date}
                onError={fail}
                onNotice={notify}
                onDirty={dirtyFor("settings")}
                onRefresh={refresh}
              />
              <ContactWorkspace
                view="contacts"
                boot={boot}
                department={context.department}
                date={context.date}
                onError={fail}
                onNotice={notify}
                onDirty={dirtyFor("contacts")}
                onRefresh={refresh}
              />
            </>
          )}
        </main>
        {serviceEmployee && (
          <ServiceStateDialog
            employee={serviceEmployee}
            actorId={boot.user.id}
            onClose={() => setServiceEmployee(null)}
            onSaved={() => {
              notify("حُفظ قرار الخدمة وتأكد ظهوره في السجل.", true);
              refresh();
            }}
            onError={fail}
            onDirty={markDirty}
          />
        )}
        <footer className="fu-footer">
          قسم المتابعة — مسائي · FANU ALNASIJ / SAVANA · المصدر: تبليغ المسؤول
        </footer>
      </div>
    </div>
  );
}

function EmployeePicker({
  boot,
  value,
  onChange,
  onError,
}: {
  boot: Boot;
  value: string;
  onChange: (s: string) => void;
  onError: (s: string) => void;
}) {
  const [query, setQuery] = useState(""),
    [options, setOptions] = useState<Employee[]>([]),
    [busy, setBusy] = useState(false);
  async function search(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    try {
      setOptions(
        await get<Employee[]>("employee_directory", { query: query.trim() }),
      );
    } catch (e) {
      onError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="fu-panel fu-picker">
      <form onSubmit={search}>
        <Field label="البحث لاختيار موظف واحد">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="الاسم أو الرمز الدائم"
          />
        </Field>
        <button disabled={busy}>بحث</button>
      </form>
      <Field label="الموظف المحدد">
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">اختر موظفاً</option>
          {value && !options.some((e) => e.id === value) && (
            <option value={value}>الموظف المحدد — أعد البحث لعرض اسمه</option>
          )}
          {options.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} · {e.internal_code} ·{" "}
              {
                boot.departments.find((d) => d.id === e.department_id)
                  ?.arabic_name
              }
            </option>
          ))}
        </select>
      </Field>
    </section>
  );
}

function PositionTable({
  rows,
  boot,
  month,
  monthly,
  query,
  onProfile,
}: {
  rows: Position[];
  boot: Boot;
  month: string;
  monthly: boolean;
  query: string;
  onProfile: (id: string) => void;
}) {
  const ps = order(
      rows.filter(
        (p) => !query || (p.name + " " + p.internal_code).includes(query),
      ),
    ),
    label = (id: string) =>
      boot.statuses.find((s) => s.code === id)?.label || "غير محسوم";
  if (!ps.length)
    return (
      <section className="fu-panel">
        <Empty />
      </section>
    );
  if (!monthly)
    return (
      <section className="fu-panel">
        <div className="fu-scroll">
          <table>
            <thead>
              <tr>
                <th>الموظف</th>
                <th>الرمز الدائم</th>
                <th>القسم في التاريخ</th>
                <th>تاريخ الخدمة</th>
                <th>الحالة</th>
                <th>اكتمال المصدر</th>
                <th>المراجعة</th>
              </tr>
            </thead>
            <tbody>
              {ps.map((p, i) => (
                <tr key={p.employee_id + p.work_date + i}>
                  <td>
                    <button
                      className="fu-name"
                      onClick={() => onProfile(p.employee_id)}
                    >
                      {p.name}
                    </button>
                  </td>
                  <td>
                    <bdi>{p.internal_code}</bdi>
                  </td>
                  <td>{p.department_name}</td>
                  <td>{p.work_date}</td>
                  <td>
                    <Chip
                      value={
                        boot.statuses.find((s) => s.code === p.status)
                          ?.category || "unresolved"
                      }
                    >
                      {label(p.status)}
                    </Chip>
                  </td>
                  <td>{sourceLabel(p)}</td>
                  <td>{states[p.review_state] || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  const groups = new Map<string, Position[]>();
  for (const p of ps) {
    if (!groups.has(p.employee_id)) groups.set(p.employee_id, []);
    groups.get(p.employee_id)!.push(p);
  }
  const days = Array.from(
    { length: Number(monthEnd(month).slice(8)) },
    (_, i) => i + 1,
  );
  return (
    <>
      <div className="fu-monthly-mobile">
        <p className="fu-warning">
          عرض الهاتف: افتح ملف الموظف لقراءة الأيام بشكل واضح.
        </p>
        {[...groups].map(([id, p]) => {
          const c = counts(p, boot.statuses);
          return (
            <button
              className="fu-summary-link"
              key={id}
              onClick={() => onProfile(id)}
            >
              <span>
                <strong>{p[0].name}</strong>
                <small>{p[0].internal_code}</small>
              </span>
              <span>
                {c.present} حضور · {c.absent} غياب · {c.unresolved} غير محسوم ←
              </span>
            </button>
          );
        })}
      </div>
      <section className="fu-panel fu-monthly-desktop">
        <div className="fu-section-title">
          <h3>الموقف الشهري · {month}</h3>
          <span>{groups.size} موظف فريد</span>
        </div>
        <p className="fu-muted">
          صف واحد لكل موظف. الأقسام مرتبطة بتاريخها؛ المستقبل وخارج القائمة
          والحالة غير المحسومة منفصلة.
        </p>
        <div className="fu-scroll">
          <table className="fu-monthly-table">
            <thead>
              <tr>
                <th className="fu-sticky-name">الموظف</th>
                <th className="fu-sticky-code">الرمز الدائم</th>
                {days.map((d) => (
                  <th key={d}>{d}</th>
                ))}
                <th>حاضر</th>
                <th>غياب</th>
                <th>إجازة</th>
                <th>أخرى</th>
                <th>غير محسوم</th>
                <th>وزن الغياب</th>
              </tr>
            </thead>
            <tbody>
              {[...groups].map(([id, p]) => {
                const c = counts(p, boot.statuses);
                return (
                  <tr key={id}>
                    <td className="fu-sticky-name">
                      <button className="fu-name" onClick={() => onProfile(id)}>
                        {p[0].name}
                      </button>
                      <small>
                        {[...new Set(p.map((x) => x.department_name))].join(
                          " / ",
                        )}
                      </small>
                    </td>
                    <td className="fu-sticky-code">
                      <bdi>{p[0].internal_code}</bdi>
                    </td>
                    {days.map((d) => {
                      const date = month + "-" + String(d).padStart(2, "0"),
                        day = p.filter((x) => x.work_date === date);
                      return (
                        <td key={d}>
                          {day.length
                            ? day.map((x, i) => (
                                <span
                                  key={i}
                                  title={
                                    x.department_name +
                                    " · " +
                                    sourceLabel(x) +
                                    " · " +
                                    (states[x.review_state] || "—")
                                  }
                                  className={
                                    "fu-day-state " +
                                    (x.scope_state === "future" ||
                                    x.scope_state?.includes("outside")
                                      ? "outside"
                                      : boot.statuses.find(
                                          (s) => s.code === x.status,
                                        )?.category || "unresolved")
                                  }
                                >
                                  {x.scope_state === "future"
                                    ? "لم يحن"
                                    : x.scope_state?.includes("outside")
                                      ? "خارج"
                                      : label(x.status)}
                                </span>
                              ))
                            : date > today()
                              ? "لم يحن"
                              : "خارج القائمة"}
                        </td>
                      );
                    })}
                    <td>{c.present}</td>
                    <td>{c.absent}</td>
                    <td>{c.leave}</td>
                    <td>{c.other}</td>
                    <td>{c.unresolved}</td>
                    <td>{c.weighted}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Trend({
  rows,
  statuses,
  month,
}: {
  rows: Position[];
  statuses: Boot["statuses"];
  month: string;
}) {
  const days = Array.from(
    { length: Number(monthEnd(month).slice(8)) },
    (_, i) => {
      const date = month + "-" + String(i + 1).padStart(2, "0");
      return {
        date,
        c: counts(
          rows.filter((p) => p.work_date === date),
          statuses,
        ),
      };
    },
  ).filter((d) => d.date <= today());
  const max = Math.max(1, ...days.map((d) => d.c.expected));
  return (
    <section className="fu-panel">
      <h3>اتجاه الحالات المبلّغ عنها</h3>
      <p className="fu-muted">
        النطاق نفسه حسب القسم وتاريخ الانتماء. الأيام غير الموثّقة لا تُقدّر؛
        تظهر الحالات غير المحسومة بجانب الغياب.
      </p>
      <div className="fu-trend-legend">
        <span>🟢 حاضر</span>
        <span>🔴 غياب</span>
        <span>🟡 إجازة</span>
        <span>🔵 أخرى</span>
        <span>⚪ غير محسوم</span>
      </div>
      {days.map(({ date, c }) => (
        <div className="fu-trend-bar" key={date}>
          <span>{date.slice(8)}</span>
          <div
            className="fu-trend-stack"
            aria-label={
              date +
              ": " +
              c.present +
              " حاضر، " +
              c.absent +
              " غياب، " +
              c.leave +
              " إجازة، " +
              c.other +
              " أخرى، " +
              c.unresolved +
              " غير محسوم"
            }
          >
            {[
              [c.present, "#1b9460"],
              [c.absent, "#c53545"],
              [c.leave, "#d09a35"],
              [c.other, "#2456d8"],
              [c.unresolved, "#77879e"],
            ].map(([v, color], i) => (
              <i
                key={i}
                style={{
                  width: (Number(v) / max) * 100 + "%",
                  background: String(color),
                }}
              />
            ))}
          </div>
          <small>
            {c.expected} ضمن القائمة · {c.absent} غياب · {c.unresolved} غير
            محسوم
          </small>
        </div>
      ))}
    </section>
  );
}

function ReportingCenter({
  boot,
  context,
  onChange,
  onError,
}: {
  boot: Boot;
  context: ViewContext;
  onChange: (p: Partial<ViewContext>) => void;
  onError: (s: string) => void;
}) {
  const [exportProgress, setExportProgress] = useState<{
    key: string;
    value: ExportProgress;
  } | null>(null);
  const previewRunning = useRef(false),
    previewController = useRef<AbortController | null>(null);
  const [previewResult, setPreviewResult] = useState<{
      key: string;
      value: ExportTable;
    } | null>(null),
    [reportResult, setReportResult] = useState<{
      key: string;
      rows: Report[];
    } | null>(null),
    [reportId, setReportId] = useState(""),
    [busy, setBusy] = useState(false);
  const kind = context.reportKind,
    monthly = ["monthly", "department-monthly", "employee"].includes(kind);
  const reportScope = context.date + ":" + context.department,
    reports = reportResult?.key === reportScope ? reportResult.rows : [],
    previewScope = JSON.stringify([
      kind,
      context.date,
      context.month,
      context.department,
      context.employee,
      context.actionFilter,
      reportId,
    ]),
    table = previewResult?.key === previewScope ? previewResult.value : null;
  useEffect(() => () => previewController.current?.abort(), [previewScope]);
  async function preview() {
    if (previewRunning.current) return;
    if (kind === "employee" && !context.employee) {
      onError("اختر موظفاً قبل التقرير الفردي.");
      return;
    }
    if (kind === "department-monthly" && !context.department) {
      onError("اختر قسماً قبل الملخص الشهري للقسم.");
      return;
    }
    if (
      kind === "reporting" &&
      (!reportId || !reports.some((r) => r.id === reportId))
    ) {
      onError("اختر تبليغاً فعلياً.");
      return;
    }
    previewRunning.current = true;
    previewController.current = new AbortController();
    setBusy(true);
    setPreviewResult(null);
    const selection: Selection = {
      kind,
      start: monthly ? context.month + "-01" : context.date,
      end: monthly ? monthEnd(context.month) : context.date,
      department_id: context.department || undefined,
      employee_id: kind === "employee" ? context.employee : undefined,
      report_id: kind === "reporting" ? reportId : undefined,
      action_filter: context.actionFilter,
    };
    try {
      setPreviewResult({
        key: previewScope,
        value: await prepareExport(
          selection,
          (value) => setExportProgress({ key: previewScope, value }),
          previewController.current.signal,
        ),
      });
    } catch (e) {
      if (!(e instanceof Error && e.name === "AbortError")) onError(message(e));
    } finally {
      previewRunning.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <nav className="fu-tabs" aria-label="نوع التقرير">
        {Object.entries(reportKinds).map(([id, name]) => (
          <button
            key={id}
            className={kind === id ? "active" : ""}
            onClick={() => {
              onChange({ reportKind: id });
              setPreviewResult(null);
            }}
          >
            {name}
          </button>
        ))}
      </nav>
      <section className="fu-panel">
        <div className="fu-command">
          <Field label="القسم">
            <select
              value={context.department}
              onChange={(e) => {
                onChange({ department: e.target.value });
                setPreviewResult(null);
              }}
            >
              <option value="">جميع الأقسام المخوّلة</option>
              {boot.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.arabic_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={monthly ? "الشهر" : "تاريخ الخدمة"}>
            <input
              type={monthly ? "month" : "date"}
              value={monthly ? context.month : context.date}
              onChange={(e) => {
                onChange(
                  monthly
                    ? { month: e.target.value }
                    : { date: e.target.value },
                );
                setPreviewResult(null);
              }}
            />
          </Field>
          {kind === "reporting" && (
            <>
              <button
                onClick={async () => {
                  try {
                    setReportResult({
                      key: reportScope,
                      rows: await get<Report[]>("reports", {
                        start: context.date,
                        end: context.date,
                        ...(context.department
                          ? { department_id: context.department }
                          : {}),
                      }),
                    });
                  } catch (e) {
                    onError(message(e));
                  }
                }}
              >
                تحميل التبليغات
              </button>
              <Field label="التبليغ">
                <select
                  value={reports.some((r) => r.id === reportId) ? reportId : ""}
                  onChange={(e) => setReportId(e.target.value)}
                >
                  <option value="">اختر تبليغاً</option>
                  {reports.map((r) => (
                    <option key={r.id} value={r.id}>
                      {
                        boot.departments.find((d) => d.id === r.department_id)
                          ?.arabic_name
                      }{" "}
                      · {states[r.state]} · إصدار {r.version}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}
          <button className="primary" disabled={busy} onClick={preview}>
            {busy ? "جارٍ إعداد التقرير…" : "إعداد المعاينة الرسمية"}
          </button>
          {exportProgress?.key === previewScope && (
            <span role="status" aria-live="polite">
              {exportProgressText(exportProgress.value)}
            </span>
          )}
        </div>
        {kind === "employee" && (
          <EmployeePicker
            boot={boot}
            value={context.employee}
            onChange={(employee) => {
              onChange({ employee });
              setPreviewResult(null);
            }}
            onError={onError}
          />
        )}
        <p className="fu-muted">
          تُقرأ البيانات كاملةً ضمن الصلاحية، وتُستخدم نفس قواعد الحالة والتعداد
          في PDF وExcel ومعاينة الطباعة.
        </p>
      </section>
      {table ? (
        <>
          <ExportButtons table={table} onError={onError} />
          <DataTable table={table} />
        </>
      ) : (
        <Empty>
          اختر النوع والنطاق ثم أعدّ المعاينة. تظهر حالة المصدر والفترة داخل
          التقرير.
        </Empty>
      )}
    </>
  );
}
