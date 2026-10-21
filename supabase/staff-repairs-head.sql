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
