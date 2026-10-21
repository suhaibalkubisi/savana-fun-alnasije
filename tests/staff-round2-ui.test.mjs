import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
const before = process.env.FANU_TEST_BEFORE;
const read = (file) =>
  fs.readFileSync(
    before && fs.existsSync(path.join(before, file))
      ? path.join(before, file)
      : file,
    "utf8",
  );
const source = (file) =>
  ts.createSourceFile(
    file,
    read(file),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
const compile = (s) =>
  ts.transpileModule(s, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
const boot = {
  user: {
    id: "11111111-1111-4111-8111-111111111111",
    role: "ADMIN",
    followup_role: "ADMIN",
  },
  departments: [{ id: "A", arabic_name: "قسم اختبار" }],
  users: [],
  statuses: [],
  capabilities: {
    service_manage: true,
    identity_edit: true,
    accounts_manage: true,
  },
};
class RequestError extends Error {
  constructor(m, status) {
    super(m);
    this.status = status;
  }
}
class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(k) {
    return this.map.get(k) ?? null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
  key(i) {
    return [...this.map.keys()][i] ?? null;
  }
  get length() {
    return this.map.size;
  }
}
globalThis.sessionStorage = new MemoryStorage();
function mount(file, component, props, client = {}) {
  let i = 0,
    j = 0;
  const state = [],
    refs = [];
  const hooks = {
    useState: (v) => {
      const n = i++;
      if (!(n in state)) state[n] = typeof v === "function" ? v() : v;
      return [
        state[n],
        (v) => (state[n] = typeof v === "function" ? v(state[n]) : v),
      ];
    },
    useRef: (v) => refs[j++] ?? (refs[j - 1] = { current: v }),
    useEffect: () => {},
    useCallback: (f) => f,
    useMemo: (f) => f(),
  };
  const cache = new Map();
  const load = (filename) => {
    if (cache.has(filename)) return cache.get(filename);
    const m = { exports: {} };
    cache.set(filename, m.exports);
    const require = (n) => {
      if (n === "react") return hooks;
      if (n === "react/jsx-runtime")
        return {
          jsx: (type, props) => ({ type, props }),
          jsxs: (type, props) => ({ type, props }),
          Fragment: "fragment",
        };
      if (n === "./client")
        return {
          RequestError,
          message: (e) => e.message,
          isAbort: (e) => e.name === "AbortError",
          ...client,
          request: (...args) => client.request(...args),
        };
      if (n === "./ui")
        return {
          Field: "field",
          Chip: "chip",
          Empty: "empty",
          Metrics: "metrics",
          ExportButtons: "exports",
        };
      if (n === "./domain")
        return {
          today: () => "2026-10-19",
          states: { submitted: "مقدم" },
          roles: {
            ADMIN: "مدير",
            FOLLOWUP: "متابعة",
            SUPERVISOR: "مشرف",
            VIEWER: "مشاهد",
          },
          channels: { phone: "هاتف" },
          actionStates: {},
          eligibleOwners: () => [],
          counts: () => ({}),
          ...client.domain,
        };
      if (n === "./report-model") return {};
      if (n.startsWith(".")) {
        let f = path.resolve(path.dirname(filename), n);
        if (!path.extname(f)) f += ".ts";
        return load(f);
      }
      throw Error("Unmocked " + n);
    };
    new Function("require", "module", "exports", compile(read(filename)))(
      require,
      m,
      m.exports,
    );
    cache.set(filename, m.exports);
    return m.exports;
  };
  const mod = load(file);
  return {
    state,
    refs,
    render() {
      i = 0;
      j = 0;
      return mod[component](props);
    },
  };
}
function all(node, pred) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((n) => all(n, pred));
  return [...(pred(node) ? [node] : []), ...all(node.props?.children, pred)];
}
function text(n) {
  if (n == null || typeof n === "boolean") return "";
  if (Array.isArray(n)) return n.map(text).join("");
  if (typeof n !== "object") return String(n);
  return text(n.props?.children);
}
const button = (tree, label) =>
  all(tree, (n) => n.type === "button" && text(n).includes(label))[0];
const change = (tree, label, value) => {
  const field = all(
    tree,
    (n) => n.type === "field" && n.props.label === label,
  )[0];
  const input = all(field, (n) =>
    ["textarea", "input", "select"].includes(n.type),
  )[0];
  input.props.onChange({ target: { value } });
};
test("R2-04 cancelling search releases only search busy; old replies cannot restore busy or prior-account results", async () => {
  const s = source("components/followup/app.tsx"),
    comp = s.statements.find(
      (n) => ts.isFunctionDeclaration(n) && n.name?.text === "FollowupApp",
    );
  const fns = comp.body.statements.filter(
    (n) =>
      ts.isFunctionDeclaration(n) &&
      ["globalSearch", "cancelSearch"].includes(n.name?.text),
  );
  for (const cause of ["edit", "clear", "navigate", "department", "logout"]) {
    const h = { busy: false, otherBusy: true, results: null };
    let resolve;
    const binding = `const searchLifetime={current:{sequence:0,controller:null}};let search='admin lookup',boot={user:{id:'admin'}},bootUserId='admin',context={department:'A'};const setBusy=v=>h.busy=v,setSearchBusy=v=>h.busy=v,setResults=v=>h.results=v,setError=()=>{},get=()=>new Promise(r=>h.resolve=r),isAbort=e=>e.name==='AbortError',message=e=>e.message;`;
    const m = { exports: {} };
    new Function(
      "h",
      "module",
      "exports",
      compile(binding + fns.map((n) => "export " + n.getText(s)).join("\n")),
    )(h, m, m.exports);
    const running = m.exports.globalSearch({ preventDefault() {} });
    assert.equal(h.busy, true, cause);
    m.exports.cancelSearch();
    assert.equal(h.busy, false, cause);
    h.resolve({ employees: [{ name: "Prior privileged result" }] });
    await running;
    assert.equal(h.results, null);
    assert.equal(h.otherBusy, true);
  }
});
test("R2-05 rejected report selection keeps exact review draft and dirty ownership; explicit cancel clears it", () => {
  const changes = [],
    reports = ["one", "two"].map((id) => ({
      id,
      state: "submitted",
      department_id: "A",
      work_date: "2026-10-19",
      entries: [],
      version: 1,
    }));
  const h = mount("components/followup/declarations.tsx", "Review", {
    boot,
    reports,
    selectedId: "one",
    onSelect: () => false,
    onDirty: (v) => changes.push(v),
    onRefresh() {},
    onError() {},
    onNotice() {},
    onProfile() {},
  });
  let tree = h.render();
  const area = all(tree, (n) => n.type === "textarea")[0];
  area.props.onChange({ target: { value: "سبب مراجعة يجب أن يبقى" } });
  tree = h.render();
  all(
    tree,
    (n) => n.type === "button" && n.props.className?.includes("fu-report-item"),
  )[1].props.onClick();
  tree = h.render();
  assert.equal(
    all(tree, (n) => n.type === "textarea")[0].props.value,
    "سبب مراجعة يجب أن يبقى",
  );
  assert.equal(changes.at(-1), true);
  const cancel = button(tree, "إلغاء مسودة المراجعة");
  assert.ok(cancel);
  cancel.props.onClick();
  assert.equal(
    all(h.render(), (n) => n.type === "textarea")[0].props.value,
    "",
  );
  assert.equal(changes.at(-1), false);
});
test("R2-05b review remains mounted on refresh and Baghdad rollover defers while any draft is dirty", () => {
  const s = source("components/followup/app.tsx");
  let visibility;
  const walk = (n) => {
    if (
      ts.isJsxSelfClosingElement(n) &&
      ts.isIdentifier(n.tagName) &&
      n.tagName.text === "Review"
    ) {
      let p = n.parent;
      while (p && !ts.isBinaryExpression(p)) p = p.parent;
      visibility = p.left;
    }
    ts.forEachChild(n, walk);
  };
  walk(s);
  const prefix = visibility.getText(s);
  assert.equal(
    new Function(
      "context",
      "loading",
      "loadFailed",
      "return !!(" + prefix + ")",
    )({ view: "review" }, true, false),
    true,
  );
  const comp = s.statements.find(
    (n) => ts.isFunctionDeclaration(n) && n.name?.text === "FollowupApp",
  );
  const effect = comp.body.statements.find((n) =>
    n.getText(s).includes("let day = today()"),
  );
  let current = "2026-10-19",
    tick,
    refresh = 0;
  const dirtyRef = { current: true };
  new Function(
    "useEffect",
    "today",
    "setInterval",
    "clearInterval",
    "setRevision",
    "dirtyRef",
    compile(effect.getText(s)),
  )(
    (fn) => fn(),
    () => current,
    (fn) => ((tick = fn), 1),
    () => {},
    () => refresh++,
    dirtyRef,
  );
  current = "2026-10-20";
  tick();
  assert.equal(refresh, 0);
  dirtyRef.current = false;
  tick();
  assert.equal(refresh, 1);
});
function fakeForm() {
  const values = {
    name: "Synthetic new account",
    email: "new@candidate.invalid",
    password: "Synthetic-Password-2026!",
    role: "VIEWER",
    reason: "Explicit isolated account decision",
    departments: [],
  };
  return {
    values,
    reset() {
      this.resetCalled = true;
    },
  };
}
class FormDataFake {
  constructor(form) {
    this.f = form.values;
  }
  get(k) {
    return this.f[k] ?? null;
  }
  getAll(k) {
    const v = this.f[k];
    return Array.isArray(v) ? v : v == null ? [] : [v];
  }
  *[Symbol.iterator]() {
    for (const [k, v] of Object.entries(this.f))
      if (!Array.isArray(v)) yield [k, v];
  }
}
async function uncertainAccount(error) {
  globalThis.sessionStorage = new MemoryStorage();
  const savedFormData = globalThis.FormData;
  globalThis.FormData = FormDataFake;
  const errors = [],
    client = {
      request: async (path) => {
        if (path.includes("?"))
          return {
            state: "configured",
            request_id: new URL(
              path,
              "http://synthetic.invalid",
            ).searchParams.get("request_id"),
          };
        throw error;
      },
    };
  const h = mount(
    "components/followup/operations.tsx",
    "Settings",
    {
      boot,
      department: "",
      date: "2026-10-19",
      onDirty() {},
      onRefresh() {},
      onError: (m) => errors.push(m),
      onNotice() {},
    },
    client,
  );
  let tree = h.render();
  change(tree, "اختيار الدور صراحةً", "VIEWER");
  tree = h.render();
  const form = all(tree, (n) => n.type === "form" && n.props.onChange)[0];
  const raw = fakeForm();
  await form.props.onSubmit({ preventDefault() {}, currentTarget: raw });
  globalThis.FormData = savedFormData;
  return { h, raw, errors, client };
}
test("R2-06 transport loss blocks a second creation and verified recovery close releases the next account", async () => {
  const { h, raw } = await uncertainAccount(
    new RequestError("Lost response", 503),
  );
  let tree = h.render();
  const close = button(tree, "إغلاق الطلب بعد التحقق");
  assert.ok(close);
  await close.props.onClick({ currentTarget: { form: raw } });
  tree = h.render();
  change(tree, "اختيار الدور صراحةً", "VIEWER");
  assert.equal(button(h.render(), "إنشاء الحساب المحدد").props.disabled, false);
});
test("R2-06b raw network failure stays uncertain instead of permitting a duplicate create", async () => {
  const { h } = await uncertainAccount(new TypeError("Network disconnected"));
  assert.ok(button(h.render(), "تحديث قائمة الحسابات للتحقق"));
  assert.equal(button(h.render(), "إنشاء الحساب المحدد").props.disabled, true);
});
test("R2-06d request lost before claim closes atomically before allowing another account", async () => {
  const { h, raw, client } = await uncertainAccount(
    new TypeError("Lost before app"),
  );
  const calls = [];
  client.request = async (url, data) => {
    calls.push({ url, data });
    const id = url.includes("?")
      ? new URL(url, "http://synthetic.invalid").searchParams.get("request_id")
      : data.close_unstarted_request_id;
    return {
      request_id: id,
      state: url.includes("?") ? "not_found" : "not_started",
    };
  };
  await button(h.render(), "إغلاق الطلب بعد التحقق").props.onClick({
    currentTarget: { form: raw },
  });
  assert.ok(calls.some((c) => c.data?.close_unstarted_request_id));
  change(h.render(), "اختيار الدور صراحةً", "VIEWER");
  assert.equal(button(h.render(), "إنشاء الحساب المحدد").props.disabled, false);
});
async function uncertainService() {
  globalThis.sessionStorage = new MemoryStorage();
  const notices = { saved: 0, closed: 0 };
  let pending;
  const employee = {
    id: "00000000-0000-4000-8000-000000000020",
    internal_code: "FANU-000020",
    name: "موظف اصطناعي",
    employment_status: "active",
    version: 1,
  };
  const client = {
    write: async (kind, data, verify, id) => {
      pending = { kind, data, id };
      throw new RequestError("Service unavailable", 503);
    },
    get: async (kind) =>
      kind === "request_receipt"
        ? null
        : [{ ...pending.data, id: "lookalike", employee_version: 2 }],
  };
  const props = {
    employee,
    actorId: boot.user.id,
    onClose: () => notices.closed++,
    onSaved: () => notices.saved++,
    onError() {},
    onDirty() {},
  };
  const h = mount(
    "components/followup/service-state.tsx",
    "ServiceStateDialog",
    props,
    client,
  );
  let tree = h.render();
  change(tree, "سبب التغيير", "سبب اصطناعي واضح");
  tree = h.render();
  await all(tree, (n) => n.type === "form")[0].props.onSubmit({
    preventDefault() {},
  });
  await button(h.render(), "حفظ القرار صراحة").props.onClick();
  return { h, notices, props, client, pending };
}
test("R2-07 unknown service save can close safely and resume the same request after remount", async () => {
  const { h, notices, props, client, pending } = await uncertainService();
  const exit = button(h.render(), "إغلاق مع حفظ طلب الاستكمال");
  assert.ok(exit);
  exit.props.onClick();
  assert.equal(notices.closed, 1);
  let repeated;
  client.write = async (kind, data, verify, id) => {
    repeated = { kind, data, id };
    throw new RequestError("Still unavailable", 503);
  };
  const reopened = mount(
    "components/followup/service-state.tsx",
    "ServiceStateDialog",
    props,
    client,
  );
  await button(reopened.render(), "إعادة محاولة نفس القرار").props.onClick();
  assert.equal(repeated.id, pending.id);
  assert.deepEqual(repeated.data, pending.data);
});
test("R2-07b a lookalike service decision is not proof of this request commit", async () => {
  const { h, notices } = await uncertainService();
  await button(h.render(), "التحقق من السجل").props.onClick();
  assert.equal(notices.saved, 0);
  assert.equal(notices.closed, 0);
});

test("R2-05c selecting a clean review report preserves loaded rows; changing fetch scope clears rows and a dirty rejection changes neither", () => {
  const s = source("components/followup/app.tsx");
  const comp = s.statements.find(
    (n) => ts.isFunctionDeclaration(n) && n.name?.text === "FollowupApp",
  );
  const fn = comp.body.statements.find(
    (n) => ts.isFunctionDeclaration(n) && n.name?.text === "change",
  );
  const initial = {
    view: "review",
    date: "2026-10-19",
    month: "2026-10",
    department: "A",
    employee: "",
    review: "one",
    query: "",
  };
  function run(patch, dirty = false) {
    const rows = {
      reports: [{ id: "one" }, { id: "two" }],
      actions: [{ id: "linked-action" }],
    };
    const h = {
      context: { ...initial },
      data: rows,
      rows,
      dirty,
      cancelled: 0,
      clears: 0,
    };
    const m = { exports: {} };
    new Function(
      "h",
      "module",
      "exports",
      compile(`
      const context=h.context,dirtyRef={current:h.dirty},emptyData={reports:[],actions:[]};
      const setContext=v=>h.context=v,setData=v=>{h.data=v;h.clears++},setError=v=>h.error=v,setResults=()=>{},setDrawer=()=>{},setNotice=()=>{};
      const cancelSearch=()=>h.cancelled++,contextSearch=()=>'';
      export ${fn.getText(s)}
    `),
    )(h, m, m.exports);
    h.accepted = m.exports.change(patch);
    return h;
  }
  const selection = run({ review: "two" });
  assert.equal(selection.accepted, true);
  assert.equal(selection.context.review, "two");
  assert.equal(
    selection.data,
    selection.rows,
    "Selecting a report has no fetch dependency change; keep its reports and actions mounted",
  );
  assert.equal(selection.clears, 0);
  for (const patch of [
    { view: "monthly" },
    { date: "2026-10-18" },
    { month: "2026-09" },
    { department: "B" },
    { employee: "employee-two" },
  ]) {
    const changed = run(patch);
    assert.equal(changed.accepted, true);
    assert.deepEqual(changed.data, { reports: [], actions: [] });
    assert.equal(changed.clears, 1);
  }
  const rejected = run({ review: "two", department: "B" }, true);
  assert.equal(rejected.accepted, false);
  assert.deepEqual(rejected.context, initial);
  assert.equal(rejected.data, rejected.rows);
  assert.equal(rejected.cancelled, 0);
  assert.equal(rejected.clears, 0);
});
