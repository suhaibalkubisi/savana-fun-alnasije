// Generate a review-only proposal from immutable v39 definitions, without connecting to a database.
import fs from "node:fs";
const root = "supabase/";
const candidate = fs
  .readFileSync(
    root + "migrations/20261013223509_evening_release_candidate.sql",
    "utf8",
  )
  .replaceAll("\r\n", "\n");
const setup = fs
  .readFileSync(
    root + "migrations/20261014181643_evening_controlled_roster_setup.sql",
    "utf8",
  )
  .replaceAll("\r\n", "\n");
function fn(source, start, end = "end$$;") {
  const i = source.indexOf(start);
  if (i < 0) throw Error(start);
  const j = source.indexOf(end, i);
  if (j < 0) throw Error("Missing function ending");
  return source.slice(i, j + end.length);
}
function replace(s, a, b) {
  if (!s.includes(a)) throw Error("Baseline changed: " + a.slice(0, 100));
  return s.replaceAll(a, b);
}
let read = fn(candidate, "create or replace function public.followup_read(");
// Administrative actions follow directory scope, while report history retains its dated checks.
read = replace(
  read,
  "if p_kind in ('position','reports','reporting_model','completeness','actions') then",
  "if p_kind in ('position','reports','reporting_model','completeness') then",
);
read = replace(
  read,
  "then raise exception 'الموظف خارج صلاحيتك' using errcode='42501';end if;\n elsif not followup_private.employee_scope(eid)",
  "and not followup_private.employee_scope(eid) then raise exception 'الموظف خارج صلاحيتك' using errcode='42501';end if;\n elsif not followup_private.employee_scope(eid)",
);
// Empty directory-only reports must keep the same filter and live-scope guards as populated reports.
read = replace(
  read,
  "end if;\nif p_kind='bootstrap' then",
  "end if;\nif eid is not null and p_kind in ('position','reports','completeness') and followup_private.employee_scope(eid) and not exists(select 1 from public.employee_assignment_history h where h.employee_id=eid and h.shift_id=es and h.voided_at is null) and not exists(select 1 from public.fu_entries e where e.employee_id=eid) then return '[]'::jsonb;end if;\nif p_kind='bootstrap' then",
);
read = replace(
  read,
  "jsonb_build_object('id',eid,'employee_id',eid,'name',max(x->>'name'),'internal_code',max(x->>'internal_code'),'period_departments',jsonb_agg(distinct x->>'department_name')) from jsonb_array_elements(public.followup_read('position',p_filters))x",
  "jsonb_build_object('id',e.id,'employee_id',e.id,'name',coalesce((select max(x->>'name') from jsonb_array_elements(public.followup_read('position',p_filters))x),e.name),'internal_code',e.internal_code,'period_departments',coalesce((select jsonb_agg(distinct x->>'department_name') from jsonb_array_elements(public.followup_read('position',p_filters))x),'[]'::jsonb)) from public.employees e where e.id=eid",
);
read = replace(
  read,
  "select e.id employee_id,e.name,e.internal_code,day::date",
  "select e.id employee_id,case when fin.report_id is not null then coalesce(en.employee_name,e.name) else e.name end name,case when fin.report_id is not null then coalesce(en.permanent_code,e.internal_code) else e.internal_code end internal_code,day::date",
);
read = replace(
  read,
  "when h.id is null or h.shift_id is distinct from es or h.employment_status not in ('active','long_leave') then 'outside_roster' when fin.report_id is not null then case when fin.status='unresolved' then 'unresolved' else 'reported' end",
  "when fin.report_id is not null then case when fin.status='unresolved' then 'unresolved' else 'reported' end when h.id is null or h.shift_id is distinct from es or h.employment_status not in ('active','long_leave') then 'outside_roster'",
);
read = replace(
  read,
  "public.followup_read(p_kind text",
  "followup_private.read_before_roster_setup(p_kind text",
);
// Each dated row resolves service independently of enrollment evidence. Saved report entries stay intact.
const ri = read.indexOf("elsif p_kind='roster'"),
  pi = read.indexOf("elsif p_kind='position'"),
  ei = read.indexOf("elsif p_kind='reports'");
read =
  read.slice(0, ri) +
  read
    .slice(ri, pi)
    .replaceAll(
      "h.employment_status",
      "followup_private.service_state(e.id,sd)",
    ) +
  read
    .slice(pi, ei)
    .replaceAll(
      "h.employment_status",
      "followup_private.service_state(e.id,day::date)",
    ) +
  read.slice(ei);
read = replace(
  read,
  "h.shift_id,followup_private.service_state(e.id,sd),h.department_id effective_department",
  "h.shift_id,followup_private.service_state(e.id,sd) employment_status,h.department_id effective_department",
);
read = replace(
  read,
  "and h.employment_status in ('active','long_leave')",
  "and followup_private.service_state(h.employee_id,day::date) in ('active','long_leave')",
);
read = replace(
  read,
  "'handovers',case when eid is null then public.followup_read('handovers',p_filters) else '[]'::jsonb end",
  "'handovers','[]'::jsonb",
);
read = replace(
  read,
  "(to_jsonb(x)-'old_value'-'new_value')||jsonb_build_object('old_value'",
  "(to_jsonb(x)-'old_value'-'new_value')||jsonb_build_object('actor_name',(select name from public.profiles where id=x.actor),'old_value'",
);
// Never expose a linked private document's identifier/title after its grant is revoked.
read = replace(
  read,
  "select jsonb_agg(to_jsonb(x) order by created_at,id) from public.fu_action_comments x where x.action_id=t.id",
  "select jsonb_agg((to_jsonb(x)-'document_id')||jsonb_build_object('actor_name',(select name from public.profiles where id=x.actor),'document_id',case when exists(select 1 from public.fu_documents linked_doc where linked_doc.id=x.document_id and linked_doc.state='active' and followup_private.document_access(linked_doc,false)) then x.document_id else null end,'document_title',(select linked_doc.title from public.fu_documents linked_doc where linked_doc.id=x.document_id and linked_doc.state='active' and followup_private.document_access(linked_doc,false))) order by created_at,id) from public.fu_action_comments x where x.action_id=t.id",
);
let write = fn(candidate, "create or replace function public.followup_write(");
write = replace(
  write,
  "public.followup_write(p_kind text",
  "followup_private.write_before_roster_setup(p_kind text",
);
write = replace(
  write,
  "and e.shift_id=es and followup_private.employee_scope(e.id)",
  "and followup_private.employee_scope(e.id)",
);
// Keep the atomic action/comment transaction and original request binding.
write = replace(
  write,
  "if btrim(coalesce(p_data->>'comment',''))<>'' then insert into public.fu_action_comments(action_id,body,actor) values(rid,p_data->>'comment',u);end if;",
  "if btrim(coalesce(p_data->>'comment',''))<>'' then insert into public.fu_action_comments(action_id,body,document_id,actor) values(rid,p_data->>'comment',nullif(p_data->>'attachment_document_id','')::uuid,u);end if;",
);
// Retain the account date-preservation wrapper from v39 under a new private name.
let outerWrite = fn(setup, "create function public.followup_write(");
outerWrite = replace(
  outerWrite,
  "e.direct_manager_id,e.employment_status,sd,",
  "e.direct_manager_id,followup_private.service_state(e.id,sd),sd,",
);
outerWrite = replace(
  outerWrite,
  "create function public.followup_write(",
  "create or replace function followup_private.write_before_staff_repairs(",
);
let directory = fn(
  setup,
  "create function followup_private.employee_directory_rows(",
  "$$;",
);
directory = replace(directory, "create function", "create or replace function");
directory = replace(
  directory,
  "e.employment_status,e.version",
  "followup_private.service_state(e.id,followup_private.today()) employment_status,e.version",
);
directory = replace(
  directory,
  "e.group_name,d.arabic_name",
  "e.group_name,(select jsonb_agg(jsonb_build_object('employment_status',decision.employment_status,'valid_from',decision.valid_from,'reason',decision.reason)) from public.fu_service_decisions decision where decision.employee_id=e.id and decision.valid_from>followup_private.today()) scheduled_service,d.arabic_name",
);
directory = replace(
  directory,
  "where followup_private.scope_at(e.department_id,followup_private.today())",
  "where followup_private.scope_at(e.department_id,followup_private.today()) and (nullif(p_filters->>'service_state','') is null or followup_private.service_state(e.id,followup_private.today())=p_filters->>'service_state')",
);
let session = fn(setup, "create or replace function public.followup_session(");
session = replace(
  session,
  "array['profile_edit'",
  "array['service_manage','identity_edit','profile_edit'",
);
const head = fs.readFileSync(root + "staff-repairs-head.sql", "utf8"),
  recovery = fs.readFileSync(root + "staff-recovery.sql", "utf8"),
  tail = fs.readFileSync(root + "staff-repairs-tail.sql", "utf8");
fs.mkdirSync(root + "proposals", { recursive: true });
let selection = fn(
  setup,
  "create function followup_private.roster_setup_selection(",
);
selection = replace(selection, "create function", "create or replace function");
selection = replace(
  selection,
  "e.employment_status not in ('active','long_leave')",
  "followup_private.service_state(e.id,day) not in ('active','long_leave')",
);
fs.writeFileSync(
  root + "proposals/staff-repairs.sql",
  [head, read, write, outerWrite, directory, selection, session, recovery, tail].join(
    "\n\n",
  ),
);
console.log("Review-only SQL proposal generated; no database connection.");
