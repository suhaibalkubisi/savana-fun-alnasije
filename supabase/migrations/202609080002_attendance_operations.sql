-- Additive, role-checked attendance API. Existing HR records are never rewritten.
begin;
create function hr_private.fingerprint_name(v text) returns text
language sql immutable set search_path='' as $$
 select regexp_replace(translate(lower(btrim(v)), 'أإآىؤئة', 'ااايويه'), '[[:space:][:punct:]ـًٌٍَُِّْ]+', '', 'g')
$$;

create function public.attendance_write(p_action text,p_data jsonb) returns jsonb
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
   elsif name_emp is not null then emp=name_emp;match='unique_name';
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

create function hr_private.attendance_day(day date,dep uuid default null) returns table(
 employee_id uuid,employee_number text,name text,department_id uuid,department text,display_order integer,
 manager text,entry_minute integer,exit_minute integer,duration_minutes integer,status text,late_minutes integer,
 manual_status text,notes text,procedure_text text,note_id uuid,note_version integer,expected boolean,daily_note_text text)
language sql stable set search_path='' as $$
 with base as (
 select e.*, rule.id rule_id,rule.start_minute,rule.grace_minutes,rule.entry_window_start,rule.entry_window_end,
  rule.working_weekdays,coalesce(e.manager,m.name) resolved_manager,
  r.status_type manual,r.late_minutes manual_minutes,r.notes manual_notes,n.notes daily_notes,n.procedure_text,n.id note_id,n.version note_version
 from hr_private.employee_view e
 left join lateral(select * from public.attendance_department_rules z where z.department_id=e.department_id and z.effective_from<=day order by effective_from desc limit 1) rule on true
 left join public.managers m on m.id=rule.default_manager_id
 left join public.hr_status_records r on r.employee_id=e.id and r.record_date=day and r.deleted_at is null
 left join public.attendance_daily_notes n on n.employee_id=e.id and n.work_date=day
 where e.employment_status='active' and (dep is null or e.department_id=dep)
 ), punches as (
 select s.employee_id,s.calendar_date,p.minute from public.fingerprint_source_rows s
 join public.attendance_imports i on i.id=s.import_id and i.state='applied'
 cross join lateral unnest(s.punch_minutes) p(minute)
 where s.calendar_date between day and day+1 and s.employee_id is not null
 ), computed as (
 select b.*, (select min(p.minute) from punches p where p.employee_id=b.id and p.calendar_date=day and p.minute between b.entry_window_start and b.entry_window_end) entry,
 (select max(p.minute) from punches p where p.employee_id=b.id and p.calendar_date=day+1 and p.minute<b.entry_window_start) next_exit
 from base b
 )
 select c.id,c.employee_number,c.name,c.department_id,c.department,c.display_order,c.resolved_manager,c.entry,c.next_exit,
 case when c.entry is not null and c.next_exit is not null then 1440+c.next_exit-c.entry end,
 coalesce(c.manual,case when c.rule_id is null then 'missing_schedule' when not(extract(dow from day)::integer=any(c.working_weekdays)) then 'off_day' when c.entry is null then 'no_entry' when c.entry>c.start_minute+c.grace_minutes then 'late' else 'present' end),
 case when c.manual='late' then c.manual_minutes when c.manual is not null then 0 when c.entry>c.start_minute+c.grace_minutes then c.entry-c.start_minute else 0 end,
 c.manual,concat_ws(' — ',nullif(c.manual_notes,''),nullif(c.daily_notes,'')),coalesce(c.procedure_text,''),c.note_id,c.note_version,
 coalesce(extract(dow from day)::integer=any(c.working_weekdays),true),coalesce(c.daily_notes,'')
 from computed c order by c.display_order,c.department,c.name,c.id
$$;

create function public.attendance_read(p_kind text,p_filters jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare day date=coalesce(nullif(p_filters->>'date','')::date,(now() at time zone 'Asia/Baghdad')::date);
 dep uuid=nullif(p_filters->>'department_id','')::uuid; result jsonb; start_day date; end_day date;
begin
 perform hr_private.require_role(array['ADMIN','HR','VIEWER']);
 if p_kind='daily' then
  select jsonb_build_object('date',day,'rows',coalesce(jsonb_agg(x),'[]')) into result from (
   select * from hr_private.attendance_day(day,dep) where coalesce(p_filters->>'search','')='' or name ilike '%'||(p_filters->>'search')||'%' or employee_number ilike '%'||(p_filters->>'search')||'%'
  ) x; return result;
 elsif p_kind='monthly' then
  start_day=date_trunc('month',day)::date;end_day=(start_day+interval '1 month')::date-1;
  select jsonb_build_object('rows',coalesce(jsonb_agg(x),'[]'),'month',to_char(start_day,'YYYY-MM')) into result from (
   select a.employee_id,a.employee_number,a.name,a.department,a.department_id,a.display_order,a.manager,
    count(*) filter(where a.status='present') present,count(*) filter(where a.status='late') late,coalesce(sum(a.late_minutes),0) late_minutes,
    count(*) filter(where a.status='absence') absence,count(*) filter(where a.status='absence2') absence2,count(*) filter(where a.status='absence3') absence3,
    sum(case a.status when 'absence' then 1 when 'absence2' then 2 when 'absence3' then 3 else 0 end) weighted,
    count(*) filter(where a.status='leave') leave,count(*) filter(where a.status='no_entry') no_entry,
    count(*) filter(where a.status='missing_schedule') missing_schedule
   from generate_series(start_day::timestamp,end_day::timestamp,interval '1 day') d cross join lateral hr_private.attendance_day(d::date,dep) a
   group by a.employee_id,a.employee_number,a.name,a.department,a.department_id,a.display_order,a.manager order by a.display_order,a.department,a.name
  ) x;return result;
 elsif p_kind='rules' then
  return (select coalesce(jsonb_agg(x order by effective_from desc),'[]') from public.attendance_department_rules x);
 elsif p_kind='imports' then
  return (select coalesce(jsonb_agg(x),'[]') from (select * from public.attendance_imports order by created_at desc limit 50) x);
 elsif p_kind='import' then
  return jsonb_build_object('batch',(select to_jsonb(i) from public.attendance_imports i where id=(p_filters->>'id')::uuid),
   'rows',(select coalesce(jsonb_agg(x),'[]') from (select s.*,e.name employee_name from public.fingerprint_source_rows s left join public.employees e on e.id=s.employee_id where import_id=(p_filters->>'id')::uuid order by source_sheet,source_row,calendar_date limit 250 offset greatest(0,coalesce((p_filters->>'page')::integer,0))*250) x));
 elsif p_kind='issues' then
  return jsonb_build_object('total',(select count(*) from public.fingerprint_issues where state=coalesce(p_filters->>'state','open')),
   'rows',(select coalesce(jsonb_agg(x),'[]') from (select i.*,s.person_code,s.source_name,s.calendar_date,s.import_id from public.fingerprint_issues i join public.fingerprint_source_rows s on s.id=i.source_row_id where i.state=coalesce(p_filters->>'state','open') order by i.created_at desc limit 100 offset greatest(0,coalesce((p_filters->>'page')::integer,0))*100) x));
 end if;
 raise exception 'طلب غير صالح';
end $$;
revoke all on function public.attendance_read(text,jsonb),public.attendance_write(text,jsonb) from public,anon,authenticated;
grant execute on function public.attendance_read(text,jsonb),public.attendance_write(text,jsonb) to authenticated;
revoke all on function hr_private.fingerprint_name(text),hr_private.attendance_day(date,uuid) from public,anon,authenticated;
commit;
