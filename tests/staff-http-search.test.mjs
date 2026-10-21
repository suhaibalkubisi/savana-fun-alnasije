import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import ts from "typescript";
import { z } from "zod";
const server = await fs.readFile("lib/server/supabase.ts", "utf8"),
  tree = ts.createSourceFile("server.ts", server, ts.ScriptTarget.Latest, true),
  names = new Set([
    "AppError",
    "body",
    "errorResponse",
    "json",
    "protectMutation",
  ]);
const basics = tree.statements
  .filter(
    (n) =>
      (ts.isClassDeclaration(n) || ts.isFunctionDeclaration(n)) &&
      names.has(n.name?.text),
  )
  .map((n) => n.getText(tree))
  .join("\n");
const route = ts.createSourceFile(
  "users.ts",
  await fs.readFile("app/api/users/route.ts", "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
const source =
  "const {z}=globalThis.__staffDeps;const session=(...a)=>globalThis.__staffHttp.session(...a),rpc=(...a)=>globalThis.__staffHttp.rpc(...a),upstream=(...a)=>globalThis.__staffHttp.upstream(...a);\n" +
  basics +
  "\n" +
  route.statements
    .filter((n) => !ts.isImportDeclaration(n))
    .map((n) => n.getText(route))
    .join("\n");
globalThis.__staffDeps = { z };
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { POST } = await import(
  "data:text/javascript;base64," + Buffer.from(compiled).toString("base64")
);
delete globalThis.__staffDeps;
const p = {
  name: "Synthetic user",
  email: "synthetic@example.invalid",
  password: "Synthetic-Password-2026!",
  role: "VIEWER",
  departments: [],
  reason: "Synthetic explicit account decision",
  request_id: crypto.randomUUID(),
};
test("actual account route separates invalid/duplicate/unavailable/unknown/partial outcomes and propagates reasons", async () => {
  for (const s of [
    { status: 422, data: { code: "validation_failed" }, expected: 422 },
    { status: 409, data: { code: "email_exists" }, expected: 409 },
    { status: 503, data: {}, expected: 503 },
    { status: 200, data: {}, expected: 503 },
    {
      status: 200,
      data: { id: crypto.randomUUID() },
      partial: true,
      expected: 409,
    },
    { status: 200, data: { id: crypto.randomUUID() }, expected: 200 },
  ]) {
    let creates = 0;
    let creationState='pending', createdId=null;
    globalThis.__staffHttp = {
      session: async () => ({
        profile: { followup_role: "ADMIN" },
        token: "synthetic",
      }),
      rpc: async (_fn, args) => {
        if (args.p_kind === "bootstrap") return { departments: [] };
        if (args.p_kind === "account_creation_begin") return {...args.p_data,request_id:args.p_request_id,state:'pending',start:true,user_id:null};
        if (args.p_kind === "account_creation_result") {creationState=args.p_data.state;createdId=args.p_data.user_id||createdId;return {...p,request_id:args.p_request_id,state:creationState,user_id:createdId};}
        if (args.p_kind === "account_creation") return {...p,request_id:p.request_id,state:creationState==='created'&&!s.partial?'configured':creationState,user_id:createdId};
        assert.equal(args.p_data.reason, p.reason);
        if (s.partial) throw Error("Synthetic configuration failure");
          return {user_id:args.p_data.user_id,role:args.p_data.role,active:true,version:1};
      },
      upstream: async () => {
        creates++;
        return {
          response: new Response(null, { status: s.status }),
          data: s.data,
        };
      },
    };
    const req = new Request("http://synthetic.invalid/api/users", {
      method: "POST",
      headers: {
        origin: "http://synthetic.invalid",
        "content-type": "application/json",
        "x-hr-request": "1",
      },
      body: JSON.stringify(p),
    });
    const response = await POST(req);
    assert.equal(response.status, s.expected);
    assert.equal(creates, 1);
    if (s.status === 503)
      assert.match((await response.json()).error, /غير متاحة/);
  }
  delete globalThis.__staffHttp;
});
const app = ts.createSourceFile(
    "app.tsx",
    await fs.readFile("components/followup/app.tsx", "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  ),
  component = app.statements.find(
    (n) => ts.isFunctionDeclaration(n) && n.name?.text === "FollowupApp",
  );
const functions = component.body.statements.filter(
  (n) =>
    ts.isFunctionDeclaration(n) &&
    ["globalSearch", "cancelSearch"].includes(n.name?.text),
);
const binding =
  'const h=globalThis.__searchHarness;let search="privileged",boot={user:{id:"admin"}},bootUserId="admin",context={department:"A"};const searchLifetime={current:{sequence:0,controller:null}};const setResults=v=>h.results=v,setBusy=()=>{},setSearchBusy=()=>{},setError=v=>h.error=v,get=(...args)=>h.get(...args),message=e=>e.message,isAbort=e=>e.name==="AbortError";';
const searchCode = ts.transpileModule(
  binding + functions.map((n) => "export " + n.getText(app)).join("\n"),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
test("actual delayed global search cannot restore privileged results after lifetime/context cancellation", async () => {
  let resolve;
  const h = { results: null, get: () => new Promise((r) => (resolve = r)) };
  globalThis.__searchHarness = h;
  const code = await import(
    "data:text/javascript;base64," + Buffer.from(searchCode).toString("base64")
  );
  const request = code.globalSearch({ preventDefault() {} });
  code.cancelSearch();
  resolve({ employees: [{ name: "Privileged synthetic result" }] });
  await request;
  assert.equal(h.results, null);
  delete globalThis.__searchHarness;
});
