-- Additive attendance-core reconciliation and monthly approval lifecycle.
-- Existing imports, source rows, employee UUIDs and HR history are preserved.
begin;

create table public.attendance_import_reviews (
 id uuid primary key default gen_random_uuid(),
 import_id uuid not null unique references public.attendance_imports(id) on delete restrict,
 period_month date not null check(period_month=date_trunc('month',period_month)::date),
 lifecycle_state text not null default 'preview' check(lifecycle_state in ('preview','reviewed','approved','superseded','cancelled')),
 reviewed_by uuid references public.profiles(id) on delete restrict,
 reviewed_at timestamptz,
 approved_by uuid references public.profiles(id) on delete restrict,
 approved_at timestamptz,
 superseded_by uuid references public.attendance_imports(id) on delete restrict,
 notes text check(length(notes)<=2000),
 version integer not null default 1,
 created_by uuid references public.profiles(id) on delete restrict,
 updated_by uuid references public.profiles(id) on delete restrict,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index attendance_one_approved_month
 on public.attendance_import_reviews(period_month)
 where lifecycle_state='approved';
create index attendance_review_state_month
 on public.attendance_import_reviews(lifecycle_state,period_month);
alter table public.attendance_import_reviews enable row level security;
revoke all on public.attendance_import_reviews from public,anon,authenticated;
create trigger touch_attendance before insert or update on public.attendance_import_reviews
 for each row execute function hr_private.touch_attendance();
create trigger audit_attendance after insert or update on public.attendance_import_reviews
 for each row execute function hr_private.audit();

with ranked as (
 select i.*,row_number() over(partition by date_trunc('month',i.period_start) order by i.updated_at desc,i.id) approved_rank
 from public.attendance_imports i where i.import_kind='monthly'
)
insert into public.attendance_import_reviews(import_id,period_month,lifecycle_state,reviewed_at,approved_at,created_by,updated_by)
select i.id,date_trunc('month',i.period_start)::date,
 case when i.state='applied' and i.approved_rank=1 then 'approved' when i.state='applied' then 'superseded' when i.state='cancelled' then 'cancelled' else 'preview' end,
 case when i.state='applied' then i.updated_at end,
 case when i.state='applied' and i.approved_rank=1 then i.updated_at end,i.created_by,i.updated_by
from ranked i
where i.import_kind='monthly'
and not exists(select 1 from public.attendance_import_reviews r where r.import_id=i.id)
;

create or replace view hr_private.approved_monthly_source_rows as
select s.* from public.fingerprint_source_rows s
join public.attendance_imports i on i.id=s.import_id and i.import_kind='monthly'
join public.attendance_import_reviews r on r.import_id=i.id and r.lifecycle_state='approved';

create or replace function hr_private.attendance_session(day date,dep uuid default null,monthly_only boolean default false)
returns table(
 employee_id uuid,employee_number text,person_code text,name text,department_id uuid,department text,display_order integer,
 manager text,scheduled_start_minute integer,entry_minute integer,exit_minute integer,duration_minutes integer,
 attendance_state text,status text,late_minutes integer,manual_status text,status_record_id uuid,status_record_version integer,
 notes text,procedure_text text,note_id uuid,note_version integer,expected boolean,daily_note_text text,needs_review boolean)
language sql stable set search_path='' as $$
with base as (
 select e.*,rule.id rule_id,rule.start_minute,rule.grace_minutes,rule.entry_window_start,rule.entry_window_end,
  rule.working_weekdays,coalesce(e.manager,m.name) resolved_manager,
  r.id status_record_id,r.version status_record_version,r.status_type manual,r.late_minutes manual_minutes,r.notes manual_notes,
  n.notes daily_notes,n.procedure_text,n.id note_id,n.version note_version,fi.person_code
 from hr_private.employee_view e
 left join lateral(select * from public.attendance_department_rules z where z.department_id=e.department_id and z.effective_from<=day order by effective_from desc limit 1) rule on true
 left join public.managers m on m.id=rule.default_manager_id
 left join public.hr_status_records r on r.employee_id=e.id and r.record_date=day and r.deleted_at is null
 left join public.attendance_daily_notes n on n.employee_id=e.id and n.work_date=day
 left join lateral(select person_code from public.fingerprint_identities f where f.employee_id=e.id and f.is_active order by f.created_at limit 1) fi on true
 where e.employment_status='active' and (dep is null or e.department_id=dep)
), punches as (
 select s.employee_id,s.calendar_date,p.minute,i.import_kind
 from public.fingerprint_source_rows s
 join public.attendance_imports i on i.id=s.import_id and i.state='applied'
 left join public.attendance_import_reviews ar on ar.import_id=i.id
 cross join lateral unnest(s.punch_minutes) p(minute)
 where s.calendar_date between day and day+1 and s.employee_id is not null
  and (not monthly_only or (i.import_kind='monthly' and ar.lifecycle_state='approved'))
), computed as (
 select b.*,
  (select min(p.minute) from punches p where p.employee_id=b.id and p.calendar_date=day and p.minute between b.entry_window_start and b.entry_window_end) entry,
  (select max(candidate) from (
    select p.minute candidate from punches p where p.employee_id=b.id and p.calendar_date=day
      and p.minute>b.entry_window_end
    union all
    select 1440+p.minute from punches p where p.employee_id=b.id and p.calendar_date=day and p.import_kind='monthly'
      and p.minute<b.entry_window_start
    union all
    select 1440+p.minute from punches p where p.employee_id=b.id and p.calendar_date=day+1
      and p.minute<b.entry_window_start
  ) exits) resolved_exit,
  exists(select 1 from public.fingerprint_source_rows s join public.fingerprint_issues i on i.source_row_id=s.id and i.state='open' where s.employee_id=b.id and s.calendar_date between day and day+1) open_issue
 from base b
)
select c.id,c.employee_number,c.person_code,c.name,c.department_id,c.department,c.display_order,c.resolved_manager,
 c.start_minute,c.entry,case when c.resolved_exit>=1440 then c.resolved_exit-1440 else c.resolved_exit end,
 case when c.entry is not null and c.resolved_exit is not null then c.resolved_exit-c.entry end,
 case when c.entry is not null and c.resolved_exit is null then 'pending_exit' when c.entry is not null then 'complete' else 'no_entry' end,
 coalesce(c.manual,case when c.rule_id is null then 'missing_schedule' when not(extract(dow from day)::integer=any(c.working_weekdays)) then 'off_day' when c.entry is null then 'no_entry' when c.entry>c.start_minute+c.grace_minutes then 'late' else 'present' end),
 case when c.manual='late' then c.manual_minutes when c.manual is not null then 0 when c.entry>c.start_minute+c.grace_minutes then c.entry-c.start_minute else 0 end,
 c.manual,c.status_record_id,c.status_record_version,concat_ws(' — ',nullif(c.manual_notes,''),nullif(c.daily_notes,'')),
 coalesce(c.procedure_text,''),c.note_id,c.note_version,coalesce(extract(dow from day)::integer=any(c.working_weekdays),true),
 coalesce(c.daily_notes,''),c.open_issue or c.rule_id is null
from computed c order by c.display_order,c.department,c.name,c.id
$$;

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
   select coalesce(jsonb_agg(x order by display_order,department,name),'[]') from (
    select a.employee_id,a.employee_number,a.person_code,a.name,a.department,a.department_id,a.display_order,a.manager,
     jsonb_object_agg(extract(day from d)::integer::text,jsonb_build_object('entry',a.entry_minute,'exit',a.exit_minute,'duration',a.duration_minutes,'state',a.attendance_state)) cells
    from generate_series(start_day::timestamp,end_day::timestamp,interval '1 day') d
    cross join lateral hr_private.attendance_session(d::date,dep,true) a
    group by a.employee_id,a.employee_number,a.person_code,a.name,a.department,a.department_id,a.display_order,a.manager
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
  -- Confirmed identity wins; otherwise require a non-conflicting code or unique name.
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
   elsif cardinality(name_candidates)=1 then matched_employee=name_candidates[1];match_kind='unique_name';
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

create or replace function public.hr_read_v3(p_kind text,p_filters jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare from_day date;to_day date;dep uuid=nullif(p_filters->>'department_id','')::uuid;sh uuid=nullif(p_filters->>'shift_id','')::uuid;
 mgr uuid=nullif(p_filters->>'manager_id','')::uuid;emp uuid=nullif(p_filters->>'employee_id','')::uuid;term text=btrim(coalesce(p_filters->>'search',''));result jsonb;
begin
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

revoke all on function public.attendance_read_v3(text,jsonb),public.attendance_write_v3(text,jsonb),public.hr_read_v3(text,jsonb) from public,anon,authenticated;
grant execute on function public.attendance_read_v3(text,jsonb),public.attendance_write_v3(text,jsonb),public.hr_read_v3(text,jsonb) to authenticated;
revoke all on function hr_private.attendance_session(date,uuid,boolean) from public,anon,authenticated;
revoke all on all functions in schema hr_private from public,anon,authenticated;
commit;
