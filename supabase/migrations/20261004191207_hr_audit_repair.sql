-- Local repair; production execution requires separate authorization.
-- No identity confirmations, historical assignments or attendance approvals.
begin;
alter table public.attendance_imports add column device_namespace text not null default 'legacy-unscoped'
 check(length(btrim(device_namespace)) between 1 and 100);
alter table public.attendance_imports add column calculation_context jsonb;
alter table public.fingerprint_identities add column device_namespace text not null default 'legacy-unscoped'
 check(length(btrim(device_namespace)) between 1 and 100);
alter table public.fingerprint_identities add column confirmation_reason text;
alter table public.fingerprint_identities add column confirmed_names text[] not null default '{}';
alter table public.fingerprint_identities add column evidence_source_id uuid references public.fingerprint_source_rows(id);
alter table public.fingerprint_identities drop constraint fingerprint_identities_person_code_key;
alter table public.fingerprint_identities add constraint fingerprint_identity_namespace_code unique(device_namespace,person_code);

-- Common lock order: imports sorted by UUID, reviews sorted by import, then source and issues.
create function hr_private.lock_attendance_operation(action text,data jsonb) returns void
language plpgsql set search_path='' as $$
declare ids uuid[]; bid uuid;
begin
 if action in ('employee.merge','employee.delete_permanent') then
  raise exception 'الهوية الدائمة محمية؛ راجع التكرار ثم عطّل السجل دون نقل تاريخه';
 end if;
 if action in ('issue.resolve','issue.reprocess','identity.resolve') then
  select s.import_id into bid from public.fingerprint_source_rows s join public.fingerprint_issues f on f.source_row_id=s.id where f.id=(data->>'id')::uuid;
  ids=array[bid];
 elsif action in ('import.apply','import.cancel','import.review','import.approve','import.supersede') then
  ids=array[(data->>'id')::uuid,nullif(data->>'replacement_id','')::uuid];
 else return;end if;
 perform 1 from public.attendance_imports where id=any(ids) order by id for update;
 perform 1 from public.attendance_import_reviews where import_id=any(ids) order by import_id for update;
 if action in ('issue.resolve','issue.reprocess','identity.resolve') and not exists(
  select 1 from public.attendance_imports b left join public.attendance_import_reviews r on r.import_id=b.id
  where b.id=bid and b.state='preview' and (b.import_kind='daily' or r.lifecycle_state='preview')
 ) then raise exception 'تعديل الهوية متاح في المعاينة المفتوحة فقط؛ المصدر مغلق أو تمت مراجعته';end if;
end $$;

create function hr_private.guard_fingerprint_evidence() returns trigger language plpgsql set search_path='' as $$
declare bid uuid; b public.attendance_imports; review_state text;
begin
 if tg_table_name='fingerprint_source_rows' then
  bid=case when tg_op='DELETE' then old.import_id else new.import_id end;
  if tg_op='DELETE' then raise exception 'لا يجوز حذف دليل البصمة الأصلي';end if;
  if tg_op='UPDATE' and (new.import_id,new.source_sheet,new.source_row,new.calendar_date,new.person_code,new.source_name,new.raw_values,new.punch_minutes)
   is distinct from (old.import_id,old.source_sheet,old.source_row,old.calendar_date,old.person_code,old.source_name,old.raw_values,old.punch_minutes)
   then raise exception 'الدليل الخام غير قابل للتغيير؛ أنشئ مصدراً بديلاً موثقاً';end if;
 else
  if tg_op='DELETE' then raise exception 'لا يجوز حذف تاريخ مشاكل البصمة';end if;
  select import_id into bid from public.fingerprint_source_rows where id=new.source_row_id;
  if tg_op='UPDATE' and (new.source_row_id,new.issue_type) is distinct from (old.source_row_id,old.issue_type) then raise exception 'مرجع المشكلة ثابت';end if;
 end if;
 select * into b from public.attendance_imports where id=bid for update;
 select lifecycle_state into review_state from public.attendance_import_reviews where import_id=bid for update;
 if b.state is distinct from 'preview' or (b.import_kind='monthly' and review_state is not null and review_state<>'preview') then
  raise exception 'المصدر مغلق؛ أدلة الهوية والمراجعة مجمدة';end if;
 return new;
end $$;
create trigger guard_evidence before insert or update or delete on public.fingerprint_source_rows for each row execute function hr_private.guard_fingerprint_evidence();
create trigger guard_issue before insert or update or delete on public.fingerprint_issues for each row execute function hr_private.guard_fingerprint_evidence();

create function hr_private.safe_fingerprint_match(ns text,code text,source text) returns uuid
language plpgsql stable set search_path='' as $$
declare mapping public.fingerprint_identities; candidate uuid; names uuid[];
begin
 select * into mapping from public.fingerprint_identities where device_namespace=ns and person_code=code and is_active;
 if mapping.id is null then return null;end if;
 if not exists(select 1 from public.employees where id=mapping.employee_id and employment_status='active') then return null;end if;
 select array_agg(id) into names from public.employees where hr_private.fingerprint_name(name)=hr_private.fingerprint_name(source);
 if exists(select 1 from unnest(names) id where id<>mapping.employee_id) then return null;end if;
 -- A renamed employee remains linked to the confirmed original device name.
 if hr_private.fingerprint_name(mapping.source_name)<>hr_private.fingerprint_name(source)
  and not (hr_private.fingerprint_name(source)=any(mapping.confirmed_names))
  and not (mapping.employee_id=any(coalesce(names,'{}'))) then return null;end if;
 return mapping.employee_id;
end $$;

create function hr_private.confirm_fingerprint_mapping(source_id uuid,target uuid,reason text) returns void
language plpgsql set search_path='' as $$
declare s public.fingerprint_source_rows; ns text;
begin
 if target is null or length(btrim(coalesce(reason,''))) not between 3 and 2000 then raise exception 'اختر الموظف ووثّق مصدر إثبات الربط';end if;
 select * into s from public.fingerprint_source_rows where id=source_id;
 select device_namespace into ns from public.attendance_imports where id=s.import_id;
 if s.person_code is null then return;end if;
 insert into public.fingerprint_identities as f(device_namespace,person_code,employee_id,source_name,confirmation_reason,evidence_source_id,confirmed_names)
 values(ns,s.person_code,target,s.source_name,btrim(reason),s.id,array[hr_private.fingerprint_name(s.source_name)])
 on conflict(device_namespace,person_code) do update set
  confirmed_names=array(select distinct unnest(f.confirmed_names||excluded.confirmed_names)),confirmation_reason=excluded.confirmation_reason,evidence_source_id=excluded.evidence_source_id
 where f.employee_id=target and f.is_active;
 if not exists(select 1 from public.fingerprint_identities where device_namespace=ns and person_code=s.person_code and employee_id=target and is_active) then
  raise exception 'تعارض هوية داخل نطاق الجهاز؛ راجع إعادة استخدام الكود دون نقل تاريخ الموظف';end if;
end $$;

create function public.attendance_identity_proposal(p_filters jsonb) returns jsonb
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
  select e.id,e.name,e.internal_code,e.employment_status,count(h.id) filter(where hr_private.fingerprint_name(h.source_name)=hr_private.fingerprint_name(s.source_name)) historical_rows,
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
 if b.device_namespace='legacy-unscoped' then conflicts=array_append(conflicts,'نطاق الجهاز القديم غير موثق؛ تحقق من سجل الأجهزة قبل التأكيد');end if;
 if exists(select 1 from jsonb_array_elements(result) c where c->>'employment_status'<>'active') then conflicts=array_append(conflicts,'يوجد مرشح غير نشط؛ راجع فترة الخدمة');end if;
 return jsonb_build_object('device_namespace',b.device_namespace,'person_code',s.person_code,'candidates',result,'conflicts',conflicts,
  'classification',case when s.match_state='invalid' then 'بيانات غير صالحة' when people>1 or jsonb_array_length(result)>1 then 'تعارض / مرشحون متعددون' when jsonb_array_length(result)=1 then 'مرشح معروف بانتظار التأكيد' else 'لا يوجد مرشح' end);
end $$;
create function public.attendance_identity_registry(p_filters jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform hr_private.require_role(array['ADMIN','HR','VIEWER']);
 return (select coalesce(jsonb_agg(f order by f.device_namespace,f.person_code),'[]') from public.fingerprint_identities f where f.employee_id=(p_filters->>'employee_id')::uuid);
end $$;

create function hr_private.freeze_daily_context() returns trigger language plpgsql set search_path='' as $$
begin
 if old.state<>'preview' and (new.device_namespace,new.source_hash,new.import_kind,new.period_start,new.period_end,new.coverage_start,new.coverage_end,new.calculation_context)
  is distinct from (old.device_namespace,old.source_hash,old.import_kind,old.period_start,old.period_end,old.coverage_start,old.coverage_end,old.calculation_context) then raise exception 'سياق المصدر المغلق ثابت';end if;
 if new.import_kind='daily' and new.state='applied' and old.state='preview' then
  perform pg_advisory_xact_lock(hashtextextended('daily:'||new.period_start::text,0));
  if exists(select 1 from public.fingerprint_source_rows s join public.fingerprint_source_rows x on x.employee_id=s.employee_id and x.calendar_date=s.calendar_date
   join public.attendance_imports i on i.id=x.import_id where s.import_id=new.id and i.id<>new.id and i.import_kind='daily' and i.state='applied') then
   raise exception 'يوجد مصدر يومي معتمد للموظف والتاريخ؛ استخدم الاستبدال الصريح';end if;
  new.calculation_context=jsonb_build_object('assignments',hr_private.assignment_evidence(array(select distinct employee_id from public.fingerprint_source_rows where import_id=new.id and employee_id is not null)),
   'rules',(select coalesce(jsonb_agg(r),'[]') from public.attendance_department_rules r),
   'managers',(select coalesce(jsonb_agg(m),'[]') from public.managers m),'calculation_version','2026-10-04-entry-only');
 end if;
 return new;
end $$;
create trigger freeze_daily_context before update on public.attendance_imports for each row execute function hr_private.freeze_daily_context();

-- Optional fields are not matching prerequisites and retain existing employee UUIDs.
alter table public.employees add column phone text check(length(phone)<=50);
alter table public.employees add column emergency_phone text check(length(emergency_phone)<=50);
alter table public.employees add column education text check(length(education)<=150);
create or replace view hr_private.employee_view as
 select e.id,e.employee_number,e.name,e.department_id,e.shift_id,e.direct_manager_id,e.employment_status,e.version,e.created_at,e.updated_at,e.created_by,e.updated_by,
 d.arabic_name||' ('||d.english_name||')' department,d.display_order,s.name shift,coalesce(me.name,m.name) manager,e.internal_code,e.phone,e.emergency_phone,e.education
 from public.employees e join public.departments d on d.id=e.department_id
 left join public.shifts s on s.id=e.shift_id left join public.managers m on m.id=e.direct_manager_id left join public.employees me on me.id=m.employee_id;

-- Optional manager/shift values do not create false employee-quality alarms.
create or replace view hr_private.review_view as
 select e.id employee_id,e.name,e.department,e.created_at,'لا يوجد إعداد دوام ساري للقسم الحالي'::text issue
 from hr_private.employee_view e where e.employment_status='active' and not exists(
 select 1 from public.attendance_department_rules r where r.department_id=e.department_id and r.effective_from<=(now() at time zone 'Asia/Baghdad')::date);

revoke all on function hr_private.lock_attendance_operation(text,jsonb),hr_private.guard_fingerprint_evidence(),hr_private.safe_fingerprint_match(text,text,text),hr_private.confirm_fingerprint_mapping(uuid,uuid,text),hr_private.freeze_daily_context() from public,anon,authenticated;
revoke all on function public.attendance_identity_proposal(jsonb),public.attendance_identity_registry(jsonb) from public,anon,authenticated;
grant execute on function public.attendance_identity_proposal(jsonb),public.attendance_identity_registry(jsonb) to authenticated;

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
   and import_kind=p_data->>'import_kind' and period_start=(p_data->>'period_start')::date and period_end=(p_data->>'period_end')::date;
  if found then
   if batch.device_namespace<>coalesce(nullif(btrim(p_data->>'device_namespace'),''),'legacy-unscoped') then raise exception 'الملف محفوظ ضمن نطاق جهاز آخر؛ راجع مصدره';end if;
   return to_jsonb(batch)||jsonb_build_object('duplicate',true);end if;
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

create or replace function public.attendance_write_v2(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.profiles; source_id uuid; target_id uuid; source_employee public.employees;
 target_employee public.employees; sm uuid; tm uuid; linked integer;
begin
 perform hr_private.lock_attendance_operation(p_action,p_data);
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

create or replace function public.attendance_write_v3(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.profiles; batch public.attendance_imports; review public.attendance_import_reviews; old_review public.attendance_import_reviews; answer jsonb;
 issue_row public.fingerprint_issues; source_row public.fingerprint_source_rows;
 matched_employee uuid; code_employee uuid; name_candidates uuid[]; match_kind text;
begin
 actor=hr_private.require_role(array['ADMIN','HR']);
 perform hr_private.lock_attendance_operation(p_action,p_data);
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
  matched_employee=hr_private.safe_fingerprint_match(batch.device_namespace,source_row.person_code,source_row.source_name);
  select array_agg(e.id) into name_candidates from public.employees e where hr_private.fingerprint_name(e.name)=hr_private.fingerprint_name(source_row.source_name);
  match_kind=case when matched_employee is not null then 'confirmed' when cardinality(name_candidates)>1 then 'ambiguous' else 'unmatched' end;
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
  select s.*,i.source_name import_name,i.calculation_context from public.fingerprint_source_rows s join public.attendance_imports i on i.id=s.import_id
  where i.import_kind='daily' and i.state='applied' and s.calendar_date=day
 ), population as materialized (
  select e.* from hr_private.employee_view e where e.employment_status='active'
   or exists(select 1 from sources s where s.employee_id=e.id)
   or exists(select 1 from public.hr_status_records h where h.employee_id=e.id and h.record_date=day and h.deleted_at is null)
   or exists(select 1 from public.employee_assignment_history a where a.employee_id=e.id and a.voided_at is null and a.employment_status='active' and day>=a.valid_from and (a.valid_to is null or day<=a.valid_to))
 ) select jsonb_build_object('date',day,'as_of',(now() at time zone 'Asia/Baghdad')::date,
  'employees',(select coalesce(jsonb_agg(e order by display_order,name,id),'[]') from population e),
  'sources',(select coalesce(jsonb_agg(s),'[]') from sources s),
  'imports',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'source_name',i.source_name,'state',i.state,'linked_rows',(select count(*) from public.fingerprint_source_rows s where s.import_id=i.id and s.employee_id is not null),'unlinked_rows',(select count(*) from public.fingerprint_source_rows s where s.import_id=i.id and s.employee_id is null))),'[]') from public.attendance_imports i where i.import_kind='daily' and i.state='applied' and day between i.period_start and i.period_end),
  'managers',(select coalesce(jsonb_agg(m),'[]') from public.managers m),
  'rules',(select coalesce(jsonb_agg(r),'[]') from public.attendance_department_rules r where effective_from<=day+1),
  'manual_records',(select coalesce(jsonb_agg(h),'[]') from public.hr_status_records h where h.record_date=day and h.deleted_at is null),
  'notes',(select coalesce(jsonb_agg(n),'[]') from public.attendance_daily_notes n where n.work_date=day),
  'issues',(select coalesce(jsonb_agg(f),'[]') from public.fingerprint_issues f join sources s on s.id=f.source_row_id)) into answer;
 return hr_private.with_assignment_evidence(answer);
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
  select x.*,hr_private.safe_fingerprint_match(coalesce(nullif(btrim(p_data->>'device_namespace'),''),'legacy-unscoped'),x.code,x.name) code_id,n.ids
  from identities x
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
  if e.department_id is distinct from (p_data->>'department_id')::uuid then raise exception 'هذا الموظف تابع لقسم مختلف';end if;
  if item_id is null and e.employment_status<>'active' then raise exception 'الموظف غير نشط';end if;
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
-- Explicitly attach an already-approved adjacent monthly source while in preview.
-- Copy its first calendar day's evidence into this source's snapshot. Later source
-- replacement never changes this report, and daily sources are never eligible.
create table public.attendance_boundary_evidence (
 id uuid not null unique default gen_random_uuid(),
 import_id uuid primary key references public.attendance_imports(id),
 adjacent_import_id uuid not null references public.attendance_imports(id),
 sources jsonb not null, assignments jsonb not null, rules jsonb not null,
 reason text not null check(length(btrim(reason)) between 3 and 2000),
 created_by uuid references public.profiles(id),created_at timestamptz not null default now()
);
alter table public.attendance_boundary_evidence enable row level security;
revoke all on public.attendance_boundary_evidence from public,anon,authenticated;
create trigger audit after insert on public.attendance_boundary_evidence for each row execute function hr_private.audit();
create function public.attendance_boundary_record(p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.attendance_imports;a public.attendance_imports;r public.attendance_import_reviews; context jsonb;
begin
 perform hr_private.require_role(array['ADMIN','HR']);
 perform 1 from public.attendance_imports where id in ((p_data->>'id')::uuid,(p_data->>'adjacent_import_id')::uuid) order by id for update;
 perform 1 from public.attendance_import_reviews where import_id in ((p_data->>'id')::uuid,(p_data->>'adjacent_import_id')::uuid) order by import_id for update;
 select * into b from public.attendance_imports where id=(p_data->>'id')::uuid;
 select * into a from public.attendance_imports where id=(p_data->>'adjacent_import_id')::uuid;
 select * into r from public.attendance_import_reviews where import_id=b.id;
 if b.version is distinct from (p_data->>'version')::integer or b.state<>'preview' or r.lifecycle_state is distinct from 'preview' then raise exception 'المعاينة تغيرت أو مغلقة';end if;
 if a.import_kind is distinct from 'monthly' or a.device_namespace<>b.device_namespace or a.period_start<>b.period_end+1
  or not exists(select 1 from public.attendance_import_reviews where import_id=a.id and lifecycle_state='approved') then raise exception 'اختر مصدراً شهرياً معتمداً للشهر التالي ضمن نطاق الجهاز نفسه';end if;
 select calculation_context into context from public.attendance_import_reviews where import_id=a.id;
 insert into public.attendance_boundary_evidence(import_id,adjacent_import_id,sources,assignments,rules,reason,created_by)
 select b.id,a.id,coalesce(jsonb_agg(s),'[]'),coalesce(context->'assignments','[]'),coalesce(context->'rules','[]'),btrim(p_data->>'reason'),auth.uid()
 from public.fingerprint_source_rows s where s.import_id=a.id and s.calendar_date=a.period_start;
 update public.attendance_imports set summary=summary||jsonb_build_object('boundary_import_id',a.id) where id=b.id;
 update public.attendance_import_reviews set updated_at=now() where id=r.id;
 return jsonb_build_object('saved',true,'adjacent_import_id',a.id);
end $$;
-- Preserve approved monthly context and add only the explicit immutable boundary.
create or replace function public.attendance_monthly_evidence_v2(p_filters jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare answer jsonb;frozen jsonb;boundary public.attendance_boundary_evidence;
begin
 answer=public.attendance_monthly_evidence(p_filters);
 if answer->>'available'='false' then return answer;end if;
 answer=hr_private.with_assignment_evidence(answer);
 select calculation_context into frozen from public.attendance_import_reviews where import_id=(answer->'batch'->>'id')::uuid;
 answer=case when frozen is null then answer||jsonb_build_object('calculation_basis','live_evidence') else answer||frozen||jsonb_build_object('calculation_basis','approval_snapshot') end;
 select * into boundary from public.attendance_boundary_evidence where import_id=(answer->'batch'->>'id')::uuid;
 if boundary.import_id is not null then
  answer=answer||jsonb_build_object('boundary_sources',boundary.sources,'boundary_import_id',boundary.adjacent_import_id,
   'assignments',coalesce((select jsonb_agg(h||jsonb_build_object('valid_from',(answer->'batch'->>'period_end')::date+1)) from jsonb_array_elements(boundary.assignments) h where (h->>'valid_from')::date<=(answer->'batch'->>'period_end')::date+1 and (nullif(h->>'valid_to','') is null or (h->>'valid_to')::date>(answer->'batch'->>'period_end')::date)),'[]')||coalesce(answer->'assignments','[]'),
   'rules',coalesce(answer->'rules','[]')||coalesce((select jsonb_agg(h||jsonb_build_object('effective_from',(answer->'batch'->>'period_end')::date+1)) from (select distinct on (v->>'department_id') v h from jsonb_array_elements(boundary.rules) v where (v->>'effective_from')::date<=(answer->'batch'->>'period_end')::date+1 order by v->>'department_id',v->>'effective_from' desc) selected),'[]'));
 end if;
 return answer;
end $$;
revoke all on function public.attendance_boundary_record(jsonb) from public,anon,authenticated;
grant execute on function public.attendance_boundary_record(jsonb) to authenticated;
create function public.attendance_daily_replace(p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.attendance_imports;r public.attendance_imports;
begin
 perform hr_private.require_role(array['ADMIN']);
 if length(btrim(coalesce(p_data->>'reason',''))) not between 3 and 2000 then raise exception 'سبب الاستبدال مطلوب';end if;
 perform 1 from public.attendance_imports where id in ((p_data->>'id')::uuid,(p_data->>'replacement_id')::uuid) order by id for update;
 select * into b from public.attendance_imports where id=(p_data->>'id')::uuid;
 select * into r from public.attendance_imports where id=(p_data->>'replacement_id')::uuid;
 if b.version is distinct from (p_data->>'version')::integer or r.version is distinct from (p_data->>'replacement_version')::integer
  or b.import_kind is distinct from 'daily' or r.import_kind is distinct from 'daily' or b.state<>'applied' or r.state<>'preview'
  or b.period_start<>r.period_start or b.period_end<>r.period_end or b.device_namespace<>r.device_namespace then raise exception 'الاستبدال غير صالح أو تغير أحد الملفين';end if;
 update public.attendance_imports set state='cancelled',summary=summary||jsonb_build_object('replaced_by',r.id,'replacement_reason',p_data->>'reason') where id=b.id;
 update public.attendance_imports set state='applied',summary=summary||jsonb_build_object('replaces',b.id,'replacement_reason',p_data->>'reason') where id=r.id returning * into r;
 return to_jsonb(r);
end $$;
revoke all on function public.attendance_daily_replace(jsonb) from public,anon,authenticated;
grant execute on function public.attendance_daily_replace(jsonb) to authenticated;
commit;
