import { employeeSchema, statusSchema } from "@/lib/hr/validation";
import { z } from "zod";
import {
  AppError,
  body,
  errorResponse,
  json,
  protectMutation,
  rpc,
  session,
} from "@/lib/server/supabase";
const lookup = z.object({
  id: z.string().uuid().optional(),
  version: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(150),
  is_active: z.boolean(),
  employee_id: z.string().uuid().nullable().optional(),
});
const department = z.object({
  id: z.string().uuid().optional(),
  version: z.number().int().positive().optional(),
  arabic_name: z.string().trim().min(1).max(100),
  english_name: z.string().trim().min(1).max(100),
  display_order: z.number().int().min(0).max(10000),
  is_active: z.boolean(),
});
const user = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  name: z.string().trim().min(1).max(150),
  role: z.enum(["ADMIN", "HR", "VIEWER"]),
  is_active: z.boolean(),
});
export async function GET(request: Request) {
  try {
    const s = await session();
    const params = new URL(request.url).searchParams;
    const kind = params.get("kind") || "dashboard";
    const filters = Object.fromEntries(
      [...params].filter(([k]) => k !== "kind"),
    );
    return json(
      await rpc("hr_read", { p_kind: kind, p_filters: filters }, s.token),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    protectMutation(request);
    const s = await session();
    const { action, data } = await body(request);
    if (s.profile.role === "VIEWER")
      throw new AppError("ليست لديك صلاحية لهذه العملية", 403);
    let schema: z.ZodTypeAny;
    if (action === "employee.save") schema = employeeSchema;
    else if (action === "status.save") schema = statusSchema;
    else if (action === "status.delete")
      schema = z.object({
        id: z.string().uuid(),
        version: z.number().int(),
        confirmed: z.literal(true),
      });
    else {
      if (s.profile.role !== "ADMIN")
        throw new AppError("ليست لديك صلاحية لهذه العملية", 403);
      if (action === "department.save") schema = department;
      else if (["shift.save", "manager.save"].includes(action)) schema = lookup;
      else if (action === "user.save") schema = user;
      else if (action === "app.save")
        schema = z.object({
          name: z.string().trim().min(1).max(150),
          version: z.number().int().positive(),
        });
      else throw new AppError("طلب غير صالح");
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success) throw new AppError(parsed.error.issues[0].message);
    return json(
      await rpc("hr_write", { p_action: action, p_data: parsed.data }, s.token),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
