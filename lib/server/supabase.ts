import "server-only";
import { cookies } from "next/headers";
import { env } from "cloudflare:workers";
import type { Profile } from "@/lib/hr/types";
import {
  readSupabaseEnvironment,
  validateSupabaseConnection,
  supabaseHeaders,
} from "./supabase-connection.mjs";
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function config() {
  const runtime = env as unknown as Record<string, string | undefined>;
  return readSupabaseEnvironment(runtime, process.env);
}
export function requireConfig() {
  const c = config();
  if (!c.url || !c.publishableKey)
    throw new AppError("الخدمة غير مهيأة حالياً", 503);
  try {
    return validateSupabaseConnection(c);
  } catch {
    throw new AppError("إعداد الاتصال غير صالح", 503);
  }
}
export async function upstream(
  path: string,
  options: RequestInit = {},
  token?: string,
  admin = false,
) {
  const c = requireConfig();
  const key = admin ? c.secretKey : c.publishableKey;
  if (!key) throw new AppError("إدارة الحسابات غير مهيأة", 503);
  let response: Response;
  try {
    response = await fetch(`${c.url}${path}`, {
      ...options,
      headers: supabaseHeaders(c, { token, admin, headers: options.headers }),
    });
  } catch {
    throw new AppError(
      "تعذر الاتصال بالخدمة. تحقق من الاتصال ثم حاول مجدداً",
      503,
    );
  }
  const data = (await response.json().catch(() => null)) as
    | ({
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        id?: string;
        message?: string;
        code?: string;
      } & Record<string, unknown>)
    | null;
  return { response, data };
}
export async function setSession(
  data: { access_token: string; refresh_token: string; expires_in: number },
  secure = true,
) {
  const jar = await cookies();
  const opts = {
    httpOnly: true,
    secure,
    sameSite: "strict" as const,
    path: "/",
  };
  jar.set("hr-access", data.access_token, { ...opts, maxAge: data.expires_in });
  jar.set("hr-refresh", data.refresh_token, {
    ...opts,
    maxAge: 60 * 60 * 24 * 7,
  });
}
export async function clearSession() {
  const jar = await cookies();
  jar.delete("hr-access");
  jar.delete("hr-refresh");
}
export async function session() {
  const jar = await cookies();
  let token = jar.get("hr-access")?.value;
  const refresh = jar.get("hr-refresh")?.value;
  if (!token && !refresh) throw new AppError("يرجى تسجيل الدخول", 401);
  let valid = token ? await upstream("/auth/v1/user", {}, token) : null;
  if ((!valid || valid.response.status === 401) && refresh) {
    const r = await upstream("/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      body: JSON.stringify({ refresh_token: refresh }),
    });
    if (r.response.ok && r.data?.access_token) {
      token = r.data.access_token;
      if (!r.data.refresh_token || typeof r.data.expires_in !== "number")
        throw new AppError("تعذر تجديد الجلسة", 401);
      await setSession({
        access_token: r.data.access_token,
        refresh_token: r.data.refresh_token,
        expires_in: r.data.expires_in,
      });
      valid = await upstream("/auth/v1/user", {}, token);
    }
  }
  if (!valid?.response.ok || !token) {
    throw new AppError("انتهت الجلسة. يرجى تسجيل الدخول", 401);
  }
  const profile = await rpc<Profile>(
    "hr_read",
    { p_kind: "session", p_filters: {} },
    token,
  );
  return { token, profile };
}
export async function rpc<T>(fn: string, body: unknown, token: string) {
  const { response, data } = await upstream(
    `/rest/v1/rpc/${fn}`,
    { method: "POST", body: JSON.stringify(body) },
    token,
  );
  if (!response.ok) {
    const message =
      typeof data?.message === "string" && /^[\u0600-\u06ff]/.test(data.message)
        ? data.message
        : response.status >= 500
          ? "تعذر الاتصال بقاعدة البيانات"
          : "تعذر حفظ البيانات. تحقق من القيم المدخلة";
    throw new AppError(
      message,
      data?.code === "42501" ? 403 : data?.code === "40001" ? 409 : 400,
    );
  }
  return data as T;
}
export function protectMutation(request: Request) {
  const origin = request.headers.get("origin");
  if (
    request.headers.get("x-hr-request") !== "1" ||
    (origin && origin !== new URL(request.url).origin)
  )
    throw new AppError("طلب غير مسموح", 403);
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new AppError("صيغة طلب غير صالحة", 415);
}
export async function body(request: Request, max = 2000000) {
  const text = await request.text();
  if (text.length > max)
    throw new AppError("حجم البيانات أكبر من المسموح", 413);
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("طلب غير صالح");
  }
}
export function errorResponse(error: unknown) {
  if (error instanceof AppError)
    return Response.json(
      { error: error.message },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  console.error(
    "HR request failed",
    error instanceof Error ? `${error.name}: ${error.message}` : "unknown",
  );
  return Response.json(
    { error: "تعذر إكمال العملية. حاول مرة أخرى" },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
}
export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
