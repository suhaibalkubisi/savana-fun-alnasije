import "server-only";
import { env } from "cloudflare:workers";
import {
  AppError,
  body,
  errorResponse,
  json,
  protectMutation,
  upstream,
} from "@/lib/server/supabase";

const FIRST_ADMIN_ID = "c2731295-68fc-43c4-808b-f101cdb6a824";

export async function POST(request: Request) {
  try {
    protectMutation(request);
    const runtime = env as unknown as Record<string, string | undefined>;
    const expected = runtime.ADMIN_BOOTSTRAP_TOKEN ?? process.env.ADMIN_BOOTSTRAP_TOKEN;
    const supplied = request.headers.get("x-bootstrap-token");
    if (!expected || expected.length < 32 || supplied !== expected)
      throw new AppError("طلب غير مسموح", 403);

    const data = await body(request, 1000);
    if (
      typeof data.password !== "string" ||
      data.password.length < 12 ||
      data.password.length > 200
    )
      throw new AppError("كلمة المرور لا تقل عن 12 حرفاً");

    const result = await upstream(
      `/auth/v1/admin/users/${FIRST_ADMIN_ID}`,
      {
        method: "PUT",
        body: JSON.stringify({ password: data.password, email_confirm: true }),
      },
      undefined,
      true,
    );
    if (!result.response.ok || result.data?.id !== FIRST_ADMIN_ID)
      throw new AppError("تعذر تحديث حساب المدير", 500);

    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
