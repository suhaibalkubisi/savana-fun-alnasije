// Run locally in a trusted terminal. Password is read without echo and never stored.
import { createInterface } from "node:readline/promises";
import {
  readSupabaseEnvironment,
  validateSupabaseConnection,
  supabaseHeaders,
} from "../lib/server/supabase-connection.mjs";
const connection = validateSupabaseConnection(readSupabaseEnvironment());
const { url, secretKey } = connection;
if (!secretKey) throw new Error("SUPABASE_SECRET_KEY is required");
const headers = supabaseHeaders(connection, { admin: true });
const existing = await fetch(
  `${url}/rest/v1/profiles?select=id&role=eq.ADMIN&is_active=eq.true&limit=1`,
  { headers, redirect: "error", signal: AbortSignal.timeout(20000) },
);
if (!existing.ok)
  throw new Error(
    "Database preflight failed. Apply the migration before creating an administrator.",
  );
if ((await existing.json()).length)
  throw new Error(
    "An active administrator already exists. No account was created.",
  );
const prompt = createInterface({
  input: process.stdin,
  output: process.stdout,
});
const email = await prompt.question("Admin email: ");
const name = await prompt.question("Display name: ");
prompt.close();
if (!process.stdin.isTTY)
  throw new Error("Use an interactive terminal for secure password entry");
process.stdout.write("Password (12+ characters): ");
process.stdin.setRawMode(true);
process.stdin.resume();
const password = await new Promise((resolve, reject) => {
  let value = "";
  const onData = (chunk) => {
    const s = chunk.toString();
    if (s === "\u0003") {
      reject(new Error("Cancelled"));
      process.stdin.off("data", onData);
    } else if (s === "\r" || s === "\n") {
      process.stdin.off("data", onData);
      resolve(value);
    } else if (s === "\u007f") value = value.slice(0, -1);
    else value += s;
  };
  process.stdin.on("data", onData);
}).finally(() => {
  process.stdin.setRawMode(false);
  process.stdin.pause();
  process.stdout.write("\n");
});
if (password.length < 12 || password.length > 200)
  throw new Error("Password must have 12 or more characters");
const r = await fetch(`${url}/auth/v1/admin/users`, {
  method: "POST",
  headers,
  redirect: "error",
  signal: AbortSignal.timeout(20000),
  body: JSON.stringify({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  }),
});
const u = await r.json();
if (!r.ok)
  throw new Error(
    "Could not create admin account; check configuration and email",
  );
const b = await fetch(`${url}/rest/v1/rpc/hr_bootstrap`, {
  method: "POST",
  headers,
  redirect: "error",
  signal: AbortSignal.timeout(20000),
  body: JSON.stringify({ p_user_id: u.id }),
});
if (!b.ok)
  throw new Error(
    "Account created but bootstrap was rejected. No active admin was replaced.",
  );
console.log("Administrator is ready.");
