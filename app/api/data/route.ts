import {
  administrativeActionSchema,
  administrativeActionTypeSchema,
  employeeSchema,
  statusBulkSchema,
  statusSchema,
} from "@/lib/hr/validation";
import { z } from "zod";
import { attendanceSchemas } from "@/lib/hr/attendance-validation";
import { buildMonthlyPosition } from "@/lib/hr/monthly-position.mjs";
import {comprehensivePosition} from "@/lib/hr/comprehensive-position.mjs";
import { buildDailyPosition } from "@/lib/hr/attendance-engine.mjs";
import {inspectFileOnboarding} from '@/lib/server/onboarding';
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
    if(kind==='attendance.company_review')return json(await rpc('attendance_company_review',{p_filters:{import_id:z.string().uuid().parse(filters.import_id)}},s.token));
    if(kind==='attendance.onboarding')return json(await inspectFileOnboarding(z.string().uuid().parse(filters.import_id),s.token));
    if(kind==="report")return json(comprehensivePosition(await rpc("hr_comprehensive_evidence",{p_filters:filters},s.token)));
    if(kind==="attendance.period_gaps")return json(await rpc("attendance_period_gaps",{p_filters:filters},s.token));
    if(kind==="attendance.sources")return json(await rpc("attendance_sources",{},s.token));
    if (kind === "attendance.monthly_position") {
      const evidence = await rpc("attendance_monthly_evidence_v2", {p_filters: filters}, s.token);
      return json(buildMonthlyPosition(evidence, {
        coverage_start: filters.coverage_start || undefined,
        coverage_end: filters.coverage_end || undefined,
      }));
    }
    if (kind === 'attendance.daily') return json(buildDailyPosition(await rpc('attendance_daily_evidence',{p_filters:filters},s.token),filters));
    if (kind === 'employee.assignments') return json(await rpc('employee_assignments',{p_employee_id:z.string().uuid().parse(filters.employee_id)},s.token));
    if (kind === 'attendance.identity_proposal' || kind === 'attendance.identity_registry') return json(await rpc(kind === 'attendance.identity_proposal'?'attendance_identity_proposal':'attendance_identity_registry',{p_filters:filters},s.token));
    return json(
      await rpc(
        kind.startsWith("attendance.") ? "attendance_read_v5" : "hr_read_v4",
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
    if(action==='attendance.company.confirm'){
      const selection=z.object({person_code:z.string().min(1).max(100),employee_uuid:z.string().uuid(),employee_version:z.number().int().positive(),reason:z.string().max(1800).optional(),evidence_reference:z.string().max(1800).optional()}).strict();
      const input=z.object({batch_id:z.string().min(1).max(150),batch_version:z.number().int().positive(),request_id:z.string().uuid(),review_confirmed:z.literal(true),evidence_reference:z.string().trim().min(3).max(1800),selections:z.array(selection).min(1).max(500)}).strict().parse(data);
      return json(await rpc('attendance_company_confirm',{p_data:input},s.token));
    }
    if(action==='attendance.company.apply')return json(await rpc('attendance_company_apply',{p_data:z.object({confirmation_id:z.string().uuid(),apply_confirmed:z.literal(true)}).strict().parse(data)},s.token));
    if(action==='attendance.company.notes')return json(await rpc('attendance_company_notes',{p_data:z.object({import_id:z.string().uuid(),preview_version:z.number().int().positive(),notes_version:z.number().int().nonnegative(),answers:z.record(z.string().max(200),z.string().max(2000))}).strict().parse(data)},s.token));
    if(action==='attendance.onboarding.inspect'){
      const input=z.object({import_id:z.string().uuid(),proposed:z.array(z.object({person_code:z.string().min(1).max(100),employee_uuid:z.string().uuid()})).max(500)}).parse(data);
      return json(await inspectFileOnboarding(input.import_id,s.token,input.proposed));
    }
    if (action === 'attendance.daily.replace') return json(await rpc('attendance_daily_replace',{p_data:z.object({id:z.string().uuid(),version:z.number().int().positive(),replacement_id:z.string().uuid(),replacement_version:z.number().int().positive(),reason:z.string().trim().min(3).max(2000)}).parse(data)},s.token));
    if (action === 'attendance.boundary.record') return json(await rpc('attendance_boundary_record',{p_data:z.object({id:z.string().uuid(),version:z.number().int().positive(),adjacent_import_id:z.string().uuid(),reason:z.string().trim().min(3).max(2000)}).parse(data)},s.token));
    if(action==='employee.assignment.bulk'){
      const assignment=z.object({employee_id:z.string().uuid(),employee_version:z.number().int().positive(),department_id:z.string().uuid(),shift_id:z.string().uuid().nullable(),direct_manager_id:z.string().uuid().nullable(),employment_status:z.enum(['active','inactive','resigned','long_leave']),valid_from:z.string().date(),valid_to:z.string().date(),reason:z.string().trim().min(3).max(2000)});
      return json(await rpc('employee_assignment_bulk',{p_data:z.object({confirmed:z.literal(true),rows:z.array(assignment).min(1).max(500)}).parse(data)},s.token));
    }
    if (action === 'employee.assignment.record') {
      const parsed=z.object({id:z.string().uuid().optional(),version:z.number().int().positive().optional(),employee_id:z.string().uuid(),employee_version:z.number().int().positive(),department_id:z.string().uuid(),shift_id:z.string().uuid().nullable(),direct_manager_id:z.string().uuid().nullable(),employment_status:z.enum(['active','inactive','resigned','long_leave']),valid_from:z.string().date(),valid_to:z.string().date(),reason:z.string().trim().min(3).max(2000)}).parse(data);
      return json(await rpc('employee_assignment_record',{p_data:parsed},s.token));
    }
    if (action === 'attendance.day.save') {
      const parsed=z.object({note:attendanceSchemas['note.save'],decision:z.discriminatedUnion('operation',[
        z.object({operation:z.literal('save'),data:statusSchema}),
        z.object({operation:z.literal('delete'),data:z.object({id:z.string().uuid(),version:z.number().int().positive(),confirmed:z.literal(true)})}),
      ]).nullable()}).parse(data);
      return json(await rpc('attendance_day_save',{p_data:parsed},s.token));
    }
    if (typeof action === "string" && action.startsWith("attendance.")) {
      const operation = action.slice(11);
      if (
        (operation === "rule.save" || operation.startsWith("employee.")) &&
        s.profile.role !== "ADMIN"
      )
        throw new AppError("ليست لديك صلاحية لهذه العملية", 403);
      const validator = attendanceSchemas[operation === "import.inspect" ? "import.preview" : operation];
      if (!validator) throw new AppError("طلب غير صالح");
      const parsed = validator.safeParse(data);
      if (!parsed.success) throw new AppError("بيانات غير صالحة");
      if (operation === "import.inspect") return json(buildMonthlyPosition(await rpc("attendance_inspect_monthly_v2", {p_data:parsed.data}, s.token)));
      return json(
        await rpc(
          operation === "identity.resolve"
            ? "attendance_identity_resolve"
            : "attendance_write_v5",
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
