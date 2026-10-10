-- Phase 2 is additive: the v1 attendance functions remain intact for rollback.
begin;

create or replace function hr_private.attendance_day_v2(day date, dep uuid default null) returns table(
 employee_id uuid, employee_number text, person_code text, name text,
 department_id uuid, department text, display_order integer, manager text,
 scheduled_start_minute integer, entry_minute integer, exit_minute integer,
 duration_minutes integer, status text, late_minutes integer,
 manual_status text, status_record_id uuid, status_record_version integer,
 notes text, procedure_text text, note_id uuid, note_version integer,
 expected boolean, daily_note_text text, needs_review boolean)
language sql stable set search_path='' as $$
 with base as (
  select e.*, rule.id rule_id,rule.start_minute,rule.grace_minutes,
   rule.entry_window_start,rule.entry_window_end,rule.working_weekdays,
   coalesce(e.manager,m.name) resolved_manager,
   r.id status_record_id,r.version status_record_version,r.status_type manual,
   r.late_minutes manual_minutes,r.notes manual_notes,n.notes daily_notes,
   n.procedure_text,n.id note_id,n.version note_version,
   fi.person_code
  from hr_private.employee_view e
  left join lateral (
   select * from public.attendance_department_rules z
   where z.department_id=e.department_id and z.effective_from<=day
   order by effective_from desc limit 1
  ) rule on true
  left join public.managers m on m.id=rule.default_manager_id
  left join public.hr_status_records r on r.employee_id=e.id and r.record_date=day and r.deleted_at is null
  left join public.attendance_daily_notes n on n.employee_id=e.id and n.work_date=day
  left join lateral (
   select person_code from public.fingerprint_identities f
   where f.employee_id=e.id and f.is_active order by f.created_at limit 1
  ) fi on true
  where e.employment_status='active' and (dep is null or e.department_id=dep)
 ), punches as (
  select s.employee_id,s.calendar_date,p.minute,s.id source_row_id
  from public.fingerprint_source_rows s
  join public.attendance_imports i on i.id=s.import_id and i.state='applied'
  cross join lateral unnest(s.punch_minutes) p(minute)
  where s.calendar_date between day and day+1 and s.employee_id is not null
 ), computed as (
  select b.*,
   (select min(p.minute) from punches p where p.employee_id=b.id and p.calendar_date=day and p.minute between b.entry_window_start and b.entry_window_end) entry,
   (select max(p.minute) from punches p where p.employee_id=b.id and p.calendar_date=day+1 and p.minute<b.entry_window_start) next_exit,
   exists(
    select 1 from public.fingerprint_source_rows s
    join public.fingerprint_issues i on i.source_row_id=s.id and i.state='open'
    where s.employee_id=b.id and s.calendar_date=day
   ) open_issue
  from base b
 )
 select c.id,c.employee_number,c.person_code,c.name,c.department_id,c.department,c.display_order,
  c.resolved_manager,c.start_minute,c.entry,c.next_exit,
  case when c.entry is not null and c.next_exit is not null then 1440+c.next_exit-c.entry end,
  coalesce(c.manual,case when c.rule_id is null then 'missing_schedule'
   when not(extract(dow from day)::integer=any(c.working_weekdays)) then 'off_day'
   when c.entry is null then 'no_entry'
   when c.entry>c.start_minute+c.grace_minutes then 'late' else 'present' end),
  case when c.manual='late' then c.manual_minutes when c.manual is not null then 0
   when c.entry>c.start_minute+c.grace_minutes then c.entry-c.start_minute else 0 end,
  c.manual,c.status_record_id,c.status_record_version,
  concat_ws(' — ',nullif(c.manual_notes,''),nullif(c.daily_notes,'')),
  coalesce(c.procedure_text,''),c.note_id,c.note_version,
  coalesce(extract(dow from day)::integer=any(c.working_weekdays),true),
  coalesce(c.daily_notes,''),c.open_issue or c.rule_id is null
 from computed c order by c.display_order,c.department,c.name,c.id
$$;

create or replace function public.attendance_read_v2(p_kind text,p_filters jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare day date=coalesce(nullif(p_filters->>'date','')::date,(now() at time zone 'Asia/Baghdad')::date);
 dep uuid=nullif(p_filters->>'department_id','')::uuid; result jsonb;
begin
 perform hr_private.require_role(array['ADMIN','HR','VIEWER']);
 if p_kind='daily' then
  select jsonb_build_object('date',day,'rows',coalesce(jsonb_agg(x),'[]')) into result from (
   select * from hr_private.attendance_day_v2(day,dep)
   where coalesce(p_filters->>'search','')='' or name ilike '%'||(p_filters->>'search')||'%'
    or employee_number ilike '%'||(p_filters->>'search')||'%'
    or person_code ilike '%'||(p_filters->>'search')||'%'
  ) x;
  return result;
 elsif p_kind='employee_duplicates' then
  perform hr_private.require_role(array['ADMIN']);
  return jsonb_build_object('rows',(
   select coalesce(jsonb_agg(x order by normalized_name,name,created_at),'[]') from (
    select e.id,e.name,e.employee_number,e.employment_status,e.created_at,
     hr_private.fingerprint_name(e.name) normalized_name,
     d.arabic_name||' ('||d.english_name||')' department,
     (select person_code from public.fingerprint_identities f where f.employee_id=e.id and f.is_active order by created_at limit 1) person_code,
     (select count(*) from public.hr_status_records r where r.employee_id=e.id) status_count,
     (select count(*) from public.fingerprint_source_rows f where f.employee_id=e.id) fingerprint_count,
     (select count(*) from public.administrative_actions a where a.employee_id=e.id) action_count,
     (select count(*) from public.attendance_daily_notes n where n.employee_id=e.id) note_count
    from public.employees e join public.departments d on d.id=e.department_id
    where hr_private.fingerprint_name(e.name) in (
     select hr_private.fingerprint_name(name) from public.employees
     group by hr_private.fingerprint_name(name) having count(*)>1
    )
   ) x));
 end if;
 return public.attendance_read(p_kind,p_filters);
end $$;

create or replace function public.attendance_write_v2(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.profiles; source_id uuid; target_id uuid; source_employee public.employees;
 target_employee public.employees; sm uuid; tm uuid; linked integer;
begin
 if p_action not in ('employee.merge','employee.delete_permanent') then
  return public.attendance_write(p_action,p_data);
 end if;
 actor=hr_private.require_role(array['ADMIN']);
 source_id=(p_data->>'source_employee_id')::uuid;
 select * into source_employee from public.employees where id=source_id for update;
 if source_employee.id is null then raise exception 'الموظف غير موجود';end if;
 if p_action='employee.delete_permanent' then
  select (select count(*) from public.hr_status_records where employee_id=source_id)
   +(select count(*) from public.fingerprint_source_rows where employee_id=source_id)
   +(select count(*) from public.fingerprint_identities where employee_id=source_id)
   +(select count(*) from public.administrative_actions where employee_id=source_id)
   +(select count(*) from public.attendance_daily_notes where employee_id=source_id)
   +(select count(*) from public.managers where employee_id=source_id) into linked;
  if linked>0 then raise exception 'لا يمكن الحذف النهائي لوجود سجلات مرتبطة؛ استخدم الدمج أو التعطيل';end if;
  insert into public.audit_logs(actor_id,actor_name,action,entity_type,entity_id,description,old_values,new_values)
   values(actor.id,actor.name,'permanent_delete','employees',source_id,'حذف نهائي لسجل موظف مكرر بلا روابط · '||source_employee.name,to_jsonb(source_employee),null);
  delete from public.employees where id=source_id;
  return jsonb_build_object('deleted',true,'id',source_id);
 end if;
 target_id=(p_data->>'target_employee_id')::uuid;
 if target_id=source_id then raise exception 'اختر موظفين مختلفين';end if;
 select * into target_employee from public.employees where id=target_id for update;
 if target_employee.id is null then raise exception 'الموظف الصحيح غير موجود';end if;
 if exists(select 1 from public.hr_status_records s join public.hr_status_records t on t.employee_id=target_id and t.record_date=s.record_date and t.deleted_at is null where s.employee_id=source_id and s.deleted_at is null) then
  raise exception 'تعذر الدمج لوجود حالتين فعالتين في التاريخ نفسه؛ عالج التعارض أولاً';
 end if;
 if exists(select 1 from public.attendance_daily_notes s join public.attendance_daily_notes t on t.employee_id=target_id and t.work_date=s.work_date where s.employee_id=source_id) then
  raise exception 'تعذر الدمج لوجود ملاحظات يومية متعارضة؛ عالج التعارض أولاً';
 end if;
 update public.hr_status_records set employee_id=target_id where employee_id=source_id;
 update public.fingerprint_source_rows set employee_id=target_id where employee_id=source_id;
 update public.fingerprint_identities set employee_id=target_id where employee_id=source_id;
 update public.administrative_actions set employee_id=target_id where employee_id=source_id;
 update public.attendance_daily_notes set employee_id=target_id where employee_id=source_id;
 select id into sm from public.managers where employee_id=source_id;
 select id into tm from public.managers where employee_id=target_id;
 if sm is not null and tm is not null then
  update public.employees set direct_manager_id=tm where direct_manager_id=sm;
  update public.attendance_department_rules set default_manager_id=tm where default_manager_id=sm;
  delete from public.managers where id=sm;
 elsif sm is not null then update public.managers set employee_id=target_id where id=sm; end if;
 insert into public.audit_logs(actor_id,actor_name,action,entity_type,entity_id,description,old_values,new_values)
  values(actor.id,actor.name,'merge','employees',target_id,'دمج سجل الموظف المكرر '||source_employee.name||' مع السجل الصحيح '||target_employee.name,
   jsonb_build_object('source',to_jsonb(source_employee)),jsonb_build_object('target',to_jsonb(target_employee),'merged_source_id',source_id));
 delete from public.employees where id=source_id;
 return jsonb_build_object('merged',true,'source_employee_id',source_id,'target_employee_id',target_id);
end $$;

revoke all on function public.attendance_read_v2(text,jsonb) from public,anon,authenticated;
grant execute on function public.attendance_read_v2(text,jsonb) to authenticated;
revoke all on function public.attendance_write_v2(text,jsonb) from public,anon,authenticated;
grant execute on function public.attendance_write_v2(text,jsonb) to authenticated;
revoke all on function hr_private.attendance_day_v2(date,uuid) from public,anon,authenticated;

commit;
