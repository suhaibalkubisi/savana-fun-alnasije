// Explicit, disposable native acceptance. Never connects to an existing database or hosted project.
import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { randomBytes, createHmac, createHash } from "node:crypto";
import assert from "node:assert/strict";
import { z } from "zod";
import { fixture, ids, employee } from "./evening-db-fixture.mjs";
import { routeModule, httpRequest } from "./staff-round2-fixture.mjs";
if (process.argv[2] !== "--isolated-only")
  throw Error("Explicit isolated-only mode required");
const bins = path.resolve(process.argv[3] || ""),
  pgBin = path.resolve(process.argv[4] || ""),
  run = promisify(execFile);
for (const f of [
  bins + "/auth.exe",
  bins + "/postgrest/postgrest.exe",
  pgBin + "/initdb.exe",
  pgBin + "/pg_ctl.exe",
])
  await fs.access(f);
const require = createRequire(bins + "/tools/package.json"),
  { Client } = require("pg");
const root = await fs.mkdtemp(path.resolve("work/round2-native-"));
if (!root.startsWith(path.resolve("work") + path.sep))
  throw Error("Workspace-owned root required");
const evidenceDir = path.resolve(process.argv[5] || "../round2/native");
if (!evidenceDir.startsWith(path.resolve("..") + path.sep))
  throw Error("Evidence must remain within this workspace's work directory");
await fs.mkdir(evidenceDir, { recursive: true });
const evidence = [],
  children = [];
let db,
  pgStarted = false;
const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
const pgPort = await freePort(),
  authPort = await freePort(),
  restPort = await freePort(),
  secret = randomBytes(32).toString("hex");
const jwt = (role) => {
  const a = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
      "base64url",
    ),
    b = Buffer.from(
      JSON.stringify({ role, exp: Math.floor(Date.now() / 1000) + 3600 }),
    ).toString("base64url");
  return (
    a +
    "." +
    b +
    "." +
    createHmac("sha256", secret)
      .update(a + "." + b)
      .digest("base64url")
  );
};
const owner = "fanu_r2_fixture_owner",
  database = "fanu_r2_native";
async function start(exe, args, name, extra = {}) {
  const handle = await fs.open(root + "/" + name + ".private.log", "a");
  const child = spawn(exe, args, {
    cwd: root,
    windowsHide: true,
    env: { ...process.env, ...extra },
    stdio: ["ignore", handle.fd, handle.fd],
  });
  child.once("error", (e) => console.error(name, e.message));
  children.push({ child, handle, name });
  return child;
}
async function waitReady(url) {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (r.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw Error("Native service did not become ready: " + url);
}
const auth = async (url, data, token) => {
  const r = await fetch("http://127.0.0.1:" + authPort + url, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: "Bearer " + token } : {}),
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    signal: AbortSignal.timeout(15000),
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const rpc = async (token, fn, args) => {
  const r = await fetch("http://127.0.0.1:" + restPort + "/rpc/" + fn, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + token,
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(15000),
  });
  return { status: r.status, data: await r.json() };
};
try {
  await run(
    pgBin + "/initdb.exe",
    [
      "-D",
      root + "/pgdata",
      "-U",
      owner,
      "--auth=trust",
      "--encoding=UTF8",
      "--no-locale",
    ],
    { windowsHide: true, timeout: 60000 },
  );
  // pg_ctl's Windows token creation is unavailable in this sandbox; the installed
  // postgres server can run directly as the same unprivileged fixture owner.
  await start(
    pgBin + "/postgres.exe",
    ["-D", root + "/pgdata", "-h", "127.0.0.1", "-p", String(pgPort)],
    "postgres-direct",
  );
  pgStarted = true;
  for (let attempt = 0; attempt < 80; attempt++) {
    const probe = new Client({
      host: "127.0.0.1",
      port: pgPort,
      user: owner,
      database: "postgres",
      connectionTimeoutMillis: 500,
    });
    try {
      await probe.connect();
      await probe.end();
      break;
    } catch (e) {
      await probe.end().catch(() => {});
      if (attempt === 79) throw e;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  db = new Client({
    host: "127.0.0.1",
    port: pgPort,
    user: owner,
    database: "postgres",
  });
  await db.connect();
  await db.query("create database " + database);
  await db.end();
  db = new Client({ host: "127.0.0.1", port: pgPort, user: owner, database });
  await db.connect();
  await db.query(
    "create role postgres nologin;create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;",
  );
  // GoTrue migrations qualify auth tables while its runtime models use the
  // connection search_path, as in the standard isolated Supabase deployment.
  await db.query(
    `alter role ${owner} in database ${database} set search_path=auth,public`,
  );
  await start(bins + "/auth.exe", [], "gotrue", {
    GOTRUE_DB_DRIVER: "postgres",
    DATABASE_URL: `postgres://${owner}@127.0.0.1:${pgPort}/${database}?sslmode=disable`,
    GOTRUE_DB_DATABASE_URL:
      `postgres://${owner}@127.0.0.1:${pgPort}:${pgPort}/${database}?sslmode=disable`.replace(
        `:${pgPort}:${pgPort}`,
        `:${pgPort}`,
      ),
    GOTRUE_DB_NAMESPACE: "auth",
    GOTRUE_API_HOST: "127.0.0.1",
    PORT: String(authPort),
    API_EXTERNAL_URL: "http://127.0.0.1:" + authPort,
    GOTRUE_SITE_URL: "http://localhost:56494",
    GOTRUE_JWT_SECRET: secret,
    GOTRUE_JWT_EXP: "60",
    GOTRUE_JWT_AUD: "authenticated",
    GOTRUE_JWT_DEFAULT_GROUP_NAME: "authenticated",
    GOTRUE_MAILER_AUTOCONFIRM: "true",
    GOTRUE_DISABLE_SIGNUP: "false",
    GOTRUE_RATE_LIMIT_EMAIL_SENT: "1000",
    GOTRUE_RATE_LIMIT_TOKEN_REFRESH: "1000",
  });
  await waitReady("http://127.0.0.1:" + authPort + "/health");
  for (const [role, id] of Object.entries({
    ADMIN: ids.admin,
    FOLLOWUP: ids.follow,
    SUPERVISOR: ids.supervisor,
    VIEWER: ids.viewer,
  })) {
    const result = await auth(
      "/admin/users",
      {
        id,
        email: role.toLowerCase() + "@native-r2.invalid",
        password: "Native-R2-Isolated-2026!",
        email_confirm: true,
        user_metadata: { name: "Synthetic " + role },
      },
      jwt("service_role"),
    );
    assert.equal(result.status, 200, JSON.stringify(result));
    assert.equal(result.data.id, id);
  }
  let ddl = fixture
    .replace(
      "create role anon;create role authenticated;create schema auth;",
      "",
    )
    .replace(
      "create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;",
      "",
    )
    .replace(/create table auth\.sessions\([^;]+;/, "")
    .replace(
      "insert into auth.sessions(id,user_id) select id,id from profiles;",
      "",
    );
  // Keep auth.uid(), auth.sessions, token issuance and validation native.
  await db.query(ddl);
  await db.query(await fs.readFile("supabase/followup-rebuild.sql", "utf8"));
  await db.query(
    `insert into fu_accounts values('${ids.supervisor}','SUPERVISOR',true,1),('${ids.follow}','FOLLOWUP',true,1),('${ids.viewer}','VIEWER',true,1);insert into fu_departments values('${ids.supervisor}','${ids.d1}'),('${ids.follow}','${ids.d1}'),('${ids.viewer}','${ids.d1}');`,
  );
  for (const f of [
    "supabase/migrations/20261013223509_evening_release_candidate.sql",
    "supabase/migrations/20261014181643_evening_controlled_roster_setup.sql",
    "supabase/proposals/staff-repairs.sql",
  ])
    await db.query(await fs.readFile(f, "utf8"));
  await db.query(
    "create function public.r2_native_profile() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$begin insert into public.profiles(id,name,email,role,is_active) values(new.id,coalesce(new.raw_user_meta_data->>'name','Synthetic account'),new.email,'VIEWER',true);return new;end$$;revoke all on function public.r2_native_profile() from public,anon,authenticated;create trigger r2_native_profile after insert on auth.users for each row execute function public.r2_native_profile();",
  );
  await fs.writeFile(
    root + "/postgrest.private.conf",
    `db-uri = "postgres://${owner}@127.0.0.1:${pgPort}/${database}"\ndb-schemas = "public"\ndb-anon-role = "anon"\njwt-secret = "${secret}"\nserver-host = "127.0.0.1"\nserver-port = ${restPort}\ndb-pool = 10\n`,
  );
  await start(
    bins + "/postgrest/postgrest.exe",
    [root + "/postgrest.private.conf"],
    "postgrest",
  );
  await waitReady("http://127.0.0.1:" + restPort + "/");
  const sessions = new Map();
  for (const role of ["ADMIN", "FOLLOWUP", "SUPERVISOR", "VIEWER"]) {
    const login = await auth("/token?grant_type=password", {
      email: role.toLowerCase() + "@native-r2.invalid",
      password: "Native-R2-Isolated-2026!",
    });
    assert.equal(login.status, 200, JSON.stringify(login));
    sessions.set(role, login.data);
    const profile = await rpc(login.data.access_token, "followup_session", {});
    assert.equal(profile.status, 200);
    assert.equal(profile.data.followup_role, role);
    const inside = await rpc(login.data.access_token, "followup_read", {
      p_kind: "profile",
      p_filters: { employee_id: employee(20) },
    });
    assert.equal(inside.status, 200);
    if (role !== "ADMIN")
      assert.equal(
        (
          await rpc(login.data.access_token, "followup_read", {
            p_kind: "profile",
            p_filters: { employee_id: employee(21) },
          })
        ).status,
        403,
      );
    evidence.push({
      role,
      real_password_login: true,
      live_sql_session: true,
      inside_department: 200,
      outside_department: role === "ADMIN" ? "global authorized" : 403,
    });
  }
  const admin = sessions.get("ADMIN");
  let current = admin.access_token;
  const checked = async (fn, args) => {
    const r = await rpc(current, fn, args);
    if (r.status !== 200)
      throw Object.assign(new Error(r.data.message || "Native RPC denied"), {
        __dbStatus: r.status,
      });
    return r.data;
  };
  const deps = {
    z,
    session: async () => {
      const u = await auth("/user", undefined, current);
      if (u.status !== 200)
        throw Object.assign(new Error("Native session expired"), {
          __dbStatus: 401,
        });
      return { token: current, profile: await checked("followup_session", {}) };
    },
    rpc: checked,
    upstream: async (url, options = {}) => {
      const p = url.replace("/auth/v1", "");
      const r = await auth(
        p,
        options.body ? JSON.parse(options.body) : undefined,
        jwt("service_role"),
      );
      return {
        response: new Response(null, { status: r.status }),
        data: r.data,
      };
    },
  };
  const route = await routeModule("app/api/users/route.ts", deps);
  const p = {
    name: "Native synthetic new account",
    email: "new@native-r2.invalid",
    password: "Native-R2-Isolated-2026!",
    role: "VIEWER",
    departments: [ids.d1],
    reason: "Explicit native isolated account acceptance",
    request_id: crypto.randomUUID(),
  };
  const created = await route.POST(
    httpRequest(p, "http://isolated.invalid/api/users"),
  );
  assert.equal(created.status, 200, await created.clone().text());
  const data = await created.json();
  assert.equal(data.ok, true);
  assert.equal(
    (await db.query("select state from fu_account_creations where user_id=$1 and request_id=$2", [ids.admin, p.request_id])).rows[0].state,
    "configured",
    "N01: successful native account configuration must persist completion",
  );
  assert.equal(
    (await route.POST(httpRequest(p, "http://isolated.invalid/api/users")))
      .status,
    200,
  );
  const duplicateId = crypto.randomUUID();
  const duplicate = await route.POST(
    httpRequest(
      { ...p, request_id: duplicateId },
      "http://isolated.invalid/api/users",
    ),
  );
  assert.equal(duplicate.status, 409);
  const duplicateBody = await duplicate.json();
  assert.match(duplicateBody.error, /الحساب موجود بالفعل/);
  assert.equal(
    (await db.query("select state from fu_account_creations where user_id=$1 and request_id=$2", [ids.admin, duplicateId])).rows[0].state,
    "duplicate",
    "N01: a new duplicate email reaches the provider and receives a definitive classification",
  );
  evidence.push({
    actual_account_route_native_provider: true,
    exact_request_replay_no_duplicate: true,
    duplicate_status: duplicate.status,
    durable_completion: "configured",
    duplicate_classification: "duplicate (provider-confirmed), not unresolved pending",
  });
  const allowed = await rpc(admin.access_token,"followup_write",{
    p_kind:"capability",p_request_id:crypto.randomUUID(),
    p_data:{user_id:ids.admin,capability:"service_manage",granted:true,version:0,reason:"Explicit isolated native recovery acceptance"},
  });
  assert.equal(allowed.status,200,JSON.stringify(allowed.data));
  const recoveryId=crypto.randomUUID();
  const recoveryData={
    employee_id:employee(20),version:(await db.query("select version from employees where id=$1",[employee(20)])).rows[0].version,
    valid_from:(await db.query("select followup_private.today()::text day")).rows[0].day,
    employment_status:"long_leave",reason:"Synthetic N02 native recovery reason",
  };
  const stage=await rpc(admin.access_token,"followup_write",{
    p_kind:"decision_recovery_stage",p_data:{kind:"service_state",data:recoveryData},p_request_id:recoveryId,
  });
  assert.equal(stage.status,200,JSON.stringify(stage.data));
  assert.equal(stage.data.state,"staged");
  const recoveryFilters={request_id:recoveryId,employee_id:employee(20),decision_kind:"service_state"};
  const restored=await rpc(admin.access_token,"followup_read",{p_kind:"decision_recovery",p_filters:recoveryFilters});
  assert.equal(restored.status,200,JSON.stringify(restored.data));
  assert.deepEqual(restored.data.data,recoveryData);
  assert.equal((await rpc(sessions.get("VIEWER").access_token,"followup_read",{p_kind:"decision_recovery",p_filters:recoveryFilters})).status,403);
  const recoveredWrite=await rpc(admin.access_token,"followup_write",{p_kind:"service_state",p_data:restored.data.data,p_request_id:recoveryId});
  assert.equal(recoveredWrite.status,200,JSON.stringify(recoveredWrite.data));
  const committedRecovery=await rpc(admin.access_token,"followup_read",{p_kind:"decision_recovery",p_filters:recoveryFilters});
  assert.equal(committedRecovery.data.state,"committed");
  const replayRecovery=await rpc(admin.access_token,"followup_write",{p_kind:"service_state",p_data:recoveryData,p_request_id:recoveryId});
  assert.equal(replayRecovery.status,200,JSON.stringify(replayRecovery.data));
  assert.deepEqual(replayRecovery.data,recoveredWrite.data);
  evidence.push({native_decision_staging_and_exact_payload_restore:true,native_recovery_write_and_replay_same_request:true,other_role_recovery_denied:403});
  const denied = await rpc(
    sessions.get("VIEWER").access_token,
    "followup_write",
    {
      p_kind: "service_state",
      p_request_id: crypto.randomUUID(),
      p_data: {
        employee_id: employee(20),
        version: 1,
        valid_from: "2026-10-19",
        employment_status: "inactive",
        reason: "Native denied write",
      },
    },
  );
  assert.equal(denied.status, 403);
  await db.query("update fu_accounts set active=false where user_id=$1", [
    ids.supervisor,
  ]);
  assert.equal(
    (
      await rpc(sessions.get("SUPERVISOR").access_token, "followup_read", {
        p_kind: "profile",
        p_filters: { employee_id: employee(20) },
      })
    ).status,
    403,
  );
  evidence.push({
    disabled_account_native_existing_JWT: 403,
    viewer_write_denied: 403,
  });
  const viewer = sessions.get("VIEWER"),
    claims = JSON.parse(
      Buffer.from(viewer.access_token.split(".")[1], "base64url"),
    );
  const logout = await fetch("http://127.0.0.1:" + authPort + "/logout", {
    method: "POST",
    headers: { authorization: "Bearer " + viewer.access_token },
  });
  assert.ok(logout.ok);
  assert.equal(
    (
      await db.query("select count(*)::int n from auth.sessions where id=$1", [
        claims.session_id,
      ])
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await rpc(viewer.access_token, "followup_read", {
        p_kind: "profile",
        p_filters: { employee_id: employee(20) },
      })
    ).status,
    403,
  );
  evidence.push({
    real_logout_removes_session: true,
    old_real_JWT_denied_by_live_gateway: 403,
  });
  console.log(
    "Native Auth/PostgREST login, account route, scope and revocation verified; waiting until native access-token expiry.",
  );
  const expiry =
    JSON.parse(Buffer.from(admin.access_token.split(".")[1], "base64url")).exp *
    1000;
  await new Promise((r) =>
    setTimeout(r, Math.max(0, expiry - Date.now() + 1500)),
  );
  assert.equal(
    (await auth("/user", undefined, admin.access_token)).status,
    403,
  );
  // PostgREST's documented clock-skew allowance is 30 seconds; observe native
  // expiry after that window instead of weakening verification configuration.
  await new Promise((r) =>
    setTimeout(r, Math.max(0, expiry - Date.now() + 31500)),
  );
  const expired = await rpc(admin.access_token, "followup_session", {});
  assert.equal(expired.status, 401);
  const refresh = await auth("/token?grant_type=refresh_token", {
    refresh_token: admin.refresh_token,
  });
  assert.equal(refresh.status, 200);
  assert.notEqual(refresh.data.access_token, admin.access_token);
  assert.equal(
    (await rpc(refresh.data.access_token, "followup_session", {})).status,
    200,
  );
  evidence.push({
    native_auth_expired_JWT: 403,
    real_postgrest_JWT_expiry_after_documented_skew: 401,
    real_refresh_new_access_token: true,
  });
  const manifest = {
    date: "2026-10-21",
    synthetic_business_date: "2026-10-19",
    native_postgres: (await db.query("select version() v")).rows[0].v,
    auth_source:
      "Supabase Auth v2.197.0, existing Windows build with single-listener portability change; Auth/JWT/session logic unchanged",
    postgrest: "16.4 official Windows executable",
    auth_sha256: createHash("sha256")
      .update(await fs.readFile(bins + "/auth.exe"))
      .digest("hex"),
    postgrest_sha256: createHash("sha256")
      .update(await fs.readFile(bins + "/postgrest/postgrest.exe"))
      .digest("hex"),
    host: "127.0.0.1",
    new_disposable_cluster: true,
    production_connections: 0,
    native_storage:
      "NOT EXECUTED: no isolated original Storage API available; no hosted branch and no Docker runtime",
    managed_supabase_platform: "NOT EXECUTED: local native services only",
    api_route_boundary:
      "Actual users POST handler transpiled from current source; real native Auth admin API and PostgREST RPC dependencies. Next HTTP server/cookie transport not exercised by this native harness.",
    jwt_clock_skew_reference:
      "https://github.com/PostgREST/postgrest/blob/main/docs/references/auth.rst",
    checks: evidence,
  };
  await fs.writeFile(
    path.join(evidenceDir, "native-auth-evidence.json"),
    JSON.stringify(manifest, null, 2),
  );
  console.log(
    "Native Auth acceptance passed; Storage remains explicitly not executed.",
  );
} catch (e) {
  await fs.writeFile(
    path.join(evidenceDir, "native-auth-failure.json"),
    JSON.stringify(
      { error: e.message, checks: evidence, runtime: path.basename(root) },
      null,
      2,
    ),
  );
  console.error("Native isolated acceptance failed:", e.message);
  process.exitCode = 1;
} finally {
  if (db) await db.end().catch(() => {});
  for (const { child, name } of children) {
    if (name !== "postgres-direct") child.kill();
  }
  if (pgStarted)
    await run(
      pgBin + "/pg_ctl.exe",
      ["-D", root + "/pgdata", "-m", "fast", "-w", "stop"],
      { windowsHide: true, timeout: 90000 },
    ).catch((e) => {
      console.error("Owned native cluster stop failed", e.message);
      children.find((c) => c.name === "postgres-direct")?.child.kill();
    });
  for (const { handle } of children) await handle.close().catch(() => {});
  const listening = (port) => new Promise((resolve) => {
    const socket = net.connect({host:"127.0.0.1",port});
    socket.once("connect",()=>{socket.destroy();resolve(true);});
    socket.once("error",()=>resolve(false));
    socket.setTimeout(1000,()=>{socket.destroy();resolve(false);});
  });
  let ports;
  for (let attempt=0;attempt<10;attempt++) {
    ports=await Promise.all([pgPort,authPort,restPort].map(listening));
    if (ports.every(open=>!open)) break;
    await new Promise(resolve=>setTimeout(resolve,300));
  }
  await fs.writeFile(path.join(evidenceDir,"native-cleanup-evidence.json"),JSON.stringify({
    scope:"Owned disposable loopback services only",postgres_port_closed:!ports[0],
    auth_port_closed:!ports[1],postgrest_port_closed:!ports[2],
    production_connections:0,
  },null,2));
  if (ports.some(Boolean)) {
    console.error("An owned native acceptance port remains open after cleanup");
    process.exitCode=1;
  }
}
