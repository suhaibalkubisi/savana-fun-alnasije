import { newUserSchema } from "@/lib/hr/validation";
import type { Profile } from "@/lib/hr/types";
import {
  AppError,
  body,
  errorResponse,
  json,
  protectMutation,
  rpc,
  session,
  upstream,
} from "@/lib/server/supabase";
export async function POST(request: Request) {
  try {
    protectMutation(request);
    const s = await session();
    if (s.profile.role !== "ADMIN")
      throw new AppError("ليست لديك صلاحية لهذه العملية", 403);
    const p = newUserSchema.safeParse(await body(request, 5000));
    if (!p.success) throw new AppError(p.error.issues[0].message);
    const result = await upstream(
      "/auth/v1/admin/users",
      {
        method: "POST",
        body: JSON.stringify({
          email: p.data.email,
          password: p.data.password,
          email_confirm: true,
          user_metadata: { name: p.data.name },
        }),
      },
      undefined,
      true,
    );
    if (!result.response.ok || !result.data?.id)
      throw new AppError("تعذر إنشاء المستخدم. تحقق من البريد الإلكتروني");
    const createdId = result.data.id;
    const users = await rpc<Profile[]>(
      "hr_read",
      { p_kind: "users", p_filters: {} },
      s.token,
    );
    const created = users.find((u) => u.id === createdId);
    if (!created) throw new AppError("تعذر تفعيل المستخدم", 500);
    await rpc(
      "hr_write",
      {
        p_action: "user.save",
        p_data: {
          id: created.id,
          version: created.version,
          name: p.data.name,
          role: p.data.role,
          is_active: true,
        },
      },
      s.token,
    );
    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
