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
import { z } from "zod";
const schema = z
  .object({
    name: z.string().trim().min(1).max(150),
    email: z
      .string()
      .trim()
      .email()
      .transform((s) => s.toLowerCase()),
    password: z.string().min(12).max(200),
    role: z.enum(["ADMIN", "SUPERVISOR", "FOLLOWUP", "VIEWER"]),
    departments: z.array(z.string().uuid()).max(100).default([]),
    reason: z.string().trim().min(5).max(2000),
    request_id: z.string().uuid(),
  })
  .refine((p) => p.role !== "SUPERVISOR" || p.departments.length > 0, {
    message: "اختر قسم المشرف صراحةً",
    path: ["departments"],
  });
type Creation = {
  request_id: string;
  state: string;
  start?: boolean;
  name: string;
  email: string;
  role: string;
  departments: string[];
  reason: string;
  user_id: string | null;
};
async function administrator() {
  const s = await session();
  if (
    (s.profile as unknown as { followup_role: string }).followup_role !==
    "ADMIN"
  )
    throw new AppError("صلاحية إدارة الحسابات مطلوبة", 403);
  return s;
}
const readCreation = (id: string, token: string) =>
  rpc<Creation>(
    "followup_read",
    { p_kind: "account_creation", p_filters: { request_id: id } },
    token,
  );
const record = (id: string, data: Record<string, unknown>, token: string) =>
  rpc<Creation>(
    "followup_write",
    { p_kind: "account_creation_result", p_data: data, p_request_id: id },
    token,
  );
async function configure(p: Creation, userId: string, token: string) {
  await record(p.request_id, { state: "created", user_id: userId }, token);
  const configured = await rpc<{
    user_id: string;
    role: string;
    active: boolean;
    version: number;
  }>(
    "followup_write",
    {
      p_kind: "account",
      p_request_id: p.request_id,
      p_data: {
        user_id: userId,
        role: p.role,
        active: true,
        departments: p.departments,
        reason: p.reason,
      },
    },
    token,
  );
  if (
    configured.user_id !== userId ||
    configured.role !== p.role ||
    configured.active !== true ||
    !Number.isInteger(configured.version)
  )
    throw new AppError("لم تتأكد قراءة إعداد الحساب", 503);
  const proof = await readCreation(p.request_id, token);
  if (proof.state !== "configured" || proof.user_id !== userId)
    throw new AppError("تعذر إثبات اكتمال طلب الحساب", 503);
  return json({ ok: true, request_id: p.request_id, user_id: userId });
}
async function findExisting(p: Creation) {
  // Read-only recovery. Finding the email never grants the requested role by itself.
  if (p.user_id) {
    const r = await upstream(
      "/auth/v1/admin/users/" + p.user_id,
      {},
      undefined,
      true,
    );
    if (
      !r.response.ok ||
      r.data?.id !== p.user_id ||
      String(r.data.email).toLowerCase() !== p.email
    )
      throw new AppError("تعذر التحقق من هوية الحساب الموجود", 503);
    return p.user_id;
  }
  for (let page = 1; page <= 100; page++) {
    const r = await upstream(
      "/auth/v1/admin/users?page=" + page + "&per_page=200",
      {},
      undefined,
      true,
    );
    const users = r.data?.users;
    if (!r.response.ok || !Array.isArray(users))
      throw new AppError(
        "تعذر قراءة حسابات المزود. الطلب محفوظ؛ حاول التحقق لاحقاً.",
        503,
      );
    const matches = users.filter(
      (u: { email?: string }) =>
        String(u.email || "").toLowerCase() === p.email,
    );
    if (matches.length > 1)
      throw new AppError("تحتاج هوية الحساب مراجعة يدوية", 409);
    if (matches.length === 1) return z.string().uuid().parse(matches[0].id);
    if (users.length < 200) return null;
  }
  throw new AppError(
    "لم تكتمل قراءة قائمة الحسابات. لا تبدأ إنشاءً بديلاً.",
    503,
  );
}
export async function GET(request: Request) {
  try {
    const s = await administrator(),
      id = z
        .string()
        .uuid()
        .parse(new URL(request.url).searchParams.get("request_id"));
    const p = await readCreation(id, s.token);
    if (["pending", "created", "unknown"].includes(p.state))
      return json({ ...p, found_user_id: await findExisting(p) });
    return json(p);
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  let created = false,
    id: string | undefined,
    claimed = false;
  try {
    protectMutation(request);
    const s = await administrator(),
      input = await body(request, 5000);
    if (
      input &&
      typeof input === "object" &&
      "close_unstarted_request_id" in input
    ) {
      const close = z
        .object({ close_unstarted_request_id: z.string().uuid() })
        .parse(input);
      return json(
        await rpc<Creation>(
          "followup_write",
          {
            p_kind: "account_creation_close",
            p_data: {},
            p_request_id: close.close_unstarted_request_id,
          },
          s.token,
        ),
      );
    }
    if (input && typeof input === "object" && "recovery_request_id" in input) {
      const recovery = z
        .object({
          recovery_request_id: z.string().uuid(),
          user_id: z.string().uuid(),
        })
        .parse(input);
      id = recovery.recovery_request_id;
      const p = await readCreation(id, s.token);
      if (p.state === "configured")
        return json({ ok: true, request_id: id, user_id: p.user_id });
      if (!["created", "unknown", "pending"].includes(p.state))
        throw new AppError("لا يوجد طلب إنشاء قابل للاستكمال", 409);
      const found = await findExisting(p);
      if (found !== recovery.user_id)
        throw new AppError("الحساب الموجود لا يطابق طلب الاستكمال", 409);
      created = true;
      return await configure(p, found, s.token);
    }
    const p = schema.parse(input);
    id = p.request_id;
    const boot = await rpc<{ departments: { id: string }[] }>(
      "followup_read",
      { p_kind: "bootstrap", p_filters: {} },
      s.token,
    );
    if (p.departments.some((d) => !boot.departments.some((x) => x.id === d)))
      throw new AppError("القسم المختار غير متاح", 403);
    const { password, request_id, ...metadata } = p;
    const claim = await rpc<Creation>(
      "followup_write",
      {
        p_kind: "account_creation_begin",
        p_data: metadata,
        p_request_id: request_id,
      },
      s.token,
    );
    if (claim.start !== true) {
      if (claim.state === "configured")
        return json({ ok: true, request_id, user_id: claim.user_id });
      throw new AppError(
        "لهذا الطلب محاولة سابقة. تحقق من نتيجتها أو استكملها؛ لن يعاد إنشاء الحساب.",
        503,
      );
    }
    claimed = true;
    const result = await upstream(
      "/auth/v1/admin/users",
      {
        method: "POST",
        body: JSON.stringify({
          email: p.email,
          password,
          email_confirm: true,
          user_metadata: { name: p.name },
        }),
      },
      undefined,
      true,
    );
    if (!result.response.ok) {
      const providerCode =
        typeof result.data?.error_code === "string"
          ? result.data.error_code
          : typeof result.data?.code === "string"
            ? result.data.code
            : "";
      if (
        ["email_exists", "user_already_exists"].includes(providerCode)
      ) {
        await record(id, { state: "duplicate" }, s.token);
        claimed = false;
        throw new AppError(
          "الحساب موجود بالفعل. افتحه من قائمة الحسابات؛ لم يُنشأ حساب بديل.",
          409,
        );
      }
      if ([400, 422].includes(result.response.status)) {
        await record(id, { state: "rejected" }, s.token);
        claimed = false;
        throw new AppError(
          "رفضت الخدمة بيانات الحساب. راجع البريد وكلمة المرور والحقول المطلوبة.",
          422,
        );
      }
      throw new AppError(
        "خدمة إنشاء الحسابات غير متاحة. الطلب محفوظ؛ تحقق منه قبل أي محاولة أخرى.",
        result.response.status === 429 ? 429 : 503,
      );
    }
    const parsed = z.string().uuid().safeParse(result.data?.id);
    if (!parsed.success)
      throw new AppError(
        "لم تتأكد نتيجة إنشاء الحساب. استخدم التحقق من الطلب المحفوظ.",
        503,
      );
    created = true;
    return await configure(
      { ...claim, ...metadata, request_id },
      parsed.data,
      s.token,
    );
  } catch (e) {
    if (claimed && id && !created) {
      try {
        const s = await administrator();
        await record(id, { state: "unknown" }, s.token);
      } catch {
        /* Original pending claim remains authoritative. */
      }
    }
    return errorResponse(
      created
        ? new AppError(
            "الحساب موجود لكن إعداد صلاحياته لم يثبت. استخدم التحقق والاستكمال؛ لا تنشئه ثانية.",
            409,
          )
        : e,
    );
  }
}
