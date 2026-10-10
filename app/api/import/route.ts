import { z } from "zod";
import type { Employee, Reference } from "@/lib/hr/types";
import {
  AppError,
  body,
  errorResponse,
  json,
  protectMutation,
  rpc,
  session,
} from "@/lib/server/supabase";
import { previewRows, signPreview, verifyPreview } from "@/lib/server/import";
const input = z.object({
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  rows: z
    .array(
      z.object({
        row: z.number().int().positive(),
        sheet: z.string().max(100),
        values: z.record(z.string().max(1000)),
      }),
    )
    .min(1)
    .max(2000),
});
export async function POST(request: Request) {
  try {
    protectMutation(request);
    const s = await session();
    if (s.profile.role !== "ADMIN")
      throw new AppError("ليست لديك صلاحية لهذه العملية", 403);
    const b = await body(request, 5000000);
    if (b.action === "preview") {
      const parsed = input.safeParse(b);
      if (!parsed.success) throw new AppError("بيانات الملف غير صالحة");
      const [ref, employees] = await Promise.all([
        rpc<Reference>(
          "hr_read",
          { p_kind: "reference", p_filters: {} },
          s.token,
        ),
        rpc<Employee[]>(
          "hr_read",
          { p_kind: "import_reference", p_filters: {} },
          s.token,
        ),
      ]);
      const rows = previewRows(parsed.data.rows, ref, employees);
      const errors = rows.filter((r) => r.error).length;
      const token = errors
        ? null
        : await signPreview({
            user: s.profile.id,
            expires: Date.now() + 10 * 60 * 1000,
            batch: crypto.randomUUID(),
            hash: parsed.data.hash,
            rows: rows.map((r) => r.data),
          });
      return json({
        rows,
        errors,
        create: rows.filter((r) => r.mode === "create").length,
        update: rows.filter((r) => r.mode === "update").length,
        token,
      });
    }
    if (
      b.action === "apply" &&
      b.confirmed === true &&
      typeof b.token === "string"
    ) {
      const p = await verifyPreview(b.token);
      if (p.user !== s.profile.id || p.expires < Date.now())
        throw new AppError("انتهت المعاينة. أعد اختيار الملف");
      return json(
        await rpc(
          "hr_import",
          { p_batch: p.batch, p_hash: p.hash, p_rows: p.rows },
          s.token,
        ),
      );
    }
    throw new AppError("طلب غير صالح");
  } catch (e) {
    return errorResponse(e);
  }
}
