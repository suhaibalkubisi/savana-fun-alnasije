-- REVIEW ONLY. Never apply without explicit approval. No real roster/grants/accounts are created.
begin;
create table public.fu_service_decisions(
 id uuid primary key default gen_random_uuid(),employee_id uuid not null references public.employees(id),
 employment_status text not null check(employment_status in ('active','inactive','resigned','long_leave')),
 valid_from date not null,reason text not null check(length(btrim(reason)) between 5 and 2000),
 actor uuid not null references public.profiles(id),employee_version integer not null,
 created_at timestamptz not null default clock_timestamp());
create index fu_service_effective on public.fu_service_decisions(employee_id,valid_from desc,created_at desc);
alter table public.fu_service_decisions enable row level security;
revoke all on public.fu_service_decisions from public,anon,authenticated;
create table public.fu_quarantined_departments(
 department_id uuid primary key references public.departments(id),provenance text not null,reason text not null);
alter table public.fu_quarantined_departments enable row level security;
revoke all on public.fu_quarantined_departments from public,anon,authenticated;
-- The two IDs below are verified in the 18 October handoff audit and fresh read-only metadata.
-- Identity-bound provenance, never a name/active-state heuristic. No employee row is deleted.
insert into public.fu_quarantined_departments(department_id,provenance,reason)
select id,'isolated QA run af78f116-5355-4e01-a07e-3197bd212a47; handoff F01; metadata read 2026-10-18',
 'Established synthetic QA retained for explicitly authorized history only'
from public.departments where id in ('b6e303a2-9ba8-411a-a904-acd192fc8724','dd98ceaa-3303-453e-b485-bb516f53fcdf');
alter table public.fu_capabilities drop constraint fu_capabilities_capability_check;
alter table public.fu_capabilities add constraint fu_capabilities_capability_check check(capability in
 ('service_manage','identity_edit','profile_edit','documents_read','documents_write','documents_sensitive_read','documents_sensitive_write','roster_manage','archive_read'));
-- New capabilities have no default grants, including ADMIN. Production permission decisions remain separate.
create table public.fu_account_creations(
 user_id uuid not null references public.profiles(id),request_id uuid not null,
 payload jsonb not null,state text not null check(state in ('pending','created','configured','rejected','duplicate','unknown','not_started')),
 created_user_id uuid,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 primary key(user_id,request_id));
alter table public.fu_account_creations enable row level security;
create index fu_account_creation_pending_email on public.fu_account_creations(user_id,(payload->>'email')) where state in ('pending','created','unknown');
revoke all on public.fu_account_creations from public,anon,authenticated;
create function followup_private.account_creation(rid uuid,data jsonb,operation text) returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare u uuid:=auth.uid();r text:=followup_private.account_role();q public.fu_account_creations;v_payload jsonb;is_new boolean:=false;target uuid;
begin
 if r<>'ADMIN' then raise exception 'إدارة الحسابات للمدير' using errcode='42501';end if;
 if rid is null then raise exception 'معرف الطلب مطلوب' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('account-creation:'||u::text||rid::text,0));
 select * into q from public.fu_account_creations where user_id=u and request_id=rid for update;
 if operation='close_unstarted' then
  -- A tombstone holds the same lock as begin: a delayed POST can never start after closure.
  if q.request_id is null then
   insert into public.fu_account_creations(user_id,request_id,payload,state) values(u,rid,'{}'::jsonb,'not_started') returning * into q;
  end if;
 elsif operation='begin' then
  if q.state='not_started' then raise exception 'أُغلق الطلب قبل بدء الإنشاء؛ استخدم طلباً جديداً' using errcode='PT409';end if;
  if length(btrim(coalesce(data->>'reason',''))) not between 5 and 2000 or length(btrim(coalesce(data->>'name',''))) not between 1 and 150 or position('@' in coalesce(data->>'email',''))<2 or coalesce(data->>'role','') not in ('ADMIN','FOLLOWUP','SUPERVISOR','VIEWER') or jsonb_typeof(data->'departments') is distinct from 'array' or jsonb_array_length(data->'departments')>100 then raise exception 'بيانات إنشاء الحساب غير صالحة' using errcode='22023';end if;
  if (data->>'role'='SUPERVISOR' and jsonb_array_length(data->'departments')=0) or exists(select 1 from jsonb_array_elements_text(data->'departments')d where not followup_private.scope_at(d::uuid,followup_private.today())) then raise exception 'الأقسام خارج صلاحيتك' using errcode='42501';end if;
  v_payload:=jsonb_build_object('name',btrim(data->>'name'),'email',lower(btrim(data->>'email')),'role',data->>'role','departments',data->'departments','reason',btrim(data->>'reason'));
  if q.request_id is not null and q.payload is distinct from v_payload then raise exception 'تغيرت بيانات طلب الإنشاء' using errcode='PT409';end if;
  if q.request_id is null then
   perform pg_advisory_xact_lock(hashtextextended('account-email:'||u::text||(v_payload->>'email'),0));
   -- A lost final proof read can leave a completed account transaction marked created.
   -- Reconcile exact actor/request/account evidence before treating the email as unresolved.
   update public.fu_account_creations x set state='configured',updated_at=clock_timestamp()
    where x.user_id=u and x.payload->>'email'=v_payload->>'email' and x.state in ('pending','created','unknown')
    and exists(select 1 from public.fu_requests proof where proof.user_id=x.user_id and proof.request_id=x.request_id and proof.payload->>'kind'='account' and proof.payload->'data'->>'user_id'=x.created_user_id::text and proof.payload->'data'->>'role'=x.payload->>'role' and proof.payload->'data'->'active'='true'::jsonb and proof.payload->'data'->'departments'=x.payload->'departments' and proof.payload->'data'->>'reason'=x.payload->>'reason');
   if exists(select 1 from public.fu_account_creations x where x.user_id=u and x.payload->>'email'=v_payload->>'email' and x.state in ('pending','created','unknown')) then raise exception 'طلب سابق لهذا البريد يحتاج استكمالاً' using errcode='PT409';end if;
   insert into public.fu_account_creations(user_id,request_id,payload,state) values(u,rid,v_payload,'pending') returning * into q;is_new:=true;
  end if;
 elsif operation='result' then
  if q.request_id is null then raise exception 'طلب الإنشاء غير موجود' using errcode='22023';end if;
  if coalesce(data->>'state','') not in ('created','configured','rejected','duplicate','unknown') then raise exception 'نتيجة الطلب غير صالحة' using errcode='22023';end if;
  target:=nullif(data->>'user_id','')::uuid;
  if q.created_user_id is not null and target is not null and target<>q.created_user_id then raise exception 'هوية الاستكمال تغيرت' using errcode='PT409';end if;
  if data->>'state'='created' and (target is null or q.state in ('rejected','duplicate')) then raise exception 'لا يمكن ربط هذا الطلب بالحساب' using errcode='PT409';end if;
  if q.state<>'configured' and not (q.state='created' and data->>'state' in ('unknown','rejected','duplicate')) then
   update public.fu_account_creations set state=data->>'state',created_user_id=coalesce(created_user_id,target),updated_at=clock_timestamp() where user_id=u and request_id=rid returning * into q;
  end if;
 elsif operation<>'read' then raise exception 'عملية غير صالحة' using errcode='22023';end if;
 if q.request_id is null then return jsonb_build_object('state','not_found','request_id',rid);end if;
 -- The exact actor/request-bound account transaction is authoritative even if its response was lost.
 if exists(select 1 from public.fu_requests x where x.user_id=u and x.request_id=rid and x.payload->>'kind'='account' and x.payload->'data'->>'user_id'=q.created_user_id::text and x.payload->'data'->>'role'=q.payload->>'role' and x.payload->'data'->'active'='true'::jsonb and x.payload->'data'->'departments'=q.payload->'departments' and x.payload->'data'->>'reason'=q.payload->>'reason') then
  if q.state<>'configured' then
   update public.fu_account_creations set state='configured',updated_at=clock_timestamp() where user_id=u and request_id=rid returning * into q;
  end if;
 elsif q.state='configured' then raise exception 'تعذر إثبات إعداد الحساب' using errcode='PT409';end if;
 return q.payload||jsonb_build_object('request_id',rid,'state',q.state,'user_id',q.created_user_id,'start',is_new);
end$$;
revoke all on function followup_private.account_creation(uuid,jsonb,text) from public,anon,authenticated;
create or replace function followup_private.user_scope_at(u uuid,d uuid,day date) returns boolean language sql stable set search_path=pg_catalog,public as $$
select not exists(select 1 from public.fu_quarantined_departments q where q.department_id=d)
 and exists(select 1 from public.fu_accounts a join public.profiles p on p.id=a.user_id where a.user_id=u and a.active and p.is_active and
 (a.role='ADMIN' or exists(select 1 from public.fu_departments f where f.user_id=u and f.department_id=d and (f.valid_from is null or f.valid_from<=day) and (f.valid_to is null or f.valid_to>=day))))$$;
create or replace function followup_private.scope(d uuid) returns boolean language sql stable set search_path=pg_catalog,public as $$select followup_private.scope_at(d,followup_private.today())$$;
create or replace function followup_private.employee_scope(eid uuid) returns boolean language sql stable set search_path=pg_catalog,public as $$
 select exists(select 1 from public.employees e where e.id=eid and followup_private.scope_at(e.department_id,followup_private.today()))$$;
create function followup_private.service_state(eid uuid,day date) returns text language sql stable set search_path=pg_catalog,public as $$
 select coalesce((select state from (
 select s.employment_status state,s.valid_from,1 priority,s.created_at from public.fu_service_decisions s where s.employee_id=eid and s.valid_from<=day
 union all select h.employment_status,h.valid_from,0,h.created_at from public.employee_assignment_history h where h.employee_id=eid and (h.evidence_kind='verified' or day<followup_private.today()) and h.voided_at is null and h.valid_from<=day and (h.valid_to is null or h.valid_to>=day)
 )x order by priority desc,valid_from desc,created_at desc limit 1),(select employment_status from public.employees where id=eid))$$;
create or replace function followup_private.verified_evening_member(eid uuid,d uuid,day date) returns boolean language sql stable set search_path=pg_catalog,public as $$
select followup_private.service_state(eid,day) in ('active','long_leave') and exists(select 1 from public.employee_assignment_history h where h.employee_id=eid and h.department_id=d and h.shift_id=followup_private.evening_shift() and h.voided_at is null and h.evidence_kind='verified' and h.valid_from<=day and (h.valid_to is null or h.valid_to>=day) and followup_private.scope_at(h.department_id,day))$$;


create or replace function followup_private.read_before_roster_setup(p_kind text,p_filters jsonb default '{}') returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r text:=followup_private.account_role();sd date:=coalesce(nullif(p_filters->>'start','')::date,followup_private.today());ed date:=coalesce(nullif(p_filters->>'end','')::date,sd);d uuid:=nullif(p_filters->>'department_id','')::uuid;eid uuid:=nullif(p_filters->>'employee_id','')::uuid;did uuid:=nullif(p_filters->>'id','')::uuid;es uuid:=followup_private.evening_shift();result jsonb;doc public.fu_documents;emp public.employees;
begin
if nullif(p_filters->>'shift_id','') is not null and (p_filters->>'shift_id')::uuid<>es then raise exception 'العمليات مسائية فقط' using errcode='22023';end if;
if ed<sd or ed-sd>366 then raise exception 'الفترة غير صالحة' using errcode='22023';end if;
if d is not null and not followup_private.scope_at(d,sd) then raise exception 'القسم خارج صلاحيتك' using errcode='42501';end if;
if eid is not null then
 if p_kind in ('position','reports','reporting_model','completeness') then
  if not exists(select 1 from public.employee_assignment_history h where h.employee_id=eid and h.voided_at is null and h.shift_id=es and h.valid_from<=ed and (h.valid_to is null or h.valid_to>=sd) and followup_private.scope_at(h.department_id,greatest(sd,h.valid_from))) and not exists(select 1 from public.fu_entries en join public.fu_reports rp on rp.id=en.report_id where en.employee_id=eid and rp.shift_id=es and rp.work_date between sd and ed and followup_private.scope_at(rp.department_id,rp.work_date)) and not followup_private.employee_scope(eid) then raise exception 'الموظف خارج صلاحيتك' using errcode='42501';end if;
 elsif not followup_private.employee_scope(eid) then raise exception 'الموظف خارج صلاحيتك' using errcode='42501';end if;
end if;
if eid is not null and p_kind in ('position','reports','completeness') and followup_private.employee_scope(eid) and not exists(select 1 from public.employee_assignment_history h where h.employee_id=eid and h.shift_id=es and h.voided_at is null) and not exists(select 1 from public.fu_entries e where e.employee_id=eid) then return '[]'::jsonb;end if;
if p_kind='bootstrap' then
 return jsonb_build_object('user',public.followup_session(),'capabilities',public.followup_session()->'capabilities','evening_shift_id',es,'departments',coalesce((select jsonb_agg(to_jsonb(t) order by t.display_order,t.arabic_name) from public.departments t where followup_private.scope_at(t.id,sd)),'[]'::jsonb),'shifts',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('scope','evening')) from public.shifts t where t.id=es),'[]'::jsonb),'statuses',(select jsonb_agg(to_jsonb(t) order by code) from public.fu_statuses t),'reporters',public.followup_read('reporters',p_filters),'users',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'email',p.email,'role',a.role,'active',a.active,'version',a.version,'departments',coalesce((select jsonb_agg(department_id) from public.fu_departments where user_id=p.id),'[]'::jsonb),'capabilities',coalesce((select jsonb_object_agg(capability,granted) from public.fu_capabilities where user_id=p.id),'{}'::jsonb))) from public.profiles p left join public.fu_accounts a on a.user_id=p.id where r='ADMIN' or (a.active and (p.id=auth.uid() or exists(select 1 from public.fu_departments x where x.user_id=p.id and followup_private.scope_at(x.department_id,sd))))),'[]'::jsonb),'configuration',jsonb_build_object('unassigned_supervisors',(select count(*) from public.fu_accounts a where r='ADMIN' and a.active and a.role='SUPERVISOR' and not exists(select 1 from public.fu_departments x where x.user_id=a.user_id)),'unverified_evening_assignments',(select count(*) from public.employee_assignment_history h where h.shift_id=es and h.voided_at is null and h.evidence_kind<>'verified' and followup_private.scope_at(h.department_id,sd)),'unassigned_shift',(select count(*) from public.employees where r='ADMIN' and shift_id is null)));
elsif p_kind='employees' then
 return coalesce((select jsonb_agg(to_jsonb(t) order by display_order,name,id) from (select e.id,e.id employee_id,e.name,e.internal_code,e.employee_number,e.department_id,e.shift_id,e.employment_status,e.version,dep.arabic_name department_name,dep.display_order from public.employees e join public.departments dep on dep.id=e.department_id where e.shift_id=es and followup_private.scope_at(e.department_id,sd) and (d is null or e.department_id=d) and (eid is null or e.id=eid) and (nullif(btrim(p_filters->>'query'),'') is null or e.name ilike '%'||(p_filters->>'query')||'%' or e.internal_code ilike '%'||(p_filters->>'query')||'%' or e.employee_number ilike '%'||(p_filters->>'query')||'%' or ((followup_private.capability('profile_edit') or followup_private.capability('documents_sensitive_read')) and (e.phone ilike '%'||(p_filters->>'query')||'%' or e.secondary_phone ilike '%'||(p_filters->>'query')||'%')) or (followup_private.capability('documents_sensitive_read') and e.reference_number ilike '%'||(p_filters->>'query')||'%')))t),'[]'::jsonb);
elsif p_kind='employee_duplicates' then
 if not followup_private.capability('roster_manage') then raise exception 'مراجعة التكرار تحتاج صلاحية الانتماء' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.name,x.id) from (select e.id,e.name,e.internal_code,e.employee_number,e.department_id,dep.arabic_name department_name,e.employment_status from public.employees e join public.departments dep on dep.id=e.department_id where followup_private.scope_at(e.department_id,sd) and lower(regexp_replace(btrim(e.name),'\s+',' ','g'))=lower(regexp_replace(btrim(p_filters->>'name'),'\s+',' ','g')) or (nullif(p_filters->>'employee_number','') is not null and e.employee_number=p_filters->>'employee_number' and followup_private.scope_at(e.department_id,sd)))x),'[]'::jsonb);
elsif p_kind='roster' then
 if d is null then raise exception 'اختر القسم';end if;
 return coalesce((select jsonb_agg(to_jsonb(t) order by name,id) from (select e.id,e.name,e.internal_code,e.employee_number,h.department_id,h.shift_id,followup_private.service_state(e.id,sd) employment_status,h.department_id effective_department,h.shift_id effective_shift,h.id assignment_id,h.evidence_kind from public.employees e join public.employee_assignment_history h on h.employee_id=e.id and h.voided_at is null and h.valid_from<=sd and (h.valid_to is null or h.valid_to>=sd) where h.department_id=d and h.shift_id=es and h.evidence_kind='verified' and followup_private.service_state(e.id,sd) in ('active','long_leave') and followup_private.scope_at(h.department_id,sd))t),'[]'::jsonb);
elsif p_kind='position' then
 return coalesce((select jsonb_agg(to_jsonb(t) order by display_order,name,employee_id,work_date) from (
 with people as (select e.* from public.employees e where (eid is null or e.id=eid) and (exists(select 1 from public.employee_assignment_history h where h.employee_id=e.id and h.shift_id=es and h.voided_at is null and h.valid_from<=ed and (h.valid_to is null or h.valid_to>=sd) and followup_private.scope_at(h.department_id,greatest(sd,h.valid_from)) and (d is null or h.department_id=d)) or exists(select 1 from public.fu_entries en join public.fu_reports rp on rp.id=en.report_id where en.employee_id=e.id and rp.shift_id=es and rp.work_date between sd and ed and followup_private.scope_at(rp.department_id,rp.work_date) and (d is null or rp.department_id=d))))
 select e.id employee_id,case when fin.report_id is not null then coalesce(en.employee_name,e.name) else e.name end name,case when fin.report_id is not null then coalesce(en.permanent_code,e.internal_code) else e.internal_code end internal_code,day::date work_date,coalesce(h.department_id,rp.department_id,perioddep.department_id) department_id,dep.arabic_name department_name,dep.display_order,es shift_id,coalesce(fin.status,'unresolved') status,case when fin.report_id is null then 'unresolved' else coalesce(en.status_category,st.category,'unresolved') end category,case when fin.report_id is null then 0 else coalesce(en.status_weight,st.weight,0) end absence_weight,case when fin.report_id is null then 'لم يُبلّغ / غير محدد' else coalesce(en.status_label,st.label,'لم يُبلّغ / غير محدد') end status_label,coalesce(rp.state,'missing') review_state,rp.id report_id,rp.version report_version,rp.reported_at,rp.submitted_at,rp.reviewed_at,
 case when rp.id is not null and fin.report_id is not null and (h.id is null or h.department_id<>rp.department_id or h.shift_id<>es) then 'conflict' when day::date>followup_private.today() then 'future' when fin.report_id is not null then case when fin.status='unresolved' then 'unresolved' else 'reported' end when h.id is null or h.shift_id is distinct from es or followup_private.service_state(e.id,day::date) not in ('active','long_leave') then 'outside_roster' when h.evidence_kind<>'verified' then 'assignment_unverified' when rp.id is null then 'missing_report' else 'unresolved' end scope_state,
 case when fin.report_id is not null then 'department_declaration' when h.evidence_kind='verified' then 'verified_roster' else 'unverified_assignment' end source,
 (h.id is not null and h.shift_id=es and h.evidence_kind='verified' and followup_private.service_state(e.id,day::date) in ('active','long_leave') and day::date<=followup_private.today()) expected,
 case when rp.id is null then 'missing' when h.id is null or h.department_id<>rp.department_id or h.shift_id is distinct from es then 'exception' when exists(select 1 from public.fu_entries x where x.report_id=rp.id and x.status='unresolved') then 'partial' else 'complete' end completeness,
 case when fin.report_id is null then en.status else null end draft_status
 from people e cross join generate_series(sd,ed,'1 day'::interval)day
 left join lateral(select a.* from public.employee_assignment_history a where a.employee_id=e.id and a.voided_at is null and a.valid_from<=day::date and (a.valid_to is null or a.valid_to>=day::date) order by a.valid_from desc limit 1)h on true
 left join lateral(select a.department_id from public.employee_assignment_history a where a.employee_id=e.id and a.voided_at is null and a.shift_id=es and a.valid_from<=ed and (a.valid_to is null or a.valid_to>=sd) and (d is null or a.department_id=d) and followup_private.scope_at(a.department_id,greatest(sd,a.valid_from)) order by a.valid_from desc limit 1)perioddep on true
 left join public.fu_final fin on fin.employee_id=e.id and fin.work_date=day::date and fin.shift_key=es
 left join lateral(select a.* from public.fu_reports a where a.shift_id=es and a.work_date=day::date and (a.id=fin.report_id or (fin.report_id is null and a.department_id=h.department_id)) and followup_private.scope_at(a.department_id,a.work_date) order by (a.id=fin.report_id) desc nulls last,a.updated_at desc limit 1)rp on true
 left join public.fu_entries en on en.report_id=rp.id and en.employee_id=e.id
 left join public.fu_statuses st on st.code=fin.status
 join public.departments dep on dep.id=coalesce(h.department_id,rp.department_id,perioddep.department_id)
 where followup_private.scope_at(dep.id,day::date) and (d is null or dep.id=d)
 )t),'[]'::jsonb);
elsif p_kind='reports' then
 return coalesce((select jsonb_agg(followup_private.report_scope(t.id,eid) order by dep.display_order,t.work_date desc,t.updated_at desc) from public.fu_reports t join public.departments dep on dep.id=t.department_id where t.shift_id=es and followup_private.scope_at(t.department_id,t.work_date) and (did is null or t.id=did) and t.work_date between sd and ed and (d is null or t.department_id=d) and (eid is null or exists(select 1 from public.fu_entries e where e.report_id=t.id and e.employee_id=eid))),'[]'::jsonb);
elsif p_kind='actions' then
 return coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('activity',coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object('actor_name',(select name from public.profiles where id=x.actor)) order by at,id) from public.fu_activity x where x.action_id=t.id),'[]'::jsonb),'comments',coalesce((select jsonb_agg((to_jsonb(x)-'document_id')||jsonb_build_object('actor_name',(select name from public.profiles where id=x.actor),'document_id',case when exists(select 1 from public.fu_documents linked_doc where linked_doc.id=x.document_id and linked_doc.state='active' and followup_private.document_access(linked_doc,false)) then x.document_id else null end,'document_title',(select linked_doc.title from public.fu_documents linked_doc where linked_doc.id=x.document_id and linked_doc.state='active' and followup_private.document_access(linked_doc,false))) order by created_at,id) from public.fu_action_comments x where x.action_id=t.id),'[]'::jsonb)) order by t.due_date,t.id) from public.fu_actions t where followup_private.scope_at(t.department_id,sd) and (d is null or t.department_id=d) and (eid is null or t.employee_id=eid) and (nullif(p_filters->>'state','') is null or t.state=p_filters->>'state')),'[]'::jsonb);
elsif p_kind='revisions' then
 return coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('actor_name',(select name from public.profiles where id=t.actor)) order by t.version desc) from public.fu_revisions t join public.fu_reports a on a.id=t.report_id where a.id=did and a.shift_id=es and followup_private.scope_at(a.department_id,a.work_date)),'[]'::jsonb);
elsif p_kind='reporters' then
 return coalesce((select jsonb_agg(to_jsonb(t) order by dep.display_order,t.name,t.id) from public.fu_reporters t join public.departments dep on dep.id=t.department_id where followup_private.scope_at(t.department_id,sd) and (d is null or t.department_id=d)),'[]'::jsonb);
elsif p_kind='communications' then
 return coalesce((select jsonb_agg(to_jsonb(t) order by t.occurred_at desc,t.id) from public.fu_communications t where followup_private.scope_at(t.department_id,t.work_date) and t.work_date between sd and ed and (d is null or t.department_id=d)),'[]'::jsonb);
elsif p_kind='handovers' then
 return coalesce((select jsonb_agg(to_jsonb(t) order by t.work_date desc,t.updated_at desc,t.id) from public.fu_handovers t where ((t.department_id is null and r in ('ADMIN','FOLLOWUP')) or followup_private.scope_at(t.department_id,t.work_date)) and t.work_date between sd and ed and (d is null or t.department_id=d)),'[]'::jsonb);
elsif p_kind='profile' then
 if eid is null or not followup_private.employee_scope(eid) then raise exception 'الموظف خارج صلاحيتك' using errcode='42501';end if;
 select * into emp from public.employees where id=eid;
 result:=followup_private.redact_profile(to_jsonb(emp));
 return jsonb_build_object('employee',result||jsonb_build_object('department_name',(select arabic_name from public.departments where id=emp.department_id)),'assignments',coalesce((select jsonb_agg(to_jsonb(h) order by h.valid_from desc) from public.employee_assignment_history h where h.employee_id=eid and followup_private.scope_at(h.department_id,h.valid_from)),'[]'::jsonb),'history',coalesce((select jsonb_agg((to_jsonb(x)-'old_value'-'new_value')||jsonb_build_object('actor_name',(select name from public.profiles where id=x.actor),'old_value',followup_private.redact_profile(x.old_value),'new_value',followup_private.redact_profile(x.new_value)) order by x.at desc,x.id) from public.fu_business_events x where x.employee_id=eid and (x.kind not like 'document%' or exists(select 1 from public.fu_documents private_doc where private_doc.id=x.entity_id and followup_private.document_access(private_doc,false)))),'[]'::jsonb),'documents',public.followup_read('documents',jsonb_build_object('employee_id',eid)));
elsif p_kind='documents' then
 if eid is null or not followup_private.employee_scope(eid) then raise exception 'الموظف خارج صلاحيتك' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object('name',x.file_name,'type',x.kind,'mime',x.mime_type,'size',x.byte_size) order by x.created_at desc) from public.fu_documents x where x.employee_id=eid and x.state in ('active','archived') and followup_private.document_access(x,false)),'[]'::jsonb);
elsif p_kind='pending_documents' then
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.fu_documents x where (x.state='pending' or (coalesce(p_filters->>'include_abandoned','false')='true' and x.state='abandoned')) and x.uploaded_by=auth.uid() and followup_private.document_access(x,true) and (eid is null or x.employee_id=eid)),'[]'::jsonb);
elsif p_kind='expiring_documents' then
 return coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object('name',x.file_name,'type',x.kind,'mime',x.mime_type,'size',x.byte_size,'employee_name',(select name from public.employees where id=x.employee_id)) order by x.expires_on,x.id) from public.fu_documents x where x.state='active' and x.expires_on is not null and x.expires_on<=ed and (coalesce(p_filters->>'include_expired','false')='true' or x.expires_on>=sd) and followup_private.document_access(x,false) and (eid is null or x.employee_id=eid) and (d is null or exists(select 1 from public.employees e where e.id=x.employee_id and e.department_id=d))),'[]'::jsonb);
elsif p_kind='document' then
 select * into doc from public.fu_documents where id=did;
 if doc.id is null or (case when doc.state in ('pending','abandoned') then doc.uploaded_by is distinct from auth.uid() or not followup_private.document_access(doc,true) else not followup_private.document_access(doc,false) end) then raise exception 'المستند خارج صلاحيتك' using errcode='42501';end if;
 return to_jsonb(doc)||jsonb_build_object('name',doc.file_name,'type',doc.kind,'mime',doc.mime_type,'size',doc.byte_size);
elsif p_kind='saved_views' then
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.name,x.id) from public.fu_saved_views x where x.user_id=auth.uid() and (x.department_id is null or followup_private.scope_at(x.department_id,coalesce(x.start_date,sd))) and (x.employee_id is null or followup_private.employee_scope(x.employee_id))),'[]'::jsonb);
elsif p_kind='capabilities' then
 if r<>'ADMIN' then raise exception 'عرض صلاحيات الحسابات للمدير' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.user_id,x.capability) from public.fu_capabilities x where nullif(p_filters->>'user_id','') is null or x.user_id=(p_filters->>'user_id')::uuid),'[]'::jsonb);
elsif p_kind='search' then
 if length(btrim(coalesce(p_filters->>'query',''))) < 2 then return jsonb_build_object('employees','[]'::jsonb,'reports','[]'::jsonb,'actions','[]'::jsonb);end if;
 return jsonb_build_object('employees',coalesce((select jsonb_agg(to_jsonb(x)) from (select e.id,e.name,e.internal_code,e.department_id,dep.arabic_name department_name,e.employment_status,e.version from public.employees e join public.departments dep on dep.id=e.department_id where e.shift_id=es and followup_private.scope_at(e.department_id,sd) and (e.name ilike '%'||(p_filters->>'query')||'%' or e.internal_code ilike '%'||(p_filters->>'query')||'%' or e.employee_number ilike '%'||(p_filters->>'query')||'%' or ((followup_private.capability('profile_edit') or followup_private.capability('documents_sensitive_read')) and (e.phone ilike '%'||(p_filters->>'query')||'%' or e.secondary_phone ilike '%'||(p_filters->>'query')||'%')) or (followup_private.capability('documents_sensitive_read') and e.reference_number ilike '%'||(p_filters->>'query')||'%')) order by dep.display_order,e.name,e.id limit 20)x),'[]'::jsonb),'reports',coalesce((select jsonb_agg(followup_private.snapshot(x.id)) from (select t.id from public.fu_reports t where t.shift_id=es and followup_private.scope_at(t.department_id,t.work_date) and t.id::text ilike '%'||(p_filters->>'query')||'%' order by t.work_date desc,t.id limit 20)x),'[]'::jsonb),'actions',coalesce((select jsonb_agg(to_jsonb(x)) from (select t.* from public.fu_actions t where followup_private.scope_at(t.department_id,sd) and (t.description ilike '%'||(p_filters->>'query')||'%' or t.id::text ilike '%'||(p_filters->>'query')||'%') order by t.due_date,t.id limit 20)x),'[]'::jsonb));
elsif p_kind='reporting_model' then
 return jsonb_build_object('scope','evening','scope_employee_id',eid,'generated_at',now(),'positions',public.followup_read('position',p_filters),'reports',public.followup_read('reports',p_filters),'actions',public.followup_read('actions',p_filters),'communications',case when eid is null then public.followup_read('communications',p_filters) else '[]'::jsonb end,'handovers','[]'::jsonb,'employees',case when eid is null then public.followup_read('employees',p_filters) else jsonb_build_array((select jsonb_build_object('id',e.id,'employee_id',e.id,'name',coalesce((select max(x->>'name') from jsonb_array_elements(public.followup_read('position',p_filters))x),e.name),'internal_code',e.internal_code,'period_departments',coalesce((select jsonb_agg(distinct x->>'department_name') from jsonb_array_elements(public.followup_read('position',p_filters))x),'[]'::jsonb)) from public.employees e where e.id=eid)) end,'departments',public.followup_read('bootstrap',p_filters-'employee_id')->'departments','statuses',(select jsonb_agg(to_jsonb(x) order by code) from public.fu_statuses x),'completeness',public.followup_read('completeness',p_filters));
elsif p_kind='completeness' then
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.work_date,x.display_order) from (
 select dep.id department_id,dep.arabic_name department_name,dep.display_order,day::date work_date,(count(h.id)filter(where h.evidence_kind='verified')>0 or rp.id is not null) expected,rp.id is not null reported,coalesce(rp.state in ('submitted','reviewed'),false) submitted,coalesce(rp.state='reviewed',false) reviewed,(select count(*) from public.fu_entries e where e.report_id=rp.id and e.status='unresolved') unresolved,count(h.id)filter(where h.evidence_kind='verified') roster_count,count(h.id)filter(where h.evidence_kind<>'verified') unverified_assignments,case when count(h.id)filter(where h.evidence_kind<>'verified')>0 then 1 else 0 end exceptions,coalesce(rp.state,case when count(h.id)filter(where h.evidence_kind='verified')>0 then 'missing' else 'not_configured' end) state
 from public.departments dep cross join generate_series(sd,ed,'1 day'::interval)day
 left join public.employee_assignment_history h on h.department_id=dep.id and h.shift_id=es and h.voided_at is null and h.valid_from<=day::date and (h.valid_to is null or h.valid_to>=day::date) and followup_private.service_state(h.employee_id,day::date) in ('active','long_leave')
 left join public.fu_reports rp on rp.department_id=dep.id and rp.shift_id=es and rp.work_date=day::date
 where dep.is_active and followup_private.scope_at(dep.id,day::date) and (d is null or dep.id=d) and (eid is null or exists(select 1 from public.fu_entries en where en.report_id=rp.id and en.employee_id=eid))
 group by dep.id,dep.arabic_name,dep.display_order,day,rp.id,rp.state
 )x),'[]'::jsonb);
elsif p_kind='archive' then
 if not followup_private.capability('archive_read') then raise exception 'الأرشيف يحتاج صلاحية مستقلة' using errcode='42501';end if;
 return jsonb_build_object('provenance','historical biometric source; not supervisor declarations','imports',coalesce((select jsonb_agg(to_jsonb(t)) from public.attendance_imports t),'[]'::jsonb),'rows',coalesce((select jsonb_agg(to_jsonb(t)) from public.fingerprint_source_rows t where t.import_id=(p_filters->>'import_id')::uuid),'[]'::jsonb));
end if;
raise exception 'طلب غير متاح' using errcode='42501';end$$;

create or replace function followup_private.write_before_roster_setup(p_kind text,p_data jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
<<gateway>>
declare r text:=followup_private.account_role();u uuid:=auth.uid();es uuid:=followup_private.evening_shift();d uuid:=nullif(p_data->>'department_id','')::uuid;eid uuid:=nullif(p_data->>'employee_id','')::uuid;rid uuid:=nullif(p_data->>'id','')::uuid;uid uuid;reason text:=btrim(coalesce(p_data->>'reason',''));result jsonb;oldpayload jsonb;oldval jsonb;newval jsonb;emp public.employees;doc public.fu_documents;h public.employee_assignment_history;sd date:=coalesce(nullif(p_data->>'work_date','')::date,followup_private.today());oldshift uuid;cap text;kind text;is_new boolean:=rid is null;
begin
if p_request_id is null then raise exception 'معرّف الطلب مطلوب' using errcode='22023';end if;
if r='VIEWER' and p_kind<>'saved_view' then raise exception 'صلاحية قراءة فقط' using errcode='42501';end if;
if nullif(p_data->>'shift_id','') is not null and (p_data->>'shift_id')::uuid<>es then raise exception 'العمليات مسائية فقط' using errcode='22023';end if;
if p_kind in ('save','submit','return','review','revise','reconcile') then
 if not followup_private.scope_at(d,sd) then raise exception 'القسم خارج صلاحيتك' using errcode='42501';end if;
 if sd>followup_private.today() then raise exception 'لا يجوز تقديم تبليغ لتاريخ خدمة لم يبدأ' using errcode='22023';end if;
 if p_kind in ('save','submit') and rid is null and p_data->>'channel'='account' and nullif(p_data->>'reporter_id','')::uuid is distinct from u then raise exception 'تبليغ الحساب يجب أن يصدر من صاحب الحساب؛ استخدم السجل والقناة الفعلية للتبليغ نيابةً عن شخص' using errcode='42501';end if;
 p_data:=p_data||jsonb_build_object('shift_id',es);
 if nullif(p_data->>'reporter_registry_id','') is not null then p_data:=p_data||jsonb_build_object('reporter_id',null);end if;
elsif p_kind in ('profile','employee_add','assignment','document','document_activate','document_archive','document_abandon') then
 if p_kind='employee_add' then
  if not followup_private.capability('roster_manage') or d is null or not followup_private.scope_at(d,sd) then raise exception 'إضافة موظف تحتاج صلاحية مستقلة' using errcode='42501';end if;
 elsif p_kind in ('document_activate','document_archive','document_abandon') then
  select * into doc from public.fu_documents where id=rid;
  if doc.id is null or not followup_private.document_access(doc,true) then raise exception 'المستند خارج صلاحيتك' using errcode='42501';end if;eid:=doc.employee_id;
 else
  if eid is null or not followup_private.employee_scope(eid) then raise exception 'الموظف خارج صلاحيتك' using errcode='42501';end if;
 end if;
 if p_kind='profile' and not followup_private.capability('profile_edit') then raise exception 'تعديل الملف يحتاج صلاحية مستقلة' using errcode='42501';end if;
 if p_kind='assignment' and (not followup_private.capability('roster_manage') or d is null or not followup_private.scope_at(d,coalesce(nullif(p_data->>'valid_from','')::date,sd))) then raise exception 'الانتماء يحتاج صلاحية مستقلة' using errcode='42501';end if;
 if p_kind='document' and not followup_private.capability(case when p_data->>'kind'='identity' then 'documents_sensitive_write' else 'documents_write' end) then raise exception 'إضافة المستند تحتاج صلاحية مستقلة' using errcode='42501';end if;
elsif p_kind in ('account','policy','department','department_order','capability') then
 if r<>'ADMIN' then raise exception 'إدارة الإعدادات للمدير' using errcode='42501';end if;
elsif p_kind='saved_view' then
 if d is not null and not followup_private.scope_at(d,sd) then raise exception 'القسم خارج صلاحيتك' using errcode='42501';end if;
 if eid is not null and not followup_private.employee_scope(eid) then raise exception 'الموظف خارج صلاحيتك' using errcode='42501';end if;
elsif p_kind='handover' then
 if r not in ('ADMIN','FOLLOWUP') or (d is not null and not followup_private.scope_at(d,sd)) then raise exception 'التسليم خارج صلاحيتك' using errcode='42501';end if;
elsif p_kind in ('reporter','communication','action','action_comment') then
 if d is null or not followup_private.scope_at(d,sd) then raise exception 'القسم خارج صلاحيتك' using errcode='42501';end if;
 if p_kind in ('reporter','communication') and r not in ('ADMIN','FOLLOWUP') then raise exception 'التوثيق لقسم المتابعة' using errcode='42501';end if;
 if p_kind='action_comment' and r='SUPERVISOR' and not exists(select 1 from public.fu_actions where id=(p_data->>'action_id')::uuid and department_id=d and responsible_id=u) then raise exception 'الإجراء خارج صلاحيتك' using errcode='42501';end if;
else raise exception 'طلب غير متاح' using errcode='42501';end if;
-- Current authorization is checked before durable retry, then the payload is bound.
perform pg_advisory_xact_lock(hashtextextended(u::text||p_request_id::text,0));
select q.result,q.payload into result,oldpayload from public.fu_requests q where q.user_id=u and q.request_id=p_request_id;
if result is not null then if oldpayload<>jsonb_build_object('kind',p_kind,'data',p_data) then raise exception 'معرّف إعادة المحاولة مستخدم لطلب آخر';end if;return result;end if;
if p_kind in ('save','submit','return','review','revise','reconcile','action','account','policy','department') then
 if p_kind='account' then
  if p_data->>'role' not in ('ADMIN','FOLLOWUP','SUPERVISOR','VIEWER') or not(p_data ? 'role') then raise exception 'اختر الدور صراحةً' using errcode='22023';end if;
  if p_data->>'role'='SUPERVISOR' and jsonb_array_length(coalesce(p_data->'departments','[]'::jsonb))=0 then raise exception 'المشرف يحتاج قسماً محدداً' using errcode='22023';end if;
 end if;
 if p_kind='action' then
  if eid is not null and not exists(select 1 from public.employees e where e.id=eid and e.department_id=d and followup_private.employee_scope(e.id)) then raise exception 'الموظف خارج قائمة القسم المسائية' using errcode='42501';end if;
  if r='SUPERVISOR' and exists(select 1 from public.fu_actions a where a.id=rid and ((p_data ? 'category' and a.category is distinct from p_data->>'category') or (p_data ? 'priority' and a.priority is distinct from p_data->>'priority'))) then raise exception 'المشرف يحدّث حالته وملاحظاته فقط' using errcode='42501';end if;
 end if;
 if rid is not null then
  if p_kind='action' then select to_jsonb(a) into oldval from public.fu_actions a where a.id=rid;else select followup_private.snapshot(rid) into oldval;end if;
 end if;
 if p_kind='account' then select to_jsonb(a)||jsonb_build_object('departments',coalesce((select jsonb_agg(to_jsonb(x)) from public.fu_departments x where x.user_id=a.user_id),'[]'::jsonb)) into oldval from public.fu_accounts a where a.user_id=(p_data->>'user_id')::uuid;end if;
 if p_kind='policy' then select to_jsonb(s) into oldval from public.fu_statuses s where s.code=p_data->>'code';end if;
 result:=followup_private.write_core(p_kind,p_data,p_request_id);
 if p_kind='action' then
  rid:=(result->>'id')::uuid;
  update public.fu_actions set category=coalesce(p_data->>'category',category),priority=coalesce(p_data->>'priority',priority) where id=rid;
  if btrim(coalesce(p_data->>'comment',''))<>'' then insert into public.fu_action_comments(action_id,body,document_id,actor) values(rid,p_data->>'comment',nullif(p_data->>'attachment_document_id','')::uuid,u);end if;
  select to_jsonb(a) into result from public.fu_actions a where a.id=rid;
 elsif p_kind in ('save','submit','return','review','revise','reconcile') then
  rid:=(result->>'id')::uuid;
  if p_kind='review' then update public.fu_reports set reviewed_unresolved_count=(select count(*) from public.fu_entries where report_id=rid and status='unresolved'),review_scope=case when exists(select 1 from public.fu_entries where report_id=rid and status='unresolved') then 'partial' else 'full' end where id=rid;result:=followup_private.snapshot(rid);end if;
 end if;
 if p_kind='account' then select to_jsonb(a)||jsonb_build_object('departments',coalesce((select jsonb_agg(to_jsonb(x)) from public.fu_departments x where x.user_id=a.user_id),'[]'::jsonb)) into newval from public.fu_accounts a where a.user_id=(p_data->>'user_id')::uuid;else if p_kind='policy' then select to_jsonb(s) into newval from public.fu_statuses s where s.code=p_data->>'code';else newval:=result;end if;end if;
 insert into public.fu_business_events(actor,kind,entity_id,department_id,employee_id,old_value,new_value,reason) values(u,p_kind,rid,d,eid,oldval,newval,nullif(reason,''));
 update public.fu_requests set result=gateway.result where user_id=u and request_id=p_request_id;
 return result;
elsif p_kind='capability' then
 uid:=(p_data->>'user_id')::uuid;cap:=p_data->>'capability';if reason='' then raise exception 'سبب الصلاحية مطلوب';end if;
 select to_jsonb(x) into oldval from public.fu_capabilities x where user_id=uid and capability=cap for update;
 if oldval is null and coalesce((p_data->>'version')::int,0)<>0 then raise exception 'Capability insert requires version zero' using errcode='PT409';end if;
 insert into public.fu_capabilities(user_id,capability,granted,granted_by,reason) values(uid,cap,(p_data->>'granted')::boolean,u,reason) on conflict(user_id,capability) do update set granted=excluded.granted,granted_by=u,reason=excluded.reason,version=public.fu_capabilities.version+1,updated_at=now() where public.fu_capabilities.version=(p_data->>'version')::int;
 if not found then raise exception 'تغيرت الصلاحية' using errcode='PT409';end if;
 select to_jsonb(x) into result from public.fu_capabilities x where user_id=uid and capability=cap;
elsif p_kind='department_order' then
 if reason='' or nullif(p_data->>'display_order','') is null or (p_data->>'display_order')::int not between 0 and 10000 then raise exception 'Department order and change reason are required' using errcode='22023';end if;
 select to_jsonb(dep) into oldval from public.departments dep where dep.id=rid for update;
 if oldval is null or (oldval->>'version')::int is distinct from (p_data->>'version')::int then raise exception 'Department version changed' using errcode='PT409';end if;
 update public.departments set display_order=(p_data->>'display_order')::int,version=version+1 where id=rid returning to_jsonb(public.departments.*) into result;
elsif p_kind='profile' then
 select * into emp from public.employees where id=eid for update;
 if emp.version is distinct from (p_data->>'version')::int then raise exception 'تغير ملف الموظف' using errcode='PT409';end if;
 if reason='' then raise exception 'سبب تعديل الملف مطلوب';end if;oldval:=to_jsonb(emp);d:=emp.department_id;
 if p_data ? 'reference_number' and not followup_private.capability('documents_sensitive_write') then raise exception 'المرجع الخاص يحتاج صلاحية مستقلة' using errcode='42501';end if;
 if nullif(p_data->>'photo_document_id','') is not null and not exists(select 1 from public.fu_documents x where x.id=(p_data->>'photo_document_id')::uuid and x.employee_id=eid and x.kind='photo' and x.state='active' and followup_private.document_access(x,false)) then raise exception 'الصورة ليست مستنداً صالحاً للموظف';end if;
 update public.employees set phone=case when p_data ? 'phone' then nullif(btrim(p_data->>'phone'),'') else phone end,secondary_phone=case when p_data ? 'secondary_phone' then nullif(btrim(p_data->>'secondary_phone'),'') else secondary_phone end,emergency_name=case when p_data ? 'emergency_name' then nullif(btrim(p_data->>'emergency_name'),'') else emergency_name end,emergency_phone=case when p_data ? 'emergency_phone' then nullif(btrim(p_data->>'emergency_phone'),'') else emergency_phone end,emergency_relation=case when p_data ? 'emergency_relation' then nullif(btrim(p_data->>'emergency_relation'),'') else emergency_relation end,education=case when p_data ? 'education' then nullif(btrim(p_data->>'education'),'') else education end,specialization=case when p_data ? 'specialization' then nullif(btrim(p_data->>'specialization'),'') else specialization end,institution=case when p_data ? 'institution' then nullif(btrim(p_data->>'institution'),'') else institution end,graduation_year=case when p_data ? 'graduation_year' then nullif(p_data->>'graduation_year','')::int else graduation_year end,group_name=case when p_data ? 'group_name' then nullif(btrim(p_data->>'group_name'),'') else group_name end,reference_number=case when p_data ? 'reference_number' then nullif(btrim(p_data->>'reference_number'),'') else reference_number end,photo_document_id=case when p_data ? 'photo_document_id' then nullif(p_data->>'photo_document_id','')::uuid else photo_document_id end where id=eid returning to_jsonb(public.employees.*) into result;
elsif p_kind='employee_add' then
 if reason='' then raise exception 'سبب إضافة الموظف مطلوب';end if;
 if nullif(p_data->>'work_date','') is null then raise exception 'تاريخ نفاذ انتماء الموظف مطلوب';end if;
 perform pg_advisory_xact_lock(hashtextextended(lower(regexp_replace(btrim(p_data->>'name'),'\s+',' ','g')),2));
 if exists(select 1 from public.employees where lower(regexp_replace(btrim(name),'\s+',' ','g'))=lower(regexp_replace(btrim(p_data->>'name'),'\s+',' ','g'))) and btrim(coalesce(p_data->>'duplicate_override_reason',''))='' then raise exception 'يوجد موظف بنفس الاسم؛ راجع التكرار وسجل سبب المتابعة' using errcode='23505';end if;
 insert into public.employees(name,employee_number,department_id,shift_id,employment_status,created_by,updated_by) values(p_data->>'name',nullif(p_data->>'employee_number',''),d,es,'active',u,u) returning * into emp;eid:=emp.id;
 -- Existing allocator remains authoritative; verification uses the explicitly selected effective date.
 update public.employee_assignment_history set voided_at=now() where employee_id=eid and evidence_kind='observed' and voided_at is null;
 insert into public.employee_assignment_history(employee_id,department_id,shift_id,direct_manager_id,employment_status,valid_from,evidence_kind,reason,created_by) values(eid,d,es,emp.direct_manager_id,emp.employment_status,sd,'verified',reason,u) on conflict(employee_id,valid_from) do update set evidence_kind='verified',reason=excluded.reason,created_by=u,voided_at=null;
 result:=to_jsonb(emp);
elsif p_kind='assignment' then
 if reason='' then raise exception 'سبب توثيق الانتماء مطلوب';end if;
 sd:=(p_data->>'valid_from')::date;if sd is null then raise exception 'تاريخ النفاذ مطلوب';end if;
 select * into emp from public.employees where id=eid for update;
 if emp.version is distinct from (p_data->>'version')::int then raise exception 'تغير ملف الموظف' using errcode='PT409';end if;
 perform pg_advisory_xact_lock(hashtextextended(eid::text,1));oldval:=to_jsonb(emp);
 if exists(select 1 from public.employee_assignment_history x where x.employee_id=eid and x.voided_at is null and x.valid_from>sd) then raise exception 'يوجد انتماء لاحق؛ راجع الفترة قبل التعديل' using errcode='PT409';end if;
 update public.employee_assignment_history set valid_to=sd-1 where employee_id=eid and voided_at is null and valid_from<sd and (valid_to is null or valid_to>=sd);
 insert into public.employee_assignment_history(employee_id,department_id,shift_id,direct_manager_id,employment_status,valid_from,evidence_kind,reason,created_by) values(eid,d,es,emp.direct_manager_id,coalesce(p_data->>'employment_status',emp.employment_status),sd,'verified',reason,u) on conflict(employee_id,valid_from) do update set department_id=excluded.department_id,shift_id=es,employment_status=excluded.employment_status,evidence_kind='verified',reason=excluded.reason,created_by=u,voided_at=null,valid_to=null;
 -- Current display is changed only for an explicit current/past effective operation.
 if sd<=followup_private.today() then
  update public.employees set department_id=d,shift_id=es,employment_status=coalesce(p_data->>'employment_status',employment_status) where id=eid;
  -- The legacy current-field trigger may add an observed tomorrow row. Keep the explicit verified interval authoritative.
  update public.employee_assignment_history set voided_at=now() where employee_id=eid and valid_from=followup_private.today()+1 and evidence_kind='observed' and voided_at is null;
  update public.employee_assignment_history set valid_to=null where employee_id=eid and valid_from=sd and evidence_kind='verified' and voided_at is null;
 else update public.employees set updated_by=u where id=eid;
 end if;
 select to_jsonb(x) into result from public.employee_assignment_history x where employee_id=eid and valid_from=sd;
elsif p_kind='document' then
 rid:=gen_random_uuid();select department_id into d from public.employees where id=eid;
 if nullif(p_data->>'previous_document_id','') is not null and not exists(select 1 from public.fu_documents x where x.id=(p_data->>'previous_document_id')::uuid and x.employee_id=eid and x.kind=p_data->>'kind' and x.state='active' and followup_private.document_access(x,true)) then raise exception 'المستند السابق خارج النطاق';end if;
 if p_data->>'kind'='photo' and (nullif(p_data->>'thumbnail_byte_size','') is null or nullif(p_data->>'thumbnail_sha256','') is null or nullif(p_data->>'original_sha256','') is null) then raise exception 'بيانات الصورة المصغرة والتحقق مطلوبة';end if;
 insert into public.fu_documents(id,employee_id,title,description,kind,file_name,mime_type,byte_size,object_path,previous_document_id,issued_on,expires_on,uploaded_by,thumbnail_object_path,thumbnail_byte_size,thumbnail_mime_type,original_sha256,thumbnail_sha256,crop_x,crop_y,crop_width,crop_height,upload_request_id) values(rid,eid,p_data->>'title',p_data->>'description',p_data->>'kind',p_data->>'file_name',p_data->>'mime_type',(p_data->>'byte_size')::bigint,eid::text||'/'||rid::text||'/v1',nullif(p_data->>'previous_document_id','')::uuid,nullif(p_data->>'issued_on','')::date,nullif(p_data->>'expires_on','')::date,u,case when p_data->>'kind'='photo' then eid::text||'/'||rid::text||'/thumbnail.jpg' else null end,nullif(p_data->>'thumbnail_byte_size','')::bigint,case when p_data->>'kind'='photo' then 'image/jpeg' else null end,p_data->>'original_sha256',p_data->>'thumbnail_sha256',(p_data->'photo_crop'->>'x')::numeric,(p_data->'photo_crop'->>'y')::numeric,(p_data->'photo_crop'->>'width')::numeric,(p_data->'photo_crop'->>'height')::numeric,p_request_id) returning * into doc;result:=to_jsonb(doc);
elsif p_kind in ('document_activate','document_archive','document_abandon') then
 select * into doc from public.fu_documents where id=rid for update;
 if doc.version is distinct from (p_data->>'version')::int then raise exception 'تغير المستند' using errcode='PT409';end if;oldval:=to_jsonb(doc);
 if p_kind='document_activate' then
  if doc.state<>'pending' or doc.uploaded_by<>u then raise exception 'المستند ليس رفعاً معلقاً لهذا المستخدم';end if;
  if not exists(select 1 from storage.objects o where o.bucket_id=doc.bucket and o.name=doc.object_path and (o.metadata->>'size')::bigint=doc.byte_size and coalesce(o.metadata->>'mimetype',o.metadata->>'contentType')=doc.mime_type) then raise exception 'لم يكتمل رفع الملف أو بياناته غير متطابقة';end if;
  if doc.thumbnail_object_path is not null and not exists(select 1 from storage.objects o where o.bucket_id=doc.bucket and o.name=doc.thumbnail_object_path and (o.metadata->>'size')::bigint=doc.thumbnail_byte_size and coalesce(o.metadata->>'mimetype',o.metadata->>'contentType')='image/jpeg') then raise exception 'لم يكتمل رفع الصورة المصغرة';end if;
 elsif p_kind='document_abandon' then if doc.state<>'pending' or reason='' or doc.uploaded_by<>u then raise exception 'إلغاء الرفع يحتاج رفعاً معلقاً مصرحاً وسبباً';end if;
 else if doc.state<>'active' or reason='' then raise exception 'أرشفة المستند تحتاج مستنداً فعالاً وسبباً';end if;end if;
 update public.fu_documents set state=case when p_kind='document_activate' then 'active' when p_kind='document_abandon' then 'abandoned' else 'archived' end,version=version+1,updated_at=now() where id=rid returning to_jsonb(public.fu_documents.*) into result;
 if p_kind='document_activate' and doc.previous_document_id is not null then
  perform 1 from public.fu_documents x where x.id=doc.previous_document_id and x.state='active' for update;
  if not found then raise exception 'استبدل المستند السابق بالفعل؛ راجع النسخة الحالية' using errcode='PT409';end if;
  update public.fu_documents set state='archived',version=version+1,updated_at=now() where id=doc.previous_document_id;
 end if;
elsif p_kind='reporter' then
 if rid is null then insert into public.fu_reporters(department_id,name,channel,contact,backup_contact,linked_user_id,active,created_by) values(d,p_data->>'name',p_data->>'channel',p_data->>'contact',p_data->>'backup_contact',nullif(p_data->>'linked_user_id','')::uuid,coalesce((p_data->>'active')::boolean,true),u) returning to_jsonb(public.fu_reporters.*) into result;
 else select to_jsonb(x) into oldval from public.fu_reporters x where x.id=rid and x.department_id=d for update;if oldval is null or (oldval->>'version')::int is distinct from (p_data->>'version')::int then raise exception 'تغير سجل المبلّغ' using errcode='PT409';end if;update public.fu_reporters set name=p_data->>'name',channel=p_data->>'channel',contact=p_data->>'contact',backup_contact=p_data->>'backup_contact',linked_user_id=nullif(p_data->>'linked_user_id','')::uuid,active=(p_data->>'active')::boolean,version=version+1,updated_at=now() where id=rid returning to_jsonb(public.fu_reporters.*) into result;end if;
elsif p_kind='communication' then
 if nullif(p_data->>'reporter_id','') is not null and not exists(select 1 from public.fu_reporters where id=(p_data->>'reporter_id')::uuid and department_id=d) then raise exception 'المبلّغ خارج القسم';end if;
 if rid is null then insert into public.fu_communications(department_id,reporter_id,work_date,kind,channel,summary,outcome,actor) values(d,nullif(p_data->>'reporter_id','')::uuid,sd,p_data->>'kind',p_data->>'channel',p_data->>'summary',p_data->>'outcome',u) returning to_jsonb(public.fu_communications.*) into result;
 else select to_jsonb(x) into oldval from public.fu_communications x where x.id=rid and x.department_id=d for update;if oldval is null or (oldval->>'version')::int is distinct from (p_data->>'version')::int then raise exception 'تغير سجل الاتصال' using errcode='PT409';end if;update public.fu_communications set summary=p_data->>'summary',outcome=p_data->>'outcome',version=version+1 where id=rid returning to_jsonb(public.fu_communications.*) into result;end if;
elsif p_kind='handover' then
 uid:=(p_data->>'owner_id')::uuid;
 if not exists(select 1 from public.fu_accounts a join public.profiles p on p.id=a.user_id where a.user_id=uid and a.active and p.is_active and a.role in ('ADMIN','FOLLOWUP','SUPERVISOR') and ((d is null and a.role in ('ADMIN','FOLLOWUP')) or followup_private.user_scope_at(uid,d,sd))) then raise exception 'مسؤول التسليم خارج النطاق';end if;
 if rid is null then insert into public.fu_handovers(work_date,department_id,owner_id,completed,remaining,next_action,state,created_by) values(sd,d,uid,coalesce(p_data->>'completed',''),coalesce(p_data->>'remaining',''),p_data->>'next_action',coalesce(p_data->>'state','open'),u) returning to_jsonb(public.fu_handovers.*) into result;
 else select to_jsonb(x) into oldval from public.fu_handovers x where x.id=rid and x.department_id is not distinct from d for update;if oldval is null or (oldval->>'version')::int is distinct from (p_data->>'version')::int then raise exception 'تغير التسليم' using errcode='PT409';end if;update public.fu_handovers set owner_id=uid,completed=coalesce(p_data->>'completed',''),remaining=coalesce(p_data->>'remaining',''),next_action=p_data->>'next_action',state=p_data->>'state',version=version+1,updated_at=now() where id=rid returning to_jsonb(public.fu_handovers.*) into result;end if;
elsif p_kind='action_comment' then
 rid:=(p_data->>'action_id')::uuid;
 if not exists(select 1 from public.fu_actions a where a.id=rid and a.department_id=d) then raise exception 'الإجراء خارج القسم';end if;
 if nullif(p_data->>'document_id','') is not null and not exists(select 1 from public.fu_documents attachment join public.fu_actions a on a.employee_id=attachment.employee_id where a.id=rid and attachment.id=(p_data->>'document_id')::uuid and attachment.state='active' and followup_private.document_access(attachment,false)) then raise exception 'مرفق الإجراء خارج النطاق';end if;
 insert into public.fu_action_comments(action_id,body,document_id,actor) values(rid,p_data->>'body',nullif(p_data->>'document_id','')::uuid,u) returning to_jsonb(public.fu_action_comments.*) into result;
elsif p_kind='saved_view' then
 if rid is null then insert into public.fu_saved_views(user_id,name,page,start_date,end_date,department_id,employee_id,state) values(u,p_data->>'name',p_data->>'page',nullif(p_data->>'start','')::date,nullif(p_data->>'end','')::date,d,eid,p_data->>'state') returning to_jsonb(public.fu_saved_views.*) into result;
 else
  select to_jsonb(x) into oldval from public.fu_saved_views x where x.id=rid and x.user_id=u for update;
  if oldval is null or (oldval->>'version')::int is distinct from (p_data->>'version')::int then raise exception 'Saved view version changed' using errcode='PT409';end if;
  if coalesce((p_data->>'remove')::boolean,false) then
   delete from public.fu_saved_views where id=rid and user_id=u;result:=jsonb_build_object('id',rid,'removed',true);
  else
   update public.fu_saved_views set name=p_data->>'name',page=p_data->>'page',start_date=nullif(p_data->>'start','')::date,end_date=nullif(p_data->>'end','')::date,department_id=d,employee_id=eid,state=p_data->>'state',version=version+1 where id=rid returning to_jsonb(public.fu_saved_views.*) into result;
  end if;
 end if;
end if;
rid:=coalesce(nullif(result->>'id','')::uuid,rid);
insert into public.fu_business_events(actor,kind,entity_id,department_id,employee_id,old_value,new_value,reason) values(u,p_kind,rid,d,eid,oldval,result,nullif(reason,''));
if p_kind='profile' and not followup_private.capability('documents_sensitive_read') then result:=result-'reference_number';end if;
insert into public.fu_requests values(u,p_request_id,result,jsonb_build_object('kind',p_kind,'data',p_data));return result;
end$$;

create or replace function followup_private.write_before_staff_repairs(p_kind text,p_data jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r text:=followup_private.account_role();u uuid:=auth.uid();d uuid:=nullif(p_data->>'department_id','')::uuid;sd date:=nullif(p_data->>'valid_from','')::date;reason text:=btrim(coalesce(p_data->>'reason',''));preview public.fu_roster_setup_previews;payload jsonb;fresh jsonb;item jsonb;h public.employee_assignment_history;result jsonb;oldpayload jsonb;decision uuid;after_rows jsonb:='[]'::jsonb;before_rows jsonb:='[]'::jsonb;visible_rows jsonb;target uuid;old_scopes jsonb;old_scope jsonb;event_id bigint;activate boolean:=false;
begin
 if nullif(p_data->>'shift_id','') is not null and (p_data->>'shift_id')::uuid<>followup_private.evening_shift() then raise exception 'Operational shift must be evening' using errcode='22023';end if;
 if p_request_id is null then raise exception 'Request identity required' using errcode='22023';end if;
 if p_kind='assignment' and (sd is null or sd<followup_private.today()) then raise exception 'Assignment changes require an explicit current or future date' using errcode='22023';end if;
 if p_kind='employee_add' and coalesce(nullif(p_data->>'work_date','')::date,followup_private.today())<followup_private.today() then raise exception 'Employee addition cannot backdate membership' using errcode='22023';end if;
 if p_kind not in ('roster_setup_preview','roster_setup_commit') then
  if p_kind='account' then
   if r<>'ADMIN' then raise exception 'Account administration denied' using errcode='42501';end if;
   target:=(p_data->>'user_id')::uuid;
   perform user_id from public.fu_accounts where user_id=target for update;
   select coalesce(jsonb_agg(to_jsonb(f)),'[]'::jsonb) into old_scopes from public.fu_departments f where user_id=target;
   if exists(select 1 from public.fu_requests where user_id=u and request_id=p_request_id) then return followup_private.write_before_roster_setup(p_kind,p_data,p_request_id);end if;
   if p_data ? 'activate_departments_today' and jsonb_typeof(p_data->'activate_departments_today') is distinct from 'boolean' then raise exception 'اختيار تفعيل الأقسام يجب أن يكون قراراً صريحاً' using errcode='22023';end if;
   activate:=coalesce((p_data->>'activate_departments_today')::boolean,false);
   if activate then
    if length(reason) not between 1 and 2000 or jsonb_array_length(old_scopes)=0 or jsonb_typeof(p_data->'departments') is distinct from 'array' or not exists(select 1 from public.fu_accounts a join public.profiles p on p.id=a.user_id where a.user_id=target and a.role='SUPERVISOR' and a.active and p.is_active) or exists(select 1 from public.fu_departments f join public.departments dep on dep.id=f.department_id where f.user_id=target and dep.is_active and (f.valid_from is null or f.valid_from<=followup_private.today()) and (f.valid_to is null or f.valid_to>=followup_private.today())) then raise exception 'التفعيل الصريح يحتاج حساب مسؤول نشطاً بلا أقسام نافذة وسبباً واضحاً' using errcode='22023';end if;
    if exists(select 1 from jsonb_array_elements_text(p_data->'departments')x where not exists(select 1 from public.departments dep where dep.id=x::uuid and dep.is_active)) then raise exception 'اختر الأقسام الفعلية النشطة صراحةً' using errcode='22023';end if;
   end if;
   result:=followup_private.write_before_roster_setup(p_kind,p_data,p_request_id);
   for old_scope in select to_jsonb(f) from public.fu_departments f where user_id=target loop
    update public.fu_departments f set valid_from=case when activate then followup_private.today() when exists(select 1 from jsonb_array_elements(old_scopes)x where x->>'department_id'=f.department_id::text) then (select nullif(x->>'valid_from','')::date from jsonb_array_elements(old_scopes)x where x->>'department_id'=f.department_id::text) else followup_private.today() end,
     valid_to=case when activate then null else (select nullif(x->>'valid_to','')::date from jsonb_array_elements(old_scopes)x where x->>'department_id'=f.department_id::text) end where f.user_id=target and f.department_id=(old_scope->>'department_id')::uuid;
   end loop;
   select max(id) into event_id from public.fu_business_events where actor=u and kind='account' and new_value->>'user_id'=target::text and at=transaction_timestamp();
   update public.fu_business_events set new_value=(select to_jsonb(a)||jsonb_build_object('departments',coalesce((select jsonb_agg(to_jsonb(f)) from public.fu_departments f where f.user_id=target),'[]'::jsonb)) from public.fu_accounts a where user_id=target) where id=event_id;
   return result;
  end if;
  return followup_private.write_before_roster_setup(p_kind,p_data,p_request_id);
 end if;
 if r='VIEWER' or not followup_private.capability('roster_manage') then raise exception 'Roster setup permission denied' using errcode='42501';end if;
 if p_kind='roster_setup_commit' then
  select * into preview from public.fu_roster_setup_previews where id=(p_data->>'preview_id')::uuid and actor=u for update;
  if preview.id is null then raise exception 'Preview belongs to another actor or does not exist' using errcode='42501';end if;
  d:=preview.department_id;sd:=preview.valid_from;
 end if;
 if d is null or not followup_private.scope_at(d,followup_private.today()) or not followup_private.scope_at(d,sd) then raise exception 'Roster setup department permission changed' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text||p_request_id::text,0));
 select q.result,q.payload into result,oldpayload from public.fu_requests q where q.user_id=u and q.request_id=p_request_id;
 if result is not null then if oldpayload is distinct from jsonb_build_object('kind',p_kind,'data',p_data) then raise exception 'Request was reused for a different payload' using errcode='PT409';end if;return result;end if;
 if p_kind='roster_setup_preview' then
  payload:=followup_private.roster_setup_selection(d,sd,reason,p_data->'employees',false);
  insert into public.fu_roster_setup_previews(actor,department_id,valid_from,reason,payload) values(u,d,sd,reason,payload) returning * into preview;
  result:=followup_private.roster_preview_result(preview);
 else
  if preview.committed_at is not null then raise exception 'Preview already committed; reconcile its original request' using errcode='PT409';end if;
  if preview.expires_at<=clock_timestamp() then raise exception 'انتهت صلاحية المعاينة؛ راجع الاختيار وأعد المعاينة' using errcode='PT410';end if;
  fresh:=followup_private.roster_setup_selection(d,sd,preview.reason,preview.payload,true);
  if fresh is distinct from preview.payload then raise exception 'Employee or assignment changed; preview again' using errcode='PT409';end if;
  if preview.expires_at<=clock_timestamp() then raise exception 'انتهت صلاحية المعاينة؛ راجع الاختيار وأعد المعاينة' using errcode='PT410';end if;
  for item in select x from jsonb_array_elements(fresh)x order by x->>'employee_id' loop
   before_rows:=before_rows||jsonb_build_array(jsonb_build_object('employee_id',item->>'employee_id','assignments',item->'_assignments'));
   update public.employee_assignment_history set valid_to=sd-1 where employee_id=(item->>'employee_id')::uuid and voided_at is null and evidence_kind='observed' and valid_from<sd and (valid_to is null or valid_to>=sd);
   insert into public.employee_assignment_history(employee_id,department_id,shift_id,direct_manager_id,employment_status,valid_from,evidence_kind,reason,created_by)
    select e.id,d,followup_private.evening_shift(),e.direct_manager_id,followup_private.service_state(e.id,sd),sd,'verified',preview.reason,u from public.employees e where e.id=(item->>'employee_id')::uuid returning * into h;
   after_rows:=after_rows||jsonb_build_array(to_jsonb(h));
  end loop;
  select jsonb_agg(x-'_employee_fingerprint'-'_assignment_fingerprint'-'_assignments') into visible_rows from jsonb_array_elements(fresh)x;
  insert into public.fu_roster_setup_decisions(preview_id,actor,department_id,valid_from,reason,member_count,employees,before_assignments,after_assignments) values(preview.id,u,d,sd,preview.reason,jsonb_array_length(fresh),visible_rows,before_rows,after_rows) returning id into decision;
  update public.fu_roster_setup_previews set committed_at=now(),decision_id=decision where id=preview.id;
  result:=jsonb_build_object('id',decision,'preview_id',preview.id,'member_count',jsonb_array_length(fresh),'department_id',d,'valid_from',sd);
  insert into public.fu_business_events(actor,kind,entity_id,department_id,old_value,new_value,reason) values(u,'roster_setup_commit',decision,d,before_rows,result||jsonb_build_object('employees',visible_rows,'assignments',after_rows),preview.reason);
 end if;
 insert into public.fu_requests(user_id,request_id,result,payload) values(u,p_request_id,result,jsonb_build_object('kind',p_kind,'data',p_data));
 return result;
end$$;

create or replace function followup_private.employee_directory_rows(p_filters jsonb) returns jsonb language sql stable set search_path=pg_catalog,public as $$
 select coalesce(jsonb_agg(to_jsonb(x) order by x.display_order,x.name,x.id),'[]'::jsonb) from (
 select e.id,e.id employee_id,e.name,e.internal_code,e.employee_number,e.department_id,e.shift_id,followup_private.service_state(e.id,followup_private.today()) employment_status,e.version,e.education,e.specialization,e.institution,e.graduation_year,e.group_name,(select jsonb_agg(jsonb_build_object('employment_status',decision.employment_status,'valid_from',decision.valid_from,'reason',decision.reason)) from public.fu_service_decisions decision where decision.employee_id=e.id and decision.valid_from>followup_private.today()) scheduled_service,d.arabic_name department_name,d.display_order,s.name shift_name,
 followup_private.verified_evening_member(e.id,e.department_id,coalesce(nullif(p_filters->>'start','')::date,followup_private.today())) evening_verified,
 case when followup_private.verified_evening_member(e.id,e.department_id,coalesce(nullif(p_filters->>'start','')::date,followup_private.today())) then 'verified_evening' when e.shift_id=followup_private.evening_shift() then 'unverified_evening' when e.shift_id is null then 'unknown_shift' else 'other_shift' end roster_scope
 from public.employees e join public.departments d on d.id=e.department_id left join public.shifts s on s.id=e.shift_id
 where followup_private.scope_at(e.department_id,followup_private.today()) and (nullif(p_filters->>'service_state','') is null or followup_private.service_state(e.id,followup_private.today())=p_filters->>'service_state') and (nullif(p_filters->>'department_id','') is null or e.department_id=(p_filters->>'department_id')::uuid) and (nullif(p_filters->>'employee_id','') is null or e.id=(p_filters->>'employee_id')::uuid)
 and (nullif(btrim(p_filters->>'query'),'') is null or e.name ilike '%'||(p_filters->>'query')||'%' or e.internal_code ilike '%'||(p_filters->>'query')||'%' or e.employee_number ilike '%'||(p_filters->>'query')||'%' or ((followup_private.capability('profile_edit') or followup_private.capability('documents_sensitive_read')) and (e.phone ilike '%'||(p_filters->>'query')||'%' or e.secondary_phone ilike '%'||(p_filters->>'query')||'%')) or (followup_private.capability('documents_sensitive_read') and e.reference_number ilike '%'||(p_filters->>'query')||'%'))
 )x;
$$;

create or replace function followup_private.roster_setup_selection(d uuid,day date,reason text,selection jsonb,lock_rows boolean default false) returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare item jsonb;e public.employees;a jsonb;result jsonb:='[]'::jsonb;eid uuid;
begin
 if followup_private.account_role()='VIEWER' or not followup_private.capability('roster_manage') or d is null or not followup_private.scope_at(d,followup_private.today()) or not followup_private.scope_at(d,day) then raise exception 'Roster setup requires current and effective-date scope and roster_manage' using errcode='42501';end if;
 if day is null or day<followup_private.today() or day>followup_private.today()+366 then raise exception 'Roster setup cannot backdate and needs a current or future effective date' using errcode='22023';end if;
 if length(btrim(coalesce(reason,''))) not between 1 and 2000 or jsonb_typeof(selection) is distinct from 'array' then raise exception 'Reason and an explicit employee selection are required' using errcode='22023';end if;
 if jsonb_array_length(selection) not between 1 and 500 or (select count(distinct (x->>'employee_id')::uuid) from jsonb_array_elements(selection)x)<>jsonb_array_length(selection) then raise exception 'Selection is empty, duplicated or too large' using errcode='22023';end if;
 if not exists(select 1 from public.departments where id=d and is_active) then raise exception 'Department is not active' using errcode='22023';end if;
 for item in select x from jsonb_array_elements(selection)x order by (x->>'employee_id')::uuid loop
  eid:=(item->>'employee_id')::uuid;
  if lock_rows then perform pg_advisory_xact_lock(hashtextextended('roster-setup:'||eid::text,0));select * into e from public.employees where id=eid for update;perform id from public.employee_assignment_history where employee_id=eid order by id for update;
  else select * into e from public.employees where id=eid;end if;
  if e.id is null or e.department_id is distinct from d or followup_private.service_state(e.id,day) not in ('active','long_leave') then raise exception 'Selected employee is outside the active current department' using errcode='42501';end if;
  if e.version is distinct from (item->>'version')::integer then raise exception 'Employee changed; refresh and preview again' using errcode='PT409';end if;
  if exists(select 1 from public.employee_assignment_history h where h.employee_id=eid and (h.valid_from>=day or (h.voided_at is null and h.evidence_kind='verified' and (h.valid_to is null or h.valid_to>=day)))) then raise exception 'A current verified or later assignment requires its existing assignment workflow' using errcode='PT409';end if;
  select coalesce(jsonb_agg(to_jsonb(h) order by h.id),'[]'::jsonb) into a from public.employee_assignment_history h where h.employee_id=eid;
  result:=result||jsonb_build_array(jsonb_build_object('id',e.id,'employee_id',e.id,'name',e.name,'internal_code',e.internal_code,'department_id',e.department_id,'version',e.version,'_employee_fingerprint',md5(to_jsonb(e)::text),'_assignment_fingerprint',md5(a::text),'_assignments',a));
 end loop;return result;
end$$;

create or replace function public.followup_session() returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare p jsonb;r text;c jsonb;all_departments jsonb;current_departments jsonb;
begin
 r:=followup_private.account_role();
 select jsonb_object_agg(x,followup_private.capability(x)) into c from unnest(array['service_manage','identity_edit','profile_edit','documents_read','documents_write','documents_sensitive_read','documents_sensitive_write','roster_manage','archive_read'])x;
 select coalesce(jsonb_agg(f.department_id order by f.department_id),'[]'::jsonb) into all_departments from public.fu_departments f where f.user_id=auth.uid();
 select coalesce(jsonb_agg(f.department_id order by f.department_id),'[]'::jsonb) into current_departments from public.fu_departments f join public.departments d on d.id=f.department_id where f.user_id=auth.uid() and d.is_active and (f.valid_from is null or f.valid_from<=followup_private.today()) and (f.valid_to is null or f.valid_to>=followup_private.today());
 select to_jsonb(t)||jsonb_build_object('followup_role',r,'capabilities',c||jsonb_build_object('accounts_manage',r='ADMIN','contacts_manage',r in ('ADMIN','FOLLOWUP')),'departments',all_departments,'current_departments',current_departments,'assignment_needed',r='SUPERVISOR' and jsonb_array_length(current_departments)=0) into p from public.profiles t where id=auth.uid();return p;
end$$;

-- REVIEW ONLY: included in the local proposal, never applied to an existing project.
-- No business mutation is performed by staging, reading or closing a recovery.
create table public.fu_decision_recoveries(
 user_id uuid not null references public.profiles(id),request_id uuid not null,
 employee_id uuid not null references public.employees(id),kind text not null check(kind in ('service_state','employee_identity')),
 data jsonb,state text not null check(state in ('staged','closed')),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 primary key(user_id,request_id));
alter table public.fu_decision_recoveries enable row level security;
revoke all on public.fu_decision_recoveries from public,anon,authenticated;

create function followup_private.decision_recovery(rid uuid,eid uuid,decision_kind text,data jsonb,operation text) returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare u uuid:=auth.uid();r text:=followup_private.account_role();stored public.fu_decision_recoveries;committed public.fu_requests;answer jsonb;
begin
 if rid is null or eid is null or decision_kind not in ('service_state','employee_identity') or decision_kind is null then raise exception 'معرفات الاستكمال غير صالحة' using errcode='22023';end if;
 if r='VIEWER' or not followup_private.employee_scope(eid) or not followup_private.capability(case decision_kind when 'service_state' then 'service_manage' else 'identity_edit' end) then raise exception 'صلاحية استكمال القرار غير متاحة' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text||rid::text,0));
 select * into stored from public.fu_decision_recoveries x where x.user_id=u and x.request_id=rid for update;
 select * into committed from public.fu_requests q where q.user_id=u and q.request_id=rid;
 if stored.request_id is not null and (stored.employee_id is distinct from eid or stored.kind is distinct from decision_kind) then raise exception 'تغيرت هوية طلب الاستكمال' using errcode='PT409';end if;
 if committed.request_id is not null and (committed.payload->>'kind' is distinct from decision_kind or committed.payload->'data'->>'employee_id' is distinct from eid::text) then raise exception 'تغيرت هوية الطلب المحفوظ' using errcode='PT409';end if;
 answer:=jsonb_build_object('request_id',rid,'actor',u,'kind',decision_kind,'employee_id',eid);
 if operation='stage' then
  if stored.state='closed' then raise exception 'أغلق الطلب قبل الحفظ؛ ابدأ قراراً جديداً' using errcode='PT409';end if;
  if jsonb_typeof(data) is distinct from 'object' or length(data::text)>16000 or data->>'employee_id' is distinct from eid::text or jsonb_typeof(data->'version') is distinct from 'number' or coalesce(data->>'version','') !~ '^[1-9][0-9]*$' or length(btrim(coalesce(data->>'reason',''))) not between 5 and 2000 then raise exception 'بيانات الاستكمال غير صالحة' using errcode='22023';end if;
  if stored.request_id is not null and stored.data is distinct from data then raise exception 'تغير محتوى طلب الاستكمال' using errcode='PT409';end if;
  if committed.request_id is not null and committed.payload->'data' is distinct from data then raise exception 'تغير محتوى الطلب المحفوظ' using errcode='PT409';end if;
  if stored.request_id is null then insert into public.fu_decision_recoveries(user_id,request_id,employee_id,kind,data,state) values(u,rid,eid,decision_kind,data,'staged');end if;
 elsif operation='close' then
  -- The same lock is held by business writes. A delayed, not-yet-committed
  -- request cannot begin after this tombstone; an existing receipt wins.
  if committed.request_id is null then
   insert into public.fu_decision_recoveries(user_id,request_id,employee_id,kind,data,state) values(u,rid,eid,decision_kind,null,'closed')
    on conflict(user_id,request_id) do update set state='closed',updated_at=clock_timestamp();
   return answer||jsonb_build_object('state','closed');
  end if;
 elsif operation<>'read' then raise exception 'عملية استكمال غير صالحة' using errcode='22023';end if;
 if committed.request_id is not null then return answer||jsonb_build_object('state','committed','data',committed.payload->'data');end if;
 if stored.state='closed' then return answer||jsonb_build_object('state','closed');end if;
 if operation='stage' then return answer||jsonb_build_object('state','staged','data',data);end if;
 if stored.request_id is not null then return answer||jsonb_build_object('state','staged','data',stored.data);end if;
 return answer||jsonb_build_object('state','not_found');
end$$;

create function followup_private.decision_recovery_guard(rid uuid,eid uuid,decision_kind text,data jsonb) returns void language plpgsql set search_path=pg_catalog,public as $$
declare stored public.fu_decision_recoveries;
begin
 -- Called only after the business-write actor/request lock and live permission guard.
 select * into stored from public.fu_decision_recoveries x where x.user_id=auth.uid() and x.request_id=rid;
 if stored.request_id is null then return;end if;
 if stored.employee_id is distinct from eid or stored.kind is distinct from decision_kind or stored.data is distinct from data or stored.state='closed' then raise exception 'أغلق طلب الاستكمال أو تغير محتواه؛ تحقق من الطلب الأصلي' using errcode='PT409';end if;
end$$;
revoke all on function followup_private.decision_recovery(uuid,uuid,text,jsonb,text),followup_private.decision_recovery_guard(uuid,uuid,text,jsonb) from public,anon,authenticated;


alter function public.followup_read(text,jsonb) rename to read_before_staff_repairs;
alter function public.read_before_staff_repairs(text,jsonb) set schema followup_private;
create function public.followup_read(p_kind text,p_filters jsonb default '{}') returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r text:=followup_private.account_role();eid uuid:=nullif(p_filters->>'employee_id','')::uuid;result jsonb;item jsonb;
begin
 if p_kind='account_creation' then return followup_private.account_creation((p_filters->>'request_id')::uuid,'{}'::jsonb,'read');end if;
 if p_kind='decision_recovery' then return followup_private.decision_recovery((p_filters->>'request_id')::uuid,eid,p_filters->>'decision_kind',null,'read');end if;
 if p_kind='request_receipt' then
  if not followup_private.employee_scope(eid) then raise exception 'الموظف خارج صلاحيتك' using errcode='42501';end if;
  select jsonb_build_object('request_id',q.request_id,'actor',q.user_id,'kind',q.payload->>'kind','employee_id',eid,'entity_id',q.result->>'id','employee_version',coalesce(q.result->'employee_version',q.result->'version')) into result
   from public.fu_requests q where q.user_id=auth.uid() and q.request_id=(p_filters->>'request_id')::uuid and q.payload->>'kind' in ('service_state','employee_identity') and q.payload->'data'->>'employee_id'=eid::text;
  if result is not null and (r='VIEWER' or not followup_private.capability(case when result->>'kind'='service_state' then 'service_manage' else 'identity_edit' end)) then raise exception 'صلاحية القرار مسحوبة' using errcode='42501';end if;
  return coalesce(result,jsonb_build_object('found',false));
 end if;
 if p_kind='quarantine_history' then
  if r<>'ADMIN' or not followup_private.capability('archive_read') then raise exception 'التاريخ المعزول يحتاج صلاحية أرشيف مستقلة' using errcode='42501';end if;
  return jsonb_build_object('departments',(select jsonb_agg(to_jsonb(q)) from public.fu_quarantined_departments q),'reports',(select jsonb_agg(followup_private.snapshot(x.id)) from public.fu_reports x join public.fu_quarantined_departments q on q.department_id=x.department_id),'actions',(select jsonb_agg(to_jsonb(x)) from public.fu_actions x join public.fu_quarantined_departments q on q.department_id=x.department_id));
 end if;
 if p_kind='handovers' and not followup_private.capability('archive_read') then raise exception 'التسليم محفوظ في الأرشيف التاريخي المخوّل' using errcode='42501';end if;
 if p_kind in ('service_decisions','employee_duplicates') then
  if p_kind='service_decisions' then
   if not followup_private.employee_scope(eid) then raise exception 'الموظف خارج صلاحيتك' using errcode='42501';end if;
   return coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('actor_name',(select name from public.profiles where id=s.actor)) order by s.valid_from desc,s.created_at desc) from public.fu_service_decisions s where s.employee_id=eid),'[]'::jsonb);
  end if;
  if r='VIEWER' or not(followup_private.capability('roster_manage') or followup_private.capability('identity_edit')) then raise exception 'فحص التكرار يحتاج صلاحية تعديل الهوية أو إضافة الموظف' using errcode='42501';end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',e.name,'internal_code',e.internal_code,'department_name',d.arabic_name,'employee_number',e.employee_number)) from public.employees e join public.departments d on d.id=e.department_id where followup_private.employee_scope(e.id) and e.id is distinct from eid and (lower(regexp_replace(btrim(e.name),'\s+',' ','g'))=lower(regexp_replace(btrim(p_filters->>'name'),'\s+',' ','g')) or (nullif(btrim(p_filters->>'employee_number'),'') is not null and e.employee_number=btrim(p_filters->>'employee_number')))),'[]'::jsonb);
 end if;
 result:=followup_private.read_before_staff_repairs(p_kind,p_filters);
 if p_kind='reporting_model' and eid is not null and result->'positions'='[]'::jsonb then return result||jsonb_build_object('empty_reason','no_evening_history');end if;
 if p_kind='roster_setup_candidates' then return coalesce((select jsonb_agg(x) from jsonb_array_elements(result)x where followup_private.service_state((x->>'id')::uuid,coalesce(nullif(p_filters->>'start','')::date,followup_private.today())) in ('active','long_leave')),'[]'::jsonb);end if;
 if p_kind='profile' then
  return result||jsonb_build_object('read_only',false,'employee',(result->'employee')||jsonb_build_object('employment_status',followup_private.service_state(eid,followup_private.today())),'service_decisions',public.followup_read('service_decisions',p_filters));
 elsif p_kind='actions' then
  return coalesce((select jsonb_agg(x||jsonb_build_object('comments',coalesce((select jsonb_agg((to_jsonb(c)-'document_id')||jsonb_build_object('actor_name',(select name from public.profiles where id=c.actor),'document_id',case when doc.id is not null then doc.id else null end,'document_title',doc.title) order by c.created_at,c.id) from public.fu_action_comments c left join public.fu_documents doc on doc.id=c.document_id and doc.state='active' and followup_private.document_access(doc,false) where c.action_id=(x->>'id')::uuid),'[]'::jsonb))) from jsonb_array_elements(result)x),'[]'::jsonb);
 end if;
 return result;
end$$;
create or replace function public.followup_write(p_kind text,p_data jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r text:=followup_private.account_role();u uuid:=auth.uid();eid uuid:=nullif(p_data->>'employee_id','')::uuid;emp public.employees;result jsonb;oldpayload jsonb;reason text:=btrim(coalesce(p_data->>'reason',''));day date:=nullif(p_data->>'valid_from','')::date;doc public.fu_documents;decision public.fu_service_decisions;
begin
 if p_request_id is null then raise exception 'معرّف الطلب مطلوب' using errcode='22023';end if;
 if p_kind='decision_recovery_stage' then return followup_private.decision_recovery(p_request_id,(p_data->'data'->>'employee_id')::uuid,p_data->>'kind',p_data->'data','stage');end if;
 if p_kind='decision_recovery_close' then return followup_private.decision_recovery(p_request_id,eid,p_data->>'decision_kind',null,'close');end if;
 if p_kind in ('account_creation_begin','account_creation_result','account_creation_close') then return followup_private.account_creation(p_request_id,p_data,case p_kind when 'account_creation_begin' then 'begin' when 'account_creation_close' then 'close_unstarted' else 'result' end);end if;
 if p_kind='handover' then raise exception 'سجل التسليم التاريخي للقراءة فقط' using errcode='42501';end if;
 if p_kind='account' then if r<>'ADMIN' then raise exception 'إدارة الحسابات للمدير' using errcode='42501';end if;if length(reason) not between 5 and 2000 then raise exception 'اكتب سبباً واضحاً لقرار الحساب' using errcode='22023';end if;end if;
 if p_kind='assignment' then
  if p_data ? 'employment_status' and p_data->>'employment_status' is distinct from followup_private.service_state(eid,day) then raise exception 'استخدم تغيير الحالة لقرار الخدمة؛ النقل لا يغيرها' using errcode='22023';end if;
  p_data:=p_data||jsonb_build_object('employment_status',followup_private.service_state(eid,day));
 end if;
 if p_kind='employee_add' then
  if r='VIEWER' or not followup_private.capability('roster_manage') then raise exception 'إضافة الموظف تحتاج صلاحية مستقلة' using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended('employee-identity-validation',0));
  if exists(select 1 from public.employees e where nullif(btrim(p_data->>'employee_number'),'') is not null and e.employee_number=btrim(p_data->>'employee_number')) then raise exception 'الرقم الوظيفي مستخدم لموظف آخر' using errcode='23505';end if;
 end if;
 if p_kind='action' and nullif(p_data->>'attachment_document_id','') is not null then
  select * into doc from public.fu_documents where id=(p_data->>'attachment_document_id')::uuid;
  if doc.id is null or doc.employee_id is distinct from eid or doc.state<>'active' or not followup_private.document_access(doc,false) or length(btrim(coalesce(p_data->>'comment','')))<1 then raise exception 'اختر مستمسكاً فعالاً لنفس الموظف واكتب تعليق المرفق' using errcode='42501';end if;
 end if;
 if p_kind not in ('service_state','employee_identity') then
  result:=followup_private.write_before_staff_repairs(p_kind,p_data,p_request_id);
  if p_kind='account' then
   select to_jsonb(a)||jsonb_build_object('ok',true,'departments',coalesce((select jsonb_agg(x.department_id) from public.fu_departments x where x.user_id=a.user_id),'[]'::jsonb)) into result from public.fu_accounts a where a.user_id=(p_data->>'user_id')::uuid;
  end if;
  return result;
 end if;
 if r='VIEWER' or not followup_private.capability(case when p_kind='service_state' then 'service_manage' else 'identity_edit' end) or not followup_private.employee_scope(eid) then raise exception 'لا تملك صلاحية هذا التعديل في قسم الموظف' using errcode='42501';end if;
 if length(reason) not between 5 and 2000 then raise exception 'اكتب سبباً واضحاً من خمسة أحرف على الأقل' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text||p_request_id::text,0));
 perform followup_private.decision_recovery_guard(p_request_id,eid,p_kind,p_data);
 select q.result,q.payload into result,oldpayload from public.fu_requests q where q.user_id=u and q.request_id=p_request_id;
 if result is not null then if oldpayload is distinct from jsonb_build_object('kind',p_kind,'data',p_data) then raise exception 'تغيرت بيانات طلب إعادة المحاولة' using errcode='PT409';end if;return result;end if;
 -- A durable, payload-bound replay can cross midnight; only a new decision must start today or later.
 if p_kind='service_state' and (day is null or day<followup_private.today() or day>followup_private.today()+366 or not followup_private.scope_at((select department_id from public.employees where id=eid),day) or coalesce(p_data->>'employment_status','') not in ('active','inactive','resigned','long_leave')) then raise exception 'اختر حالة وتاريخ نفاذ اليوم أو المستقبل ضمن صلاحيتك' using errcode='22023';end if;
 select * into emp from public.employees where id=eid for update;
 if emp.version is distinct from (p_data->>'version')::integer then raise exception 'تغير ملف الموظف. احتفظ بالتعديل وراجع النسخة الجديدة' using errcode='PT409';end if;
 if p_kind='service_state' then
  update public.employees set updated_by=u where id=eid;
  insert into public.fu_service_decisions(employee_id,employment_status,valid_from,reason,actor,employee_version) select eid,p_data->>'employment_status',day,reason,u,version from public.employees where id=eid returning * into decision;
  result:=to_jsonb(decision);
 else
  if length(btrim(coalesce(p_data->>'name',''))) not between 1 and 150 then raise exception 'اسم الموظف مطلوب' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended('employee-identity-validation',0));
  if exists(select 1 from public.employees e where e.id<>eid and nullif(btrim(p_data->>'employee_number'),'') is not null and e.employee_number=btrim(p_data->>'employee_number')) then raise exception 'الرقم الوظيفي مستخدم لموظف آخر' using errcode='23505';end if;
  if exists(select 1 from public.employees e where e.id<>eid and lower(regexp_replace(btrim(e.name),'\s+',' ','g'))=lower(regexp_replace(btrim(p_data->>'name'),'\s+',' ','g'))) then raise exception 'يوجد اسم مطابق؛ راجع الهوية ولا تدمج السجلات' using errcode='23505';end if;
  update public.employees set name=btrim(p_data->>'name'),employee_number=nullif(btrim(p_data->>'employee_number'),''),updated_by=u where id=eid returning followup_private.redact_profile(to_jsonb(public.employees.*)) into result;
 end if;
 insert into public.fu_business_events(actor,kind,entity_id,department_id,employee_id,old_value,new_value,reason) values(u,p_kind,coalesce((result->>'id')::uuid,eid),emp.department_id,eid,followup_private.redact_profile(to_jsonb(emp)),result,reason);
 insert into public.fu_requests(user_id,request_id,result,payload) values(u,p_request_id,result,jsonb_build_object('kind',p_kind,'data',p_data));return result;
end$$;
revoke all on function followup_private.service_state(uuid,date),followup_private.write_before_staff_repairs(text,jsonb,uuid),followup_private.read_before_staff_repairs(text,jsonb),followup_private.read_before_roster_setup(text,jsonb),followup_private.write_before_roster_setup(text,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.followup_read(text,jsonb),public.followup_write(text,jsonb,uuid) from public,anon;
grant execute on function public.followup_read(text,jsonb),public.followup_write(text,jsonb,uuid) to authenticated;
commit;
