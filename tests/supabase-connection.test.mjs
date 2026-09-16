import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import {
  readSupabaseEnvironment,
  validateSupabaseConnection,
  supabaseHeaders,
} from "../lib/server/supabase-connection.mjs";

// Synthetic strings test transport rules; these cannot authenticate to a project.
const values = {
  NEXT_PUBLIC_SUPABASE_URL: "https://unit-test.example.invalid/",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_transport_test",
  SUPABASE_SECRET_KEY: "sb_secret_transport_test",
};
const connection = validateSupabaseConnection(
  readSupabaseEnvironment(values, {}),
);

test("Worker bindings and Node environment use only the new key names", () => {
  assert.deepEqual(
    readSupabaseEnvironment({}, values),
    readSupabaseEnvironment(values, {}),
  );
  assert.equal(
    readSupabaseEnvironment(
      { ...values, SUPABASE_SECRET_KEY: "sb_secret_runtime" },
      values,
    ).secretKey,
    "sb_secret_runtime",
  );
  assert.equal(
    readSupabaseEnvironment(
      {},
      { SUPABASE_ANON_KEY: "legacy", SUPABASE_SERVICE_ROLE_KEY: "legacy" },
    ).publishableKey,
    "",
  );
  assert.equal(connection.url, "https://unit-test.example.invalid");
});
test("login and refresh requests send the publishable key without a bearer token", () => {
  const headers = supabaseHeaders(connection);
  assert.equal(
    headers.get("apikey"),
    values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
  assert.equal(headers.has("authorization"), false);
  assert.equal(headers.get("content-type"), "application/json");
});
test("user database requests preserve the user JWT and cannot bypass RLS with the secret key", () => {
  const headers = supabaseHeaders(connection, {
    token: "header.user.signature",
  });
  assert.equal(headers.get("authorization"), "Bearer header.user.signature");
  assert.equal(headers.get("apikey"), connection.publishableKey);
  assert.ok(!JSON.stringify([...headers]).includes(connection.secretKey));
});
test("administrative requests use the secret only in apikey and strip bearer overrides", () => {
  const headers = supabaseHeaders(connection, {
    admin: true,
    headers: { Authorization: "Bearer override", apikey: "override" },
  });
  assert.equal(headers.get("apikey"), connection.secretKey);
  assert.equal(headers.has("authorization"), false);
  assert.throws(() =>
    supabaseHeaders(connection, {
      admin: true,
      token: "header.user.signature",
    }),
  );
  assert.throws(() =>
    supabaseHeaders({ ...connection, secretKey: "" }, { admin: true }),
  );
});
test("API keys cannot be passed as user JWTs; unsafe project URLs are rejected", () => {
  assert.throws(() =>
    supabaseHeaders(connection, { token: connection.secretKey }),
  );
  assert.throws(() =>
    supabaseHeaders(connection, { token: connection.publishableKey }),
  );
  for (const url of [
    "http://example.invalid",
    "https://user:pass@example.invalid",
    "https://example.invalid/?key=value",
    "https://example.invalid/path",
  ])
    assert.throws(() => validateSupabaseConnection({ ...connection, url }));
  assert.throws(() =>
    validateSupabaseConnection({
      ...connection,
      publishableKey: connection.secretKey,
    }),
  );
});
test("server-only guards protect modules containing secret access", async () => {
  for (const file of ["lib/server/supabase.ts", "lib/server/import.ts"])
    assert.match(await readFile(file, "utf8"), /^import "server-only";/m);
  const clientFiles = await readdir("components/hr");
  for (const file of clientFiles) {
    const source = await readFile(`components/hr/${file}`, "utf8");
    assert.doesNotMatch(source, /SUPABASE_SECRET_KEY/);
    assert.doesNotMatch(source, /^import (?!type).*lib\/server/m);
  }
  assert.match(
    await readFile("scripts/bootstrap-admin.mjs", "utf8"),
    /supabaseHeaders\(connection,\s*\{\s*admin:\s*true/,
  );
  assert.doesNotMatch(
    await readFile("lib/server/supabase.ts", "utf8"),
    /AbortSignal\.timeout/,
  );
  assert.doesNotMatch(
    await readFile("lib/server/supabase.ts", "utf8"),
    /cache:\s*"no-store"|redirect:\s*"error"/,
  );
});
