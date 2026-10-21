alter function public.followup_read(text,jsonb) rename to read_before_staff_repairs;
alter function public.read_before_staff_repairs(text,jsonb) set schema followup_private;
create function public.followup_read(p_kind text,p_filters jsonb default '{}') returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r text:=followup_private.account_role();eid uuid:=nullif(p_filters->>'employee_id','')::uuid;result jsonb;item jsonb;
begin
 if p_kind='account_creation' then return followup_private.account_creation((p_filters->>'request_id')::uuid,'{}'::jsonb,'read');end if;
 if p_kind='decision_recovery' then return followup_private.decision_recovery((p_filters->>'request_id')::uuid,eid,p_filters->>'decision_kind',null,'read');end if;
 if p_kind='request_receipt' then
  if not followup_private.employee_scope(eid) then raise exception 'الموظف خارج صلاحيتك' using errcode='42501';end if;
  select jsonb_build_object('request_id',q.request_id,'actor',q.user_id,'kind',q.payload->>'kind','employee_id',eid,'entity_id',q.result->>'id','employee_version',coalesce(q.result->'employee_version',q.result->'version')) into result
   from public.fu_requests q where q.user_id=auth.uid() and q.request_id=(p_filters->>'request_id')::uuid and q.payload->>'kind' in ('service_state','employee_identity') and q.payload->'data'->>'employee_id'=eid::text;
  if result is not null and (r='VIEWER' or not followup_private.capability(case when result->>'kind'='service_state' then 'service_manage' else 'identity_edit' end)) then raise exception 'صلاحية القرار مسحوبة' using errcode='42501';end if;
  return coalesce(result,jsonb_build_object('found',false));
 end if;
 if p_kind='quarantine_history' then
  if r<>'ADMIN' or not followup_private.capability('archive_read') then raise exception 'التاريخ المعزول يحتاج صلاحية أرشيف مستقلة' using errcode='42501';end if;
  return jsonb_build_object('departments',(select jsonb_agg(to_jsonb(q)) from public.fu_quarantined_departments q),'reports',(select jsonb_agg(followup_private.snapshot(x.id)) from public.fu_reports x join public.fu_quarantined_departments q on q.department_id=x.department_id),'actions',(select jsonb_agg(to_jsonb(x)) from public.fu_actions x join public.fu_quarantined_departments q on q.department_id=x.department_id));
 end if;
 if p_kind='handovers' and not followup_private.capability('archive_read') then raise exception 'التسليم محفوظ في الأرشيف التاريخي المخوّل' using errcode='42501';end if;
 if p_kind in ('service_decisions','employee_duplicates') then
  if p_kind='service_decisions' then
   if not followup_private.employee_scope(eid) then raise exception 'الموظف خارج صلاحيتك' using errcode='42501';end if;
   return coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('actor_name',(select name from public.profiles where id=s.actor)) order by s.valid_from desc,s.created_at desc) from public.fu_service_decisions s where s.employee_id=eid),'[]'::jsonb);
  end if;
  if r='VIEWER' or not(followup_private.capability('roster_manage') or followup_private.capability('identity_edit')) then raise exception 'فحص التكرار يحتاج صلاحية تعديل الهوية أو إضافة الموظف' using errcode='42501';end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',e.name,'internal_code',e.internal_code,'department_name',d.arabic_name,'employee_number',e.employee_number)) from public.employees e join public.departments d on d.id=e.department_id where followup_private.employee_scope(e.id) and e.id is distinct from eid and (lower(regexp_replace(btrim(e.name),'\s+',' ','g'))=lower(regexp_replace(btrim(p_filters->>'name'),'\s+',' ','g')) or (nullif(btrim(p_filters->>'employee_number'),'') is not null and e.employee_number=btrim(p_filters->>'employee_number')))),'[]'::jsonb);
 end if;
 result:=followup_private.read_before_staff_repairs(p_kind,p_filters);
 if p_kind='reporting_model' and eid is not null and result->'positions'='[]'::jsonb then return result||jsonb_build_object('empty_reason','no_evening_history');end if;
 if p_kind='roster_setup_candidates' then return coalesce((select jsonb_agg(x) from jsonb_array_elements(result)x where followup_private.service_state((x->>'id')::uuid,coalesce(nullif(p_filters->>'start','')::date,followup_private.today())) in ('active','long_leave')),'[]'::jsonb);end if;
 if p_kind='profile' then
  return result||jsonb_build_object('read_only',false,'employee',(result->'employee')||jsonb_build_object('employment_status',followup_private.service_state(eid,followup_private.today())),'service_decisions',public.followup_read('service_decisions',p_filters));
 elsif p_kind='actions' then
  return coalesce((select jsonb_agg(x||jsonb_build_object('comments',coalesce((select jsonb_agg((to_jsonb(c)-'document_id')||jsonb_build_object('actor_name',(select name from public.profiles where id=c.actor),'document_id',case when doc.id is not null then doc.id else null end,'document_title',doc.title) order by c.created_at,c.id) from public.fu_action_comments c left join public.fu_documents doc on doc.id=c.document_id and doc.state='active' and followup_private.document_access(doc,false) where c.action_id=(x->>'id')::uuid),'[]'::jsonb))) from jsonb_array_elements(result)x),'[]'::jsonb);
 end if;
 return result;
end$$;
create or replace function public.followup_write(p_kind text,p_data jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r text:=followup_private.account_role();u uuid:=auth.uid();eid uuid:=nullif(p_data->>'employee_id','')::uuid;emp public.employees;result jsonb;oldpayload jsonb;reason text:=btrim(coalesce(p_data->>'reason',''));day date:=nullif(p_data->>'valid_from','')::date;doc public.fu_documents;decision public.fu_service_decisions;
begin
 if p_request_id is null then raise exception 'معرّف الطلب مطلوب' using errcode='22023';end if;
 if p_kind='decision_recovery_stage' then return followup_private.decision_recovery(p_request_id,(p_data->'data'->>'employee_id')::uuid,p_data->>'kind',p_data->'data','stage');end if;
 if p_kind='decision_recovery_close' then return followup_private.decision_recovery(p_request_id,eid,p_data->>'decision_kind',null,'close');end if;
 if p_kind in ('account_creation_begin','account_creation_result','account_creation_close') then return followup_private.account_creation(p_request_id,p_data,case p_kind when 'account_creation_begin' then 'begin' when 'account_creation_close' then 'close_unstarted' else 'result' end);end if;
 if p_kind='handover' then raise exception 'سجل التسليم التاريخي للقراءة فقط' using errcode='42501';end if;
 if p_kind='account' then if r<>'ADMIN' then raise exception 'إدارة الحسابات للمدير' using errcode='42501';end if;if length(reason) not between 5 and 2000 then raise exception 'اكتب سبباً واضحاً لقرار الحساب' using errcode='22023';end if;end if;
 if p_kind='assignment' then
  if p_data ? 'employment_status' and p_data->>'employment_status' is distinct from followup_private.service_state(eid,day) then raise exception 'استخدم تغيير الحالة لقرار الخدمة؛ النقل لا يغيرها' using errcode='22023';end if;
  p_data:=p_data||jsonb_build_object('employment_status',followup_private.service_state(eid,day));
 end if;
 if p_kind='employee_add' then
  if r='VIEWER' or not followup_private.capability('roster_manage') then raise exception 'إضافة الموظف تحتاج صلاحية مستقلة' using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended('employee-identity-validation',0));
  if exists(select 1 from public.employees e where nullif(btrim(p_data->>'employee_number'),'') is not null and e.employee_number=btrim(p_data->>'employee_number')) then raise exception 'الرقم الوظيفي مستخدم لموظف آخر' using errcode='23505';end if;
 end if;
 if p_kind='action' and nullif(p_data->>'attachment_document_id','') is not null then
  select * into doc from public.fu_documents where id=(p_data->>'attachment_document_id')::uuid;
  if doc.id is null or doc.employee_id is distinct from eid or doc.state<>'active' or not followup_private.document_access(doc,false) or length(btrim(coalesce(p_data->>'comment','')))<1 then raise exception 'اختر مستمسكاً فعالاً لنفس الموظف واكتب تعليق المرفق' using errcode='42501';end if;
 end if;
 if p_kind not in ('service_state','employee_identity') then
  result:=followup_private.write_before_staff_repairs(p_kind,p_data,p_request_id);
  if p_kind='account' then
   select to_jsonb(a)||jsonb_build_object('ok',true,'departments',coalesce((select jsonb_agg(x.department_id) from public.fu_departments x where x.user_id=a.user_id),'[]'::jsonb)) into result from public.fu_accounts a where a.user_id=(p_data->>'user_id')::uuid;
  end if;
  return result;
 end if;
 if r='VIEWER' or not followup_private.capability(case when p_kind='service_state' then 'service_manage' else 'identity_edit' end) or not followup_private.employee_scope(eid) then raise exception 'لا تملك صلاحية هذا التعديل في قسم الموظف' using errcode='42501';end if;
 if length(reason) not between 5 and 2000 then raise exception 'اكتب سبباً واضحاً من خمسة أحرف على الأقل' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text||p_request_id::text,0));
 perform followup_private.decision_recovery_guard(p_request_id,eid,p_kind,p_data);
 select q.result,q.payload into result,oldpayload from public.fu_requests q where q.user_id=u and q.request_id=p_request_id;
 if result is not null then if oldpayload is distinct from jsonb_build_object('kind',p_kind,'data',p_data) then raise exception 'تغيرت بيانات طلب إعادة المحاولة' using errcode='PT409';end if;return result;end if;
 -- A durable, payload-bound replay can cross midnight; only a new decision must start today or later.
 if p_kind='service_state' and (day is null or day<followup_private.today() or day>followup_private.today()+366 or not followup_private.scope_at((select department_id from public.employees where id=eid),day) or coalesce(p_data->>'employment_status','') not in ('active','inactive','resigned','long_leave')) then raise exception 'اختر حالة وتاريخ نفاذ اليوم أو المستقبل ضمن صلاحيتك' using errcode='22023';end if;
 select * into emp from public.employees where id=eid for update;
 if emp.version is distinct from (p_data->>'version')::integer then raise exception 'تغير ملف الموظف. احتفظ بالتعديل وراجع النسخة الجديدة' using errcode='PT409';end if;
 if p_kind='service_state' then
  update public.employees set updated_by=u where id=eid;
  insert into public.fu_service_decisions(employee_id,employment_status,valid_from,reason,actor,employee_version) select eid,p_data->>'employment_status',day,reason,u,version from public.employees where id=eid returning * into decision;
  result:=to_jsonb(decision);
 else
  if length(btrim(coalesce(p_data->>'name',''))) not between 1 and 150 then raise exception 'اسم الموظف مطلوب' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended('employee-identity-validation',0));
  if exists(select 1 from public.employees e where e.id<>eid and nullif(btrim(p_data->>'employee_number'),'') is not null and e.employee_number=btrim(p_data->>'employee_number')) then raise exception 'الرقم الوظيفي مستخدم لموظف آخر' using errcode='23505';end if;
  if exists(select 1 from public.employees e where e.id<>eid and lower(regexp_replace(btrim(e.name),'\s+',' ','g'))=lower(regexp_replace(btrim(p_data->>'name'),'\s+',' ','g'))) then raise exception 'يوجد اسم مطابق؛ راجع الهوية ولا تدمج السجلات' using errcode='23505';end if;
  update public.employees set name=btrim(p_data->>'name'),employee_number=nullif(btrim(p_data->>'employee_number'),''),updated_by=u where id=eid returning followup_private.redact_profile(to_jsonb(public.employees.*)) into result;
 end if;
 insert into public.fu_business_events(actor,kind,entity_id,department_id,employee_id,old_value,new_value,reason) values(u,p_kind,coalesce((result->>'id')::uuid,eid),emp.department_id,eid,followup_private.redact_profile(to_jsonb(emp)),result,reason);
 insert into public.fu_requests(user_id,request_id,result,payload) values(u,p_request_id,result,jsonb_build_object('kind',p_kind,'data',p_data));return result;
end$$;
revoke all on function followup_private.service_state(uuid,date),followup_private.write_before_staff_repairs(text,jsonb,uuid),followup_private.read_before_staff_repairs(text,jsonb),followup_private.read_before_roster_setup(text,jsonb),followup_private.write_before_roster_setup(text,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.followup_read(text,jsonb),public.followup_write(text,jsonb,uuid) from public,anon;
grant execute on function public.followup_read(text,jsonb),public.followup_write(text,jsonb,uuid) to authenticated;
commit;
