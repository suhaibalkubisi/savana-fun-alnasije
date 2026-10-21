begin;
create table public.fu_roster_setup_previews(
 id uuid primary key default gen_random_uuid(),actor uuid not null references public.profiles(id),department_id uuid not null references public.departments(id),valid_from date not null,reason text not null check(length(btrim(reason)) between 1 and 2000),payload jsonb not null check(jsonb_typeof(payload)='array'),created_at timestamptz not null default now(),expires_at timestamptz not null default (now()+interval '20 minutes'),committed_at timestamptz,decision_id uuid);
create table public.fu_roster_setup_decisions(
 id uuid primary key default gen_random_uuid(),preview_id uuid not null unique references public.fu_roster_setup_previews(id),actor uuid not null references public.profiles(id),department_id uuid not null references public.departments(id),valid_from date not null,reason text not null,member_count integer not null check(member_count between 1 and 500),employees jsonb not null,before_assignments jsonb not null,after_assignments jsonb not null,created_at timestamptz not null default now());
alter table public.fu_roster_setup_previews add constraint fu_roster_preview_decision foreign key(decision_id) references public.fu_roster_setup_decisions(id);
alter table public.fu_roster_setup_previews enable row level security;
alter table public.fu_roster_setup_decisions enable row level security;
revoke all on public.fu_roster_setup_previews,public.fu_roster_setup_decisions from public,anon,authenticated;
create function followup_private.verified_evening_member(eid uuid,d uuid,day date) returns boolean language sql stable set search_path=pg_catalog,public as $$
 select exists(select 1 from public.employee_assignment_history h where h.employee_id=eid and h.department_id=d and h.shift_id=followup_private.evening_shift() and h.voided_at is null and h.evidence_kind='verified' and h.employment_status in ('active','long_leave') and h.valid_from<=day and (h.valid_to is null or h.valid_to>=day) and followup_private.scope_at(h.department_id,day));
$$;
create function followup_private.employee_directory_rows(p_filters jsonb) returns jsonb language sql stable set search_path=pg_catalog,public as $$
 select coalesce(jsonb_agg(to_jsonb(x) order by x.display_order,x.name,x.id),'[]'::jsonb) from (
 select e.id,e.id employee_id,e.name,e.internal_code,e.employee_number,e.department_id,e.shift_id,e.employment_status,e.version,e.education,e.specialization,e.institution,e.graduation_year,e.group_name,d.arabic_name department_name,d.display_order,s.name shift_name,
 followup_private.verified_evening_member(e.id,e.department_id,coalesce(nullif(p_filters->>'start','')::date,followup_private.today())) evening_verified,
 case when followup_private.verified_evening_member(e.id,e.department_id,coalesce(nullif(p_filters->>'start','')::date,followup_private.today())) then 'verified_evening' when e.shift_id=followup_private.evening_shift() then 'unverified_evening' when e.shift_id is null then 'unknown_shift' else 'other_shift' end roster_scope
 from public.employees e join public.departments d on d.id=e.department_id left join public.shifts s on s.id=e.shift_id
 where followup_private.scope_at(e.department_id,followup_private.today()) and (nullif(p_filters->>'department_id','') is null or e.department_id=(p_filters->>'department_id')::uuid) and (nullif(p_filters->>'employee_id','') is null or e.id=(p_filters->>'employee_id')::uuid)
 and (nullif(btrim(p_filters->>'query'),'') is null or e.name ilike '%'||(p_filters->>'query')||'%' or e.internal_code ilike '%'||(p_filters->>'query')||'%' or e.employee_number ilike '%'||(p_filters->>'query')||'%' or ((followup_private.capability('profile_edit') or followup_private.capability('documents_sensitive_read')) and (e.phone ilike '%'||(p_filters->>'query')||'%' or e.secondary_phone ilike '%'||(p_filters->>'query')||'%')) or (followup_private.capability('documents_sensitive_read') and e.reference_number ilike '%'||(p_filters->>'query')||'%'))
 )x;
$$;
create function followup_private.roster_setup_selection(d uuid,day date,reason text,selection jsonb,lock_rows boolean default false) returns jsonb language plpgsql set search_path=pg_catalog,public as $$
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
  if e.id is null or e.department_id is distinct from d or e.employment_status not in ('active','long_leave') then raise exception 'Selected employee is outside the active current department' using errcode='42501';end if;
  if e.version is distinct from (item->>'version')::integer then raise exception 'Employee changed; refresh and preview again' using errcode='PT409';end if;
  if exists(select 1 from public.employee_assignment_history h where h.employee_id=eid and (h.valid_from>=day or (h.voided_at is null and h.evidence_kind='verified' and (h.valid_to is null or h.valid_to>=day)))) then raise exception 'A current verified or later assignment requires its existing assignment workflow' using errcode='PT409';end if;
  select coalesce(jsonb_agg(to_jsonb(h) order by h.id),'[]'::jsonb) into a from public.employee_assignment_history h where h.employee_id=eid;
  result:=result||jsonb_build_array(jsonb_build_object('id',e.id,'employee_id',e.id,'name',e.name,'internal_code',e.internal_code,'department_id',e.department_id,'version',e.version,'_employee_fingerprint',md5(to_jsonb(e)::text),'_assignment_fingerprint',md5(a::text),'_assignments',a));
 end loop;return result;
end$$;
create function followup_private.roster_preview_result(p public.fu_roster_setup_previews) returns jsonb language sql stable set search_path=pg_catalog,public as $$
 select jsonb_build_object('id',p.id,'expires_at',p.expires_at,'department_id',p.department_id,'valid_from',p.valid_from,'reason',p.reason,'member_count',jsonb_array_length(p.payload),'employees',coalesce((select jsonb_agg(x-'_employee_fingerprint'-'_assignment_fingerprint'-'_assignments') from jsonb_array_elements(p.payload)x),'[]'::jsonb));
$$;
alter function public.followup_read(text,jsonb) rename to read_before_roster_setup;
alter function public.read_before_roster_setup(text,jsonb) set schema followup_private;
alter function public.followup_write(text,jsonb,uuid) rename to write_before_roster_setup;
alter function public.write_before_roster_setup(text,jsonb,uuid) set schema followup_private;
revoke all on function followup_private.read_before_roster_setup(text,jsonb),followup_private.write_before_roster_setup(text,jsonb,uuid),followup_private.verified_evening_member(uuid,uuid,date),followup_private.employee_directory_rows(jsonb),followup_private.roster_setup_selection(uuid,date,text,jsonb,boolean),followup_private.roster_preview_result(public.fu_roster_setup_previews) from public,anon,authenticated;
create function public.followup_read(p_kind text,p_filters jsonb default '{}') returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r text:=followup_private.account_role();sd date:=coalesce(nullif(p_filters->>'start','')::date,followup_private.today());ed date:=coalesce(nullif(p_filters->>'end','')::date,sd);d uuid:=nullif(p_filters->>'department_id','')::uuid;eid uuid:=nullif(p_filters->>'employee_id','')::uuid;result jsonb;e public.employees;preview public.fu_roster_setup_previews;
begin
 if nullif(p_filters->>'shift_id','') is not null and (p_filters->>'shift_id')::uuid<>followup_private.evening_shift() then raise exception 'Operational shift must be evening' using errcode='22023';end if;
 if ed<sd or ed-sd>366 then raise exception 'Invalid date interval' using errcode='22023';end if;
 if d is not null and not followup_private.scope_at(d,sd) then raise exception 'Department outside effective-date scope' using errcode='42501';end if;
 if p_kind='bootstrap' then
  result:=followup_private.read_before_roster_setup(p_kind,p_filters);
  result:=result||jsonb_build_object('users',coalesce((select jsonb_agg(x||jsonb_build_object('current_departments',coalesce((select jsonb_agg(f.department_id order by f.department_id) from public.fu_departments f join public.departments dep on dep.id=f.department_id where f.user_id=(x->>'id')::uuid and dep.is_active and (f.valid_from is null or f.valid_from<=followup_private.today()) and (f.valid_to is null or f.valid_to>=followup_private.today())),'[]'::jsonb),'assignment_needed',x->>'role'='SUPERVISOR' and coalesce((x->>'active')::boolean,false) and not exists(select 1 from public.fu_departments f join public.departments dep on dep.id=f.department_id where f.user_id=(x->>'id')::uuid and dep.is_active and (f.valid_from is null or f.valid_from<=followup_private.today()) and (f.valid_to is null or f.valid_to>=followup_private.today())))) from jsonb_array_elements(result->'users')x),'[]'::jsonb));
  return result||jsonb_build_object('configuration',(result->'configuration')||jsonb_build_object('unassigned_supervisors',(select count(*) from public.fu_accounts a join public.profiles p on p.id=a.user_id where r='ADMIN' and a.role='SUPERVISOR' and a.active and p.is_active and not exists(select 1 from public.fu_departments f join public.departments dep on dep.id=f.department_id where f.user_id=a.user_id and dep.is_active and (f.valid_from is null or f.valid_from<=followup_private.today()) and (f.valid_to is null or f.valid_to>=followup_private.today())))));
 elsif p_kind='roster_setup_status' then
  if r='VIEWER' or not followup_private.capability('roster_manage') then raise exception 'تحتاج صلاحية إدارة الانتماء لعرض نتيجة المعاينة' using errcode='42501';end if;
  select * into preview from public.fu_roster_setup_previews where id=(p_filters->>'preview_id')::uuid and actor=auth.uid();
  if preview.id is null or not followup_private.scope_at(preview.department_id,followup_private.today()) or not followup_private.scope_at(preview.department_id,preview.valid_from) then raise exception 'المعاينة خارج صلاحية حسابك الحالية' using errcode='42501';end if;
  return jsonb_build_object('preview',followup_private.roster_preview_result(preview),'decision',(select jsonb_build_object('id',x.id,'preview_id',x.preview_id,'member_count',x.member_count,'department_id',x.department_id,'valid_from',x.valid_from,'reason',x.reason,'created_at',x.created_at,'employees',x.employees) from public.fu_roster_setup_decisions x where x.id=preview.decision_id));
 elsif p_kind='employee_directory' then return followup_private.employee_directory_rows(p_filters);
 elsif p_kind='roster_setup_candidates' then
  if r='VIEWER' or not followup_private.capability('roster_manage') or d is null or not followup_private.scope_at(d,followup_private.today()) then raise exception 'Roster setup permission required' using errcode='42501';end if;
  if sd<followup_private.today() or sd>followup_private.today()+366 then raise exception 'Choose a current or future effective date' using errcode='22023';end if;
  return coalesce((select jsonb_agg(x order by x->>'name',x->>'id') from jsonb_array_elements(followup_private.employee_directory_rows(p_filters))x where x->>'employment_status' in ('active','long_leave') and not exists(select 1 from public.employee_assignment_history h where h.employee_id=(x->>'id')::uuid and (h.valid_from>=sd or (h.voided_at is null and h.evidence_kind='verified' and (h.valid_to is null or h.valid_to>=sd))))),'[]'::jsonb);
 elsif p_kind='employees' then
  return coalesce((select jsonb_agg(x order by (x->>'display_order')::integer,x->>'name',x->>'id') from jsonb_array_elements(followup_private.employee_directory_rows(p_filters))x where (x->>'shift_id')::uuid=followup_private.evening_shift() or exists(select 1 from public.employee_assignment_history h where h.employee_id=(x->>'id')::uuid and h.shift_id=followup_private.evening_shift() and h.evidence_kind='verified' and h.voided_at is null and h.employment_status in ('active','long_leave') and h.valid_from<=ed and (h.valid_to is null or h.valid_to>=sd) and followup_private.scope_at(h.department_id,greatest(sd,h.valid_from)) and (d is null or h.department_id=d))),'[]'::jsonb);
 elsif p_kind='profile' then
  select * into e from public.employees where id=eid;
  if e.id is null or not followup_private.scope_at(e.department_id,followup_private.today()) then raise exception 'Employee outside current department scope' using errcode='42501';end if;
  if followup_private.employee_scope(eid) then result:=followup_private.read_before_roster_setup(p_kind,p_filters);
  else result:=jsonb_build_object('employee',followup_private.redact_profile(to_jsonb(e))||jsonb_build_object('department_name',(select arabic_name from public.departments where id=e.department_id)),'assignments','[]'::jsonb,'history','[]'::jsonb,'documents','[]'::jsonb);end if;
  return result||jsonb_build_object('read_only',not followup_private.employee_scope(eid))||jsonb_build_object('employee',(result->'employee')||jsonb_build_object('shift_name',(select name from public.shifts where id=e.shift_id),'evening_verified',followup_private.verified_evening_member(eid,e.department_id,followup_private.today()),'roster_scope',case when followup_private.verified_evening_member(eid,e.department_id,followup_private.today()) then 'verified_evening' when e.shift_id=followup_private.evening_shift() then 'unverified_evening' when e.shift_id is null then 'unknown_shift' else 'other_shift' end));
 elsif p_kind='search' then
  result:=followup_private.read_before_roster_setup(p_kind,p_filters);
  if length(btrim(coalesce(p_filters->>'query','')))<2 then return result;end if;
  return result||jsonb_build_object('employees',coalesce((select jsonb_agg(x) from (select x from jsonb_array_elements(followup_private.employee_directory_rows(p_filters))x limit 20)s),'[]'::jsonb));
 end if;
 return followup_private.read_before_roster_setup(p_kind,p_filters);
end$$;
create function public.followup_write(p_kind text,p_data jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
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
    select e.id,d,followup_private.evening_shift(),e.direct_manager_id,e.employment_status,sd,'verified',preview.reason,u from public.employees e where e.id=(item->>'employee_id')::uuid returning * into h;
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
do $$declare definition text;old_predicate text:='e.department_id=d and e.shift_id=es and followup_private.employee_scope(e.id)';begin
 definition:=pg_get_functiondef('followup_private.write_before_roster_setup(text,jsonb,uuid)'::regprocedure);
 if (length(definition)-length(replace(definition,old_predicate,'')))/length(old_predicate)<>1 then raise exception 'Candidate action predicate drift; stop for review';end if;
 execute replace(definition,old_predicate,'e.department_id=d and followup_private.verified_evening_member(e.id,d,sd) and followup_private.employee_scope(e.id)');
end$$;
create or replace function public.followup_session() returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare p jsonb;r text;c jsonb;all_departments jsonb;current_departments jsonb;
begin
 r:=followup_private.account_role();
 select jsonb_object_agg(x,followup_private.capability(x)) into c from unnest(array['profile_edit','documents_read','documents_write','documents_sensitive_read','documents_sensitive_write','roster_manage','archive_read'])x;
 select coalesce(jsonb_agg(f.department_id order by f.department_id),'[]'::jsonb) into all_departments from public.fu_departments f where f.user_id=auth.uid();
 select coalesce(jsonb_agg(f.department_id order by f.department_id),'[]'::jsonb) into current_departments from public.fu_departments f join public.departments d on d.id=f.department_id where f.user_id=auth.uid() and d.is_active and (f.valid_from is null or f.valid_from<=followup_private.today()) and (f.valid_to is null or f.valid_to>=followup_private.today());
 select to_jsonb(t)||jsonb_build_object('followup_role',r,'capabilities',c||jsonb_build_object('accounts_manage',r='ADMIN','contacts_manage',r in ('ADMIN','FOLLOWUP')),'departments',all_departments,'current_departments',current_departments,'assignment_needed',r='SUPERVISOR' and jsonb_array_length(current_departments)=0) into p from public.profiles t where id=auth.uid();return p;
end$$;
revoke all on function followup_private.read_before_roster_setup(text,jsonb),followup_private.write_before_roster_setup(text,jsonb,uuid),followup_private.verified_evening_member(uuid,uuid,date),followup_private.employee_directory_rows(jsonb),followup_private.roster_setup_selection(uuid,date,text,jsonb,boolean),followup_private.roster_preview_result(public.fu_roster_setup_previews) from public,anon,authenticated;
revoke execute on function public.followup_read(text,jsonb),public.followup_write(text,jsonb,uuid),public.followup_session() from public,anon;
grant execute on function public.followup_read(text,jsonb),public.followup_write(text,jsonb,uuid),public.followup_session() to authenticated;
notify pgrst,'reload schema';
commit;
