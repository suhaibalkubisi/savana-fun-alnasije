-- Operational acceptance repair. Local rehearsal only; no production authorization.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
-- Cancelled evidence remains immutable. A reupload creates a new attempt.
alter table public.attendance_imports add column previous_attempt_id uuid references public.attendance_imports(id);
alter table public.attendance_imports add column coverage_confirmed boolean not null default false;
do $$declare n text;begin
 select conname into strict n from pg_constraint where conrelid='public.attendance_imports'::regclass and contype='u' and pg_get_constraintdef(oid)='UNIQUE (source_hash, import_kind, period_start, period_end)';
 execute format('alter table public.attendance_imports drop constraint %I',n);
end $$;
create unique index attendance_import_active_hash on public.attendance_imports(source_hash,import_kind,period_start,period_end) where state='preview';

create table public.attendance_device_sources (
 id uuid primary key default gen_random_uuid(), namespace text not null unique check(length(btrim(namespace)) between 1 and 100),
 label text not null check(length(btrim(label)) between 1 and 150), is_active boolean not null default true,
 confirmation_reason text, version integer not null default 1,created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),created_by uuid references public.profiles(id),updated_by uuid references public.profiles(id)
);
alter table public.attendance_device_sources enable row level security;
revoke all on public.attendance_device_sources from public,anon,authenticated;
insert into public.attendance_device_sources(namespace,label)
 select distinct device_namespace,case when device_namespace='legacy-unscoped' then 'مصادر قديمة غير محددة - تحقق من الجهاز' else device_namespace end from public.attendance_imports;
create trigger touch before insert or update on public.attendance_device_sources for each row execute function hr_private.touch();
create trigger audit after insert or update on public.attendance_device_sources for each row execute function hr_private.audit();



create function hr_private.verified_source_identity(employee uuid,match_kind text,ns text,code text,source text) returns boolean language sql stable set search_path='' as $$
 select employee is not null and (match_kind='confirmed' or (match_kind='code' and exists(
 select 1 from public.fingerprint_identities f where f.device_namespace=ns and f.person_code=code and f.employee_id=employee and length(btrim(coalesce(f.confirmation_reason,'')))>=3 and
 (hr_private.fingerprint_name(f.source_name)=hr_private.fingerprint_name(source) or hr_private.fingerprint_name(source)=any(f.confirmed_names) or exists(select 1 from public.employees e where e.id=employee and hr_private.fingerprint_name(e.name)=hr_private.fingerprint_name(source)))
 )))
$$;
revoke all on function hr_private.verified_source_identity(uuid,text,text,text,text) from public,anon,authenticated;


create or replace function hr_private.refresh_import_summary(bid uuid) returns void language sql set search_path='' as $$
 update public.attendance_imports i set summary=(
 select jsonb_build_object('rows',count(*),'matched',count(*) filter(where s.employee_id is not null),
 'unmatched',count(*) filter(where s.employee_id is null and s.match_state='unmatched'),
 'ambiguous',count(*) filter(where s.match_state='ambiguous'),'invalid',count(*) filter(where s.match_state='invalid'),
 'days',count(distinct s.calendar_date),'linked_people',count(distinct s.employee_id),
 'open_issues',(select count(*) from public.fingerprint_issues f join public.fingerprint_source_rows x on x.id=f.source_row_id where x.import_id=bid and f.state='open'))
 from public.fingerprint_source_rows s where s.import_id=bid) where i.id=bid and i.state='preview'
$$;

create function hr_private.require_linked_approval() returns trigger language plpgsql set search_path='' as $$
begin
 if new.state='applied' and old.state is distinct from 'applied' and not exists(
 select 1 from public.fingerprint_source_rows s where s.import_id=new.id and s.employee_id is not null and s.match_state not in ('invalid','ambiguous')
 ) then raise exception 'لا يمكن الاعتماد: صفر موظفين مرتبطين. احفظ الأدلة وراجع الهوية أولاً';end if;
 return new;
end $$;
create trigger require_linked_approval before update of state on public.attendance_imports for each row execute function hr_private.require_linked_approval();
create or replace function public.attendance_write(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.profiles; batch public.attendance_imports; r jsonb; item uuid;
 emp uuid; candidates uuid[]; code_emp uuid; name_emp uuid; match text; issue text;
 row_id uuid; minutes integer[]; existing public.fingerprint_source_rows;
 rev integer; answer jsonb; d date;
begin
 actor=hr_private.require_role(array['ADMIN','HR']);
 perform hr_private.lock_attendance_operation(p_action,p_data);
 if p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'طلب غير صالح';end if;
 if p_action in ('import.apply','import.cancel','issue.resolve') and (nullif(p_data->>'id','') is null or coalesce((p_data->>'version')::integer,0)<1) then raise exception 'الإصدار مطلوب';end if;
 if p_action='import.preview' then
  if p_data->'rows' is null or jsonb_typeof(p_data->'rows')<>'array' or jsonb_array_length(p_data->'rows') not between 1 and 20000 then raise exception 'عدد صفوف الملف غير صالح'; end if;
  if (p_data->>'period_end')::date-(p_data->>'period_start')::date not between 0 and 31 then raise exception 'الفترة غير صالحة';end if;
  -- Serialize duplicate uploads; never replace a previously applied source.
  perform pg_advisory_xact_lock(hashtextextended(p_data->>'source_hash',0));
  select * into batch from public.attendance_imports where source_hash=p_data->>'source_hash'
   and import_kind=p_data->>'import_kind' and period_start=(p_data->>'period_start')::date and period_end=(p_data->>'period_end')::date and state<>'cancelled' order by (state='preview') desc,created_at desc,id desc limit 1;
  if found then
   if batch.device_namespace<>coalesce(nullif(btrim(p_data->>'device_namespace'),''),'legacy-unscoped') then raise exception 'الملف محفوظ ضمن نطاق جهاز آخر؛ راجع مصدره';end if;
   return to_jsonb(batch)||jsonb_build_object('duplicate',true);end if;
  if exists(select 1 from public.attendance_imports where source_hash=p_data->>'source_hash' and device_namespace<>coalesce(nullif(btrim(p_data->>'device_namespace'),''),'legacy-unscoped')) then raise exception 'الملف محفوظ ضمن نطاق جهاز آخر؛ راجع مصدره';end if;
  insert into public.attendance_imports(source_name,source_hash,import_kind,period_start,period_end,device_namespace)
   values(p_data->>'source_name',p_data->>'source_hash',p_data->>'import_kind',(p_data->>'period_start')::date,(p_data->>'period_end')::date,coalesce(nullif(btrim(p_data->>'device_namespace'),''),'legacy-unscoped')) returning * into batch;
  for r in select value from jsonb_array_elements(p_data->'rows') loop
   d=(r->>'calendar_date')::date;
   if d<batch.period_start or d>batch.period_end then raise exception 'تاريخ خارج فترة الملف';end if;
   select coalesce(array_agg(distinct value::integer order by value::integer),'{}') into minutes from jsonb_array_elements_text(r->'punch_minutes');
   if cardinality(minutes)>100 then raise exception 'عدد بصمات غير صالح';end if;
   emp=null; code_emp=null; name_emp=null; issue=null; match='unmatched';
   code_emp=hr_private.safe_fingerprint_match(batch.device_namespace,nullif(btrim(r->>'person_code'),''),r->>'source_name');
   select array_agg(id) into candidates from public.employees where hr_private.fingerprint_name(name)=hr_private.fingerprint_name(r->>'source_name');
   if cardinality(candidates)=1 then name_emp=candidates[1];end if;
   if r->>'invalid'='true' then match='invalid';issue='invalid';
   elsif code_emp is not null then emp=code_emp;match='code';
   elsif exists(select 1 from public.fingerprint_identities f where f.device_namespace=batch.device_namespace and f.person_code=nullif(btrim(r->>'person_code'),'') and f.is_active) then match='ambiguous';issue='code_conflict';
   elsif cardinality(candidates)>1 then match='ambiguous';issue='ambiguous';
   elsif name_emp is not null then match='unmatched';issue='unmatched';
   else issue='unmatched';end if;
   insert into public.fingerprint_source_rows(import_id,source_sheet,source_row,calendar_date,person_code,source_name,raw_values,punch_minutes,employee_id,match_state)
    values(batch.id,r->>'source_sheet',(r->>'source_row')::integer,d,nullif(btrim(r->>'person_code'),''),r->>'source_name',r->'raw_values',minutes,emp,match) returning id into row_id;
   if issue is not null then insert into public.fingerprint_issues(source_row_id,issue_type,details) values(row_id,issue,case issue when 'code_conflict' then 'تعارض رمز الشخص مع الاسم' when 'ambiguous' then 'الاسم يطابق أكثر من موظف' when 'invalid' then 'بصمات غير صالحة' else 'لا يوجد تطابق آمن' end);end if;
  end loop;
  update public.attendance_imports set summary=(select jsonb_build_object('rows',count(*),'matched',count(*) filter(where employee_id is not null),'unmatched',count(*) filter(where match_state='unmatched'),'ambiguous',count(*) filter(where match_state='ambiguous'),'invalid',count(*) filter(where match_state='invalid'),'days',count(distinct calendar_date)) from public.fingerprint_source_rows where import_id=batch.id) where id=batch.id returning * into batch;
  return to_jsonb(batch);
 elsif p_action in ('import.apply','import.cancel') then
  select * into batch from public.attendance_imports where id=(p_data->>'id')::uuid for update;
  if batch.id is null or batch.version<>(p_data->>'version')::integer or batch.state<>'preview' then raise exception 'تم تغيير الاستيراد؛ حدّث الصفحة';end if;
  update public.attendance_imports set state=case when p_action='import.apply' then 'applied' else 'cancelled' end where id=batch.id returning * into batch;
  return to_jsonb(batch);
 elsif p_action='issue.resolve' then
  select s.* into existing from public.fingerprint_source_rows s join public.fingerprint_issues i on i.source_row_id=s.id where i.id=(p_data->>'id')::uuid for update of s;
  if existing.id is null then raise exception 'السجل غير موجود';end if;
  select version into rev from public.fingerprint_issues where id=(p_data->>'id')::uuid for update;
  if rev<>(p_data->>'version')::integer then raise exception 'تم تعديل السجل؛ حدّث الصفحة';end if;
  if length(btrim(coalesce(p_data->>'resolution_note',''))) not between 3 and 2000 then raise exception 'سبب المعالجة مطلوب';end if;
  if p_data->>'state'='resolved' then
   emp=(p_data->>'employee_id')::uuid;
   if emp is null or not exists(select 1 from public.employees where id=emp) then raise exception 'الموظف غير موجود';end if;
   if existing.match_state='invalid' then raise exception 'الصف غير صالح؛ صحح الملف وأعد استيراده';end if;
   perform hr_private.confirm_fingerprint_mapping(existing.id,emp,p_data->>'resolution_note');
   update public.fingerprint_source_rows set employee_id=emp,match_state='confirmed' where id=existing.id;
  elsif p_data->>'state'<>'ignored' then raise exception 'حالة غير صالحة';end if;
  update public.fingerprint_issues set state=p_data->>'state',resolution_note=p_data->>'resolution_note' where id=(p_data->>'id')::uuid returning to_jsonb(fingerprint_issues) into answer;
  return answer;
 elsif p_action='rule.save' then
  perform hr_private.require_role(array['ADMIN']);
  if not exists(select 1 from public.departments where id=(p_data->>'department_id')::uuid and is_active) then raise exception 'القسم غير صالح';end if;
  if (p_data->>'start_minute')::integer not between (p_data->>'entry_window_start')::integer and (p_data->>'entry_window_end')::integer then raise exception 'بداية الدوام خارج نافذة الدخول';end if;
  item=nullif(p_data->>'id','')::uuid;
  if item is null then
   insert into public.attendance_department_rules(department_id,effective_from,start_minute,grace_minutes,entry_window_start,entry_window_end,working_weekdays,default_manager_id)
   values((p_data->>'department_id')::uuid,(p_data->>'effective_from')::date,(p_data->>'start_minute')::integer,(p_data->>'grace_minutes')::integer,(p_data->>'entry_window_start')::integer,(p_data->>'entry_window_end')::integer,array(select value::integer from jsonb_array_elements_text(p_data->'working_weekdays')),nullif(p_data->>'default_manager_id','')::uuid) returning to_jsonb(attendance_department_rules) into answer;
  else
   update public.attendance_department_rules set start_minute=(p_data->>'start_minute')::integer,grace_minutes=(p_data->>'grace_minutes')::integer,entry_window_start=(p_data->>'entry_window_start')::integer,entry_window_end=(p_data->>'entry_window_end')::integer,working_weekdays=array(select value::integer from jsonb_array_elements_text(p_data->'working_weekdays')),default_manager_id=nullif(p_data->>'default_manager_id','')::uuid
    where id=item and version=(p_data->>'version')::integer and department_id=(p_data->>'department_id')::uuid and effective_from=(p_data->>'effective_from')::date returning to_jsonb(attendance_department_rules) into answer;
   if answer is null then raise exception 'تم تعديل الإعداد؛ حدّث الصفحة';end if;
  end if;
  return answer;
 elsif p_action='note.save' then
  item=nullif(p_data->>'id','')::uuid;
  if item is null then
   insert into public.attendance_daily_notes(employee_id,work_date,notes,procedure_text) values((p_data->>'employee_id')::uuid,(p_data->>'work_date')::date,coalesce(p_data->>'notes',''),coalesce(p_data->>'procedure_text','')) returning to_jsonb(attendance_daily_notes) into answer;
  else
   update public.attendance_daily_notes set notes=coalesce(p_data->>'notes',''),procedure_text=coalesce(p_data->>'procedure_text','') where id=item and version=(p_data->>'version')::integer and employee_id=(p_data->>'employee_id')::uuid and work_date=(p_data->>'work_date')::date returning to_jsonb(attendance_daily_notes) into answer;
   if answer is null then raise exception 'تم تعديل الملاحظة؛ حدّث الصفحة';end if;
  end if;
  return answer;
 end if;
 raise exception 'طلب غير صالح';
end $$;
create or replace function hr_private.identity_issues(source_id uuid)
returns table(issue_id uuid,issue_version integer,source_row_id uuid,source_version integer,calendar_date date)
language sql stable set search_path='' as $$
 select f.id,f.version,s.id,s.version,s.calendar_date
 from public.fingerprint_source_rows base
 join public.attendance_imports b on b.id=base.import_id and b.state='preview'
 left join public.attendance_import_reviews r on r.import_id=b.id
 join public.fingerprint_source_rows s on s.import_id=base.import_id
  and s.person_code=base.person_code
  and hr_private.fingerprint_name(s.source_name)=hr_private.fingerprint_name(base.source_name)
 join public.fingerprint_issues f on f.source_row_id=s.id
 where (b.import_kind='daily' or r.lifecycle_state='preview') and base.id=source_id and nullif(btrim(base.person_code),'') is not null
  and f.state='open' and f.issue_type in ('unmatched','ambiguous','code_conflict')
  and s.match_state in ('unmatched','ambiguous')
$$;
create or replace function public.attendance_identity_resolve(p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.fingerprint_source_rows; b public.attendance_imports; f public.fingerprint_issues;
 target uuid=nullif(p_data->>'employee_id','')::uuid; note text=btrim(p_data->>'resolution_note');
 token text; issue_ids uuid[]; source_ids uuid[]; n integer;
begin
 perform hr_private.require_role(array['ADMIN','HR']);
 perform hr_private.lock_attendance_operation('identity.resolve',p_data);
 if target is null or coalesce(length(note),0) not between 1 and 2000
  or coalesce(p_data->>'group_token','') !~ '^[a-f0-9]{32}$' then raise exception 'اختر الموظف واكتب سبب الربط ثم حدّث المعاينة';end if;
 select x.* into s from public.fingerprint_source_rows x join public.fingerprint_issues y on y.source_row_id=x.id where y.id=(p_data->>'id')::uuid;
 if s.id is null then raise exception 'المشكلة غير موجودة';end if;
 -- Same serialization boundary as review/approval. No cross-import propagation.
 select * into b from public.attendance_imports where id=s.import_id for update;
 perform 1 from public.attendance_import_reviews where import_id=b.id for update;
 if b.state<>'preview' or (b.import_kind='monthly' and not exists(
  select 1 from public.attendance_import_reviews where import_id=b.id and lifecycle_state='preview'
 )) then raise exception 'الربط الجماعي متاح للمعاينة المفتوحة قبل إنهاء المراجعة فقط';end if;
 perform 1 from public.fingerprint_source_rows x
  where x.import_id=s.import_id and x.person_code=s.person_code
   and hr_private.fingerprint_name(x.source_name)=hr_private.fingerprint_name(s.source_name)
  order by x.id for update;
 perform 1 from public.fingerprint_issues x join hr_private.identity_issues(s.id) g on g.issue_id=x.id
  order by x.id for update of x;
 select * into f from public.fingerprint_issues where id=(p_data->>'id')::uuid;
 if f.state<>'open' or f.version is distinct from (p_data->>'version')::integer then raise exception 'تم تعديل المشكلة؛ حدّث الصفحة';end if;
 select array_agg(g.issue_id),array_agg(g.source_row_id),count(*)::integer,
  md5(string_agg(g.issue_id::text||':'||g.issue_version||':'||g.source_version,',' order by g.issue_id))
 into issue_ids,source_ids,n,token from hr_private.identity_issues(s.id) g;
 if n=0 or token is distinct from p_data->>'group_token' then raise exception 'تغيرت الأيام المرتبطة؛ حدّث المعاينة قبل التأكيد';end if;
 if not exists(select 1 from public.employees where id=target) then raise exception 'الموظف غير موجود';end if;
 if exists(select 1 from public.fingerprint_source_rows x where x.import_id=s.import_id and x.person_code=s.person_code
  and hr_private.fingerprint_name(x.source_name)=hr_private.fingerprint_name(s.source_name)
  and x.employee_id is not null and x.employee_id<>target) then raise exception 'بعض أيام الهوية مرتبطة بموظف آخر؛ راجع التعارض منفرداً';end if;
 perform hr_private.confirm_fingerprint_mapping(s.id,target,note);
 update public.fingerprint_source_rows set employee_id=target,match_state='confirmed' where id=any(source_ids);
 update public.fingerprint_issues set state='resolved',resolution_note=note where id=any(issue_ids);
 update public.attendance_imports i set summary=(
  select jsonb_build_object('rows',count(*),'matched',count(*) filter(where x.employee_id is not null),
   'unmatched',count(*) filter(where x.match_state='unmatched'),'ambiguous',count(*) filter(where x.match_state='ambiguous'),
   'invalid',count(*) filter(where x.match_state='invalid'),'days',count(distinct x.calendar_date))
  from public.fingerprint_source_rows x where x.import_id=b.id) where i.id=b.id;
 return jsonb_build_object('import_id',b.id,'resolved_issues',n,'lifecycle_state','preview');
end $$;
create or replace function public.attendance_daily_evidence(p_filters jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare day date=coalesce(nullif(p_filters->>'date','')::date,(now() at time zone 'Asia/Baghdad')::date); answer jsonb;
begin
 perform hr_private.require_role(array['ADMIN','HR','VIEWER']);
 with sources as materialized (
  select s.*,i.source_name import_name,i.coverage_confirmed,hr_private.verified_source_identity(s.employee_id,s.match_state,i.device_namespace,s.person_code,s.source_name) identity_verified from public.fingerprint_source_rows s join public.attendance_imports i on i.id=s.import_id
  where i.import_kind='daily' and i.state='applied' and s.calendar_date=day
 ), population as materialized (
  select e.* from hr_private.employee_view e where e.employment_status='active'
   or exists(select 1 from sources s where s.employee_id=e.id)
   or exists(select 1 from public.hr_status_records h where h.employee_id=e.id and h.record_date=day and h.deleted_at is null)
   or exists(select 1 from public.employee_assignment_history a where a.employee_id=e.id and a.voided_at is null and a.employment_status='active' and day>=a.valid_from and (a.valid_to is null or day<=a.valid_to))
 ) select jsonb_build_object('date',day,'as_of',(now() at time zone 'Asia/Baghdad')::date,'as_of_minute',extract(hour from now() at time zone 'Asia/Baghdad')::integer*60+extract(minute from now() at time zone 'Asia/Baghdad')::integer,
  'employees',(select coalesce(jsonb_agg(e order by display_order,name,id),'[]') from population e),
  'sources',(select coalesce(jsonb_agg(s),'[]') from sources s),
  'contexts',(select coalesce(jsonb_object_agg(i.id::text,i.calculation_context) filter(where i.calculation_context is not null),'{}') from public.attendance_imports i where i.import_kind='daily' and i.state='applied' and day between i.period_start and i.period_end),
  'imports',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'source_name',i.source_name,'state',i.state,'linked_rows',(select count(*) from public.fingerprint_source_rows s where s.import_id=i.id and s.employee_id is not null),'unlinked_rows',(select count(*) from public.fingerprint_source_rows s where s.import_id=i.id and s.employee_id is null))),'[]') from public.attendance_imports i where i.import_kind='daily' and i.state='applied' and day between i.period_start and i.period_end),
  'managers',(select coalesce(jsonb_agg(m),'[]') from public.managers m),
  'rules',(select coalesce(jsonb_agg(r),'[]') from public.attendance_department_rules r where effective_from<=day+1),
  'manual_records',(select coalesce(jsonb_agg(h),'[]') from public.hr_status_records h where h.record_date=day and h.deleted_at is null),
  'notes',(select coalesce(jsonb_agg(n),'[]') from public.attendance_daily_notes n where n.work_date=day),
  'issues',(select coalesce(jsonb_agg(f),'[]') from public.fingerprint_issues f join sources s on s.id=f.source_row_id)) into answer;
 return hr_private.with_assignment_evidence(answer);
end $$;
create or replace function public.hr_write(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles; e public.employees; r public.hr_status_records; result jsonb; item_id uuid; d uuid; s uuid; m uuid; existing uuid; rev integer; t text; active_value boolean;
begin
 actor=hr_private.require_role(array['ADMIN','HR']);
 item_id=nullif(p_data->>'id','')::uuid;rev=(p_data->>'version')::integer;
 if p_action='employee.save' then
  d=(p_data->>'department_id')::uuid;s=nullif(p_data->>'shift_id','')::uuid;m=nullif(p_data->>'direct_manager_id','')::uuid;
  perform 1 from public.departments where id=d and is_active for share;if not found then raise exception 'القسم غير معتمد أو غير نشط';end if;
  if s is not null then perform 1 from public.shifts where id=s and is_active for share;if not found then raise exception 'الشفت غير معتمد أو غير نشط';end if;end if;
  if m is not null then perform 1 from public.managers where id=m and is_active and (employee_id is null or employee_id is distinct from item_id) for share;if not found then raise exception 'المسؤول المباشر غير صالح';end if;end if;
  if item_id is null then
   insert into public.employees(name,employee_number,department_id,shift_id,direct_manager_id,employment_status,phone,emergency_phone,education)
   values(btrim(p_data->>'name'),nullif(btrim(p_data->>'employee_number'),''),d,s,m,p_data->>'employment_status',nullif(btrim(p_data->>'phone'),''),nullif(btrim(p_data->>'emergency_phone'),''),nullif(btrim(p_data->>'education'),'')) returning * into e;
  else
   update public.employees set name=btrim(p_data->>'name'),employee_number=nullif(btrim(p_data->>'employee_number'),''),department_id=d,shift_id=s,direct_manager_id=m,employment_status=p_data->>'employment_status',phone=case when p_data?'phone' then nullif(btrim(p_data->>'phone'),'') else phone end,emergency_phone=case when p_data?'emergency_phone' then nullif(btrim(p_data->>'emergency_phone'),'') else emergency_phone end,education=case when p_data?'education' then nullif(btrim(p_data->>'education'),'') else education end where id=item_id and version=rev returning * into e;
   if not found then raise exception using errcode='40001',message='تم تعديل السجل بواسطة مستخدم آخر. أعد تحميله';end if;
  end if;return to_jsonb(e);
 elsif p_action='status.save' then
  select * into e from public.employees where id=(p_data->>'employee_id')::uuid for share;
  if e.id is null then raise exception 'الموظف غير موجود';end if;
  if not exists(select 1 from public.employee_assignment_history h where h.employee_id=e.id and h.voided_at is null and (p_data->>'record_date')::date>=h.valid_from and (h.valid_to is null or (p_data->>'record_date')::date<=h.valid_to) and h.department_id=(p_data->>'department_id')::uuid)
   and not (e.department_id=(p_data->>'department_id')::uuid and not exists(select 1 from public.employee_assignment_history h where h.employee_id=e.id and h.voided_at is null and (p_data->>'record_date')::date>=h.valid_from and (h.valid_to is null or (p_data->>'record_date')::date<=h.valid_to))) then raise exception 'هذا الموظف تابع لقسم مختلف في تاريخ السجل';end if;
  if item_id is null and e.employment_status<>'active' and not exists(select 1 from public.employee_assignment_history h where h.employee_id=e.id and h.voided_at is null and h.employment_status='active' and (p_data->>'record_date')::date>=h.valid_from and (h.valid_to is null or (p_data->>'record_date')::date<=h.valid_to)) then raise exception 'الموظف غير نشط';end if;
  if item_id is not null then
   select * into r from public.hr_status_records where id=item_id and deleted_at is null for update;
   if r.id is null or r.version is distinct from rev then raise exception using errcode='40001',message='تم تعديل السجل بواسطة مستخدم آخر. أعد تحميله';end if;
   if r.employee_id<>e.id then raise exception 'لا يمكن تغيير هوية الموظف في سجل سابق';end if;
  end if;
  select id into existing from public.hr_status_records where employee_id=e.id and record_date=(p_data->>'record_date')::date and deleted_at is null and id is distinct from item_id;
  if existing is not null then return jsonb_build_object('conflict',true,'record',(select to_jsonb(v) from hr_private.record_view v where id=existing));end if;
  if p_data->>'status_type'<>'late' and coalesce((p_data->>'late_minutes')::numeric,0)<>0 then raise exception 'دقائق موجودة لكن الحالة ليست تأخير';end if;
  if p_data->>'status_type'='late' and ((p_data->>'late_minutes') is null or (p_data->>'late_minutes')::numeric<>trunc((p_data->>'late_minutes')::numeric)) then raise exception 'دقائق التأخير يجب أن تكون عدداً صحيحاً';end if;
  if item_id is null then
   insert into public.hr_status_records(employee_id,record_date,status_type,late_minutes,notes)
   values(e.id,(p_data->>'record_date')::date,p_data->>'status_type',case when p_data->>'status_type'='late' then (p_data->>'late_minutes')::integer end,nullif(btrim(p_data->>'notes'),'')) returning * into r;
  else
   update public.hr_status_records set record_date=(p_data->>'record_date')::date,status_type=p_data->>'status_type',late_minutes=case when p_data->>'status_type'='late' then (p_data->>'late_minutes')::integer end,notes=nullif(btrim(p_data->>'notes'),'') where id=item_id returning * into r;
  end if;return to_jsonb(r);
 elsif p_action='status.delete' then
  if coalesce((p_data->>'confirmed')::boolean,false) is not true then raise exception 'تأكيد الحذف مطلوب';end if;
  update public.hr_status_records set deleted_at=now() where id=item_id and version=rev and deleted_at is null returning * into r;
  if not found then raise exception using errcode='40001',message='تم تعديل السجل بواسطة مستخدم آخر. أعد تحميله';end if;return jsonb_build_object('ok',true);
 end if;
 perform hr_private.require_role(array['ADMIN']);
 if p_action='department.save' then
  active_value=coalesce((p_data->>'is_active')::boolean,true);
  if item_id is not null then
   perform 1 from public.departments where id=item_id for update;
   if not active_value and exists(select 1 from public.employees where department_id=item_id and employment_status='active') then raise exception 'القسم مرتبط بموظفين نشطين';end if;
   update public.departments set arabic_name=btrim(p_data->>'arabic_name'),english_name=btrim(p_data->>'english_name'),display_order=(p_data->>'display_order')::integer,is_active=active_value where id=item_id and version=rev returning to_jsonb(departments.*) into result;
  else insert into public.departments(arabic_name,english_name,display_order,is_active) values(btrim(p_data->>'arabic_name'),btrim(p_data->>'english_name'),(p_data->>'display_order')::integer,active_value) returning to_jsonb(departments.*) into result;end if;
 elsif p_action in ('shift.save','manager.save') then
  t=case when p_action='shift.save' then 'shifts' else 'managers' end;active_value=coalesce((p_data->>'is_active')::boolean,true);
  if item_id is not null then
   execute format('select 1 from public.%I where id=$1 for update',t) using item_id;
   if not active_value and exists(select 1 from public.employees where employment_status='active' and ((t='shifts' and shift_id=item_id) or(t='managers' and direct_manager_id=item_id))) then raise exception 'مرتبط بموظفين نشطين';end if;
   if t='shifts' then update public.shifts set name=btrim(p_data->>'name'),is_active=active_value where id=item_id and version=rev returning to_jsonb(shifts.*) into result;
   else update public.managers set name=btrim(p_data->>'name'),is_active=active_value,employee_id=nullif(p_data->>'employee_id','')::uuid where id=item_id and version=rev returning to_jsonb(managers.*) into result;end if;
  else
   if t='shifts' then insert into public.shifts(name,is_active) values(btrim(p_data->>'name'),active_value) returning to_jsonb(shifts.*) into result;
   else insert into public.managers(name,is_active,employee_id) values(btrim(p_data->>'name'),active_value,nullif(p_data->>'employee_id','')::uuid) returning to_jsonb(managers.*) into result;end if;
  end if;
 elsif p_action='user.save' then
  perform pg_advisory_xact_lock(9042026);
  if (p_data->>'role'<>'ADMIN' or (p_data->>'is_active')::boolean=false) and exists(select 1 from public.profiles where id=item_id and role='ADMIN' and is_active) and (select count(*) from public.profiles where role='ADMIN' and is_active)<=1 then raise exception 'لا يمكن تعطيل آخر مدير للنظام';end if;
  update public.profiles set name=btrim(p_data->>'name'),role=p_data->>'role',is_active=(p_data->>'is_active')::boolean where id=item_id and version=rev returning to_jsonb(profiles.*) into result;
 elsif p_action='app.save' then
  update public.app_settings set value=btrim(p_data->>'name') where key='app_name' and version=rev returning to_jsonb(app_settings.*) into result;
 else raise exception 'طلب غير صالح';end if;
 if result is null then raise exception using errcode='40001',message='تم تعديل السجل بواسطة مستخدم آخر. أعد تحميله';end if;
 return result;
exception when unique_violation then
 if p_action='employee.save' then raise exception 'رقم الموظف مستخدم مسبقاً';
 elsif p_action='status.save' then raise exception 'توجد حالة مسجلة لهذا الموظف بهذا التاريخ';
 else raise exception 'القيمة مستخدمة مسبقاً';end if;
end $$;

create or replace view hr_private.record_view_v2 as
select r.*,e.name employee_name,e.employee_number,
 case when h.id is null then e.department else d.arabic_name||' ('||d.english_name||')' end department,
 coalesce(h.department_id,e.department_id) department_id,coalesce(h.shift_id,e.shift_id) shift_id,
 case when h.id is null then e.shift else sh.name end shift,
 case when h.id is null then e.direct_manager_id else h.direct_manager_id end direct_manager_id,
 case when h.id is null then e.manager else m.name end manager,
 cp.name created_by_name,up.name updated_by_name,e.internal_code
from public.hr_status_records r join hr_private.employee_view e on e.id=r.employee_id
left join lateral (select a.* from public.employee_assignment_history a where a.employee_id=e.id and a.voided_at is null and r.record_date>=a.valid_from and (a.valid_to is null or r.record_date<=a.valid_to) order by a.valid_from desc limit 1) h on true
left join public.departments d on d.id=h.department_id left join public.shifts sh on sh.id=h.shift_id
left join public.managers m on m.id=h.direct_manager_id left join public.profiles cp on cp.id=r.created_by left join public.profiles up on up.id=r.updated_by;

create or replace view hr_private.administrative_action_view as
select a.*,t.arabic_name action_type,e.name employee_name,e.employee_number,
 case when h.id is null then e.department else d.arabic_name||' ('||d.english_name||')' end department,
 coalesce(h.department_id,e.department_id) department_id,coalesce(h.shift_id,e.shift_id) shift_id,
 case when h.id is null then e.shift else sh.name end shift,
 case when h.id is null then e.direct_manager_id else h.direct_manager_id end direct_manager_id,
 case when h.id is null then e.manager else m.name end manager,cp.name created_by_name,up.name updated_by_name,e.internal_code
from public.administrative_actions a join public.administrative_action_types t on t.id=a.action_type_id join hr_private.employee_view e on e.id=a.employee_id
left join lateral (select x.* from public.employee_assignment_history x where x.employee_id=e.id and x.voided_at is null and a.action_date>=x.valid_from and (x.valid_to is null or a.action_date<=x.valid_to) order by x.valid_from desc limit 1) h on true
left join public.departments d on d.id=h.department_id left join public.shifts sh on sh.id=h.shift_id left join public.managers m on m.id=h.direct_manager_id
left join public.profiles cp on cp.id=a.created_by left join public.profiles up on up.id=a.updated_by;
create or replace function public.hr_read_v2(p_kind text, p_filters jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p public.profiles;
  result jsonb;
  base jsonb;
  from_day date;
  to_day date;
  today date = (now() at time zone 'Asia/Baghdad')::date;
  pg integer;
  dep uuid;
  sh uuid;
  v_manager uuid;
  emp uuid;
  action_type_filter uuid;
  term text;
begin
  p = hr_private.require_role(array['ADMIN','HR','VIEWER']);
  pg = greatest(0, least(coalesce((p_filters->>'page')::integer, 1) - 1, 100000));
  dep = nullif(p_filters->>'department_id', '')::uuid;
  sh = nullif(p_filters->>'shift_id', '')::uuid;
  v_manager = nullif(p_filters->>'manager_id', '')::uuid;
  emp = nullif(p_filters->>'employee_id', '')::uuid;
  action_type_filter = nullif(p_filters->>'action_type_id', '')::uuid;
  term = btrim(coalesce(p_filters->>'search', ''));
  if p_filters ? 'month' then
    if (p_filters->>'month') !~ '^\d{4}-(0[1-9]|1[012])$' then raise exception 'الشهر غير صالح'; end if;
    from_day = ((p_filters->>'month') || '-01')::date;
  else
    from_day = date_trunc('month', today)::date;
  end if;
  to_day = (from_day + interval '1 month')::date;

  if p_kind in ('reference','settings') then
    base = public.hr_read(p_kind, p_filters);
    return base || jsonb_build_object(
      'action_types', (select coalesce(jsonb_agg(t order by display_order, arabic_name), '[]') from public.administrative_action_types t)
    );
  elsif p_kind = 'dashboard' then
    return jsonb_build_object(
      'active', (select count(*) from public.employees where employment_status = 'active'),
      'absence', (select count(*) from public.hr_status_records where record_date = today and status_type in ('absence','absence2','absence3') and deleted_at is null),
      'leave', (select count(*) from public.hr_status_records where record_date = today and status_type = 'leave' and deleted_at is null),
      'late', (select count(*) from public.hr_status_records where record_date = today and status_type = 'late' and deleted_at is null),
      'late_minutes', (select coalesce(sum(late_minutes),0) from public.hr_status_records where record_date = today and status_type = 'late' and deleted_at is null),
      'actions_month', (select count(*) from public.administrative_actions where action_date >= from_day and action_date < to_day and state <> 'cancelled' and deleted_at is null),
      'review', (select count(*) from hr_private.review_view),
      'today', today,
      'recent', (select coalesce(jsonb_agg(x), '[]') from (select * from hr_private.record_view_v2 where deleted_at is null order by updated_at desc limit 8) x),
      'recent_actions', (select coalesce(jsonb_agg(x), '[]') from (select * from hr_private.administrative_action_view where deleted_at is null order by updated_at desc limit 6) x),
      'top_late', (select coalesce(jsonb_agg(x), '[]') from (
        select e.id employee_id, e.name employee_name, e.department, count(r.id) occurrences, coalesce(sum(r.late_minutes),0) minutes
        from public.hr_status_records r join hr_private.employee_view e on e.id = r.employee_id
        where r.deleted_at is null and r.status_type = 'late' and r.record_date >= from_day and r.record_date < to_day
        group by e.id, e.name, e.department order by minutes desc, occurrences desc, e.name limit 6
      ) x),
      'departments', (select coalesce(jsonb_agg(x order by display_order), '[]') from (
        select d.id, d.arabic_name || ' (' || d.english_name || ')' name, d.display_order, count(e.id) count
        from public.departments d left join public.employees e on e.department_id = d.id and e.employment_status = 'active'
        group by d.id
      ) x)
    );
  elsif p_kind = 'report' then
    with selected as (
      select e.* from hr_private.employee_view e where
        (employment_status = 'active' or p_filters->>'include_inactive' = 'true' or exists(select 1 from public.hr_status_records h where h.employee_id=e.id and h.deleted_at is null and h.record_date>=from_day and h.record_date<to_day))
        and (dep is null or exists(select 1 from public.employee_assignment_history h where h.employee_id=e.id and h.voided_at is null and h.department_id=dep and h.valid_from<to_day and (h.valid_to is null or h.valid_to>=from_day)) or exists(select 1 from hr_private.record_view_v2 h where h.employee_id=e.id and h.record_date>=from_day and h.record_date<to_day and h.department_id=dep))
        and (sh is null or shift_id = sh)
        and (v_manager is null or direct_manager_id = v_manager)
        and (emp is null or id = emp)
        and (term = '' or position(lower(term) in lower(name)) > 0 or position(lower(term) in lower(coalesce(employee_number,''))) > 0 or position(lower(term) in lower(e.internal_code))>0)
    ), counted as (
      select e.id,
        count(r.id) filter(where r.status_type='absence') absence,
        count(r.id) filter(where r.status_type='absence2') absence2,
        count(r.id) filter(where r.status_type='absence3') absence3,
        count(r.id) filter(where r.status_type='leave') leave,
        count(r.id) filter(where r.status_type='late') late,
        coalesce(sum(r.late_minutes),0) late_minutes,
        coalesce(sum(case r.status_type when 'absence' then 1 when 'absence2' then 2 when 'absence3' then 3 else 0 end),0) weighted,
        coalesce(jsonb_object_agg(extract(day from r.record_date)::integer::text,r.status_type) filter(where r.id is not null),'{}') cells
      from selected e left join public.hr_status_records r on r.employee_id=e.id and r.deleted_at is null and r.record_date>=from_day and r.record_date<to_day
      group by e.id
    ), action_counted as (
      select e.id, count(a.id) administrative_actions
      from selected e left join public.administrative_actions a on a.employee_id=e.id and a.deleted_at is null and a.state<>'cancelled' and a.action_date>=from_day and a.action_date<to_day
      group by e.id
    ), full_rows as (
      select (to_jsonb(e)||coalesce((select jsonb_build_object('department_id',h.department_id,'department',d.arabic_name||' ('||d.english_name||')','shift_id',h.shift_id,'direct_manager_id',h.direct_manager_id) from public.employee_assignment_history h join public.departments d on d.id=h.department_id where h.employee_id=e.id and h.voided_at is null and h.valid_from<to_day and (h.valid_to is null or h.valid_to>=from_day) and (dep is null or h.department_id=dep) order by h.valid_from desc limit 1),'{}'::jsonb)) display_employee,e.*, c.absence, c.absence2, c.absence3, c.leave, c.late, c.late_minutes, c.weighted, c.cells, a.administrative_actions
      from selected e join counted c using(id) join action_counted a using(id)
    )
    select jsonb_build_object(
      'month', to_char(from_day,'YYYY-MM'),
      'rows', coalesce(jsonb_agg((to_jsonb(f)-'display_employee')||f.display_employee order by display_order,name,id),'[]'),
      'totals', jsonb_build_object(
        'absence',coalesce(sum(absence),0),'absence2',coalesce(sum(absence2),0),'absence3',coalesce(sum(absence3),0),
        'leave',coalesce(sum(leave),0),'late',coalesce(sum(late),0),'late_minutes',coalesce(sum(late_minutes),0),
        'weighted',coalesce(sum(weighted),0),'administrative_actions',coalesce(sum(administrative_actions),0)
      )
    ) into result from full_rows f;
    return result;
  elsif p_kind = 'lateness' then
    with filtered as (
      select * from hr_private.record_view_v2 r where r.deleted_at is null and r.status_type='late'
        and r.record_date>=from_day and r.record_date<to_day
        and (dep is null or r.department_id=dep) and (sh is null or r.shift_id=sh)
        and (v_manager is null or r.direct_manager_id=v_manager) and (emp is null or r.employee_id=emp)
        and (not(p_filters?'min_minutes') or r.late_minutes >= (p_filters->>'min_minutes')::integer)
        and (not(p_filters?'max_minutes') or r.late_minutes <= (p_filters->>'max_minutes')::integer)
        and (term='' or position(lower(term) in lower(r.employee_name))>0 or position(lower(term) in lower(coalesce(r.employee_number,'')))>0 or position(lower(term) in lower(r.internal_code))>0)
    ), page as (select * from filtered order by record_date desc, updated_at desc offset case when p_filters->>'export_all'='true' then 0 else pg*50 end limit case when p_filters->>'export_all'='true' then 100000 else 50 end),
    by_employee as (
      select employee_id,max(internal_code) internal_code,max(employee_name) employee_name,max(employee_number) employee_number,(array_agg(department order by record_date desc,updated_at desc,id desc))[1] department,count(*) occurrences,
             sum(late_minutes) total_minutes, round(avg(late_minutes),1) average_minutes,
             max(late_minutes) highest_minutes, max(record_date) last_late
      from filtered group by employee_id
      order by total_minutes desc, occurrences desc, employee_name
    )
    select jsonb_build_object(
      'rows',(select coalesce(jsonb_agg(page),'[]') from page),
      'total',(select count(*) from filtered),
      'kpis',(select jsonb_build_object('occurrences',count(*),'minutes',coalesce(sum(late_minutes),0),'average',coalesce(round(avg(late_minutes),1),0),'highest',coalesce(max(late_minutes),0),'employees',count(distinct employee_id)) from filtered),
      'summary',(select coalesce(jsonb_agg(by_employee),'[]') from by_employee)
    ) into result;
    return result;
  elsif p_kind = 'absence_leave' then
    with filtered as (
      select * from hr_private.record_view_v2 r where r.deleted_at is null and r.status_type in ('absence','absence2','absence3','leave') and (coalesce(p_filters->>'status_group','')<>'absence' or r.status_type in ('absence','absence2','absence3'))
        and r.record_date>=from_day and r.record_date<to_day
        and (dep is null or r.department_id=dep) and (emp is null or r.employee_id=emp)
        and (not(p_filters?'status_type') or p_filters->>'status_type'='' or r.status_type=p_filters->>'status_type')
        and (term='' or position(lower(term) in lower(r.employee_name))>0 or position(lower(term) in lower(coalesce(r.employee_number,'')))>0 or position(lower(term) in lower(r.internal_code))>0)
    ), page as (select * from filtered order by record_date desc, updated_at desc offset case when p_filters->>'export_all'='true' then 0 else pg*50 end limit case when p_filters->>'export_all'='true' then 100000 else 50 end)
    select jsonb_build_object(
      'rows',(select coalesce(jsonb_agg(page),'[]') from page),
      'total',(select count(*) from filtered),
      'kpis',(select jsonb_build_object(
        'absence',count(*) filter(where status_type='absence'),
        'absence2',count(*) filter(where status_type='absence2'),
        'absence3',count(*) filter(where status_type='absence3'),
        'leave',count(*) filter(where status_type='leave'),
        'weighted',coalesce(sum(case status_type when 'absence' then 1 when 'absence2' then 2 when 'absence3' then 3 else 0 end),0)
      ) from filtered)
    ) into result;
    return result;
  elsif p_kind in ('administrative_actions','employee_actions') then
    with filtered as (
      select * from hr_private.administrative_action_view a where a.deleted_at is null
        and a.action_date>=from_day and a.action_date<to_day
        and (dep is null or a.department_id=dep) and (emp is null or a.employee_id=emp)
        and (action_type_filter is null or a.action_type_id=action_type_filter)
        and (not(p_filters?'state') or p_filters->>'state'='' or a.state=p_filters->>'state')
        and (term='' or position(lower(term) in lower(a.employee_name))>0 or position(lower(term) in lower(coalesce(a.employee_number,'')))>0 or position(lower(term) in lower(a.reason))>0 or position(lower(term) in lower(a.internal_code))>0)
    ), page as (select * from filtered order by action_date desc, updated_at desc offset case when p_filters->>'export_all'='true' then 0 else pg*50 end limit case when p_filters->>'export_all'='true' then 100000 else 50 end)
    select jsonb_build_object('rows',(select coalesce(jsonb_agg(page),'[]') from page),'total',(select count(*) from filtered)) into result;
    return result;
  elsif p_kind = 'administrative_action' then
    select to_jsonb(a) into result from hr_private.administrative_action_view a where a.id=(p_filters->>'id')::uuid and a.deleted_at is null;
    if result is null then raise exception 'الإجراء الإداري غير موجود'; end if;
    return result;
  elsif p_kind = 'employee_audit' then
    if p.role <> 'ADMIN' then raise exception using errcode='42501', message='ليست لديك صلاحية لهذه العملية'; end if;
    with filtered as (
      select * from public.audit_logs where entity_id=emp or new_values->>'employee_id'=emp::text or old_values->>'employee_id'=emp::text
    ), page as (select * from filtered order by created_at desc offset case when p_filters->>'export_all'='true' then 0 else pg*50 end limit case when p_filters->>'export_all'='true' then 100000 else 50 end)
    select jsonb_build_object('rows',(select coalesce(jsonb_agg(page),'[]') from page),'total',(select count(*) from filtered)) into result;
    return result;
  elsif p_kind = 'employee_report' then
    select jsonb_build_object(
      'employee', (select to_jsonb(e) from hr_private.employee_view e where e.id=emp),
      'report', public.hr_read_v2('report', p_filters),
      'records', (select coalesce(jsonb_agg(r order by record_date desc),'[]') from hr_private.record_view_v2 r where r.employee_id=emp and r.deleted_at is null and r.record_date>=from_day and r.record_date<to_day),
      'actions', (select coalesce(jsonb_agg(a order by action_date desc),'[]') from hr_private.administrative_action_view a where a.employee_id=emp and a.deleted_at is null and a.action_date>=from_day and a.action_date<to_day)
    ) into result;
    return result;
  end if;
  return public.hr_read(p_kind, p_filters);
end $$;
create or replace function public.attendance_reprocess_import(p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.attendance_imports;s public.fingerprint_source_rows;target uuid;n integer=0;actor public.profiles;
begin
 actor=hr_private.require_role(array['ADMIN','HR']);
 select * into b from public.attendance_imports where id=(p_data->>'id')::uuid for update;
 perform 1 from public.attendance_import_reviews where import_id=b.id for update;
 if b.id is null or b.version is distinct from (p_data->>'version')::integer or b.state<>'preview' or (b.import_kind='monthly' and not exists(select 1 from public.attendance_import_reviews where import_id=b.id and lifecycle_state='preview')) then raise exception 'تغير الملف أو أصبح مغلقاً؛ إعادة المعالجة للمعاينة المفتوحة فقط';end if;
 for s in select * from public.fingerprint_source_rows where import_id=b.id and ((employee_id is null and match_state in ('unmatched','ambiguous')) or match_state='unique_name') order by id for update loop
  target=hr_private.safe_fingerprint_match(b.device_namespace,s.person_code,s.source_name);
  if target is null then
   if s.match_state='unique_name' then
    update public.fingerprint_source_rows set employee_id=null,match_state='unmatched' where id=s.id;
    insert into public.fingerprint_issues(source_row_id,issue_type,details)values(s.id,'unmatched','ربط سابق بالاسم وحده؛ يلزم إثبات مستقل للهوية') on conflict do nothing;
   end if;continue;
  end if;
  if exists(select 1 from public.employees e where hr_private.fingerprint_name(e.name)=hr_private.fingerprint_name(s.source_name) and e.id<>target) then continue;end if;
  update public.fingerprint_source_rows set employee_id=target,match_state='code' where id=s.id;
  update public.fingerprint_issues set state='resolved',resolution_note='إعادة معالجة صريحة باستخدام سجل الجهاز المؤكد' where source_row_id=s.id and state='open' and issue_type in ('unmatched','ambiguous','code_conflict');
  n=n+1;
 end loop;
 perform hr_private.refresh_import_summary(b.id);
 insert into public.audit_logs(actor_id,actor_name,action,entity_type,entity_id,description,new_values) values(actor.id,actor.name,'reprocess','attendance_imports',b.id,'إعادة معالجة معاينة مفتوحة في نطاق الجهاز '||b.device_namespace,jsonb_build_object('linked_rows',n));
 return jsonb_build_object('linked_rows',n,'import_id',b.id,'batch',(select to_jsonb(x) from public.attendance_imports x where id=b.id));
end $$;
create or replace function public.attendance_write_v5(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; evidence jsonb; target uuid; c_start date;c_end date;b public.attendance_imports;
begin
 perform hr_private.require_role(array['ADMIN','HR']);
 perform set_config('lock_timeout','5s',true);
 if p_action='import.supersede' and length(btrim(coalesce(p_data->>'reason',''))) not between 3 and 2000 then raise exception 'سبب الاستبدال مطلوب';end if;
 if p_action='import.new_attempt' then return public.attendance_new_attempt(p_data);end if;
 if p_action='import.reopen' then return public.attendance_reopen_import(p_data);end if;
 if p_action='import.reprocess' then return public.attendance_reprocess_import(p_data);end if;
 if p_action='source.save' then
  perform hr_private.require_role(array['ADMIN']);
  if length(btrim(coalesce(p_data->>'namespace',''))) not between 1 and 100 or length(btrim(coalesce(p_data->>'label',''))) not between 1 and 150 or length(btrim(coalesce(p_data->>'confirmation_reason',''))) not between 3 and 2000 then raise exception 'وثق نطاق الجهاز واسمه ومصدر تعريفه';end if;
  if nullif(p_data->>'id','') is not null then
   update public.attendance_device_sources set label=btrim(p_data->>'label'),confirmation_reason=btrim(p_data->>'confirmation_reason')
    where id=(p_data->>'id')::uuid and version=(p_data->>'version')::integer and namespace=btrim(p_data->>'namespace') returning to_jsonb(attendance_device_sources) into result;
   if result is null then raise exception 'تغير تعريف المصدر؛ أعد تحميله. لا يمكن تغيير نطاقه';end if;return result;
  end if;
  insert into public.attendance_device_sources(namespace,label,confirmation_reason) values(btrim(p_data->>'namespace'),btrim(p_data->>'label'),btrim(p_data->>'confirmation_reason')) returning to_jsonb(attendance_device_sources) into result;return result;
 end if;
 if p_action='import.preview' and p_data->>'import_kind'='monthly' then
  c_start=nullif(p_data->>'coverage_start','')::date;c_end=nullif(p_data->>'coverage_end','')::date;
  if c_start is null or c_end is null or c_start<(p_data->>'period_start')::date or c_end>(p_data->>'period_end')::date or c_end<c_start then raise exception 'حدد نطاق التغطية داخل فترة الملف';end if;
  result=public.attendance_write_v3(p_action,p_data);
  if result->>'duplicate'='true' then return result;end if;
  update public.attendance_imports set coverage_start=c_start,coverage_end=c_end,coverage_confirmed=coalesce((p_data->>'coverage_confirmed')::boolean,false),previous_attempt_id=(select id from public.attendance_imports where source_hash=p_data->>'source_hash' and import_kind='monthly' and state='cancelled' and id<>(result->>'id')::uuid order by created_at desc,id desc limit 1) where id=(result->>'id')::uuid returning * into b;
  return result||to_jsonb(b);
 end if;
 result=public.attendance_write_v3(p_action,p_data);
 if p_action='import.supersede' then
  insert into public.audit_logs(actor_id,actor_name,action,entity_type,entity_id,description,new_values) select id,name,'supersede','attendance_imports',(p_data->>'id')::uuid,'استبدال مصدر شهري: '||(p_data->>'reason'),p_data from public.profiles where id=auth.uid();
 end if;
 if p_action='import.preview' and result->>'duplicate' is distinct from 'true' then
  update public.attendance_imports set previous_attempt_id=(select id from public.attendance_imports where source_hash=p_data->>'source_hash' and import_kind=p_data->>'import_kind' and state='cancelled' and id<>(result->>'id')::uuid order by created_at desc,id desc limit 1),
  coverage_confirmed=coalesce((p_data->>'coverage_confirmed')::boolean,false) where id=(result->>'id')::uuid returning * into b;
  return result||to_jsonb(b);
 end if;
 return result;
end $$;

create or replace function hr_private.audit() returns trigger language plpgsql security definer set search_path='' as $$
declare previous jsonb; next_value jsonb; actor text; verb text; label text;
begin
 if tg_op='UPDATE' then previous=to_jsonb(old);end if; next_value=to_jsonb(new);
 select name into actor from public.profiles where id=auth.uid();
 verb=case when tg_op='INSERT' then 'create' else 'update' end;
 label=case tg_table_name when 'employees' then 'الموظف' when 'hr_status_records' then 'الحالة اليومية' when 'departments' then 'القسم' when 'shifts' then 'الشفت' when 'managers' then 'المسؤول المباشر' when 'profiles' then 'المستخدم' when 'attendance_imports' then 'ملف البصمة' when 'attendance_import_reviews' then 'مراجعة ملف البصمة' when 'fingerprint_identities' then 'هوية جهاز مؤكدة' when 'fingerprint_source_rows' then 'رابط دليل البصمة' when 'fingerprint_issues' then 'مشكلة البصمة' when 'employee_assignment_history' then 'الانتماء التاريخي' when 'attendance_device_sources' then 'مصدر الجهاز' else 'الإعدادات' end;
 if tg_table_name='employees' and tg_op='UPDATE' then
  if previous->>'department_id' is distinct from next_value->>'department_id' then verb='transfer';end if;
  if previous->>'employment_status' is distinct from next_value->>'employment_status' then verb='employment_status';end if;
 end if;
 if tg_table_name='hr_status_records' and tg_op='UPDATE' and previous->>'deleted_at' is null and next_value->>'deleted_at' is not null then verb='soft_delete';end if;
 insert into public.audit_logs(actor_id,actor_name,action,entity_type,entity_id,description,old_values,new_values)
 values(auth.uid(),coalesce(actor,'استيراد النظام'),verb,tg_table_name,new.id,
 case verb when 'create' then 'إضافة ' when 'transfer' then 'نقل ' when 'employment_status' then 'تغيير حالة ' when 'soft_delete' then 'حذف ' else 'تعديل ' end ||label||coalesce(' · '||coalesce(next_value->>'name',next_value->>'source_name',next_value->>'device_namespace'),'')||coalesce(' · '||(next_value->>'state'),'')||coalesce(' · '||(next_value->>'import_kind'),''),previous,next_value);
 return new;
end $$;

revoke all on function hr_private.refresh_import_summary(uuid),hr_private.require_linked_approval() from public,anon,authenticated;
revoke all on function public.attendance_reprocess_import(jsonb) from public,anon,authenticated;
grant execute on function public.attendance_reprocess_import(jsonb) to authenticated;
create or replace function public.hr_read_v3(p_kind text,p_filters jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare from_day date;to_day date;dep uuid=nullif(p_filters->>'department_id','')::uuid;sh uuid=nullif(p_filters->>'shift_id','')::uuid;
 mgr uuid=nullif(p_filters->>'manager_id','')::uuid;emp uuid=nullif(p_filters->>'employee_id','')::uuid;term text=btrim(coalesce(p_filters->>'search',''));result jsonb;
begin
 if p_kind='report' then return public.hr_read_v2(p_kind,p_filters);end if;
 perform hr_private.require_role(array['ADMIN','HR','VIEWER']);
 if p_kind<>'report' then return public.hr_read_v2(p_kind,p_filters);end if;
 if (p_filters->>'month') !~ '^\d{4}-(0[1-9]|1[012])$' then raise exception 'الشهر غير صالح';end if;
 from_day=((p_filters->>'month')||'-01')::date;to_day=(from_day+interval '1 month')::date;
 with selected as (
  select e.* from hr_private.employee_view e where
   (e.employment_status='active' or p_filters->>'include_inactive'='true' or exists(select 1 from public.hr_status_records h where h.employee_id=e.id and h.record_date>=from_day and h.record_date<to_day and h.deleted_at is null))
   and(dep is null or e.department_id=dep) and(sh is null or e.shift_id=sh) and(mgr is null or e.direct_manager_id=mgr) and(emp is null or e.id=emp)
   and(term='' or position(lower(term) in lower(e.name))>0 or position(lower(term) in lower(coalesce(e.employee_number,'')))>0)
 ), counted as (
  select e.id,count(r.id) filter(where r.status_type='absence') absence,count(r.id) filter(where r.status_type='absence2') absence2,
   count(r.id) filter(where r.status_type='absence3') absence3,count(r.id) filter(where r.status_type='leave') leave,count(r.id) filter(where r.status_type='late') late,
   coalesce(sum(r.late_minutes),0) late_minutes,coalesce(sum(case r.status_type when 'absence' then 1 when 'absence2' then 2 when 'absence3' then 3 else 0 end),0) weighted,
   coalesce(jsonb_object_agg(extract(day from r.record_date)::integer::text,r.status_type) filter(where r.id is not null),'{}') cells
  from selected e left join public.hr_status_records r on r.employee_id=e.id and r.deleted_at is null and r.record_date>=from_day and r.record_date<to_day group by e.id
 ), action_counted as (
  select e.id,count(a.id) administrative_actions from selected e left join public.administrative_actions a on a.employee_id=e.id and a.deleted_at is null and a.state<>'cancelled' and a.action_date>=from_day and a.action_date<to_day group by e.id
 ), full_rows as (
  select e.id,e.employee_number,e.name,e.department_id,e.shift_id,e.direct_manager_id,
   e.employment_status,e.version,e.created_at,e.updated_at,e.created_by,e.updated_by,
   e.department,e.display_order,e.shift,e.manager,
   c.absence,c.absence2,c.absence3,c.leave,c.late,c.late_minutes,c.weighted,c.cells,
   a.administrative_actions
  from selected e join counted c on c.id=e.id join action_counted a on a.id=e.id
 )
 select jsonb_build_object('month',to_char(from_day,'YYYY-MM'),'rows',coalesce(jsonb_agg(f order by f.display_order,f.name,f.id),'[]'),
  'totals',jsonb_build_object('absence',coalesce(sum(f.absence),0),'absence2',coalesce(sum(f.absence2),0),'absence3',coalesce(sum(f.absence3),0),'leave',coalesce(sum(f.leave),0),'late',coalesce(sum(f.late),0),'late_minutes',coalesce(sum(f.late_minutes),0),'weighted',coalesce(sum(f.weighted),0),'administrative_actions',coalesce(sum(f.administrative_actions),0))) into result from full_rows f;
 return result;
end $$;

create or replace function hr_private.safe_fingerprint_match(ns text,code text,source text) returns uuid
language plpgsql stable set search_path='' as $$
declare mapping public.fingerprint_identities; candidate uuid; names uuid[];
begin
 select * into mapping from public.fingerprint_identities where device_namespace=ns and person_code=code and is_active;
 if mapping.id is null then return null;end if;
 if not exists(select 1 from public.employees where id=mapping.employee_id) then return null;end if;
 -- A verified code + previously confirmed source alias outranks name-only ambiguity.
 if hr_private.fingerprint_name(mapping.source_name)=hr_private.fingerprint_name(source) or hr_private.fingerprint_name(source)=any(mapping.confirmed_names) then return mapping.employee_id;end if;
 select array_agg(id) into names from public.employees where hr_private.fingerprint_name(name)=hr_private.fingerprint_name(source);
 if exists(select 1 from unnest(names) id where id<>mapping.employee_id) then return null;end if;
 -- A renamed employee remains linked to the confirmed original device name.
 if hr_private.fingerprint_name(mapping.source_name)<>hr_private.fingerprint_name(source)
  and not (hr_private.fingerprint_name(source)=any(mapping.confirmed_names))
  and not (mapping.employee_id=any(coalesce(names,'{}'))) then return null;end if;
 return mapping.employee_id;
end $$;
create function public.attendance_sources() returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles;
begin
 actor=hr_private.require_role(array['ADMIN','HR','VIEWER']);
 return jsonb_build_object('can_configure',actor.role='ADMIN','rows',(select coalesce(jsonb_agg(s order by s.label,s.id),'[]') from public.attendance_device_sources s where s.is_active));
end $$;
revoke all on function public.attendance_sources() from public,anon,authenticated;
grant execute on function public.attendance_sources() to authenticated;
create or replace function public.attendance_read_v3(p_kind text,p_filters jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare day date=coalesce(nullif(p_filters->>'date','')::date,(now() at time zone 'Asia/Baghdad')::date);
 dep uuid=nullif(p_filters->>'department_id','')::uuid; result jsonb; start_day date; end_day date;
begin
 perform hr_private.require_role(array['ADMIN','HR','VIEWER']);
 if p_kind='daily' then
  select jsonb_build_object('date',day,'rows',coalesce(jsonb_agg(x),'[]')) into result from (
   select * from hr_private.attendance_session(day,dep,false)
   where coalesce(p_filters->>'search','')='' or name ilike '%'||(p_filters->>'search')||'%' or employee_number ilike '%'||(p_filters->>'search')||'%' or person_code ilike '%'||(p_filters->>'search')||'%'
  ) x; return result;
 elsif p_kind='monthly_fingerprint' then
  start_day=date_trunc('month',day)::date;end_day=(start_day+interval '1 month')::date-1;
  return jsonb_build_object('month',to_char(start_day,'YYYY-MM'),'approved_import',(
    select jsonb_build_object('id',i.id,'source_name',i.source_name,'approved_at',r.approved_at)
    from public.attendance_import_reviews r join public.attendance_imports i on i.id=r.import_id
    where r.period_month=start_day and r.lifecycle_state='approved'
  ),'rows',(
   with daily as materialized (
    select d::date work_date,a.*
    from generate_series(start_day::timestamp,end_day::timestamp,interval '1 day') d
    cross join lateral hr_private.attendance_session(d::date,null,true) a
   ), cells as (
    -- Identity is ONLY the employee UUID. Daily assignments must not split rows.
    select a.employee_id,
     jsonb_object_agg(extract(day from a.work_date)::integer::text,
      jsonb_build_object('entry',a.entry_minute,'exit',a.exit_minute,
       'duration',a.duration_minutes,'state',a.attendance_state)) cells
    from daily a group by a.employee_id
   )
   select coalesce(jsonb_agg(x order by x.display_order,x.department,x.name,x.employee_id),'[]') from (
    -- Use the explicit month-end session for the header, never an arbitrary row.
    -- Employee department is current: there is no dated transfer ledger.
    select h.employee_id,h.employee_number,h.person_code,h.name,h.department,h.department_id,
     h.display_order,h.manager,coalesce(e.direct_manager_id,rule.default_manager_id) manager_id,c.cells
    from cells c join daily h on h.employee_id=c.employee_id and h.work_date=end_day
    join public.employees e on e.id=h.employee_id
    left join lateral (
     select r.default_manager_id from public.attendance_department_rules r
     where r.department_id=h.department_id and r.effective_from<=end_day
     order by r.effective_from desc limit 1
    ) rule on true
    where (dep is null or h.department_id=dep)
     and (nullif(p_filters->>'manager_id','') is null
      or coalesce(e.direct_manager_id,rule.default_manager_id)=(p_filters->>'manager_id')::uuid)
   ) x));
 elsif p_kind='matching_employees' then
  return (select coalesce(jsonb_agg(x order by x.name,x.id),'[]') from (
   select e.id,e.name,e.employee_number,e.employment_status,d.arabic_name department
   from public.employees e join public.departments d on d.id=e.department_id
  ) x);
 elsif p_kind='imports' then
  return (select coalesce(jsonb_agg(x order by x.created_at desc,x.id),'[]') from (
   select i.*,coalesce(r.lifecycle_state,i.state) lifecycle_state,r.version lifecycle_version,r.reviewed_at,r.approved_at,r.superseded_by
   from public.attendance_imports i left join public.attendance_import_reviews r on r.import_id=i.id
   where nullif(p_filters->>'import_kind','') is null or i.import_kind=p_filters->>'import_kind'
   order by i.created_at desc,i.id limit 50
  ) x);
 elsif p_kind='import' then
  result=public.attendance_read_v2(p_kind,p_filters);
  result=result||jsonb_build_object('batch',result->'batch'||coalesce((
   select jsonb_build_object('lifecycle_state',r.lifecycle_state,'lifecycle_version',r.version,
    'reviewed_at',r.reviewed_at,'approved_at',r.approved_at)
   from public.attendance_import_reviews r where r.import_id=(p_filters->>'id')::uuid
  ),'{}'::jsonb),'review_summary',(
   select jsonb_build_object('rows',count(*),'matched',count(*) filter(where s.employee_id is not null),
    'unmatched',count(*) filter(where s.match_state='unmatched'),'ambiguous',count(*) filter(where s.match_state='ambiguous'),
    'invalid',count(*) filter(where s.match_state='invalid'),'days',count(distinct s.calendar_date),
    'identities',count(distinct (s.person_code,hr_private.fingerprint_name(s.source_name))),
    'matched_identities',count(distinct (s.person_code,hr_private.fingerprint_name(s.source_name))) filter(where s.employee_id is not null),
    'populated_cells',count(*) filter(where cardinality(s.punch_minutes)>0),
    'punch_tokens',coalesce(sum(cardinality(s.punch_minutes)),0),
    'open_issues',(select count(*) from public.fingerprint_issues f join public.fingerprint_source_rows x on x.id=f.source_row_id where x.import_id=(p_filters->>'id')::uuid and f.state='open'))
   from public.fingerprint_source_rows s where s.import_id=(p_filters->>'id')::uuid
  ));
  -- Existing single-day resolution also gets fresh counts without rewriting it.
  return jsonb_set(result,'{batch,summary}',result->'review_summary');
 elsif p_kind='issues' then
  with filtered as materialized (
   select f.*,s.person_code,s.source_name,s.calendar_date,s.import_id,s.raw_values,s.punch_minutes,
    b.source_name import_name,b.import_kind,
    case when p_filters->>'group_identities'='true' and f.state='open'
     and (b.import_kind='daily' or r.lifecycle_state='preview') and b.state='preview'
     and nullif(btrim(s.person_code),'') is not null and s.match_state in ('unmatched','ambiguous')
     and f.issue_type in ('unmatched','ambiguous','code_conflict')
     then jsonb_build_array(s.import_id,s.person_code,hr_private.fingerprint_name(s.source_name))::text
     else f.id::text end group_key,
    s.version source_version
   from public.fingerprint_issues f join public.fingerprint_source_rows s on s.id=f.source_row_id
   join public.attendance_imports b on b.id=s.import_id
   left join public.attendance_import_reviews r on r.import_id=b.id
   where f.state=coalesce(p_filters->>'state','open') and b.state<>'cancelled'
    and (nullif(p_filters->>'import_id','') is null or s.import_id=(p_filters->>'import_id')::uuid)
  ), groups as (
   select x.group_key,(array_agg(x.id order by x.id))[1] representative,
    count(*) related_open_count,min(x.calendar_date) first_date,max(x.calendar_date) last_date,
    case when x.group_key like '[%' then md5(string_agg(x.id::text||':'||x.version||':'||x.source_version,',' order by x.id)) end group_token
   from filtered x group by x.group_key
  )
  select jsonb_build_object('total',(select count(*) from groups),
   'issue_count',(select count(*) from filtered),'rows',(
    select coalesce(jsonb_agg(z order by z.created_at desc,z.id),'[]') from (
     select f.*,g.related_open_count,g.first_date,g.last_date,g.group_token,
      (select coalesce(jsonb_agg(c),'[]') from (select e.id,e.name,e.employee_number,e.employment_status,d.arabic_name department
       from public.employees e join public.departments d on d.id=e.department_id
       where hr_private.fingerprint_name(e.name)=hr_private.fingerprint_name(f.source_name) or e.employee_number=f.person_code
       order by e.id limit 10)c) candidates
     from groups g join filtered f on f.id=g.representative
     order by f.created_at desc,f.id limit 100 offset greatest(0,coalesce((p_filters->>'page')::integer,0))*100
    ) z)) into result;
  return result;
 end if;
 return public.attendance_read_v2(p_kind,p_filters);
end $$;


-- One snapshot supplies HR decisions and approved evidence to all report renderers.
create function public.hr_comprehensive_evidence(p_filters jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare report jsonb;monthly jsonb;daily jsonb='[]';d date;first_day date;last_day date;today date=(now() at time zone 'Asia/Baghdad')::date;
begin
 perform hr_private.require_role(array['ADMIN','HR','VIEWER']);
 if coalesce(p_filters->>'month','')!~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'الشهر غير صالح';end if;
 first_day=((p_filters->>'month')||'-01')::date;last_day=(first_day+interval '1 month')::date-1;
 report=public.hr_read_v4('report',p_filters);
 monthly=public.attendance_monthly_evidence_v2(jsonb_build_object('month',p_filters->>'month'));
 if monthly->>'available'='false' then
  for d in select g::date from generate_series(first_day,least(last_day,today),interval '1 day') g loop
   if exists(select 1 from public.attendance_imports i where i.import_kind='daily' and i.state='applied' and d between i.period_start and i.period_end) then daily=daily||jsonb_build_array(public.attendance_daily_evidence(jsonb_build_object('date',d)));end if;
  end loop;
 end if;
 return jsonb_build_object('report',report,'monthly',monthly,'daily',daily,'as_of',today);
end $$;
revoke all on function public.hr_comprehensive_evidence(jsonb) from public,anon,authenticated;
grant execute on function public.hr_comprehensive_evidence(jsonb) to authenticated;

create function public.attendance_period_gaps(p_filters jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare from_day date;to_day date;answer jsonb;
begin
 perform hr_private.require_role(array['ADMIN','HR','VIEWER']);
 if coalesce(p_filters->>'month','')!~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'الشهر غير صالح';end if;
 from_day=((p_filters->>'month')||'-01')::date;to_day=least((from_day+interval '1 month')::date-1,(now() at time zone 'Asia/Baghdad')::date);
 with population as (select e.* from public.employees e where e.employment_status='active' or exists(select 1 from public.fingerprint_source_rows s where s.employee_id=e.id and s.calendar_date between from_day and to_day)),
 gaps as (
 select e.id,e.name,e.internal_code,g::date work_date,case when a.id is null then 'missing_assignment' else 'missing_schedule' end reason
 from population e cross join generate_series(from_day,to_day,interval '1 day') g
 left join lateral(select h.* from public.employee_assignment_history h where h.employee_id=e.id and h.voided_at is null and g::date>=h.valid_from and (h.valid_to is null or g::date<=h.valid_to) order by h.valid_from desc limit 1)a on true
 where a.id is null or not exists(select 1 from public.attendance_department_rules r where r.department_id=a.department_id and r.effective_from<=g::date)
 ), grouped as (
 select id employee_id,name,internal_code,reason,count(*) days,min(work_date) first_date,max(work_date) last_date,jsonb_agg(work_date order by work_date) dates from gaps group by id,name,internal_code,reason
 ) select jsonb_build_object('month',p_filters->>'month','rows',coalesce(jsonb_agg(grouped order by name,employee_id,reason),'[]'),'can_write',(select role in ('ADMIN','HR') from public.profiles where id=auth.uid())) into answer from grouped;
 return answer;
end $$;
create function public.employee_assignment_bulk(p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;results jsonb='[]';
begin
 perform hr_private.require_role(array['ADMIN','HR']);
 if p_data->>'confirmed' is distinct from 'true' or jsonb_typeof(p_data->'rows')<>'array' or jsonb_array_length(p_data->'rows') not between 1 and 500 then raise exception 'راجع الفترات والموظفين ثم أكد الحفظ الجماعي';end if;
 if (select count(*) from jsonb_array_elements(p_data->'rows'))<>(select count(distinct v->>'employee_id') from jsonb_array_elements(p_data->'rows') v) then raise exception 'اختر فترة واحدة لكل موظف في الدفعة';end if;
 perform 1 from public.employees where id=any(array(select (v->>'employee_id')::uuid from jsonb_array_elements(p_data->'rows') v)) order by id for update;
 for r in select v from jsonb_array_elements(p_data->'rows') v order by v->>'employee_id' loop
  results=results||jsonb_build_array(public.employee_assignment_record(r));
 end loop;
 return jsonb_build_object('saved',jsonb_array_length(results),'rows',results);
end $$;
create function public.attendance_reopen_import(p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.attendance_imports;r public.attendance_import_reviews;actor public.profiles;
begin
 actor=hr_private.require_role(array['ADMIN','HR']);
 select * into b from public.attendance_imports where id=(p_data->>'id')::uuid for update;
 select * into r from public.attendance_import_reviews where import_id=b.id for update;
 if b.id is null or b.state<>'preview' or r.lifecycle_state is distinct from 'reviewed' or r.version is distinct from (p_data->>'version')::integer or length(btrim(coalesce(p_data->>'reason',''))) not between 3 and 2000 then raise exception 'إعادة الفتح لمراجعة غير معتمدة وبإصدار وسبب موثق فقط';end if;
 update public.attendance_import_reviews set lifecycle_state='preview',reviewed_at=null,reviewed_by=null where id=r.id returning * into r;
 insert into public.audit_logs(actor_id,actor_name,action,entity_type,entity_id,description,new_values)values(actor.id,actor.name,'reopen','attendance_imports',b.id,'إعادة معاينة قبل الاعتماد: '||(p_data->>'reason'),jsonb_build_object('lifecycle_version',r.version));
 return to_jsonb(b)||jsonb_build_object('lifecycle_state',r.lifecycle_state,'lifecycle_version',r.version);
end $$;
revoke all on function public.attendance_period_gaps(jsonb),public.employee_assignment_bulk(jsonb),public.attendance_reopen_import(jsonb) from public,anon,authenticated;
grant execute on function public.attendance_period_gaps(jsonb),public.employee_assignment_bulk(jsonb),public.attendance_reopen_import(jsonb) to authenticated;


create or replace function public.attendance_identity_proposal(p_filters jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.fingerprint_source_rows; b public.attendance_imports; result jsonb; conflicts text[]='{}'; people integer; names integer;
begin
 perform hr_private.require_role(array['ADMIN','HR','VIEWER']);
 select x.* into s from public.fingerprint_source_rows x join public.fingerprint_issues f on f.source_row_id=x.id where f.id=(p_filters->>'issue_id')::uuid;
 select * into b from public.attendance_imports where id=s.import_id;
 if s.id is null then raise exception 'المشكلة غير موجودة';end if;
 with historical as materialized (
  select x.* from public.fingerprint_source_rows x join public.attendance_imports i on i.id=x.import_id
  left join public.attendance_import_reviews r on r.import_id=i.id
  where i.device_namespace=b.device_namespace and x.person_code=s.person_code and x.employee_id is not null
   and i.state='applied' and (i.import_kind='daily' or r.lifecycle_state='approved')
 ), candidates as (
  select e.id,e.name,e.internal_code,e.employment_status,e.department_id,(select arabic_name from public.departments where id=e.department_id) department,count(h.id) filter(where hr_private.fingerprint_name(h.source_name)=hr_private.fingerprint_name(s.source_name)) historical_rows,
   coalesce(jsonb_agg(distinct h.import_id) filter(where h.id is not null),'[]') import_ids
  from public.employees e left join historical h on h.employee_id=e.id
  where h.id is not null or hr_private.fingerprint_name(e.name)=hr_private.fingerprint_name(s.source_name)
  group by e.id
 ) select coalesce(jsonb_agg(c),'[]') into result from candidates c;
 select count(distinct x.employee_id),count(distinct hr_private.fingerprint_name(x.source_name)) into people,names
 from public.fingerprint_source_rows x join public.attendance_imports i on i.id=x.import_id
 where i.device_namespace=b.device_namespace and x.person_code=s.person_code and x.employee_id is not null;
 if people>1 then conflicts=array_append(conflicts,'الكود استُخدم لموظفين مختلفين؛ لا ربط تلقائي');end if;
 if names>1 then conflicts=array_append(conflicts,'أسماء مصدر مختلفة للكود؛ تحقق من تغيير الاسم أو إعادة الاستخدام');end if;
 if exists(select 1 from public.fingerprint_identities m where m.device_namespace=b.device_namespace and m.person_code=s.person_code and m.is_active) and hr_private.safe_fingerprint_match(b.device_namespace,s.person_code,s.source_name) is null then conflicts=array_append(conflicts,'اسم المصدر لا يطابق سجل الجهاز المؤكد؛ راجع تغيير الاسم أو إعادة استخدام الرقم');end if;
 if b.device_namespace='legacy-unscoped' then conflicts=array_append(conflicts,'نطاق الجهاز القديم غير موثق؛ تحقق من سجل الأجهزة قبل التأكيد');end if;
 if exists(select 1 from jsonb_array_elements(result) c where c->>'employment_status'<>'active') then conflicts=array_append(conflicts,'يوجد مرشح غير نشط؛ راجع فترة الخدمة');end if;
 return jsonb_build_object('device_namespace',b.device_namespace,'person_code',s.person_code,'candidates',result,'conflicts',conflicts,'existing_mapping',(select to_jsonb(m) from public.fingerprint_identities m where m.device_namespace=b.device_namespace and m.person_code=s.person_code),
  'classification',case when s.match_state='invalid' then 'بيانات غير صالحة' when people>1 or jsonb_array_length(result)>1 then 'تعارض / مرشحون متعددون' when jsonb_array_length(result)=1 then 'مرشح معروف بانتظار التأكيد' else 'لا يوجد مرشح' end);
end $$;


create or replace function hr_private.require_linked_approval() returns trigger language plpgsql set search_path='' as $$
begin
 if new.state='applied' and old.state is distinct from 'applied' then
  if not exists(select 1 from public.fingerprint_source_rows s where s.import_id=new.id and s.employee_id is not null and s.match_state not in ('invalid','ambiguous')) then raise exception 'لا يمكن الاعتماد: صفر موظفين مرتبطين. احفظ الأدلة وراجع الهوية أولاً';end if;
  if not exists(
   select 1 from public.fingerprint_source_rows s
   join public.employee_assignment_history h on h.employee_id=s.employee_id and h.voided_at is null and h.employment_status='active' and s.calendar_date>=h.valid_from and (h.valid_to is null or s.calendar_date<=h.valid_to)
   join lateral(select r.* from public.attendance_department_rules r where r.department_id=h.department_id and r.effective_from<=s.calendar_date order by r.effective_from desc limit 1) rule on true
   where s.import_id=new.id and s.employee_id is not null and hr_private.verified_source_identity(s.employee_id,s.match_state,new.device_namespace,s.person_code,s.source_name) and s.calendar_date<=(now() at time zone 'Asia/Baghdad')::date and (
    exists(select 1 from unnest(s.punch_minutes) m where m between rule.entry_window_start and rule.entry_window_end)
    or (new.coverage_confirmed and (s.calendar_date<(now() at time zone 'Asia/Baghdad')::date or extract(hour from now() at time zone 'Asia/Baghdad')*60+extract(minute from now() at time zone 'Asia/Baghdad')>rule.entry_window_end))
   )
  ) then raise exception 'لا يمكن الاعتماد: لا يوجد دخول مؤهل بسياق تاريخي موثق أو يوم مكتمل بتغطية مثبتة. تبقى الأدلة في المعاينة';end if;
 end if;return new;
end $$;


create or replace function public.attendance_monthly_evidence(p_filters jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.attendance_imports; r public.attendance_import_reviews;
 month_start date; month_end date; answer jsonb;
begin
 perform hr_private.require_role(array['ADMIN','HR','VIEWER']);
 if coalesce(p_filters->>'month','') !~ '^\d{4}-(0[1-9]|1[012])$' then raise exception 'اختر شهراً وسنة صالحين';end if;
 month_start=((p_filters->>'month')||'-01')::date;month_end=(month_start+interval '1 month')::date-1;
 if nullif(p_filters->>'import_id','') is not null then
  select i.* into b from public.attendance_imports i where i.id=(p_filters->>'import_id')::uuid
   and i.import_kind='monthly' and date_trunc('month',i.period_start)::date=month_start;
  if b.id is null then raise exception 'الملف الشهري غير موجود في الفترة المختارة';end if;
 else
  select i.* into b from public.attendance_imports i join public.attendance_import_reviews x on x.import_id=i.id
   where x.period_month=month_start and x.lifecycle_state='approved' and i.state='applied';
 end if;
 if b.id is null then return jsonb_build_object('month',p_filters->>'month','available',false,'batch',null,'sources','[]'::jsonb);end if;
 select x.* into r from public.attendance_import_reviews x where x.import_id=b.id;
 select jsonb_build_object('month',p_filters->>'month','available',true,
  'as_of',(now() at time zone 'Asia/Baghdad')::date,
  'batch',to_jsonb(b)||jsonb_build_object('lifecycle_state',r.lifecycle_state,'lifecycle_version',r.version,'approved_at',r.approved_at,'reviewed_at',r.reviewed_at),
  'sources',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'employee_id',s.employee_id,'person_code',s.person_code,
   'source_name',s.source_name,'source_sheet',s.source_sheet,'source_row',s.source_row,'calendar_date',s.calendar_date,
   'raw_values',s.raw_values,'punch_minutes',s.punch_minutes,'match_state',s.match_state,'identity_verified',hr_private.verified_source_identity(s.employee_id,s.match_state,b.device_namespace,s.person_code,s.source_name)) order by s.source_sheet,s.source_row,s.calendar_date),'[]')
   from public.fingerprint_source_rows s where s.import_id=b.id),
  'employees',(select coalesce(jsonb_agg(e),'[]') from hr_private.employee_view e
   where exists(select 1 from public.fingerprint_source_rows s where s.import_id=b.id and s.employee_id=e.id)),
  'rules',(select coalesce(jsonb_agg(x order by x.effective_from),'[]') from public.attendance_department_rules x
   where x.effective_from<=month_end+1),
  'manual_records',(select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'employee_id',h.employee_id,'record_date',h.record_date,
   'status_type',h.status_type,'late_minutes',h.late_minutes,'notes',h.notes,'updated_at',h.updated_at,'version',h.version)),'[]')
   from public.hr_status_records h where h.deleted_at is null and h.record_date between month_start and month_end
   and exists(select 1 from public.fingerprint_source_rows s where s.import_id=b.id and s.employee_id=h.employee_id)),
  'issues',(select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'source_row_id',f.source_row_id,'issue_type',f.issue_type,
   'state',f.state,'details',f.details,'resolution_note',f.resolution_note)),'[]')
   from public.fingerprint_issues f join public.fingerprint_source_rows s on s.id=f.source_row_id where s.import_id=b.id),
  'other_approved',(select jsonb_build_object('id',i.id,'source_name',i.source_name,'approved_at',v.approved_at)
   from public.attendance_import_reviews v join public.attendance_imports i on i.id=v.import_id
   where v.period_month=month_start and v.lifecycle_state='approved' and v.import_id<>b.id),
  'daily_overlap_rows',(select count(*) from public.fingerprint_source_rows s
   join public.attendance_imports i on i.id=s.import_id and i.import_kind='daily' and i.state='applied'
   where s.calendar_date between month_start and month_end and cardinality(s.punch_minutes)>0
    and exists(select 1 from public.fingerprint_source_rows p where p.import_id=b.id and p.employee_id=s.employee_id
     and p.calendar_date=s.calendar_date and cardinality(p.punch_minutes)>0))) into answer;
 return answer;
end $$;


-- A correction copies immutable raw evidence; the old approval stays authoritative.
-- One open attempt per file; a DAILY file can have only one applied attempt.
create unique index attendance_daily_applied_hash on public.attendance_imports(source_hash,import_kind,period_start,period_end) where state='applied' and import_kind='daily';
create function public.attendance_new_attempt(p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles;parent public.attendance_imports;b public.attendance_imports;source public.fingerprint_source_rows;
 ns text;target_source public.attendance_device_sources;target uuid;names uuid[];kind text;problem text;sid uuid;answer jsonb;reason text=btrim(coalesce(p_data->>'reason',''));
begin
 actor=hr_private.require_role(array['ADMIN','HR']);
 perform set_config('lock_timeout','5s',true);
 select * into parent from public.attendance_imports where id=(p_data->>'id')::uuid for update;
 if parent.id is null or parent.version is distinct from (p_data->>'version')::integer or parent.state not in ('applied','cancelled') or length(reason) not between 3 and 2000 then raise exception 'اختر مصدراً مغلقاً بإصداره الحالي ووثق سبب محاولة التصحيح';end if;
 ns=parent.device_namespace;
 if nullif(p_data->>'device_source_id','') is not null then
  select * into target_source from public.attendance_device_sources where id=(p_data->>'device_source_id')::uuid and is_active;
  if target_source.id is null or length(btrim(coalesce(target_source.confirmation_reason,'')))<3 then raise exception 'عرّف الجهاز الصحيح بدليل مستقل أولاً';end if;
  if target_source.namespace<>ns then perform hr_private.require_role(array['ADMIN']);end if;ns=target_source.namespace;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(parent.source_hash,0));
 select * into b from public.attendance_imports where source_hash=parent.source_hash and import_kind=parent.import_kind and period_start=parent.period_start and period_end=parent.period_end and state='preview' order by created_at desc,id desc limit 1;
 if b.id is not null then
  if b.previous_attempt_id=parent.id and b.device_namespace=ns then return to_jsonb(b)||jsonb_build_object('duplicate',true);end if;
  raise exception 'توجد معاينة مفتوحة لهذا الملف؛ تابعها أو ألغها بقرار صريح قبل محاولة أخرى';
 end if;
 insert into public.attendance_imports(source_name,source_hash,import_kind,period_start,period_end,device_namespace,previous_attempt_id,coverage_start,coverage_end,coverage_confirmed)
 values(parent.source_name,parent.source_hash,parent.import_kind,parent.period_start,parent.period_end,ns,parent.id,parent.coverage_start,parent.coverage_end,coalesce((p_data->>'coverage_confirmed')::boolean,false))returning * into b;
 if b.import_kind='monthly' then insert into public.attendance_import_reviews(import_id,period_month,created_by,updated_by)values(b.id,date_trunc('month',b.period_start)::date,actor.id,actor.id);end if;
 for source in select * from public.fingerprint_source_rows where import_id=parent.id order by source_sheet,source_row,calendar_date,id loop
  target=null;problem=null;kind='unmatched';
  select array_agg(e.id) into names from public.employees e where hr_private.fingerprint_name(e.name)=hr_private.fingerprint_name(source.source_name);
  if source.match_state='invalid' then kind='invalid';problem='invalid';
  else
   target=hr_private.safe_fingerprint_match(ns,source.person_code,source.source_name);
   if target is not null then kind='code';
   elsif exists(select 1 from public.fingerprint_identities f where f.device_namespace=ns and f.person_code=source.person_code and f.is_active)then kind='ambiguous';problem='code_conflict';
   elsif cardinality(names)>1 then kind='ambiguous';problem='ambiguous';
   else problem='unmatched';end if;
  end if;
  insert into public.fingerprint_source_rows(import_id,source_sheet,source_row,calendar_date,person_code,source_name,raw_values,punch_minutes,employee_id,match_state)
  values(b.id,source.source_sheet,source.source_row,source.calendar_date,source.person_code,source.source_name,source.raw_values,source.punch_minutes,target,kind) returning id into sid;
  if problem is not null then insert into public.fingerprint_issues(source_row_id,issue_type,details)values(sid,problem,'محاولة تصحيحية؛ يلزم ربط مؤكد في نطاق الجهاز المختار');end if;
 end loop;
 perform hr_private.refresh_import_summary(b.id);
 insert into public.audit_logs(actor_id,actor_name,action,entity_type,entity_id,description,old_values,new_values)
 values(actor.id,actor.name,'new_attempt','attendance_imports',b.id,'محاولة تصحيحية دون تغيير المصدر المغلق: '||reason,
 jsonb_build_object('parent_id',parent.id,'source_hash',parent.source_hash,'device_namespace',parent.device_namespace),
 jsonb_build_object('device_namespace',ns,'reason',reason));
 select to_jsonb(i)||jsonb_build_object('lifecycle_state',coalesce(r.lifecycle_state,i.state),'lifecycle_version',r.version) into answer from public.attendance_imports i left join public.attendance_import_reviews r on r.import_id=i.id where i.id=b.id;
 return answer;
end $$;
revoke all on function public.attendance_new_attempt(jsonb) from public,anon,authenticated;
grant execute on function public.attendance_new_attempt(jsonb) to authenticated;


commit;
