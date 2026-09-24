import {
  administrativeActionSchema,
  administrativeActionTypeSchema,
  employeeSchema,
  statusBulkSchema,
  statusSchema,
} from "@/lib/hr/validation";
import { z } from "zod";
import { attendanceSchemas } from "@/lib/hr/attendance-validation";
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
      await rpc(
        kind.startsWith("attendance.") ? "attendance_read_v3" : "hr_read_v3",
        { p_kind: kind.replace(/^attendance\./, ""), p_filters: filters },
        s.token,
      ),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    protectMutation(request);
    const s = await session();
    const { action, data } = await body(request, 8_000_000);
    if (s.profile.role === "VIEWER")
      throw new AppError("ليست لديك صلاحية لهذه العملية", 403);
    let schema: z.ZodTypeAny;
    if (typeof action === "string" && action.startsWith("attendance.")) {
      const operation = action.slice(11);
      if (
        (operation === "rule.save" || operation.startsWith("employee.")) &&
        s.profile.role !== "ADMIN"
      )
        throw new AppError("ليست لديك صلاحية لهذه العملية", 403);
      const validator = attendanceSchemas[operation];
      if (!validator) throw new AppError("طلب غير صالح");
      const parsed = validator.safeParse(data);
      if (!parsed.success) throw new AppError("بيانات غير صالحة");
      return json(
        await rpc(
          operation === "identity.resolve"
            ? "attendance_identity_resolve"
            : "attendance_write_v3",
          operation === "identity.resolve"
            ? { p_data: parsed.data }
            : { p_action: operation, p_data: parsed.data },
          s.token,
        ),
      );
    }
    if (action === "employee.save") schema = employeeSchema;
    else if (action === "status.save") schema = statusSchema;
    else if (action === "status.bulk") schema = statusBulkSchema;
    else if (action === "administrative_action.save")
      schema = administrativeActionSchema;
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
      else if (action === "administrative_action_type.save")
        schema = administrativeActionTypeSchema;
      else if (action === "administrative_action.delete")
        schema = z.object({
          id: z.string().uuid(),
          version: z.number().int().positive(),
          confirmed: z.literal(true),
        });
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
      await rpc(
        "hr_write_v2",
        { p_action: action, p_data: parsed.data },
        s.token,
      ),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
