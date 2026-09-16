import { loginSchema } from "@/lib/hr/validation";
import { authenticationFailure } from "@/lib/server/auth-error.mjs";
import {
  AppError,
  body,
  clearSession,
  config,
  errorResponse,
  json,
  protectMutation,
  session,
  setSession,
  upstream,
} from "@/lib/server/supabase";
export async function GET() {
  try {
    const c = config();
    if (!c.url || !c.publishableKey)
      return json({ configured: false, user: null });
    try {
      const s = await session();
      return json({ configured: true, user: s.profile });
    } catch (e) {
      if (e instanceof AppError && e.status === 401)
        return json({ configured: true, user: null });
      throw e;
    }
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    protectMutation(request);
    const data = await body(request, 5000);
    if (data.action === "logout") {
      try {
        const s = await session();
        await upstream("/auth/v1/logout", { method: "POST" }, s.token);
      } catch {}
      await clearSession();
      return json({ ok: true });
    }
    if (data.action === "password") {
      const s = await session();
      if (
        typeof data.password !== "string" ||
        data.password.length < 12 ||
        data.password.length > 200
      )
        throw new AppError("كلمة المرور لا تقل عن 12 حرفاً");
      const r = await upstream(
        "/auth/v1/user",
        { method: "PUT", body: JSON.stringify({ password: data.password }) },
        s.token,
      );
      if (!r.response.ok) throw new AppError("تعذر تغيير كلمة المرور");
      return json({ ok: true });
    }
    const parsed = loginSchema.safeParse(data);
    if (!parsed.success) throw new AppError(parsed.error.issues[0].message);
    const r = await upstream("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: JSON.stringify(parsed.data),
    });
    if (
      !r.response.ok ||
      !r.data?.access_token ||
      !r.data.refresh_token ||
      typeof r.data.expires_in !== "number"
    ) {
      const failure = authenticationFailure(
        r.response.status,
        r.data?.error_code ?? r.data?.code,
      );
      throw new AppError(failure.message, failure.status);
    }
    await setSession(
      {
        access_token: r.data.access_token,
        refresh_token: r.data.refresh_token,
        expires_in: r.data.expires_in,
      },
      new URL(request.url).protocol === "https:",
    );
    try {
      const s = await session();
      return json({ user: s.profile });
    } catch (e) {
      await clearSession();
      throw e;
    }
  } catch (e) {
    return errorResponse(e);
  }
}
