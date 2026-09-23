-- One monthly row per employee UUID, preserving all daily attendance.
begin;

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
 elsif p_kind='imports' then
  return (select coalesce(jsonb_agg(x order by created_at desc),'[]') from (
   select i.*,coalesce(r.lifecycle_state,i.state) lifecycle_state,r.version lifecycle_version,r.reviewed_at,r.approved_at,r.superseded_by
   from public.attendance_imports i left join public.attendance_import_reviews r on r.import_id=i.id limit 50
  ) x);
 elsif p_kind='issues' then
  return jsonb_build_object('total',(select count(*) from public.fingerprint_issues f join public.fingerprint_source_rows s on s.id=f.source_row_id join public.attendance_imports b on b.id=s.import_id where f.state=coalesce(p_filters->>'state','open') and b.state<>'cancelled'),
   'rows',(select coalesce(jsonb_agg(x),'[]') from (select f.*,s.person_code,s.source_name,s.calendar_date,s.import_id,s.raw_values,s.punch_minutes,
    (select coalesce(jsonb_agg(c),'[]') from (select e.id,e.name,e.employee_number,d.arabic_name department from public.employees e join public.departments d on d.id=e.department_id where hr_private.fingerprint_name(e.name)=hr_private.fingerprint_name(s.source_name) or e.employee_number=s.person_code limit 10)c) candidates
    from public.fingerprint_issues f join public.fingerprint_source_rows s on s.id=f.source_row_id join public.attendance_imports b on b.id=s.import_id
    where f.state=coalesce(p_filters->>'state','open') and b.state<>'cancelled' order by f.created_at desc limit 100 offset greatest(0,coalesce((p_filters->>'page')::integer,0))*100)x));
 end if;
 return public.attendance_read_v2(p_kind,p_filters);
end $$;

-- CREATE OR REPLACE preserves the existing RPC owner and execution grants.
commit;
