import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const moduleUrls = new Map();
async function moduleUrl(source) {
  if (moduleUrls.has(source)) return moduleUrls.get(source);
  const text = await readFile(
    new URL("../components/followup/" + source + ".ts", import.meta.url),
    "utf8",
  );
  let compiled = ts.transpileModule(text, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const dependencies = [
    ...new Set(
      [...compiled.matchAll(/from\s*(["'])\.\/([^"']+)\1/g)].map((m) => m[2]),
    ),
  ];
  for (const dependency of dependencies) {
    const url = await moduleUrl(dependency);
    compiled = compiled
      .split(JSON.stringify("./" + dependency))
      .join(JSON.stringify(url))
      .split("'./" + dependency + "'")
      .join(JSON.stringify(url));
  }
  const url =
    "data:text/javascript;base64," + Buffer.from(compiled).toString("base64");
  moduleUrls.set(source, url);
  return url;
}
const load = async (source) => import(await moduleUrl(source));
const domain = await load("domain"),
  client = await load("client");
test("explicit decision retry ID survives cache reset and malformed acknowledgement", async () => {
  const original = global.fetch,
    calls = [],
    requestId = "11111111-1111-4111-8111-111111111111";
  let attempt = 0;
  client.clearRetryKeys();
  global.fetch = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return Response.json(attempt++ ? { id: "decision" } : null);
  };
  try {
    await assert.rejects(
      client.write(
        "roster_setup_commit",
        { preview_id: "preview" },
        (value) => value?.id === "decision",
        requestId,
      ),
    );
    client.clearRetryKeys();
    assert.deepEqual(
      await client.write(
        "roster_setup_commit",
        { preview_id: "preview" },
        (value) => value?.id === "decision",
        requestId,
      ),
      { id: "decision" },
    );
    assert.deepEqual(
      calls.map((value) => value.request_id),
      [requestId, requestId],
    );
    await assert.rejects(
      client.write(
        "roster_setup_commit",
        { preview_id: "preview" },
        undefined,
        "invalid",
      ),
    );
    assert.equal(calls.length, 2);
  } finally {
    global.fetch = original;
    client.clearRetryKeys();
  }
});
test("decision recovery stores only two IDs and logout removes only current account recovery", () => {
  const original = global.sessionStorage,
    values = {
      getItem(key) {
        return this[key] ?? null;
      },
      setItem(key, value) {
        this[key] = value;
      },
      removeItem(key) {
        delete this[key];
      },
      get length() {
        return Object.keys(this).filter(
          (k) => k !== "length" && typeof this[k] === "string",
        ).length;
      },
      key(i) {
        return (
          Object.keys(this).filter(
            (k) => k !== "length" && typeof this[k] === "string",
          )[i] ?? null
        );
      },
    };
  global.sessionStorage = values;
  const pointer = {
    preview_id: "22222222-2222-4222-8222-222222222222",
    request_id: "33333333-3333-4333-8333-333333333333",
  };
  try {
    client.saveRosterRecovery("actor", {
      ...pointer,
      employees: [{ name: "Synthetic private name" }],
      reason: "private source",
    });
    client.saveRosterRecovery("other", pointer);
    assert.deepEqual(
      JSON.parse(values[client.rosterRecoveryKey("actor")]),
      pointer,
    );
    assert.deepEqual(client.readRosterRecovery("actor"), pointer);
    client.clearSessionDrafts("actor");
    assert.equal(client.readRosterRecovery("actor"), null);
    assert.deepEqual(client.readRosterRecovery("other"), pointer);
    values[client.rosterRecoveryKey("actor")] = "{bad";
    assert.throws(() => client.readRosterRecovery("actor"));
    assert.equal(values[client.rosterRecoveryKey("actor")], "{bad");
  } finally {
    global.sessionStorage = original;
  }
});
test("definitive expired rejection is distinguished from network ambiguity and permission loss", async () => {
  const original = global.fetch;
  try {
    for (const status of [410, 409, 403, 503]) {
      global.fetch = async () =>
        Response.json({ error: "Synthetic rejection" }, { status });
      await assert.rejects(
        client.request("/api/followup", { kind: "roster_setup_commit" }),
        (error) =>
          error instanceof client.RequestError && error.status === status,
      );
    }
    global.fetch = async () => {
      throw Error("response lost");
    };
    await assert.rejects(
      client.request("/api/followup", { kind: "roster_setup_commit" }),
      (error) => !(error instanceof client.RequestError),
    );
  } finally {
    global.fetch = original;
  }
});
test("ambiguous saves reconcile every intended field and a newer version, including note-only edits", () => {
  const p = {
    id: "report",
    version: 1,
    department_id: "dept",
    work_date: "2026-10-14",
    channel: "phone",
    reporter_id: null,
    reporter_registry_id: "registry",
    note: "updated note",
    reported_at: null,
    evidence_reference: "reference",
    entries: [{ employee_id: "one", status: "absent3" }],
  };
  const r = { ...p, version: 2, state: "draft", entered_by: "actor" };
  assert.equal(domain.declarationMatchesSaved(r, p, "save", "actor"), true);
  for (const change of [
    { version: 1 },
    { note: "old note" },
    { reporter_registry_id: "other" },
    { reported_at: "2026-10-14T18:00:00Z" },
    { evidence_reference: "old reference" },
    { department_id: "other" },
    { work_date: "2026-10-13" },
    { channel: "account" },
    { state: "reviewed" },
    { entries: [{ employee_id: "other", status: "absent3" }] },
  ])
    assert.equal(
      domain.declarationMatchesSaved({ ...r, ...change }, p, "save", "actor"),
      false,
    );
  assert.equal(
    domain.declarationMatchesSaved(
      { ...r, reported_at: "2026-10-14T21:15:00Z" },
      { ...p, reported_at: "2026-10-15T00:15:00+03:00" },
      "save",
      "actor",
    ),
    true,
  );
  const fresh = { ...p, id: undefined, version: undefined };
  assert.equal(
    domain.declarationMatchesSaved(
      { ...r, entered_by: "other" },
      fresh,
      "save",
      "actor",
    ),
    false,
  );
  assert.equal(domain.declarationMatchesSaved(null, p, "save", "actor"), false);
  assert.equal(
    domain.declarationMatchesSaved(
      { ...r, entries: [...r.entries, ...r.entries] },
      { ...p, entries: [...p.entries, ...p.entries] },
      "save",
      "actor",
    ),
    false,
  );
});
test("malformed HTTP responses keep business writes ambiguous without showing raw HTML", async () => {
  const original = global.fetch;
  global.fetch = async () =>
    new Response("<html>synthetic infrastructure error</html>", {
      status: 200,
    });
  try {
    await assert.rejects(
      client.request("/api/followup", { kind: "save" }),
      (e) => e.message.startsWith("لم تصل") && !e.message.includes("html"),
    );
    await assert.rejects(client.request("/api/followup"), (e) =>
      e.message.startsWith("تعذر تحميل"),
    );
  } finally {
    global.fetch = original;
  }
});
test("malformed success snapshots retain the original idempotency key until verified", async () => {
  const original = global.fetch,
    requests = [];
  let attempt = 0;
  client.clearRetryKeys();
  global.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return Response.json(attempt++ ? { id: "saved" } : null);
  };
  try {
    await assert.rejects(
      client.write("save", { note: "same" }, (r) => r?.id === "saved"),
    );
    assert.deepEqual(
      await client.write("save", { note: "same" }, (r) => r?.id === "saved"),
      { id: "saved" },
    );
    assert.equal(requests[0].request_id, requests[1].request_id);
  } finally {
    global.fetch = original;
    client.clearRetryKeys();
  }
});
test("reported timestamp loads in Baghdad and round-trips after midnight without changing the service date", () => {
  const timestamp = "2026-10-14T21:35:00.000Z",
    local = domain.baghdadLocalDateTime(timestamp);
  assert.equal(local, "2026-10-15T00:35");
  assert.equal(new Date(local + "+03:00").toISOString(), timestamp);
  assert.equal(domain.baghdadLocalDateTime(null), "");
  assert.equal(domain.baghdadLocalDateTime(""), "");
  const context = domain.parseContext("?view=reporting&date=2026-10-14");
  assert.equal(context.date, "2026-10-14");
});
const statuses = [
  { code: "present", category: "present", weight: 0, enabled: true },
  { code: "absentx3", category: "absent", weight: 3, enabled: false },
  { code: "mission", category: "other", weight: 0, enabled: false },
];

test("headcount, historical policy weights and unresolved data stay distinct", () => {
  assert.deepEqual(
    domain.counts(
      [
        { status: "present" },
        { status: "absentx3" },
        { status: "mission" },
        { status: "" },
        { status: "present", scope_state: "future" },
        { status: "absentx3", scope_state: "outside_roster" },
        { status: "present", scope_state: "assignment_unverified" },
      ],
      statuses,
    ),
    {
      expected: 4,
      present: 1,
      absent: 1,
      leave: 0,
      other: 1,
      unresolved: 1,
      weighted: 3,
    },
  );
  assert.equal(
    domain.counts(
      [{ status: "old", status_category: "absent", status_weight: 2 }],
      statuses,
    ).weighted,
    2,
  );
});
test("explicit bulk selection cannot include hidden rows", () => {
  assert.deepEqual(
    domain.visibleSelection(
      ["one", "hidden", "three"],
      [{ id: "one" }, { id: "three" }],
    ),
    ["one", "three"],
  );
});
test("revision comparison exposes a changed, removed or newly reported person", () => {
  const before = [
      { employee_id: "one", employee_name: "One", status: "present" },
      { employee_id: "two", employee_name: "Two", status: "unresolved" },
    ],
    after = [
      { employee_id: "one", employee_name: "One", status: "absentx3" },
      { employee_id: "three", employee_name: "Three", status: "present" },
    ];
  assert.deepEqual(
    domain.revisionDiff(before, after).map((d) => [d.id, d.before, d.after]),
    [
      ["one", "present", "absentx3"],
      ["two", "unresolved", null],
      ["three", null, "present"],
    ],
  );
});
test("saved monthly scope round-trips immutable employee and department IDs", () => {
  const scope = domain.parseContext(
    "?view=monthly&date=2026-10-14&month=2026-02&department=dept-id&employee=immutable-id&actions=completed&q=sensitive-local-search",
  );
  const payload = domain.savedViewInput(scope, "  Monthly range  ");
  assert.deepEqual(payload, {
    name: "Monthly range",
    page: "monthly",
    start: "2026-02-01",
    end: "2026-02-28",
    department_id: "dept-id",
    employee_id: "immutable-id",
    state: "completed",
  });
  const restored = domain.savedViewContext({
    id: "view",
    version: 1,
    ...payload,
    start_date: payload.start,
    end_date: payload.end,
  });
  assert.equal(restored.month, "2026-02");
  assert.equal(restored.employee, "immutable-id");
  assert.equal(restored.department, "dept-id");
  assert.equal(restored.query, "");
});
test("saved employee profile targets directory by UUID without restoring editable forms", () => {
  const restored = domain.savedViewContext({
    id: "view",
    version: 1,
    name: "Profile",
    page: "employees",
    start_date: "2026-10-14",
    employee_id: "exact-uuid",
    department_id: "d",
  });
  assert.equal(restored.view, "directory");
  assert.equal(restored.employee, "exact-uuid");
  assert.equal(restored.review, "");
  assert.throws(() =>
    domain.savedViewInput({ ...restored, view: "reporting" }, "Declaration"),
  );
});
test("report-family deep links and saved individual summary keep selected person and month", () => {
  const scope = domain.parseContext(
    "?view=reports&report=employee&month=2026-10&employee=exact-id&department=dept-id",
  );
  assert.match(domain.contextSearch(scope), /report=employee/);
  const payload = domain.savedViewInput(scope, "Employee summary");
  assert.equal(payload.state, "employee");
  assert.equal(payload.start, "2026-10-01");
  assert.equal(payload.end, "2026-10-31");
  const restored = domain.savedViewContext({
    ...payload,
    id: "saved",
    version: 1,
    start_date: payload.start,
  });
  assert.equal(restored.reportKind, "employee");
  assert.equal(restored.employee, "exact-id");
});
test("saved names are bounded and expiry horizon crosses month/year correctly", () => {
  assert.equal(
    domain.savedViewInput(domain.parseContext(""), "x".repeat(200)).name.length,
    100,
  );
  assert.equal(domain.addDays("2026-12-15", 30), "2027-01-14");
  assert.equal(domain.addDays("2028-02-28", 1), "2028-02-29");
});
test("authorized get uses no-store, exact scope filters and abort signal", async () => {
  const original = globalThis.fetch,
    controller = new AbortController();
  try {
    globalThis.fetch = async (url, options) => {
      assert.match(url, /kind=pending_documents/);
      assert.match(url, /employee_id=exact-id/);
      assert.equal(options.cache, "no-store");
      assert.equal(options.signal, controller.signal);
      return new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    assert.deepEqual(
      await client.get(
        "pending_documents",
        { employee_id: "exact-id" },
        controller.signal,
      ),
      [],
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("ambiguous business mutation retry retains one request ID, different payload gets another", async () => {
  client.clearRetryKeys();
  const original = globalThis.fetch,
    ids = [];
  let first = true;
  try {
    globalThis.fetch = async (url, options) => {
      const b = JSON.parse(options.body);
      ids.push(b.request_id);
      assert.equal(options.headers["x-hr-request"], "1");
      if (first) {
        first = false;
        throw new Error("response lost");
      }
      return new Response('{"id":"saved"}', { status: 200 });
    };
    await assert.rejects(
      client.write("saved_view", { page: "daily", start: "2026-10-14" }),
      /response lost/,
    );
    await client.write("saved_view", { page: "daily", start: "2026-10-14" });
    await client.write("saved_view", { page: "daily", start: "2026-10-15" });
    assert.equal(ids[0], ids[1]);
    assert.notEqual(ids[1], ids[2]);
  } finally {
    globalThis.fetch = original;
    client.clearRetryKeys();
  }
});
test("private upload retries bind exact bytes and immutable recovery metadata", async () => {
  client.clearRetryKeys();
  const original = globalThis.fetch,
    calls = [];
  let first = true;
  const payload = {
    operation: "upload",
    resume_document_id: "pending-id",
    employee_id: "immutable-id",
    content_base64: "synthetic-original",
    title: "Frozen title",
    kind: "photo",
    photo_crop: { x: 0, y: 0, width: 1, height: 1 },
  };
  try {
    globalThis.fetch = async (url, options) => {
      const b = JSON.parse(options.body);
      calls.push(b);
      assert.equal(url, "/api/followup/documents");
      if (first) {
        first = false;
        throw new Error("network interrupted");
      }
      return new Response('{"id":"pending-id","state":"active"}', {
        status: 200,
      });
    };
    await assert.rejects(client.privateWrite(payload), /network interrupted/);
    await client.privateWrite(payload);
    assert.equal(calls[0].request_id, calls[1].request_id);
    assert.equal(calls[1].resume_document_id, "pending-id");
    await client.privateWrite({
      ...payload,
      content_base64: "different-original",
    });
    assert.notEqual(calls[1].request_id, calls[2].request_id);
    assert.equal(calls[1].content_base64, "synthetic-original");
  } finally {
    globalThis.fetch = original;
    client.clearRetryKeys();
  }
});
test("logout clears retry identity and only this user’s recoverable declaration edits", async () => {
  const originalStorage = globalThis.sessionStorage,
    originalFetch = globalThis.fetch,
    ids = [];
  globalThis.sessionStorage = {
    ["fu-evening-draft:user:d:date"]: "private draft",
    ["fu-evening-draft:other:d:date"]: "other",
    getItem(key) {
      return this[key] ?? null;
    },
    setItem(key, value) {
      this[key] = value;
    },
    get length() {
      return Object.keys(this).filter(
        (k) => k !== "length" && typeof this[k] === "string",
      ).length;
    },
    key(i) {
      return (
        Object.keys(this).filter(
          (k) => k !== "length" && typeof this[k] === "string",
        )[i] ?? null
      );
    },
    removeItem(key) {
      delete this[key];
    },
  };
  try {
    client.clearSessionDrafts("user");
    assert.equal(sessionStorage["fu-evening-draft:user:d:date"], undefined);
    assert.equal(sessionStorage["fu-evening-draft:other:d:date"], "other");
    globalThis.fetch = async (url, options) => {
      ids.push(JSON.parse(options.body).request_id);
      throw Error("lost response");
    };
    await assert.rejects(client.write("action", { id: "a" }));
    client.clearRetryKeys();
    await assert.rejects(client.write("action", { id: "a" }));
    assert.notEqual(ids[0], ids[1]);
  } finally {
    globalThis.sessionStorage = originalStorage;
    globalThis.fetch = originalFetch;
    client.clearRetryKeys();
  }
});
