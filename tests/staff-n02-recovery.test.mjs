import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
const before = process.env.FANU_TEST_BEFORE;
const read = (file) =>
  fs.readFileSync(
    before &&
      fs.existsSync(
        path.join(before, path.relative(process.cwd(), path.resolve(file))),
      )
      ? path.join(before, path.relative(process.cwd(), path.resolve(file)))
      : file,
    "utf8",
  );
const compile = (s, fileName = "module.ts") =>
  ts.transpileModule(s, {
    fileName,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
function modules(hooks) {
  const cache = new Map();
  const load = (file) => {
    if (cache.has(file)) return cache.get(file);
    const m = { exports: {} };
    cache.set(file, m.exports);
    new Function("require", "module", "exports", compile(read(file), file))(
      (name) => {
        if (name === "react") return hooks;
        if (name === "react/jsx-runtime")
          return {
            jsx: (type, props) => ({ type, props }),
            jsxs: (type, props) => ({ type, props }),
            Fragment: "fragment",
          };
        if (name === "./ui") return { Field: "field" };
        if (name === "./domain")
          return { today: () => "2026-10-21", serviceLabels: {} };
        if (!name.startsWith(".")) throw Error("Unexpected module " + name);
        return load(path.resolve(path.dirname(file), name + ".ts"));
      },
      m,
      m.exports,
    );
    cache.set(file, m.exports);
    return m.exports;
  };
  return {
    load,
    client: load(path.resolve("components/followup/client.ts")),
    account: load(path.resolve("components/followup/account-recovery.ts")),
    decision: load(path.resolve("components/followup/decision-recovery.ts")),
  };
}
class Storage {
  #values = new Map();
  getItem(k) {
    return this.#values.get(k) ?? null;
  }
  setItem(k, v) {
    this.#values.set(k, String(v));
    Object.defineProperty(this, k, {
      configurable: true,
      enumerable: true,
      value: String(v),
      writable: true,
    });
  }
  removeItem(k) {
    this.#values.delete(k);
    delete this[k];
  }
  key(i) {
    return [...this.#values.keys()][i] ?? null;
  }
  get length() {
    return this.#values.size;
  }
}
const actor = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222",
  eid = "00000000-0000-4000-8000-000000000020";
const attempt = () => ({
  id: crypto.randomUUID(),
  actor,
  kind: "employee_identity",
  data: {
    employee_id: eid,
    version: 1,
    name: "Synthetic private corrected name",
    employee_number: "SYNTHETIC-PRIVATE-NUMBER",
    reason: "Synthetic private decision reason",
  },
});
test("N02 redacted same-account pointers restore only exact authenticated payloads; another actor and a lookalike proof cannot restore them", () => {
  const { client, decision, p } = fixture();
  client.clearSessionDrafts(actor);
  const pointer = decision.readDecisionRecovery(actor, eid, p.kind);
  assert.equal(pointer.redacted, true);
  assert.equal(pointer.data.reason, undefined);
  const proof = {
    request_id: p.id,
    actor,
    kind: p.kind,
    employee_id: eid,
    state: "staged",
    data: p.data,
  };
  assert.deepEqual(decision.restoreDecisionAttempt(pointer, proof), p);
  assert.throws(() =>
    decision.restoreDecisionAttempt(pointer, { ...proof, actor: other }),
  );
  assert.throws(() =>
    decision.restoreDecisionAttempt(pointer, {
      ...proof,
      request_id: crypto.randomUUID(),
    }),
  );
  assert.throws(() =>
    decision.restoreDecisionAttempt(pointer, {
      ...proof,
      state: "not_found",
      data: undefined,
    }),
  );
  assert.equal(
    decision.restoreDecisionAttempt(pointer, {
      ...proof,
      state: "closed",
      data: undefined,
    }),
    null,
  );
});
test("N02 confirmed logout invalidates late sensitive saves while failed logout retains the recovery lifetime", async () => {
  const { client, account, decision, p, pending } = fixture();
  const epoch = account.captureRecoverySession(actor);
  const failed = logoutFunction(client, Error("Synthetic lost response"));
  await failed.logout();
  assert.equal(account.recoverySessionCurrent(actor, epoch), true);
  await logoutFunction(client, { ok: true }).logout();
  assert.equal(decision.saveDecisionRecovery(p, epoch), false);
  assert.equal(account.saveAccountPending(actor, pending, epoch), false);
  assert.equal(
    decision.readDecisionRecovery(actor, eid, p.kind).redacted,
    true,
  );
  assert.equal(account.readAccountPending(actor).email, undefined);
});
test("N02 Settings StrictMode setup-cleanup-setup restores active callbacks while a logged-out generation stays rejected", () => {
  const tree = ts.createSourceFile(
    "operations.tsx",
    read("components/followup/operations.tsx"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const settings = tree.statements.find(
    (n) => ts.isFunctionDeclaration(n) && n.name?.text === "Settings",
  );
  const effect = settings.body.statements.find(
    (n) =>
      ts.isExpressionStatement(n) &&
      ts.isCallExpression(n.expression) &&
      n.expression.expression.getText(tree) === "useEffect" &&
      n.getText(tree).includes("creationLifetime"),
  );
  const declarations = settings.body.statements.flatMap((n) =>
    ts.isVariableStatement(n) ? [...n.declarationList.declarations] : [],
  );
  const current = declarations.find(
    (n) => n.name.getText(tree) === "creationCurrent",
  );
  assert.ok(
    effect && current,
    "Use the actual Settings lifecycle and callback ownership guard",
  );
  const { account, client } = modules();
  globalThis.sessionStorage = new Storage();
  const epoch = account.captureRecoverySession(actor),
    lifetime = { active: true, generation: epoch };
  const m = { exports: {} };
  new Function(
    "account",
    "module",
    "exports",
    compile(
      `export function cycle(value){const creationLifetime={current:value},boot={user:{id:${JSON.stringify(actor)}}},recoverySessionCurrent=account.recoverySessionCurrent;const useEffect=setup=>{const cleanup=setup();cleanup();setup();};${effect.getText(tree)}const ${current.getText(tree)};return creationCurrent();}`,
    ),
  )(account, m, m.exports);
  assert.equal(
    m.exports.cycle(lifetime),
    true,
    "StrictMode reconnect must restore active callbacks",
  );
  assert.equal(lifetime.active, true);
  client.clearSessionDrafts(actor);
  assert.equal(
    m.exports.cycle(lifetime),
    false,
    "StrictMode must not revive a logged-out generation",
  );
});
test("N02 a lost logout reply retains recovery immediately; confirmed other-actor login or unauthenticated bootstrap redacts only the remembered owner", async () => {
  for (const transition of ["other-login", "unauthenticated"]) {
    const { client, decision, p } = fixture();
    client.activateRecoveryActor(actor);
    await logoutFunction(
      client,
      Error("Response lost after provider logout"),
    ).logout();
    assert.equal(
      decision.readDecisionRecovery(actor, eid, p.kind).data.reason,
      p.data.reason,
    );
    if (transition === "other-login") client.activateRecoveryActor(other);
    else client.confirmRecoverySignedOut();
    assert.equal(decision.readDecisionRecovery(actor, eid, p.kind).id, p.id);
    assert.equal(
      decision.readDecisionRecovery(actor, eid, p.kind).data.reason,
      undefined,
    );
    assert.equal(
      sessionStorage.getItem(
        `fu-decision-recovery:${other}:${eid}:service_state`,
      ),
      "other actor private unchanged",
    );
    assert.equal(
      sessionStorage.getItem(`fu-account-creation:${other}`),
      "other actor account unchanged",
    );
  }
  const { client, decision, p } = fixture();
  client.activateRecoveryActor(actor);
  await logoutFunction(client, Error("Lost response")).logout();
  client.activateRecoveryActor(actor);
  assert.equal(decision.readDecisionRecovery(actor, eid, p.kind).id, p.id);
  assert.equal(
    decision.readDecisionRecovery(actor, eid, p.kind).data.reason,
    p.data.reason,
  );
});
test("N02 a storage write failure retains only in-memory recovery identifiers and confirmed logout still clears the visible session", async () => {
  const { client, account, decision, p, pending } = fixture();
  sessionStorage.setItem = () => {
    throw Error("Synthetic quota failure");
  };
  const f = logoutFunction(client, { ok: true });
  await f.logout();
  assert.equal(f.h.session, "login");
  assert.equal(
    sessionStorage.getItem(`fu-decision-recovery:${actor}:${eid}:${p.kind}`),
    null,
  );
  assert.equal(decision.readDecisionRecovery(actor, eid, p.kind).id, p.id);
  assert.equal(
    decision.readDecisionRecovery(actor, eid, p.kind).data.reason,
    undefined,
  );
  assert.equal(account.readAccountPending(actor).id, pending.id);
  assert.equal(account.readAccountPending(actor).email, undefined);
});
test("N02 legacy staging cannot hold logout when fetch never settles, and a staging error cannot prevent confirmed session clearing", async () => {
  const { client, p } = fixture(),
    previous = globalThis.fetch;
  globalThis.fetch = () => new Promise(() => {});
  try {
    const started = Date.now();
    await logoutFunction(client, { ok: true }).logout();
    assert.ok(Date.now() - started < 3000);
    assert.equal(
      sessionStorage
        .getItem(`fu-decision-recovery:${actor}:${eid}:${p.kind}`)
        .includes(p.data.reason),
      false,
    );
  } finally {
    globalThis.fetch = previous;
  }
});
function uiHarness(existing, overrides) {
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
  };
  const m = existing || modules(hooks);
  Object.assign(m.client, overrides);
  const component = m.load(
    path.resolve("components/followup/service-state.tsx"),
  ).ServiceStateDialog;
  const events = { saved: 0, closed: 0, errors: [] };
  const props = {
    actorId: actor,
    identity: true,
    employee: {
      id: eid,
      name: "Synthetic current name",
      internal_code: "SYNTHETIC-20",
      employee_number: "20",
      employment_status: "active",
      version: 1,
    },
    onSaved: () => events.saved++,
    onClose: () => events.closed++,
    onError: (v) => events.errors.push(v),
    onDirty: () => {},
  };
  return {
    ...m,
    events,
    render() {
      i = j = 0;
      return component(props);
    },
  };
}
function nodes(v) {
  if (!v || typeof v !== "object") return [];
  if (Array.isArray(v)) return v.flatMap(nodes);
  return [v, ...nodes(v.props?.children)];
}
function nodeText(v) {
  if (typeof v === "string") return v;
  if (!v || typeof v !== "object") return "";
  if (Array.isArray(v)) return v.map(nodeText).join("");
  return nodeText(v.props?.children);
}
const click = (h, label) =>
  nodes(h.render())
    .find((n) => n.type === "button" && nodeText(n).includes(label))
    .props.onClick();
test("N02 returning to the same actor hydrates a redacted unknown and retries the same RID/payload; a late reply after logout cannot save or signal success", async () => {
  globalThis.sessionStorage = new Storage();
  const p = attempt(),
    calls = [];
  let resolveStage;
  const h = uiHarness(null, {
    get: async () => ({
      request_id: p.id,
      actor,
      kind: p.kind,
      employee_id: eid,
      state: "staged",
      data: p.data,
    }),
    write: async (kind, data, _verify, id) => {
      calls.push({ kind, data, id });
      if (kind === "decision_recovery_stage")
        return await new Promise((resolve) => (resolveStage = resolve));
      throw Error("Business write must not run after logout");
    },
  });
  h.decision.saveDecisionRecovery(p);
  h.client.clearSessionDrafts(actor);
  // Mount a fresh component after the same actor signs in; generation is current.
  const resumed = uiHarness(null, {});
  resumed.decision.saveDecisionRecovery({
    ...p,
    data: { employee_id: eid, version: 1 },
    redacted: true,
  });
  let reply;
  Object.assign(resumed.client, {
    get: async () => ({
      request_id: p.id,
      actor,
      kind: p.kind,
      employee_id: eid,
      state: "staged",
      data: p.data,
    }),
    write: async (kind, data, _verify, id) => {
      calls.push({ kind, data, id });
      if (kind === "decision_recovery_stage")
        return await new Promise((resolve) => (reply = resolve));
      throw Error("Business write must not run after logout");
    },
  });
  assert.equal(
    nodes(resumed.render()).some((n) => n.type === "fieldset"),
    false,
    "Redacted payload must not display guessed form fields",
  );
  await click(resumed, "التحقق من السجل");
  const waiting = click(resumed, "إعادة محاولة نفس القرار");
  for (let n = 0; n < 10 && !reply; n++) await Promise.resolve();
  assert.ok(reply);
  assert.equal(calls.at(-1).id, p.id);
  assert.deepEqual(calls.at(-1).data.data, p.data);
  resumed.client.clearSessionDrafts(actor);
  reply({
    request_id: p.id,
    actor,
    kind: p.kind,
    employee_id: eid,
    state: "staged",
    data: p.data,
  });
  await waiting;
  assert.equal(resumed.events.saved, 0);
  assert.equal(resumed.events.closed, 0);
  assert.equal(
    calls.some((c) => c.kind === p.kind),
    false,
  );
  assert.equal(
    sessionStorage
      .getItem(`fu-decision-recovery:${actor}:${eid}:${p.kind}`)
      .includes(p.data.reason),
    false,
  );
});
function fixture() {
  globalThis.sessionStorage = new Storage();
  const m = modules(),
    p = attempt(),
    account = { id: crypto.randomUUID(), email: "private@synthetic.invalid" };
  m.decision.saveDecisionRecovery(p);
  m.account.saveAccountPending(actor, account);
  sessionStorage.setItem(
    `fu-evening-draft:${actor}:A:2026-10-21`,
    "old declaration private",
  );
  sessionStorage.setItem(`fu-roster-setup:${actor}`, "old roster private");
  sessionStorage.setItem(
    `fu-decision-recovery:${other}:${eid}:service_state`,
    "other actor private unchanged",
  );
  sessionStorage.setItem(
    `fu-account-creation:${other}`,
    "other actor account unchanged",
  );
  return { ...m, p, pending: account };
}
function logoutFunction(client, response) {
  const tree = ts.createSourceFile(
    "app.tsx",
    read("components/followup/app.tsx"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const app = tree.statements.find(
    (n) => ts.isFunctionDeclaration(n) && n.name?.text === "FollowupApp",
  );
  const logout = app.body.statements.find(
    (n) => ts.isFunctionDeclaration(n) && n.name?.text === "logout",
  );
  const h = {
    dirty: false,
    boot: { user: { id: actor } },
    session: "ready",
    error: "",
    ...client,
    request: async () => {
      if (response instanceof Error) throw response;
      return response;
    },
  };
  const code = `const {dirty,boot,request,clearSessionDrafts,prepareLogoutRecovery,clearRetryKeys}=h;const cancelSearch=()=>{},clearDownloads=()=>{},setBusy=()=>{},setBoot=v=>h.boot=v,setData=()=>{},setResults=()=>{},setSession=v=>h.session=v,setSaved=()=>{},setError=v=>h.error=v,message=e=>e.message,emptyData={};export ${logout.getText(tree)}`;
  const m = { exports: {} };
  new Function("h", "module", "exports", compile(code))(h, m, m.exports);
  return { h, logout: m.exports.logout };
}
test("N02 confirmed logout strips sensitive recovery fields, preserves exact identifiers, and leaves other actors untouched", async () => {
  const { client, account, decision, p, pending } = fixture();
  const f = logoutFunction(client, { ok: true });
  await f.logout();
  assert.equal(f.h.session, "login");
  const raw = sessionStorage.getItem(
    `fu-decision-recovery:${actor}:${eid}:employee_identity`,
  );
  assert.ok(raw, "Unknown request identity must survive logout");
  for (const value of [p.data.name, p.data.employee_number, p.data.reason])
    assert.equal(
      raw.includes(value),
      false,
      "PII must not remain after confirmed logout",
    );
  const recovered = decision.readDecisionRecovery(
    actor,
    eid,
    "employee_identity",
  );
  assert.equal(recovered.id, p.id);
  assert.equal(recovered.actor, actor);
  assert.equal(recovered.data.employee_id, eid);
  const accountRaw = sessionStorage.getItem(`fu-account-creation:${actor}`);
  assert.equal(
    accountRaw.includes(pending.email),
    false,
    "Email must not remain after confirmed logout",
  );
  assert.equal(account.readAccountPending(actor).id, pending.id);
  assert.equal(
    sessionStorage.getItem(`fu-evening-draft:${actor}:A:2026-10-21`),
    null,
  );
  assert.equal(sessionStorage.getItem(`fu-roster-setup:${actor}`), null);
  assert.equal(
    sessionStorage.getItem(
      `fu-decision-recovery:${other}:${eid}:service_state`,
    ),
    "other actor private unchanged",
  );
  assert.equal(
    sessionStorage.getItem(`fu-account-creation:${other}`),
    "other actor account unchanged",
  );
});
test("N02 a failed logout retains the current actor's exact unknown recovery and does not clear another actor", async () => {
  const { client, p, pending } = fixture();
  const snapshot = Object.fromEntries(
    Object.keys(sessionStorage).map((k) => [k, sessionStorage.getItem(k)]),
  );
  const f = logoutFunction(client, Error("Synthetic lost logout response"));
  await f.logout();
  assert.equal(f.h.session, "ready");
  assert.equal(
    sessionStorage.getItem(
      `fu-decision-recovery:${actor}:${eid}:employee_identity`,
    ),
    JSON.stringify(p),
  );
  assert.equal(
    sessionStorage.getItem(`fu-account-creation:${actor}`),
    JSON.stringify(pending),
  );
  for (const [key, value] of Object.entries(snapshot))
    assert.equal(sessionStorage.getItem(key), value);
});
