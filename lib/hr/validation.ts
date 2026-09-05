import { z } from "zod";
export const clean = (s: string) => s.trim().replace(/\s+/g, " ");
const text = z.string().transform(clean);
const id = z.string().uuid("اختيار غير صالح");
const optionalId = z
  .union([id, z.literal(""), z.null()])
  .transform((v) => v || null);
export const employeeSchema = z.object({
  id: id.optional(),
  version: z.number().int().positive().optional(),
  name: text.pipe(
    z.string().min(1, "اسم الموظف مطلوب").max(150, "الاسم طويل جداً"),
  ),
  employee_number: text
    .pipe(z.string().max(50))
    .nullable()
    .transform((v) => v || null),
  department_id: id,
  shift_id: optionalId,
  direct_manager_id: optionalId,
  employment_status: z.enum(["active", "resigned", "inactive", "long_leave"]),
});
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "التاريخ غير صالح")
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "التاريخ غير صالح",
  );
export const statusSchema = z
  .object({
    id: id.optional(),
    version: z.number().int().positive().optional(),
    employee_id: id,
    department_id: id,
    record_date: date,
    status_type: z.enum(["absence", "absence2", "absence3", "leave", "late"]),
    late_minutes: z
      .number()
      .int("دقائق التأخير يجب أن تكون عدداً صحيحاً")
      .min(0, "دقائق التأخير سالبة")
      .max(10080)
      .nullable(),
    notes: text.pipe(z.string().max(1000, "الملاحظات طويلة جداً")).nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.status_type === "late" && v.late_minutes === null)
      ctx.addIssue({
        code: "custom",
        path: ["late_minutes"],
        message: "دقائق التأخير مطلوبة",
      });
    if (
      v.status_type !== "late" &&
      v.late_minutes !== null &&
      v.late_minutes !== 0
    )
      ctx.addIssue({
        code: "custom",
        path: ["late_minutes"],
        message: "دقائق موجودة لكن الحالة ليست تأخير",
      });
  });
export const statusBulkSchema = z.object({
  items: z
    .array(
      z.union([
        z.object({ operation: z.literal("save"), data: statusSchema }),
        z.object({
          operation: z.literal("delete"),
          data: z.object({
            id,
            version: z.number().int().positive(),
            confirmed: z.literal(true),
          }),
        }),
      ]),
    )
    .min(1, "لا توجد تغييرات للحفظ")
    .max(200, "عدد الإدخالات أكبر من المسموح"),
});
export const administrativeActionSchema = z.object({
  id: id.optional(),
  version: z.number().int().positive().optional(),
  employee_id: id,
  action_type_id: id,
  action_date: date,
  reason: text.pipe(z.string().min(1, "سبب الإجراء مطلوب").max(300)),
  description: text.pipe(z.string().max(3000)).nullable(),
  notes: text.pipe(z.string().max(2000)).nullable(),
  related_status_record_id: optionalId,
  state: z.enum(["active", "closed", "cancelled"]),
});
export const administrativeActionTypeSchema = z.object({
  id: id.optional(),
  version: z.number().int().positive().optional(),
  arabic_name: text.pipe(z.string().min(1, "اسم الإجراء مطلوب").max(100)),
  display_order: z.number().int().min(0).max(10000),
  is_active: z.boolean(),
});
export const loginSchema = z.object({
  email: z.string().email("البريد الإلكتروني غير صالح").max(254),
  password: z.string().min(1, "كلمة المرور مطلوبة").max(200),
});
export const newUserSchema = z.object({
  name: text.pipe(z.string().min(1).max(150)),
  email: z.string().email().max(254),
  password: z.string().min(12, "كلمة المرور لا تقل عن 12 حرفاً").max(200),
  role: z.enum(["ADMIN", "HR", "VIEWER"]),
});
