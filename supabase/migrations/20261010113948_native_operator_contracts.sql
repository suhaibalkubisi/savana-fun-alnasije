-- Native acceptance fixes: proved duplicate-name registry reuse and v25 snapshot wire compatibility.
-- Existing migrations, source rows, UUIDs and approved contexts remain unchanged.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create function hr_private.daily_context_for_employee(ctx jsonb,employee uuid) returns jsonb
language sql stable strict set search_path='' as $$
 with assignments as (select a from jsonb_array_elements(coalesce(ctx->'assignments','[]')) a where a->>'employee_id'=employee::text),
 rules as (select r from jsonb_array_elements(coalesce(ctx->'rules','[]')) r where r->>'department_id' in (select a->>'department_id' from assignments)),
 managers as (select m from jsonb_array_elements(coalesce(ctx->'managers','[]')) m where m->>'id' in (select a->>'direct_manager_id' from assignments union select r->>'default_manager_id' from rules))
 select jsonb_build_object('assignments',(select coalesce(jsonb_agg(a),'[]') from assignments),'rules',(select coalesce(jsonb_agg(r),'[]') from rules))
 ||case when ctx?'managers' then jsonb_build_object('managers',(select coalesce(jsonb_agg(m),'[]') from managers)) else '{}'::jsonb end;
$$;
revoke all on function hr_private.daily_context_for_employee(jsonb,uuid) from public,anon,authenticated;
create or replace function public.attendance_daily_evidence(p_filters jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare day date=coalesce(nullif(p_filters->>'date','')::date,(now() at time zone 'Asia/Baghdad')::date); answer jsonb;
begin
 perform hr_private.require_role(array['ADMIN','HR','VIEWER']);
 with sources as materialized (
  select s.*,i.source_name import_name,i.coverage_confirmed,hr_private.daily_context_for_employee(i.calculation_context,s.employee_id) calculation_context,hr_private.verified_source_identity(s.employee_id,s.match_state,i.device_namespace,s.person_code,s.source_name) identity_verified from public.fingerprint_source_rows s join public.attendance_imports i on i.id=s.import_id
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
  -- The safe matcher already rejects unconfirmed aliases/conflicting names. A proven
  -- scoped code/alias outranks duplicate-name ambiguity; do not require re-confirmation.
  if not exists(select 1 from public.fingerprint_identities m where m.device_namespace=b.device_namespace and m.person_code=s.person_code and m.employee_id=target and m.is_active and length(btrim(coalesce(m.confirmation_reason,'')))>=3) then continue;end if;
  update public.fingerprint_source_rows set employee_id=target,match_state='code' where id=s.id;
  update public.fingerprint_issues set state='resolved',resolution_note='إعادة معالجة صريحة باستخدام سجل الجهاز المؤكد' where source_row_id=s.id and state='open' and issue_type in ('unmatched','ambiguous','code_conflict');
  n=n+1;
 end loop;
 perform hr_private.refresh_import_summary(b.id);
 insert into public.audit_logs(actor_id,actor_name,action,entity_type,entity_id,description,new_values) values(actor.id,actor.name,'reprocess','attendance_imports',b.id,'إعادة معالجة معاينة مفتوحة في نطاق الجهاز '||b.device_namespace,jsonb_build_object('linked_rows',n));
 return jsonb_build_object('linked_rows',n,'import_id',b.id,'batch',(select to_jsonb(x) from public.attendance_imports x where id=b.id));
end $$;
commit;
