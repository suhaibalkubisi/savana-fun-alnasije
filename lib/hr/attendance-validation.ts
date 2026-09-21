import { z } from "zod";
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const revision = {
  id: z.string().uuid(),
  version: z.number().int().positive(),
};
const minute = z.number().int().min(0).max(1439);
export const attendanceSchemas: Record<string, z.ZodTypeAny> = {
  "import.preview": z.object({
    source_name: z.string().min(1).max(250),
    source_hash: z.string().regex(/^[a-f0-9]{64}$/),
    import_kind: z.enum(["daily", "monthly"]),
    period_start: date,
    period_end: date,
    rows: z
      .array(
        z.object({
          source_sheet: z.string().max(100),
          source_row: z.number().int().positive(),
          calendar_date: date,
          person_code: z.string().max(100),
          source_name: z.string().max(250),
          raw_values: z.array(z.string().max(2000)).max(101),
          punch_minutes: z.array(minute).max(100),
          invalid: z.boolean(),
        }),
      )
      .min(1)
      .max(20000),
  }),
  "import.apply": z.object(revision),
  "import.cancel": z.object(revision),
  "import.review": z.object(revision),
  "import.approve": z.object(revision),
  "import.supersede": z.object({
    ...revision,
    replacement_id: z.string().uuid(),
    replacement_version: z.number().int().positive(),
  }),
  "issue.resolve": z.object({
    ...revision,
    state: z.enum(["resolved", "ignored"]),
    employee_id: z.string().uuid().optional(),
    resolution_note: z.string().trim().min(1).max(2000),
  }),
  "issue.reprocess": z.object(revision),
  "rule.save": z.object({
    id: revision.id.optional(),
    version: revision.version.optional(),
    department_id: z.string().uuid(),
    effective_from: date,
    start_minute: minute,
    grace_minutes: z.number().int().min(0).max(180),
    entry_window_start: minute,
    entry_window_end: minute,
    working_weekdays: z.array(z.number().int().min(0).max(6)).max(7),
    default_manager_id: z.string().uuid().nullable(),
  }),
  "note.save": z.object({
    id: revision.id.optional(),
    version: revision.version.optional(),
    employee_id: z.string().uuid(),
    work_date: date,
    notes: z.string().max(2000),
    procedure_text: z.string().max(2000),
  }),
  "employee.delete_permanent": z.object({
    source_employee_id: z.string().uuid(),
    confirmed: z.literal(true),
  }),
  "employee.merge": z.object({
    source_employee_id: z.string().uuid(),
    target_employee_id: z.string().uuid(),
    confirmed: z.literal(true),
  }),
};
