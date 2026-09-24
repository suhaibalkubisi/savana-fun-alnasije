-- Review workflow only: retain UUIDs, original evidence, attendance rules and history.
begin;

-- The group boundary is explicit: one preview, one Person Code and normalized
-- source name. Invalid rows and unrelated problem types are never bulk-resolved.
create function hr_private.identity_issues(source_id uuid)
returns table(issue_id uuid,issue_version integer,source_row_id uuid,source_version integer,calendar_date date)
language sql stable set search_path='' as $$
 select f.id,f.version,s.id,s.version,s.calendar_date
 from public.fingerprint_source_rows base
 join public.attendance_imports b on b.id=base.import_id and b.import_kind='monthly' and b.state='preview'
 join public.attendance_import_reviews r on r.import_id=b.id and r.lifecycle_state='preview'
 join public.fingerprint_source_rows s on s.import_id=base.import_id
  and s.person_code=base.person_code
  and hr_private.fingerprint_name(s.source_name)=hr_private.fingerprint_name(base.source_name)
 join public.fingerprint_issues f on f.source_row_id=s.id
 where base.id=source_id and nullif(btrim(base.person_code),'') is not null
  and f.state='open' and f.issue_type in ('unmatched','ambiguous','code_conflict')
  and s.match_state in ('unmatched','ambiguous')
$$;

create function public.attendance_identity_resolve(p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.fingerprint_source_rows; b public.attendance_imports; f public.fingerprint_issues;
 target uuid=nullif(p_data->>'employee_id','')::uuid; note text=btrim(p_data->>'resolution_note');
 token text; issue_ids uuid[]; source_ids uuid[]; n integer;
begin
 perform hr_private.require_role(array['ADMIN','HR']);
 if target is null or coalesce(length(note),0) not between 1 and 2000
  or coalesce(p_data->>'group_token','') !~ '^[a-f0-9]{32}$' then raise exception 'اختر الموظف واكتب سبب الربط ثم حدّث المعاينة';end if;
 select x.* into s from public.fingerprint_source_rows x join public.fingerprint_issues y on y.source_row_id=x.id where y.id=(p_data->>'id')::uuid;
 if s.id is null then raise exception 'المشكلة غير موجودة';end if;
 -- Same serialization boundary as review/approval. No cross-import propagation.
 select * into b from public.attendance_imports where id=s.import_id for update;
 perform 1 from public.attendance_import_reviews where import_id=b.id for update;
 if b.import_kind<>'monthly' or b.state<>'preview' or not exists(
  select 1 from public.attendance_import_reviews where import_id=b.id and lifecycle_state='preview'
 ) then raise exception 'الربط الجماعي متاح للمعاينة الشهرية قبل إنهاء المراجعة فقط';end if;
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
 insert into public.fingerprint_identities(person_code,employee_id,source_name)
 values(s.person_code,target,s.source_name) on conflict(person_code) do nothing;
 if not exists(select 1 from public.fingerprint_identities where person_code=s.person_code and employee_id=target and is_active)
 then raise exception 'رمز الشخص مرتبط بموظف آخر أو ربط غير نشط؛ لم يتغير أي يوم';end if;
 update public.fingerprint_source_rows set employee_id=target,match_state='confirmed' where id=any(source_ids);
 update public.fingerprint_issues set state='resolved',resolution_note=note where id=any(issue_ids);
 update public.attendance_imports i set summary=(
  select jsonb_build_object('rows',count(*),'matched',count(*) filter(where x.employee_id is not null),
   'unmatched',count(*) filter(where x.match_state='unmatched'),'ambiguous',count(*) filter(where x.match_state='ambiguous'),
   'invalid',count(*) filter(where x.match_state='invalid'),'days',count(distinct x.calendar_date))
  from public.fingerprint_source_rows x where x.import_id=b.id) where i.id=b.id;
 return jsonb_build_object('import_id',b.id,'resolved_issues',n,'lifecycle_state','preview');
end $$;

-- Also protect replacement approval, not just the normal V3 approve branch.
create function hr_private.require_clear_import_review() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.lifecycle_state in ('reviewed','approved') and new.lifecycle_state is distinct from old.lifecycle_state
  and exists(select 1 from public.fingerprint_issues f join public.fingerprint_source_rows s on s.id=f.source_row_id
   where s.import_id=new.import_id and f.state='open') then
  raise exception 'عالج مشاكل المطابقة المفتوحة قبل اعتماد الملف';
 end if;
 return new;
end $$;
create trigger require_clear_import_review before update on public.attendance_import_reviews
 for each row execute function hr_private.require_clear_import_review();

-- Preview creation is already audited at batch level, including source hash,
-- actor, time, period and reconciliation summary. Immutable source evidence is
-- retained. Keep every later row/issue UPDATE audit and all older audit records.
-- Inserts outside preview still receive the original detailed audit.
create function hr_private.preview_import(import_id uuid) returns boolean
language sql stable set search_path='' as $$
 select exists(select 1 from public.attendance_imports i where i.id=import_id and i.state='preview')
$$;
create function hr_private.preview_source(source_id uuid) returns boolean
language sql stable set search_path='' as $$
 select exists(select 1 from public.fingerprint_source_rows s join public.attendance_imports i on i.id=s.import_id
  where s.id=source_id and i.state='preview')
$$;
drop trigger audit_attendance on public.fingerprint_source_rows;
create trigger audit_attendance after update on public.fingerprint_source_rows
 for each row execute function hr_private.audit();
create trigger audit_non_preview_insert after insert on public.fingerprint_source_rows
 for each row when (not hr_private.preview_import(new.import_id)) execute function hr_private.audit();
drop trigger audit_attendance on public.fingerprint_issues;
create trigger audit_attendance after update on public.fingerprint_issues
 for each row execute function hr_private.audit();
create trigger audit_non_preview_insert after insert on public.fingerprint_issues
 for each row when (not hr_private.preview_source(new.source_row_id)) execute function hr_private.audit();

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
     and b.import_kind='monthly' and r.lifecycle_state='preview' and b.state='preview'
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

revoke all on function public.attendance_identity_resolve(jsonb) from public,anon,authenticated;
grant execute on function public.attendance_identity_resolve(jsonb) to authenticated;
revoke all on function hr_private.identity_issues(uuid),hr_private.require_clear_import_review(),
 hr_private.preview_import(uuid),hr_private.preview_source(uuid) from public,anon,authenticated;
-- CREATE OR REPLACE preserves existing V3 owner and execution grants.
alter function hr_private.immutable_audit() set search_path='';
commit;
