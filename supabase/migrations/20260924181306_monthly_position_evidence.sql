-- Read-only evidence model shared by monthly preview and approved reporting.
begin;
alter table public.attendance_imports add column coverage_start date;
alter table public.attendance_imports add column coverage_end date;
alter table public.attendance_imports add constraint attendance_coverage_bounds check(
 (coverage_start is null and coverage_end is null) or
 (coverage_start is not null and coverage_end is not null and coverage_start>=period_start
  and coverage_end<=period_end and coverage_end>=coverage_start));

create function public.attendance_monthly_evidence(p_filters jsonb default '{}') returns jsonb
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
   'raw_values',s.raw_values,'punch_minutes',s.punch_minutes,'match_state',s.match_state) order by s.source_sheet,s.source_row,s.calendar_date),'[]')
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

create function public.attendance_write_v4(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare answer jsonb; c_start date; c_end date; b public.attendance_imports;
begin
 perform hr_private.require_role(array['ADMIN','HR']);
 if p_action='import.preview' and p_data->>'import_kind'='monthly' then
  c_start=nullif(p_data->>'coverage_start','')::date;c_end=nullif(p_data->>'coverage_end','')::date;
  if c_start is null or c_end is null or c_start<(p_data->>'period_start')::date
   or c_end>(p_data->>'period_end')::date or c_end<c_start then raise exception 'حدد نطاق التغطية داخل فترة الملف';end if;
  answer=public.attendance_write_v3(p_action,p_data);
  -- Reopening the same evidence must preserve coverage and every review decision.
  if answer->>'duplicate'='true' then return answer;end if;
  update public.attendance_imports set coverage_start=c_start,coverage_end=c_end
   where id=(answer->>'id')::uuid returning * into b;
  return answer||to_jsonb(b);
 end if;
 return public.attendance_write_v3(p_action,p_data);
end $$;

create function public.attendance_read_v4(p_kind text,p_filters jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare answer jsonb; filters jsonb=coalesce(p_filters,'{}'); term text=btrim(coalesce(p_filters->>'search',''));
begin
 perform hr_private.require_role(array['ADMIN','HR','VIEWER']);
 if p_kind='matching_employees' then
  return (select coalesce(jsonb_agg(e order by e.name,e.id),'[]') from hr_private.employee_view e);
 end if;
 if p_kind='work_queue' then
  return jsonb_build_object('monthly_pending',(select count(*) from public.attendance_import_reviews r where r.lifecycle_state in ('preview','reviewed')),
   'ready_for_approval',(select count(*) from public.attendance_import_reviews r where r.lifecycle_state='reviewed'),
   'open_identity_groups',(select count(distinct(s.import_id,coalesce(s.person_code,''),hr_private.fingerprint_name(s.source_name)))
    from public.fingerprint_issues f join public.fingerprint_source_rows s on s.id=f.source_row_id
    join public.attendance_imports i on i.id=s.import_id
    where f.state='open' and i.state='preview' and f.issue_type in ('unmatched','ambiguous','code_conflict')));
 end if;
 if p_kind='daily' and upper(term) like 'FANU-%' then filters=filters-'search';end if;
 answer=public.attendance_read_v3(p_kind,filters);
 if p_kind in ('daily','employee_duplicates') then
  answer=jsonb_set(answer,'{rows}',coalesce((select jsonb_agg(r.value||jsonb_build_object('internal_code',e.internal_code) order by r.ordinality)
   from jsonb_array_elements(answer->'rows') with ordinality r
   join public.employees e on e.id=coalesce(r.value->>'employee_id',r.value->>'id')::uuid
   where p_kind<>'daily' or upper(term) not like 'FANU-%' or e.internal_code ilike '%'||term||'%'),'[]'));
 end if;
 return answer;
end $$;

-- Transport POST, database read only: inspect before the user saves a preview.
-- Evaluate matching once per source identity, not once per calendar cell.
create function public.attendance_inspect_monthly(p_data jsonb) returns jsonb
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
   else coalesce(m.code_id,case when cardinality(m.ids)=1 then m.ids[1] end) end,
   'match_state',case when r.value->>'invalid'='true' then 'invalid'
    when m.code_id is not null and cardinality(m.ids)=1 and m.code_id<>m.ids[1] then 'ambiguous'
    when m.code_id is not null then 'code' when cardinality(m.ids)>1 then 'ambiguous'
    when cardinality(m.ids)=1 then 'unique_name' else 'unmatched' end) value
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

revoke all on function public.attendance_read_v4(text,jsonb),public.attendance_inspect_monthly(jsonb) from public,anon,authenticated;
grant execute on function public.attendance_read_v4(text,jsonb),public.attendance_inspect_monthly(jsonb) to authenticated;

revoke all on function public.attendance_monthly_evidence(jsonb),public.attendance_write_v4(text,jsonb) from public,anon,authenticated;
grant execute on function public.attendance_monthly_evidence(jsonb),public.attendance_write_v4(text,jsonb) to authenticated;
comment on function public.attendance_monthly_evidence(jsonb) is 'Explicit monthly import only. Without import_id, reads one applied/approved import only. Never consumes daily punches. No writes.';
commit;
