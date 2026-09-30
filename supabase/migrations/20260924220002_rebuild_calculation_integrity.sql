-- Additive history and evidence transport. Never infer historical assignments.
begin;
create table public.employee_assignment_history (
 id uuid primary key default gen_random_uuid(),
 employee_id uuid not null references public.employees(id) on delete restrict,
 department_id uuid not null references public.departments(id),
 shift_id uuid references public.shifts(id), direct_manager_id uuid references public.managers(id),
 employment_status text not null check(employment_status in ('active','inactive','resigned','long_leave')),
 valid_from date not null, valid_to date,
 evidence_kind text not null check(evidence_kind in ('observed','verified')),
 reason text not null check(length(btrim(reason)) between 1 and 2000),
 created_by uuid references public.profiles(id), created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), version integer not null default 1, voided_at timestamptz,
 check(valid_to is null or valid_to>=valid_from), unique(employee_id,valid_from)
);
create index assignment_history_employee_range on public.employee_assignment_history(employee_id,valid_from desc,valid_to);
create index assignment_history_department on public.employee_assignment_history(department_id);
create index assignment_history_manager on public.employee_assignment_history(direct_manager_id);
create index assignment_history_shift on public.employee_assignment_history(shift_id);
create index assignment_history_actor on public.employee_assignment_history(created_by);
alter table public.employee_assignment_history enable row level security;
revoke all on public.employee_assignment_history from public,anon,authenticated;
create trigger touch before update on public.employee_assignment_history for each row execute function hr_private.touch();
create trigger audit after insert or update on public.employee_assignment_history for each row execute function hr_private.audit();

-- The current row is evidence of the assignment now, not of a past workday.
insert into public.employee_assignment_history(employee_id,department_id,shift_id,direct_manager_id,employment_status,valid_from,evidence_kind,reason)
select id,department_id,shift_id,direct_manager_id,employment_status,(now() at time zone 'Asia/Baghdad')::date+1,'observed','رصد الانتماء الحالي عند تفعيل السجل؛ لا يثبت الفترات السابقة' from public.employees;

create function hr_private.capture_employee_assignment() returns trigger language plpgsql security definer set search_path='' as $$
declare today date=(now() at time zone 'Asia/Baghdad')::date;
begin
 if tg_op='UPDATE' and (new.department_id,new.shift_id,new.direct_manager_id,new.employment_status) is not distinct from (old.department_id,old.shift_id,old.direct_manager_id,old.employment_status) then return new;end if;
 -- Current-day transfers have no invented time of effect. Leave the day unresolved.
 update public.employee_assignment_history set valid_to=today,voided_at=now()
 where employee_id=new.id and valid_from=today and voided_at is null and (valid_to is null or valid_to>=today);
 update public.employee_assignment_history set valid_to=today-1
 where employee_id=new.id and valid_from<today and voided_at is null and (valid_to is null or valid_to>=today);
 insert into public.employee_assignment_history(employee_id,department_id,shift_id,direct_manager_id,employment_status,valid_from,evidence_kind,reason,created_by)
 values(new.id,new.department_id,new.shift_id,new.direct_manager_id,new.employment_status,today+1,'observed','رصد تغيير الانتماء الحالي؛ يوم التغيير يحتاج توثيقاً مستقلاً',auth.uid())
 on conflict(employee_id,valid_from) do update set department_id=excluded.department_id,shift_id=excluded.shift_id,direct_manager_id=excluded.direct_manager_id,employment_status=excluded.employment_status;
 return new;
end $$;
create trigger capture_assignment after insert or update on public.employees for each row execute function hr_private.capture_employee_assignment();

create function hr_private.assignment_evidence(ids uuid[]) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(h)||jsonb_build_object('department',d.arabic_name,'manager',m.name) order by h.employee_id,h.valid_from),'[]')
 from public.employee_assignment_history h join public.departments d on d.id=h.department_id left join public.managers m on m.id=h.direct_manager_id
 where h.employee_id=any(ids)
$$;
alter table public.attendance_import_reviews add column calculation_context jsonb;
create function hr_private.with_assignment_evidence(answer jsonb) returns jsonb language sql stable set search_path='' as $$
 select answer||jsonb_build_object('assignments',hr_private.assignment_evidence(array(select (e->>'id')::uuid from jsonb_array_elements(coalesce(answer->'employees','[]')) e)))
$$;

create function public.attendance_daily_evidence(p_filters jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare day date=coalesce(nullif(p_filters->>'date','')::date,(now() at time zone 'Asia/Baghdad')::date); answer jsonb;
begin
 perform hr_private.require_role(array['ADMIN','HR','VIEWER']);
 with sources as materialized (
  select s.* from public.fingerprint_source_rows s join public.attendance_imports i on i.id=s.import_id
  where i.import_kind='daily' and i.state='applied' and s.calendar_date between day and day+1
 ), population as materialized (
  select e.* from hr_private.employee_view e where e.employment_status='active'
   or exists(select 1 from sources s where s.employee_id=e.id)
   or exists(select 1 from public.hr_status_records h where h.employee_id=e.id and h.record_date=day and h.deleted_at is null)
   or exists(select 1 from public.employee_assignment_history a where a.employee_id=e.id and a.voided_at is null and a.employment_status='active' and day>=a.valid_from and (a.valid_to is null or day<=a.valid_to))
 ) select jsonb_build_object('date',day,'as_of',(now() at time zone 'Asia/Baghdad')::date,
  'employees',(select coalesce(jsonb_agg(e order by display_order,name,id),'[]') from population e),
  'sources',(select coalesce(jsonb_agg(s),'[]') from sources s),
  'rules',(select coalesce(jsonb_agg(r),'[]') from public.attendance_department_rules r where effective_from<=day+1),
  'manual_records',(select coalesce(jsonb_agg(h),'[]') from public.hr_status_records h where h.record_date=day and h.deleted_at is null),
  'notes',(select coalesce(jsonb_agg(n),'[]') from public.attendance_daily_notes n where n.work_date=day),
  'issues',(select coalesce(jsonb_agg(f),'[]') from public.fingerprint_issues f join sources s on s.id=f.source_row_id)) into answer;
 return hr_private.with_assignment_evidence(answer);
end $$;

create function public.employee_assignments(p_employee_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform hr_private.require_role(array['ADMIN','HR','VIEWER']);
 return hr_private.assignment_evidence(array[p_employee_id]);
end $$;

create function public.employee_assignment_record(p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles; e public.employees; a public.employee_assignment_history;
 first_day date=(p_data->>'valid_from')::date;last_day date=(p_data->>'valid_to')::date;
begin
 actor=hr_private.require_role(array['ADMIN','HR']);
 select * into e from public.employees where id=(p_data->>'employee_id')::uuid for update;
 if e.id is null or e.version is distinct from (p_data->>'employee_version')::integer then raise exception 'تغير الموظف؛ أعد تحميل بياناته';end if;
 if first_day is null or last_day is null or first_day>last_day or last_day>(now() at time zone 'Asia/Baghdad')::date or length(btrim(coalesce(p_data->>'reason',''))) not between 3 and 2000 then raise exception 'وثّق الفترة المنتهية ومصدر إثبات الانتماء';end if;
 if nullif(p_data->>'id','') is not null then
  select * into a from public.employee_assignment_history where id=(p_data->>'id')::uuid and employee_id=e.id for update;
  if a.id is null or a.version is distinct from (p_data->>'version')::integer then raise exception 'تغير سجل الفترة؛ أعد تحميل البيانات';end if;
  if a.valid_to is null or a.valid_to>(now() at time zone 'Asia/Baghdad')::date then raise exception 'لا يمكن تعديل فترة رصد جارية؛ وثّق الفترات المنتهية فقط';end if;
 end if;
 if exists(select 1 from public.employee_assignment_history h where h.employee_id=e.id and h.id is distinct from a.id and h.voided_at is null and h.valid_from<=last_day and (h.valid_to is null or h.valid_to>=first_day)) then raise exception 'الفترة تتداخل مع انتماء موثق؛ راجع السجل قبل الإضافة';end if;
 if exists(select 1 from public.employee_assignment_history h where h.employee_id=e.id and h.id is distinct from a.id and h.valid_from=first_day) then raise exception 'يوجد سجل يبدأ بهذا التاريخ؛ افتح تصحيح الفترة لذلك السجل للحفاظ على أثر التدقيق';end if;
 if a.id is not null then
  update public.employee_assignment_history set department_id=(p_data->>'department_id')::uuid,shift_id=nullif(p_data->>'shift_id','')::uuid,direct_manager_id=nullif(p_data->>'direct_manager_id','')::uuid,
   employment_status=p_data->>'employment_status',valid_from=first_day,valid_to=last_day,evidence_kind='verified',reason=btrim(p_data->>'reason'),voided_at=null where id=a.id returning * into a;
  return to_jsonb(a);
 end if;
 insert into public.employee_assignment_history(employee_id,department_id,shift_id,direct_manager_id,employment_status,valid_from,valid_to,evidence_kind,reason,created_by)
 values(e.id,(p_data->>'department_id')::uuid,nullif(p_data->>'shift_id','')::uuid,nullif(p_data->>'direct_manager_id','')::uuid,p_data->>'employment_status',first_day,last_day,'verified',btrim(p_data->>'reason'),actor.id) returning * into a;
 return to_jsonb(a);
end $$;

-- Notes and an HR decision form one transaction. A stale/conflicting decision
-- rolls back the note, instead of showing success for half a form.
create function public.attendance_day_save(p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; note jsonb=p_data->'note'; decision jsonb=p_data->'decision';
begin
 perform hr_private.require_role(array['ADMIN','HR']);
 if decision is not null and decision<>'null'::jsonb then
  if decision->>'operation'='save' then
   if decision->'data'->>'employee_id' is distinct from note->>'employee_id' or decision->'data'->>'record_date' is distinct from note->>'work_date' then raise exception 'عدم تطابق الموظف أو التاريخ';end if;
   result=public.hr_write_v2('status.save',decision->'data');
   if result->>'conflict'='true' then raise exception 'يوجد قرار لهذا اليوم؛ أعد تحميل السجل قبل التعديل';end if;
  elsif decision->>'operation'='delete' then
   if not exists(select 1 from public.hr_status_records r where r.id=(decision->'data'->>'id')::uuid and r.employee_id=(note->>'employee_id')::uuid and r.record_date=(note->>'work_date')::date) then raise exception 'قرار غير مطابق';end if;
   result=public.hr_write_v2('status.delete',decision->'data');
  else raise exception 'قرار غير صالح';end if;
 end if;
 result=public.attendance_write_v4('note.save',note);
 return jsonb_build_object('saved',true,'note',result);
end $$;

create function public.attendance_monthly_evidence_v2(p_filters jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare answer jsonb; frozen jsonb;
begin
 answer=public.attendance_monthly_evidence(p_filters);
 if answer->>'available'='false' then return answer;end if;
 answer=hr_private.with_assignment_evidence(answer);
 select calculation_context into frozen from public.attendance_import_reviews where import_id=(answer->'batch'->>'id')::uuid;
 return case when frozen is null then answer||jsonb_build_object('calculation_basis','live_evidence') else answer||frozen||jsonb_build_object('calculation_basis','approval_snapshot') end;
end $$;
create function public.attendance_inspect_monthly_v2(p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin return hr_private.with_assignment_evidence(public.attendance_inspect_monthly(p_data));end $$;
create function public.attendance_write_v5(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; evidence jsonb; target uuid; c_start date;c_end date;b public.attendance_imports;
begin
 perform hr_private.require_role(array['ADMIN','HR']);
 if p_action='import.preview' and p_data->>'import_kind'='monthly' then
  c_start=nullif(p_data->>'coverage_start','')::date;c_end=nullif(p_data->>'coverage_end','')::date;
  if c_start is null or c_end is null or c_start<(p_data->>'period_start')::date or c_end>(p_data->>'period_end')::date or c_end<c_start then raise exception 'حدد نطاق التغطية داخل فترة الملف';end if;
  result=public.attendance_write_v3(p_action,p_data);
  if result->>'duplicate'='true' then return result;end if;
  update public.attendance_imports set coverage_start=c_start,coverage_end=c_end where id=(result->>'id')::uuid returning * into b;
  return result||to_jsonb(b);
 end if;
 result=public.attendance_write_v3(p_action,p_data);
 return result;
end $$;
-- Freeze calculation evidence at the authoritative state transition, including older RPCs.
create function hr_private.freeze_attendance_context() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.lifecycle_state='approved' and old.lifecycle_state is distinct from 'approved' then
  if exists(select 1 from public.fingerprint_issues f join public.fingerprint_source_rows s on s.id=f.source_row_id where s.import_id=new.import_id and f.state='open') then
   raise exception 'عالج مشاكل المطابقة المفتوحة قبل اعتماد الملف أو استبداله';
  end if;
  if exists(
   select 1 from public.attendance_imports b
   cross join lateral generate_series(b.coverage_start,least(b.coverage_end,(now() at time zone 'Asia/Baghdad')::date),interval '1 day') as work_date
   cross join lateral (select distinct employee_id from public.fingerprint_source_rows s where s.import_id=b.id and s.employee_id is not null) people
   where b.id=new.import_id and not exists(
    select 1 from public.employee_assignment_history h where h.employee_id=people.employee_id and h.voided_at is null
     and h.valid_from<=work_date::date and (h.valid_to is null or h.valid_to>=work_date::date)
     and exists(select 1 from public.attendance_department_rules r where r.department_id=h.department_id and r.effective_from<=work_date::date)
   )
  ) then raise exception 'لا يمكن الاعتماد: توجد أيام دون انتماء وظيفي أو إعداد دوام موثق. افتح ملف الموظف ووثّق الفترة من السجل الإداري أولاً';end if;
  if exists(select 1 from public.attendance_imports where id=new.import_id and (coverage_start is null or coverage_end is null)) then
   raise exception 'لا يمكن الاعتماد دون توثيق نطاق تغطية الملف';
  end if;
  new.calculation_context=jsonb_build_object('assignments',hr_private.assignment_evidence(array(select distinct employee_id from public.fingerprint_source_rows where import_id=new.import_id and employee_id is not null)),
   'rules',(select coalesce(jsonb_agg(r),'[]') from public.attendance_department_rules r),'calculation_version','2026-09-25');
 end if;
 return new;
end $$;
create trigger freeze_calculation_context before update on public.attendance_import_reviews for each row execute function hr_private.freeze_attendance_context();
revoke all on function hr_private.freeze_attendance_context() from public,anon,authenticated;
-- Existing clients also pass through the new transaction/snapshot boundary.
create or replace function public.attendance_write_v4(p_action text,p_data jsonb) returns jsonb language sql security definer set search_path='' as $$
 select public.attendance_write_v5(p_action,p_data)
$$;
revoke all on function public.attendance_monthly_evidence_v2(jsonb),public.attendance_inspect_monthly_v2(jsonb),public.attendance_write_v5(text,jsonb) from public,anon,authenticated;
grant execute on function public.attendance_monthly_evidence_v2(jsonb),public.attendance_inspect_monthly_v2(jsonb),public.attendance_write_v5(text,jsonb) to authenticated;

revoke all on function public.attendance_daily_evidence(jsonb),public.employee_assignments(uuid),public.employee_assignment_record(jsonb),public.attendance_day_save(jsonb) from public,anon,authenticated;
grant execute on function public.attendance_daily_evidence(jsonb),public.employee_assignments(uuid),public.employee_assignment_record(jsonb),public.attendance_day_save(jsonb) to authenticated;
revoke all on function hr_private.capture_employee_assignment(),hr_private.assignment_evidence(uuid[]),hr_private.with_assignment_evidence(jsonb) from public,anon,authenticated;
-- New ingestion requires established identifier evidence. Existing stored mappings are not rewritten.
create or replace function public.attendance_write(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.profiles; batch public.attendance_imports; r jsonb; item uuid;
 emp uuid; candidates uuid[]; code_emp uuid; name_emp uuid; match text; issue text;
 row_id uuid; minutes integer[]; existing public.fingerprint_source_rows;
 rev integer; answer jsonb; d date;
begin
 actor=hr_private.require_role(array['ADMIN','HR']);
 if p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'طلب غير صالح';end if;
 if p_action in ('import.apply','import.cancel','issue.resolve') and (nullif(p_data->>'id','') is null or coalesce((p_data->>'version')::integer,0)<1) then raise exception 'الإصدار مطلوب';end if;
 if p_action='import.preview' then
  if p_data->'rows' is null or jsonb_typeof(p_data->'rows')<>'array' or jsonb_array_length(p_data->'rows') not between 1 and 20000 then raise exception 'عدد صفوف الملف غير صالح'; end if;
  if (p_data->>'period_end')::date-(p_data->>'period_start')::date not between 0 and 31 then raise exception 'الفترة غير صالحة';end if;
  -- Serialize duplicate uploads; never replace a previously applied source.
  perform pg_advisory_xact_lock(hashtextextended(p_data->>'source_hash',0));
  select * into batch from public.attendance_imports where source_hash=p_data->>'source_hash'
   and import_kind=p_data->>'import_kind' and period_start=(p_data->>'period_start')::date and period_end=(p_data->>'period_end')::date;
  if found then return to_jsonb(batch)||jsonb_build_object('duplicate',true);end if;
  insert into public.attendance_imports(source_name,source_hash,import_kind,period_start,period_end)
   values(p_data->>'source_name',p_data->>'source_hash',p_data->>'import_kind',(p_data->>'period_start')::date,(p_data->>'period_end')::date) returning * into batch;
  for r in select value from jsonb_array_elements(p_data->'rows') loop
   d=(r->>'calendar_date')::date;
   if d<batch.period_start or d>batch.period_end then raise exception 'تاريخ خارج فترة الملف';end if;
   select coalesce(array_agg(distinct value::integer order by value::integer),'{}') into minutes from jsonb_array_elements_text(r->'punch_minutes');
   if cardinality(minutes)>100 then raise exception 'عدد بصمات غير صالح';end if;
   emp=null; code_emp=null; name_emp=null; issue=null; match='unmatched';
   select employee_id into code_emp from public.fingerprint_identities where person_code=nullif(btrim(r->>'person_code'),'') and is_active;
   if code_emp is null then select id into code_emp from public.employees where employee_number=nullif(btrim(r->>'person_code'),'');end if;
   select array_agg(id) into candidates from public.employees where hr_private.fingerprint_name(name)=hr_private.fingerprint_name(r->>'source_name');
   if cardinality(candidates)=1 then name_emp=candidates[1];end if;
   if r->>'invalid'='true' then match='invalid';issue='invalid';
   elsif code_emp is not null and name_emp is not null and code_emp<>name_emp then match='ambiguous';issue='code_conflict';
   elsif code_emp is not null then emp=code_emp;match='code';
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
  if p_data->>'state'='resolved' then
   emp=(p_data->>'employee_id')::uuid;
   if emp is null or not exists(select 1 from public.employees where id=emp) then raise exception 'الموظف غير موجود';end if;
   if existing.match_state='invalid' then raise exception 'الصف غير صالح؛ صحح الملف وأعد استيراده';end if;
   if existing.person_code is not null then
    insert into public.fingerprint_identities(person_code,employee_id,source_name) values(existing.person_code,emp,existing.source_name) on conflict(person_code) do nothing;
    if not exists(select 1 from public.fingerprint_identities where person_code=existing.person_code and employee_id=emp and is_active) then raise exception 'رمز الشخص مرتبط بموظف آخر';end if;
   end if;
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
create or replace function public.attendance_write_v3(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.profiles; batch public.attendance_imports; review public.attendance_import_reviews; old_review public.attendance_import_reviews; answer jsonb;
 issue_row public.fingerprint_issues; source_row public.fingerprint_source_rows;
 matched_employee uuid; code_employee uuid; name_candidates uuid[]; match_kind text;
begin
 actor=hr_private.require_role(array['ADMIN','HR']);
 if p_action='import.preview' then
  answer=public.attendance_write_v2(p_action,p_data);
  if p_data->>'import_kind'='monthly' then
   insert into public.attendance_import_reviews(import_id,period_month,created_by,updated_by)
   values((answer->>'id')::uuid,date_trunc('month',(p_data->>'period_start')::date)::date,actor.id,actor.id) on conflict(import_id) do nothing;
   return answer||coalesce((select jsonb_build_object('lifecycle_state',r.lifecycle_state,'lifecycle_version',r.version) from public.attendance_import_reviews r where r.import_id=(answer->>'id')::uuid),'{}'::jsonb);
  end if; return answer;
 elsif p_action in ('import.review','import.approve') then
  select * into batch from public.attendance_imports where id=(p_data->>'id')::uuid and import_kind='monthly' for update;
  select * into review from public.attendance_import_reviews where import_id=batch.id for update;
  if batch.id is null or review.version<>(p_data->>'version')::integer then raise exception 'تم تغيير الاستيراد؛ حدّث الصفحة';end if;
  if exists(select 1 from public.fingerprint_issues f join public.fingerprint_source_rows s on s.id=f.source_row_id where s.import_id=batch.id and f.state='open') then raise exception 'عالج مشاكل المطابقة المفتوحة قبل اعتماد الملف';end if;
  if p_action='import.review' then
   if review.lifecycle_state<>'preview' then raise exception 'لا يمكن مراجعة الملف في حالته الحالية';end if;
   update public.attendance_import_reviews set lifecycle_state='reviewed',reviewed_by=actor.id,reviewed_at=now() where id=review.id returning * into review;
  else
   if review.lifecycle_state<>'reviewed' then raise exception 'يجب إكمال المراجعة قبل الاعتماد';end if;
   if exists(select 1 from public.attendance_import_reviews where period_month=review.period_month and lifecycle_state='approved' and id<>review.id) then raise exception 'يوجد ملف شهري معتمد لهذه الفترة؛ استخدم الاستبدال الآمن';end if;
   update public.attendance_imports set state='applied' where id=batch.id;
   update public.attendance_import_reviews set lifecycle_state='approved',approved_by=actor.id,approved_at=now() where id=review.id returning * into review;
  end if; return to_jsonb(batch)||to_jsonb(review)||jsonb_build_object('id',batch.id,'import_id',batch.id,'version',batch.version,'lifecycle_version',review.version,'lifecycle_state',review.lifecycle_state,'summary',batch.summary,'source_name',batch.source_name);
 elsif p_action='import.supersede' then
  perform hr_private.require_role(array['ADMIN']);
  select * into old_review from public.attendance_import_reviews where import_id=(p_data->>'id')::uuid for update;
  select * into review from public.attendance_import_reviews where import_id=(p_data->>'replacement_id')::uuid for update;
  if old_review.version<>(p_data->>'version')::integer or review.version<>(p_data->>'replacement_version')::integer then raise exception 'تم تغيير أحد الملفين؛ حدّث الصفحة';end if;
  if old_review.lifecycle_state<>'approved' or review.lifecycle_state<>'reviewed' or old_review.period_month<>review.period_month then raise exception 'الاستبدال غير صالح';end if;
  update public.attendance_import_reviews set lifecycle_state='superseded',superseded_by=review.import_id where id=old_review.id;
  update public.attendance_imports set state='cancelled' where id=old_review.import_id;
  update public.attendance_imports set state='applied' where id=review.import_id;
  update public.attendance_import_reviews set lifecycle_state='approved',approved_by=actor.id,approved_at=now() where id=review.id returning * into review;
  return to_jsonb(review);
 elsif p_action='import.apply' and exists(select 1 from public.attendance_imports where id=(p_data->>'id')::uuid and import_kind='monthly') then
  raise exception 'الملف الشهري يحتاج مراجعة ثم اعتماد';
 elsif p_action='issue.reprocess' then
  select f.* into issue_row from public.fingerprint_issues f where f.id=(p_data->>'id')::uuid for update;
  if issue_row.id is null or (p_data->>'version')::integer is distinct from issue_row.version then raise exception 'تم تعديل المشكلة؛ حدّث الصفحة';end if;
  select s.* into source_row from public.fingerprint_source_rows s where s.id=issue_row.source_row_id for update;
  select i.* into batch from public.attendance_imports i where i.id=source_row.import_id for update;
  if batch.state='cancelled' then raise exception 'لا يمكن إعادة معالجة ملف ملغى';end if;
  if source_row.match_state='invalid' or issue_row.issue_type='invalid' then raise exception 'الصف غير صالح؛ صحح الملف وأعد استيراده';end if;
  -- Confirmed identity wins; otherwise require a non-conflicting established device identifier. Names remain review candidates.
  select f.employee_id into matched_employee from public.fingerprint_identities f
   where f.person_code=source_row.person_code and f.is_active;
  match_kind='confirmed';
  if matched_employee is null then
   select e.id into code_employee from public.employees e where e.employee_number=source_row.person_code;
   select array_agg(e.id) into name_candidates from public.employees e
    where hr_private.fingerprint_name(e.name)=hr_private.fingerprint_name(source_row.source_name);
   if code_employee is not null and cardinality(name_candidates)=1 and code_employee<>name_candidates[1] then
    match_kind='ambiguous';
   elsif code_employee is not null then matched_employee=code_employee;match_kind='code';
   elsif cardinality(name_candidates)>1 then match_kind='ambiguous';
   elsif cardinality(name_candidates)=1 then match_kind='unmatched';
   else match_kind='unmatched';end if;
  end if;
  -- Attendance is calculated from these preserved punches at read time, never copied into HR statuses.
  update public.fingerprint_source_rows s set employee_id=matched_employee,match_state=match_kind where s.id=source_row.id;
  update public.fingerprint_issues f set state=case when matched_employee is null then 'open' else 'resolved' end,
   resolution_note=case when matched_employee is null then 'لا يوجد تطابق آمن بعد إعادة المعالجة' else 'أعيدت المعالجة من أدلة البصمة الأصلية' end
   where f.id=issue_row.id returning to_jsonb(f) into answer;
  update public.attendance_imports i set summary=(
   select jsonb_build_object('rows',count(*),'matched',count(*) filter(where s.employee_id is not null),
    'unmatched',count(*) filter(where s.match_state='unmatched'),'ambiguous',count(*) filter(where s.match_state='ambiguous'),
    'invalid',count(*) filter(where s.match_state='invalid'),'days',count(distinct s.calendar_date))
   from public.fingerprint_source_rows s where s.import_id=batch.id) where i.id=batch.id;
  return answer;
 end if;
 return public.attendance_write_v2(p_action,p_data);
end $$;
create or replace function public.attendance_inspect_monthly(p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare first_day date=(p_data->>'period_start')::date;last_day date=(p_data->>'period_end')::date; answer jsonb;
begin
 perform hr_private.require_role(array['ADMIN','HR']);
 if p_data->>'import_kind' is distinct from 'monthly' or first_day is null or last_day is null
  or first_day<>date_trunc('month',first_day)::date or last_day<>(first_day+interval '1 month')::date-1
  or jsonb_typeof(p_data->'rows') is distinct from 'array'
  or jsonb_array_length(p_data->'rows') not between 1 and 20000 then raise exception 'ملف شهري غير صالح';end if;
 if exists(select 1 from jsonb_array_elements(p_data->'rows') r where (r->>'calendar_date')::date not between first_day and last_day
  or (r->>'calendar_date') is null or jsonb_typeof(r->'punch_minutes') is distinct from 'array'
  or jsonb_array_length(r->'punch_minutes')>100) then raise exception 'تاريخ أو بصمات خارج النطاق';end if;
 if exists(select 1 from jsonb_array_elements(p_data->'rows') r cross join lateral jsonb_array_elements_text(r->'punch_minutes') p where p.value::integer not between 0 and 1439) then raise exception 'وقت بصمة غير صالح';end if;
 with identities as materialized (
  select distinct nullif(btrim(r->>'person_code'),'') code,r->>'source_name' name from jsonb_array_elements(p_data->'rows') r
 ), matches as materialized (
  select x.*,coalesce(f.employee_id,e.id) code_id,n.ids
  from identities x left join public.fingerprint_identities f on f.person_code=x.code and f.is_active
  left join public.employees e on e.employee_number=x.code and f.employee_id is null
  left join lateral (select array_agg(z.id) ids from public.employees z where hr_private.fingerprint_name(z.name)=hr_private.fingerprint_name(x.name)) n on true
 ), classified as (
  select r.value||jsonb_build_object('id','inspect-'||r.ordinality,'employee_id',case
   when r.value->>'invalid'='true' or (m.code_id is not null and cardinality(m.ids)=1 and m.code_id<>m.ids[1]) then null
   else m.code_id end,
   'match_state',case when r.value->>'invalid'='true' then 'invalid'
    when m.code_id is not null and cardinality(m.ids)=1 and m.code_id<>m.ids[1] then 'ambiguous'
    when m.code_id is not null then 'code' when cardinality(m.ids)>1 then 'ambiguous'
    else 'unmatched' end) value
  from jsonb_array_elements(p_data->'rows') with ordinality r join matches m
   on m.code is not distinct from nullif(btrim(r.value->>'person_code'),'') and m.name=r.value->>'source_name'
 )
 select jsonb_build_object('month',to_char(first_day,'YYYY-MM'),'available',true,'as_of',(now() at time zone 'Asia/Baghdad')::date,
  'batch',jsonb_build_object('source_name',p_data->>'source_name','lifecycle_state','preview','coverage_start',p_data->>'coverage_start','coverage_end',p_data->>'coverage_end'),
  'sources',(select coalesce(jsonb_agg(c.value),'[]') from classified c),
  'employees',(select coalesce(jsonb_agg(e),'[]') from hr_private.employee_view e where exists(select 1 from classified c where (c.value->>'employee_id')::uuid=e.id)),
  'rules',(select coalesce(jsonb_agg(x order by x.effective_from),'[]') from public.attendance_department_rules x where x.effective_from<=last_day+1),
  'issues',(select coalesce(jsonb_agg(jsonb_build_object('id',c.value->>'id','source_row_id',c.value->>'id','state','open','issue_type',c.value->>'match_state','details','تحتاج مطابقة أو مراجعة قبل الاعتماد')),'[]') from classified c where c.value->>'match_state' in ('unmatched','ambiguous','invalid')),
  'other_approved',(select jsonb_build_object('id',i.id,'source_name',i.source_name,'approved_at',v.approved_at) from public.attendance_import_reviews v join public.attendance_imports i on i.id=v.import_id where v.period_month=first_day and v.lifecycle_state='approved')
 ) into answer;
 return answer;
end $$;
-- Preserve permanent employee identities even through older clients.
create function hr_private.preserve_employee_identity() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'هوية الموظف دائمة؛ أوقف السجل من ملف الموظف بدلاً من الحذف أو نقل تاريخه إلى هوية أخرى';end $$;
create trigger preserve_identity before delete on public.employees for each row execute function hr_private.preserve_employee_identity();
revoke all on function hr_private.preserve_employee_identity() from public,anon,authenticated;
commit;
