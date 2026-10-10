/** Server transport only. API keys are never user JWTs. */
/** @typedef {{url:string,publishableKey:string,secretKey:string}} SupabaseConnection */
/**
 * @param {Record<string,string|undefined>} [runtime]
 * @param {Record<string,string|undefined>} [fallback]
 * @returns {SupabaseConnection}
 */
export function readSupabaseEnvironment(runtime = {}, fallback = process.env) {
  const read = (name) => (runtime[name] || fallback[name] || "").trim();
  return {
    url: read("NEXT_PUBLIC_SUPABASE_URL"),
    publishableKey: read("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    secretKey: read("SUPABASE_SECRET_KEY"),
  };
}

/** @param {SupabaseConnection} connection @returns {SupabaseConnection} */
export function validateSupabaseConnection(connection) {
  const url = new URL(connection.url);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    !connection.publishableKey?.startsWith("sb_publishable_") ||
    (connection.secretKey && !connection.secretKey.startsWith("sb_secret_"))
  )
    throw new Error("Invalid Supabase configuration");
  return { ...connection, url: url.origin };
}

/**
 * @param {SupabaseConnection} connection
 * @param {{token?:string,admin?:boolean,headers?:HeadersInit}} [options]
 */
export function supabaseHeaders(
  connection,
  { token, admin = false, headers } = {},
) {
  if (admin && token)
    throw new Error("Administrative requests cannot use a user session");
  const key = admin ? connection.secretKey : connection.publishableKey;
  if (!key?.startsWith(admin ? "sb_secret_" : "sb_publishable_")) {
    throw new Error("Supabase API key is unavailable");
  }
  if (token && (token.startsWith("sb_") || token.split(".").length !== 3)) {
    throw new Error("A user access token is required");
  }
  const result = new Headers(headers);
  result.set("apikey", key);
  result.set("Content-Type", "application/json");
  result.delete("Authorization");
  if (token) result.set("Authorization", `Bearer ${token}`);
  return result;
}
