create or replace function public.followup_read(p_kind text,p_filters jsonb default '{}') returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r text:=followup_private.account_role();sd date:=coalesce(nullif(p_filters->>'start','')::date,followup_private.today());ed date:=coalesce(nullif(p_filters->>'end','')::date,sd);d uuid:=nullif(p_filters->>'department_id','')::uuid;eid uuid:=nullif(p_filters->>'employee_id','')::uuid;did uuid:=nullif(p_filters->>'id','')::uuid;es uuid:=followup_private.evening_shift();result jsonb;doc public.fu_documents;emp public.employees;
begin
if nullif(p_filters->>'shift_id','') is not null and (p_filters->>'shift_id')::uuid<>es then raise exception 'العمليات مسائية فقط' using errcode='22023';end if;
if ed<sd or ed-sd>366 then raise exception 'الفترة غير صالحة' using errcode='22023';end if;
if d is not null and not followup_private.scope_at(d,sd) then raise exception 'القسم خارج صلاحيتك' using errcode='42501';end if;
if eid is not null then
 if p_kind in ('position','reports','reporting_model','completeness','actions') then
  if not exists(select 1 from public.employee_assignment_history h where h.employee_id=eid and h.voided_at is null and h.shift_id=es and h.valid_from<=ed and (h.valid_to is null or h.valid_to>=sd) and followup_private.scope_at(h.department_id,greatest(sd,h.valid_from))) and not exists(select 1 from public.fu_entries en join public.fu_reports rp on rp.id=en.report_id where en.employee_id=eid and rp.shift_id=es and rp.work_date between sd and ed and followup_private.scope_at(rp.department_id,rp.work_date)) then raise exception 'الموظف خارج صلاحيتك' using errcode='42501';end if;
 elsif not followup_private.employee_scope(eid) then raise exception 'الموظف خارج صلاحيتك' using errcode='42501';end if;
end if;
if p_kind='bootstrap' then
 return jsonb_build_object('user',public.followup_session(),'capabilities',public.followup_session()->'capabilities','evening_shift_id',es,'departments',coalesce((select jsonb_agg(to_jsonb(t) order by t.display_order,t.arabic_name) from public.departments t where followup_private.scope_at(t.id,sd)),'[]'::jsonb),'shifts',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('scope','evening')) from public.shifts t where t.id=es),'[]'::jsonb),'statuses',(select jsonb_agg(to_jsonb(t) order by code) from public.fu_statuses t),'reporters',public.followup_read('reporters',p_filters),'users',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'email',p.email,'role',a.role,'active',a.active,'version',a.version,'departments',coalesce((select jsonb_agg(department_id) from public.fu_departments where user_id=p.id),'[]'::jsonb),'capabilities',coalesce((select jsonb_object_agg(capability,granted) from public.fu_capabilities where user_id=p.id),'{}'::jsonb))) from public.profiles p left join public.fu_accounts a on a.user_id=p.id where r='ADMIN' or (a.active and (p.id=auth.uid() or exists(select 1 from public.fu_departments x where x.user_id=p.id and followup_private.scope_at(x.department_id,sd))))),'[]'::jsonb),'configuration',jsonb_build_object('unassigned_supervisors',(select count(*) from public.fu_accounts a where r='ADMIN' and a.active and a.role='SUPERVISOR' and not exists(select 1 from public.fu_departments x where x.user_id=a.user_id)),'unverified_evening_assignments',(select count(*) from public.employee_assignment_history h where h.shift_id=es and h.voided_at is null and h.evidence_kind<>'verified' and followup_private.scope_at(h.department_id,sd)),'unassigned_shift',(select count(*) from public.employees where r='ADMIN' and shift_id is null)));
elsif p_kind='employees' then
 return coalesce((select jsonb_agg(to_jsonb(t) order by display_order,name,id) from (select e.id,e.id employee_id,e.name,e.internal_code,e.employee_number,e.department_id,e.shift_id,e.employment_status,e.version,dep.arabic_name department_name,dep.display_order from public.employees e join public.departments dep on dep.id=e.department_id where e.shift_id=es and followup_private.scope_at(e.department_id,sd) and (d is null or e.department_id=d) and (eid is null or e.id=eid) and (nullif(btrim(p_filters->>'query'),'') is null or e.name ilike '%'||(p_filters->>'query')||'%' or e.internal_code ilike '%'||(p_filters->>'query')||'%' or e.employee_number ilike '%'||(p_filters->>'query')||'%' or ((followup_private.capability('profile_edit') or followup_private.capability('documents_sensitive_read')) and (e.phone ilike '%'||(p_filters->>'query')||'%' or e.secondary_phone ilike '%'||(p_filters->>'query')||'%')) or (followup_private.capability('documents_sensitive_read') and e.reference_number ilike '%'||(p_filters->>'query')||'%')))t),'[]'::jsonb);
elsif p_kind='employee_duplicates' then
 if not followup_private.capability('roster_manage') then raise exception 'مراجعة التكرار تحتاج صلاحية الانتماء' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.name,x.id) from (select e.id,e.name,e.internal_code,e.employee_number,e.department_id,dep.arabic_name department_name,e.employment_status from public.employees e join public.departments dep on dep.id=e.department_id where followup_private.scope_at(e.department_id,sd) and lower(regexp_replace(btrim(e.name),'\s+',' ','g'))=lower(regexp_replace(btrim(p_filters->>'name'),'\s+',' ','g')) or (nullif(p_filters->>'employee_number','') is not null and e.employee_number=p_filters->>'employee_number' and followup_private.scope_at(e.department_id,sd)))x),'[]'::jsonb);
elsif p_kind='roster' then
 if d is null then raise exception 'اختر القسم';end if;
 return coalesce((select jsonb_agg(to_jsonb(t) order by name,id) from (select e.id,e.name,e.internal_code,e.employee_number,h.department_id,h.shift_id,h.employment_status,h.department_id effective_department,h.shift_id effective_shift,h.id assignment_id,h.evidence_kind from public.employees e join public.employee_assignment_history h on h.employee_id=e.id and h.voided_at is null and h.valid_from<=sd and (h.valid_to is null or h.valid_to>=sd) where h.department_id=d and h.shift_id=es and h.evidence_kind='verified' and h.employment_status in ('active','long_leave') and followup_private.scope_at(h.department_id,sd))t),'[]'::jsonb);
elsif p_kind='position' then
 return coalesce((select jsonb_agg(to_jsonb(t) order by display_order,name,employee_id,work_date) from (
 with people as (select e.* from public.employees e where (eid is null or e.id=eid) and (exists(select 1 from public.employee_assignment_history h where h.employee_id=e.id and h.shift_id=es and h.voided_at is null and h.valid_from<=ed and (h.valid_to is null or h.valid_to>=sd) and followup_private.scope_at(h.department_id,greatest(sd,h.valid_from)) and (d is null or h.department_id=d)) or exists(select 1 from public.fu_entries en join public.fu_reports rp on rp.id=en.report_id where en.employee_id=e.id and rp.shift_id=es and rp.work_date between sd and ed and followup_private.scope_at(rp.department_id,rp.work_date) and (d is null or rp.department_id=d))))
 select e.id employee_id,e.name,e.internal_code,day::date work_date,coalesce(h.department_id,rp.department_id,perioddep.department_id) department_id,dep.arabic_name department_name,dep.display_order,es shift_id,coalesce(fin.status,'unresolved') status,case when fin.report_id is null then 'unresolved' else coalesce(en.status_category,st.category,'unresolved') end category,case when fin.report_id is null then 0 else coalesce(en.status_weight,st.weight,0) end absence_weight,case when fin.report_id is null then 'لم يُبلّغ / غير محدد' else coalesce(en.status_label,st.label,'لم يُبلّغ / غير محدد') end status_label,coalesce(rp.state,'missing') review_state,rp.id report_id,rp.version report_version,rp.reported_at,rp.submitted_at,rp.reviewed_at,
 case when rp.id is not null and fin.report_id is not null and (h.id is null or h.department_id<>rp.department_id or h.shift_id<>es) then 'conflict' when day::date>followup_private.today() then 'future' when h.id is null or h.shift_id is distinct from es or h.employment_status not in ('active','long_leave') then 'outside_roster' when fin.report_id is not null then case when fin.status='unresolved' then 'unresolved' else 'reported' end when h.evidence_kind<>'verified' then 'assignment_unverified' when rp.id is null then 'missing_report' else 'unresolved' end scope_state,
 case when fin.report_id is not null then 'department_declaration' when h.evidence_kind='verified' then 'verified_roster' else 'unverified_assignment' end source,
 (h.id is not null and h.shift_id=es and h.evidence_kind='verified' and h.employment_status in ('active','long_leave') and day::date<=followup_private.today()) expected,
 case when rp.id is null then 'missing' when h.id is null or h.department_id<>rp.department_id or h.shift_id is distinct from es then 'exception' when exists(select 1 from public.fu_entries x where x.report_id=rp.id and x.status='unresolved') then 'partial' else 'complete' end completeness,
 case when fin.report_id is null then en.status else null end draft_status
 from people e cross join generate_series(sd,ed,'1 day'::interval)day
 left join lateral(select a.* from public.employee_assignment_history a where a.employee_id=e.id and a.voided_at is null and a.valid_from<=day::date and (a.valid_to is null or a.valid_to>=day::date) order by a.valid_from desc limit 1)h on true
 left join lateral(select a.department_id from public.employee_assignment_history a where a.employee_id=e.id and a.voided_at is null and a.shift_id=es and a.valid_from<=ed and (a.valid_to is null or a.valid_to>=sd) and (d is null or a.department_id=d) and followup_private.scope_at(a.department_id,greatest(sd,a.valid_from)) order by a.valid_from desc limit 1)perioddep on true
 left join public.fu_final fin on fin.employee_id=e.id and fin.work_date=day::date and fin.shift_key=es
 left join lateral(select a.* from public.fu_reports a where a.shift_id=es and a.work_date=day::date and (a.id=fin.report_id or (fin.report_id is null and a.department_id=h.department_id)) and followup_private.scope_at(a.department_id,a.work_date) order by (a.id=fin.report_id) desc nulls last,a.updated_at desc limit 1)rp on true
 left join public.fu_entries en on en.report_id=rp.id and en.employee_id=e.id
 left join public.fu_statuses st on st.code=fin.status
 join public.departments dep on dep.id=coalesce(h.department_id,rp.department_id,perioddep.department_id)
 where followup_private.scope_at(dep.id,day::date) and (d is null or dep.id=d)
 )t),'[]'::jsonb);
elsif p_kind='reports' then
 return coalesce((select jsonb_agg(followup_private.report_scope(t.id,eid) order by dep.display_order,t.work_date desc,t.updated_at desc) from public.fu_reports t join public.departments dep on dep.id=t.department_id where t.shift_id=es and followup_private.scope_at(t.department_id,t.work_date) and (did is null or t.id=did) and t.work_date between sd and ed and (d is null or t.department_id=d) and (eid is null or exists(select 1 from public.fu_entries e where e.report_id=t.id and e.employee_id=eid))),'[]'::jsonb);
elsif p_kind='actions' then
 return coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('activity',coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object('actor_name',(select name from public.profiles where id=x.actor)) order by at,id) from public.fu_activity x where x.action_id=t.id),'[]'::jsonb),'comments',coalesce((select jsonb_agg(to_jsonb(x) order by created_at,id) from public.fu_action_comments x where x.action_id=t.id),'[]'::jsonb)) order by t.due_date,t.id) from public.fu_actions t where followup_private.scope_at(t.department_id,sd) and (d is null or t.department_id=d) and (eid is null or t.employee_id=eid) and (nullif(p_filters->>'state','') is null or t.state=p_filters->>'state')),'[]'::jsonb);
elsif p_kind='revisions' then
 return coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('actor_name',(select name from public.profiles where id=t.actor)) order by t.version desc) from public.fu_revisions t join public.fu_reports a on a.id=t.report_id where a.id=did and a.shift_id=es and followup_private.scope_at(a.department_id,a.work_date)),'[]'::jsonb);
elsif p_kind='reporters' then
 return coalesce((select jsonb_agg(to_jsonb(t) order by dep.display_order,t.name,t.id) from public.fu_reporters t join public.departments dep on dep.id=t.department_id where followup_private.scope_at(t.department_id,sd) and (d is null or t.department_id=d)),'[]'::jsonb);
elsif p_kind='communications' then
 return coalesce((select jsonb_agg(to_jsonb(t) order by t.occurred_at desc,t.id) from public.fu_communications t where followup_private.scope_at(t.department_id,t.work_date) and t.work_date between sd and ed and (d is null or t.department_id=d)),'[]'::jsonb);
elsif p_kind='handovers' then
 return coalesce((select jsonb_agg(to_jsonb(t) order by t.work_date desc,t.updated_at desc,t.id) from public.fu_handovers t where ((t.department_id is null and r in ('ADMIN','FOLLOWUP')) or followup_private.scope_at(t.department_id,t.work_date)) and t.work_date between sd and ed and (d is null or t.department_id=d)),'[]'::jsonb);
elsif p_kind='profile' then
 if eid is null or not followup_private.employee_scope(eid) then raise exception 'الموظف خارج صلاحيتك' using errcode='42501';end if;
 select * into emp from public.employees where id=eid;
 result:=followup_private.redact_profile(to_jsonb(emp));
 return jsonb_build_object('employee',result||jsonb_build_object('department_name',(select arabic_name from public.departments where id=emp.department_id)),'assignments',coalesce((select jsonb_agg(to_jsonb(h) order by h.valid_from desc) from public.employee_assignment_history h where h.employee_id=eid and followup_private.scope_at(h.department_id,h.valid_from)),'[]'::jsonb),'history',coalesce((select jsonb_agg((to_jsonb(x)-'old_value'-'new_value')||jsonb_build_object('old_value',followup_private.redact_profile(x.old_value),'new_value',followup_private.redact_profile(x.new_value)) order by x.at desc,x.id) from public.fu_business_events x where x.employee_id=eid and (x.kind not like 'document%' or exists(select 1 from public.fu_documents private_doc where private_doc.id=x.entity_id and followup_private.document_access(private_doc,false)))),'[]'::jsonb),'documents',public.followup_read('documents',jsonb_build_object('employee_id',eid)));
elsif p_kind='documents' then
 if eid is null or not followup_private.employee_scope(eid) then raise exception 'الموظف خارج صلاحيتك' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object('name',x.file_name,'type',x.kind,'mime',x.mime_type,'size',x.byte_size) order by x.created_at desc) from public.fu_documents x where x.employee_id=eid and x.state in ('active','archived') and followup_private.document_access(x,false)),'[]'::jsonb);
elsif p_kind='pending_documents' then
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.fu_documents x where (x.state='pending' or (coalesce(p_filters->>'include_abandoned','false')='true' and x.state='abandoned')) and x.uploaded_by=auth.uid() and followup_private.document_access(x,true) and (eid is null or x.employee_id=eid)),'[]'::jsonb);
elsif p_kind='expiring_documents' then
 return coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object('name',x.file_name,'type',x.kind,'mime',x.mime_type,'size',x.byte_size,'employee_name',(select name from public.employees where id=x.employee_id)) order by x.expires_on,x.id) from public.fu_documents x where x.state='active' and x.expires_on is not null and x.expires_on<=ed and (coalesce(p_filters->>'include_expired','false')='true' or x.expires_on>=sd) and followup_private.document_access(x,false) and (eid is null or x.employee_id=eid) and (d is null or exists(select 1 from public.employees e where e.id=x.employee_id and e.department_id=d))),'[]'::jsonb);
elsif p_kind='document' then
 select * into doc from public.fu_documents where id=did;
 if doc.id is null or (case when doc.state in ('pending','abandoned') then doc.uploaded_by is distinct from auth.uid() or not followup_private.document_access(doc,true) else not followup_private.document_access(doc,false) end) then raise exception 'المستند خارج صلاحيتك' using errcode='42501';end if;
 return to_jsonb(doc)||jsonb_build_object('name',doc.file_name,'type',doc.kind,'mime',doc.mime_type,'size',doc.byte_size);
elsif p_kind='saved_views' then
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.name,x.id) from public.fu_saved_views x where x.user_id=auth.uid() and (x.department_id is null or followup_private.scope_at(x.department_id,coalesce(x.start_date,sd))) and (x.employee_id is null or followup_private.employee_scope(x.employee_id))),'[]'::jsonb);
elsif p_kind='capabilities' then
 if r<>'ADMIN' then raise exception 'عرض صلاحيات الحسابات للمدير' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.user_id,x.capability) from public.fu_capabilities x where nullif(p_filters->>'user_id','') is null or x.user_id=(p_filters->>'user_id')::uuid),'[]'::jsonb);
elsif p_kind='search' then
 if length(btrim(coalesce(p_filters->>'query',''))) < 2 then return jsonb_build_object('employees','[]'::jsonb,'reports','[]'::jsonb,'actions','[]'::jsonb);end if;
 return jsonb_build_object('employees',coalesce((select jsonb_agg(to_jsonb(x)) from (select e.id,e.name,e.internal_code,e.department_id,dep.arabic_name department_name,e.employment_status,e.version from public.employees e join public.departments dep on dep.id=e.department_id where e.shift_id=es and followup_private.scope_at(e.department_id,sd) and (e.name ilike '%'||(p_filters->>'query')||'%' or e.internal_code ilike '%'||(p_filters->>'query')||'%' or e.employee_number ilike '%'||(p_filters->>'query')||'%' or ((followup_private.capability('profile_edit') or followup_private.capability('documents_sensitive_read')) and (e.phone ilike '%'||(p_filters->>'query')||'%' or e.secondary_phone ilike '%'||(p_filters->>'query')||'%')) or (followup_private.capability('documents_sensitive_read') and e.reference_number ilike '%'||(p_filters->>'query')||'%')) order by dep.display_order,e.name,e.id limit 20)x),'[]'::jsonb),'reports',coalesce((select jsonb_agg(followup_private.snapshot(x.id)) from (select t.id from public.fu_reports t where t.shift_id=es and followup_private.scope_at(t.department_id,t.work_date) and t.id::text ilike '%'||(p_filters->>'query')||'%' order by t.work_date desc,t.id limit 20)x),'[]'::jsonb),'actions',coalesce((select jsonb_agg(to_jsonb(x)) from (select t.* from public.fu_actions t where followup_private.scope_at(t.department_id,sd) and (t.description ilike '%'||(p_filters->>'query')||'%' or t.id::text ilike '%'||(p_filters->>'query')||'%') order by t.due_date,t.id limit 20)x),'[]'::jsonb));
elsif p_kind='reporting_model' then
 return jsonb_build_object('scope','evening','scope_employee_id',eid,'generated_at',now(),'positions',public.followup_read('position',p_filters),'reports',public.followup_read('reports',p_filters),'actions',public.followup_read('actions',p_filters),'communications',case when eid is null then public.followup_read('communications',p_filters) else '[]'::jsonb end,'handovers',case when eid is null then public.followup_read('handovers',p_filters) else '[]'::jsonb end,'employees',case when eid is null then public.followup_read('employees',p_filters) else jsonb_build_array((select jsonb_build_object('id',eid,'employee_id',eid,'name',max(x->>'name'),'internal_code',max(x->>'internal_code'),'period_departments',jsonb_agg(distinct x->>'department_name')) from jsonb_array_elements(public.followup_read('position',p_filters))x)) end,'departments',public.followup_read('bootstrap',p_filters-'employee_id')->'departments','statuses',(select jsonb_agg(to_jsonb(x) order by code) from public.fu_statuses x),'completeness',public.followup_read('completeness',p_filters));
elsif p_kind='completeness' then
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.work_date,x.display_order) from (
 select dep.id department_id,dep.arabic_name department_name,dep.display_order,day::date work_date,(count(h.id)filter(where h.evidence_kind='verified')>0 or rp.id is not null) expected,rp.id is not null reported,coalesce(rp.state in ('submitted','reviewed'),false) submitted,coalesce(rp.state='reviewed',false) reviewed,(select count(*) from public.fu_entries e where e.report_id=rp.id and e.status='unresolved') unresolved,count(h.id)filter(where h.evidence_kind='verified') roster_count,count(h.id)filter(where h.evidence_kind<>'verified') unverified_assignments,case when count(h.id)filter(where h.evidence_kind<>'verified')>0 then 1 else 0 end exceptions,coalesce(rp.state,case when count(h.id)filter(where h.evidence_kind='verified')>0 then 'missing' else 'not_configured' end) state
 from public.departments dep cross join generate_series(sd,ed,'1 day'::interval)day
 left join public.employee_assignment_history h on h.department_id=dep.id and h.shift_id=es and h.voided_at is null and h.valid_from<=day::date and (h.valid_to is null or h.valid_to>=day::date) and h.employment_status in ('active','long_leave')
 left join public.fu_reports rp on rp.department_id=dep.id and rp.shift_id=es and rp.work_date=day::date
 where dep.is_active and followup_private.scope_at(dep.id,day::date) and (d is null or dep.id=d) and (eid is null or exists(select 1 from public.fu_entries en where en.report_id=rp.id and en.employee_id=eid))
 group by dep.id,dep.arabic_name,dep.display_order,day,rp.id,rp.state
 )x),'[]'::jsonb);
elsif p_kind='archive' then
 if not followup_private.capability('archive_read') then raise exception 'الأرشيف يحتاج صلاحية مستقلة' using errcode='42501';end if;
 return jsonb_build_object('provenance','historical biometric source; not supervisor declarations','imports',coalesce((select jsonb_agg(to_jsonb(t)) from public.attendance_imports t),'[]'::jsonb),'rows',coalesce((select jsonb_agg(to_jsonb(t)) from public.fingerprint_source_rows t where t.import_id=(p_filters->>'import_id')::uuid),'[]'::jsonb));
end if;
raise exception 'طلب غير متاح' using errcode='42501';end$$;

-- Write gateway is appended by the candidate generator below.
create or replace function public.followup_write(p_kind text,p_data jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
<<gateway>>
declare r text:=followup_private.account_role();u uuid:=auth.uid();es uuid:=followup_private.evening_shift();d uuid:=nullif(p_data->>'department_id','')::uuid;eid uuid:=nullif(p_data->>'employee_id','')::uuid;rid uuid:=nullif(p_data->>'id','')::uuid;uid uuid;reason text:=btrim(coalesce(p_data->>'reason',''));result jsonb;oldpayload jsonb;oldval jsonb;newval jsonb;emp public.employees;doc public.fu_documents;h public.employee_assignment_history;sd date:=coalesce(nullif(p_data->>'work_date','')::date,followup_private.today());oldshift uuid;cap text;kind text;is_new boolean:=rid is null;
begin
if p_request_id is null then raise exception 'معرّف الطلب مطلوب' using errcode='22023';end if;
if r='VIEWER' and p_kind<>'saved_view' then raise exception 'صلاحية قراءة فقط' using errcode='42501';end if;
if nullif(p_data->>'shift_id','') is not null and (p_data->>'shift_id')::uuid<>es then raise exception 'العمليات مسائية فقط' using errcode='22023';end if;
if p_kind in ('save','submit','return','review','revise','reconcile') then
 if not followup_private.scope_at(d,sd) then raise exception 'القسم خارج صلاحيتك' using errcode='42501';end if;
 if sd>followup_private.today() then raise exception 'لا يجوز تقديم تبليغ لتاريخ خدمة لم يبدأ' using errcode='22023';end if;
 if p_kind in ('save','submit') and rid is null and p_data->>'channel'='account' and nullif(p_data->>'reporter_id','')::uuid is distinct from u then raise exception 'تبليغ الحساب يجب أن يصدر من صاحب الحساب؛ استخدم السجل والقناة الفعلية للتبليغ نيابةً عن شخص' using errcode='42501';end if;
 p_data:=p_data||jsonb_build_object('shift_id',es);
 if nullif(p_data->>'reporter_registry_id','') is not null then p_data:=p_data||jsonb_build_object('reporter_id',null);end if;
elsif p_kind in ('profile','employee_add','assignment','document','document_activate','document_archive','document_abandon') then
 if p_kind='employee_add' then
  if not followup_private.capability('roster_manage') or d is null or not followup_private.scope_at(d,sd) then raise exception 'إضافة موظف تحتاج صلاحية مستقلة' using errcode='42501';end if;
 elsif p_kind in ('document_activate','document_archive','document_abandon') then
  select * into doc from public.fu_documents where id=rid;
  if doc.id is null or not followup_private.document_access(doc,true) then raise exception 'المستند خارج صلاحيتك' using errcode='42501';end if;eid:=doc.employee_id;
 else
  if eid is null or not followup_private.employee_scope(eid) then raise exception 'الموظف خارج صلاحيتك' using errcode='42501';end if;
 end if;
 if p_kind='profile' and not followup_private.capability('profile_edit') then raise exception 'تعديل الملف يحتاج صلاحية مستقلة' using errcode='42501';end if;
 if p_kind='assignment' and (not followup_private.capability('roster_manage') or d is null or not followup_private.scope_at(d,coalesce(nullif(p_data->>'valid_from','')::date,sd))) then raise exception 'الانتماء يحتاج صلاحية مستقلة' using errcode='42501';end if;
 if p_kind='document' and not followup_private.capability(case when p_data->>'kind'='identity' then 'documents_sensitive_write' else 'documents_write' end) then raise exception 'إضافة المستند تحتاج صلاحية مستقلة' using errcode='42501';end if;
elsif p_kind in ('account','policy','department','department_order','capability') then
 if r<>'ADMIN' then raise exception 'إدارة الإعدادات للمدير' using errcode='42501';end if;
elsif p_kind='saved_view' then
 if d is not null and not followup_private.scope_at(d,sd) then raise exception 'القسم خارج صلاحيتك' using errcode='42501';end if;
 if eid is not null and not followup_private.employee_scope(eid) then raise exception 'الموظف خارج صلاحيتك' using errcode='42501';end if;
elsif p_kind='handover' then
 if r not in ('ADMIN','FOLLOWUP') or (d is not null and not followup_private.scope_at(d,sd)) then raise exception 'التسليم خارج صلاحيتك' using errcode='42501';end if;
elsif p_kind in ('reporter','communication','action','action_comment') then
 if d is null or not followup_private.scope_at(d,sd) then raise exception 'القسم خارج صلاحيتك' using errcode='42501';end if;
 if p_kind in ('reporter','communication') and r not in ('ADMIN','FOLLOWUP') then raise exception 'التوثيق لقسم المتابعة' using errcode='42501';end if;
 if p_kind='action_comment' and r='SUPERVISOR' and not exists(select 1 from public.fu_actions where id=(p_data->>'action_id')::uuid and department_id=d and responsible_id=u) then raise exception 'الإجراء خارج صلاحيتك' using errcode='42501';end if;
else raise exception 'طلب غير متاح' using errcode='42501';end if;
-- Current authorization is checked before durable retry, then the payload is bound.
perform pg_advisory_xact_lock(hashtextextended(u::text||p_request_id::text,0));
select q.result,q.payload into result,oldpayload from public.fu_requests q where q.user_id=u and q.request_id=p_request_id;
if result is not null then if oldpayload<>jsonb_build_object('kind',p_kind,'data',p_data) then raise exception 'معرّف إعادة المحاولة مستخدم لطلب آخر';end if;return result;end if;
if p_kind in ('save','submit','return','review','revise','reconcile','action','account','policy','department') then
 if p_kind='account' then
  if p_data->>'role' not in ('ADMIN','FOLLOWUP','SUPERVISOR','VIEWER') or not(p_data ? 'role') then raise exception 'اختر الدور صراحةً' using errcode='22023';end if;
  if p_data->>'role'='SUPERVISOR' and jsonb_array_length(coalesce(p_data->'departments','[]'::jsonb))=0 then raise exception 'المشرف يحتاج قسماً محدداً' using errcode='22023';end if;
 end if;
 if p_kind='action' then
  if eid is not null and not exists(select 1 from public.employees e where e.id=eid and e.department_id=d and e.shift_id=es and followup_private.employee_scope(e.id)) then raise exception 'الموظف خارج قائمة القسم المسائية' using errcode='42501';end if;
  if r='SUPERVISOR' and exists(select 1 from public.fu_actions a where a.id=rid and ((p_data ? 'category' and a.category is distinct from p_data->>'category') or (p_data ? 'priority' and a.priority is distinct from p_data->>'priority'))) then raise exception 'المشرف يحدّث حالته وملاحظاته فقط' using errcode='42501';end if;
 end if;
 if rid is not null then
  if p_kind='action' then select to_jsonb(a) into oldval from public.fu_actions a where a.id=rid;else select followup_private.snapshot(rid) into oldval;end if;
 end if;
 if p_kind='account' then select to_jsonb(a)||jsonb_build_object('departments',coalesce((select jsonb_agg(to_jsonb(x)) from public.fu_departments x where x.user_id=a.user_id),'[]'::jsonb)) into oldval from public.fu_accounts a where a.user_id=(p_data->>'user_id')::uuid;end if;
 if p_kind='policy' then select to_jsonb(s) into oldval from public.fu_statuses s where s.code=p_data->>'code';end if;
 result:=followup_private.write_core(p_kind,p_data,p_request_id);
 if p_kind='action' then
  rid:=(result->>'id')::uuid;
  update public.fu_actions set category=coalesce(p_data->>'category',category),priority=coalesce(p_data->>'priority',priority) where id=rid;
  if btrim(coalesce(p_data->>'comment',''))<>'' then insert into public.fu_action_comments(action_id,body,actor) values(rid,p_data->>'comment',u);end if;
  select to_jsonb(a) into result from public.fu_actions a where a.id=rid;
 elsif p_kind in ('save','submit','return','review','revise','reconcile') then
  rid:=(result->>'id')::uuid;
  if p_kind='review' then update public.fu_reports set reviewed_unresolved_count=(select count(*) from public.fu_entries where report_id=rid and status='unresolved'),review_scope=case when exists(select 1 from public.fu_entries where report_id=rid and status='unresolved') then 'partial' else 'full' end where id=rid;result:=followup_private.snapshot(rid);end if;
 end if;
 if p_kind='account' then select to_jsonb(a)||jsonb_build_object('departments',coalesce((select jsonb_agg(to_jsonb(x)) from public.fu_departments x where x.user_id=a.user_id),'[]'::jsonb)) into newval from public.fu_accounts a where a.user_id=(p_data->>'user_id')::uuid;else if p_kind='policy' then select to_jsonb(s) into newval from public.fu_statuses s where s.code=p_data->>'code';else newval:=result;end if;end if;
 insert into public.fu_business_events(actor,kind,entity_id,department_id,employee_id,old_value,new_value,reason) values(u,p_kind,rid,d,eid,oldval,newval,nullif(reason,''));
 update public.fu_requests set result=gateway.result where user_id=u and request_id=p_request_id;
 return result;
elsif p_kind='capability' then
 uid:=(p_data->>'user_id')::uuid;cap:=p_data->>'capability';if reason='' then raise exception 'سبب الصلاحية مطلوب';end if;
 select to_jsonb(x) into oldval from public.fu_capabilities x where user_id=uid and capability=cap for update;
 if oldval is null and coalesce((p_data->>'version')::int,0)<>0 then raise exception 'Capability insert requires version zero' using errcode='PT409';end if;
 insert into public.fu_capabilities(user_id,capability,granted,granted_by,reason) values(uid,cap,(p_data->>'granted')::boolean,u,reason) on conflict(user_id,capability) do update set granted=excluded.granted,granted_by=u,reason=excluded.reason,version=public.fu_capabilities.version+1,updated_at=now() where public.fu_capabilities.version=(p_data->>'version')::int;
 if not found then raise exception 'تغيرت الصلاحية' using errcode='PT409';end if;
 select to_jsonb(x) into result from public.fu_capabilities x where user_id=uid and capability=cap;
elsif p_kind='department_order' then
 if reason='' or nullif(p_data->>'display_order','') is null or (p_data->>'display_order')::int not between 0 and 10000 then raise exception 'Department order and change reason are required' using errcode='22023';end if;
 select to_jsonb(dep) into oldval from public.departments dep where dep.id=rid for update;
 if oldval is null or (oldval->>'version')::int is distinct from (p_data->>'version')::int then raise exception 'Department version changed' using errcode='PT409';end if;
 update public.departments set display_order=(p_data->>'display_order')::int,version=version+1 where id=rid returning to_jsonb(public.departments.*) into result;
elsif p_kind='profile' then
 select * into emp from public.employees where id=eid for update;
 if emp.version is distinct from (p_data->>'version')::int then raise exception 'تغير ملف الموظف' using errcode='PT409';end if;
 if reason='' then raise exception 'سبب تعديل الملف مطلوب';end if;oldval:=to_jsonb(emp);d:=emp.department_id;
 if p_data ? 'reference_number' and not followup_private.capability('documents_sensitive_write') then raise exception 'المرجع الخاص يحتاج صلاحية مستقلة' using errcode='42501';end if;
 if nullif(p_data->>'photo_document_id','') is not null and not exists(select 1 from public.fu_documents x where x.id=(p_data->>'photo_document_id')::uuid and x.employee_id=eid and x.kind='photo' and x.state='active' and followup_private.document_access(x,false)) then raise exception 'الصورة ليست مستنداً صالحاً للموظف';end if;
 update public.employees set phone=case when p_data ? 'phone' then nullif(btrim(p_data->>'phone'),'') else phone end,secondary_phone=case when p_data ? 'secondary_phone' then nullif(btrim(p_data->>'secondary_phone'),'') else secondary_phone end,emergency_name=case when p_data ? 'emergency_name' then nullif(btrim(p_data->>'emergency_name'),'') else emergency_name end,emergency_phone=case when p_data ? 'emergency_phone' then nullif(btrim(p_data->>'emergency_phone'),'') else emergency_phone end,emergency_relation=case when p_data ? 'emergency_relation' then nullif(btrim(p_data->>'emergency_relation'),'') else emergency_relation end,education=case when p_data ? 'education' then nullif(btrim(p_data->>'education'),'') else education end,specialization=case when p_data ? 'specialization' then nullif(btrim(p_data->>'specialization'),'') else specialization end,institution=case when p_data ? 'institution' then nullif(btrim(p_data->>'institution'),'') else institution end,graduation_year=case when p_data ? 'graduation_year' then nullif(p_data->>'graduation_year','')::int else graduation_year end,group_name=case when p_data ? 'group_name' then nullif(btrim(p_data->>'group_name'),'') else group_name end,reference_number=case when p_data ? 'reference_number' then nullif(btrim(p_data->>'reference_number'),'') else reference_number end,photo_document_id=case when p_data ? 'photo_document_id' then nullif(p_data->>'photo_document_id','')::uuid else photo_document_id end where id=eid returning to_jsonb(public.employees.*) into result;
elsif p_kind='employee_add' then
 if reason='' then raise exception 'سبب إضافة الموظف مطلوب';end if;
 if nullif(p_data->>'work_date','') is null then raise exception 'تاريخ نفاذ انتماء الموظف مطلوب';end if;
 perform pg_advisory_xact_lock(hashtextextended(lower(regexp_replace(btrim(p_data->>'name'),'\s+',' ','g')),2));
 if exists(select 1 from public.employees where lower(regexp_replace(btrim(name),'\s+',' ','g'))=lower(regexp_replace(btrim(p_data->>'name'),'\s+',' ','g'))) and btrim(coalesce(p_data->>'duplicate_override_reason',''))='' then raise exception 'يوجد موظف بنفس الاسم؛ راجع التكرار وسجل سبب المتابعة' using errcode='23505';end if;
 insert into public.employees(name,employee_number,department_id,shift_id,employment_status,created_by,updated_by) values(p_data->>'name',nullif(p_data->>'employee_number',''),d,es,'active',u,u) returning * into emp;eid:=emp.id;
 -- Existing allocator remains authoritative; verification uses the explicitly selected effective date.
 update public.employee_assignment_history set voided_at=now() where employee_id=eid and evidence_kind='observed' and voided_at is null;
 insert into public.employee_assignment_history(employee_id,department_id,shift_id,direct_manager_id,employment_status,valid_from,evidence_kind,reason,created_by) values(eid,d,es,emp.direct_manager_id,emp.employment_status,sd,'verified',reason,u) on conflict(employee_id,valid_from) do update set evidence_kind='verified',reason=excluded.reason,created_by=u,voided_at=null;
 result:=to_jsonb(emp);
elsif p_kind='assignment' then
 if reason='' then raise exception 'سبب توثيق الانتماء مطلوب';end if;
 sd:=(p_data->>'valid_from')::date;if sd is null then raise exception 'تاريخ النفاذ مطلوب';end if;
 select * into emp from public.employees where id=eid for update;
 if emp.version is distinct from (p_data->>'version')::int then raise exception 'تغير ملف الموظف' using errcode='PT409';end if;
 perform pg_advisory_xact_lock(hashtextextended(eid::text,1));oldval:=to_jsonb(emp);
 if exists(select 1 from public.employee_assignment_history x where x.employee_id=eid and x.voided_at is null and x.valid_from>sd) then raise exception 'يوجد انتماء لاحق؛ راجع الفترة قبل التعديل' using errcode='PT409';end if;
 update public.employee_assignment_history set valid_to=sd-1 where employee_id=eid and voided_at is null and valid_from<sd and (valid_to is null or valid_to>=sd);
 insert into public.employee_assignment_history(employee_id,department_id,shift_id,direct_manager_id,employment_status,valid_from,evidence_kind,reason,created_by) values(eid,d,es,emp.direct_manager_id,coalesce(p_data->>'employment_status',emp.employment_status),sd,'verified',reason,u) on conflict(employee_id,valid_from) do update set department_id=excluded.department_id,shift_id=es,employment_status=excluded.employment_status,evidence_kind='verified',reason=excluded.reason,created_by=u,voided_at=null,valid_to=null;
 -- Current display is changed only for an explicit current/past effective operation.
 if sd<=followup_private.today() then
  update public.employees set department_id=d,shift_id=es,employment_status=coalesce(p_data->>'employment_status',employment_status) where id=eid;
  -- The legacy current-field trigger may add an observed tomorrow row. Keep the explicit verified interval authoritative.
  update public.employee_assignment_history set voided_at=now() where employee_id=eid and valid_from=followup_private.today()+1 and evidence_kind='observed' and voided_at is null;
  update public.employee_assignment_history set valid_to=null where employee_id=eid and valid_from=sd and evidence_kind='verified' and voided_at is null;
 else update public.employees set updated_by=u where id=eid;
 end if;
 select to_jsonb(x) into result from public.employee_assignment_history x where employee_id=eid and valid_from=sd;
elsif p_kind='document' then
 rid:=gen_random_uuid();select department_id into d from public.employees where id=eid;
 if nullif(p_data->>'previous_document_id','') is not null and not exists(select 1 from public.fu_documents x where x.id=(p_data->>'previous_document_id')::uuid and x.employee_id=eid and x.kind=p_data->>'kind' and x.state='active' and followup_private.document_access(x,true)) then raise exception 'المستند السابق خارج النطاق';end if;
 if p_data->>'kind'='photo' and (nullif(p_data->>'thumbnail_byte_size','') is null or nullif(p_data->>'thumbnail_sha256','') is null or nullif(p_data->>'original_sha256','') is null) then raise exception 'بيانات الصورة المصغرة والتحقق مطلوبة';end if;
 insert into public.fu_documents(id,employee_id,title,description,kind,file_name,mime_type,byte_size,object_path,previous_document_id,issued_on,expires_on,uploaded_by,thumbnail_object_path,thumbnail_byte_size,thumbnail_mime_type,original_sha256,thumbnail_sha256,crop_x,crop_y,crop_width,crop_height,upload_request_id) values(rid,eid,p_data->>'title',p_data->>'description',p_data->>'kind',p_data->>'file_name',p_data->>'mime_type',(p_data->>'byte_size')::bigint,eid::text||'/'||rid::text||'/v1',nullif(p_data->>'previous_document_id','')::uuid,nullif(p_data->>'issued_on','')::date,nullif(p_data->>'expires_on','')::date,u,case when p_data->>'kind'='photo' then eid::text||'/'||rid::text||'/thumbnail.jpg' else null end,nullif(p_data->>'thumbnail_byte_size','')::bigint,case when p_data->>'kind'='photo' then 'image/jpeg' else null end,p_data->>'original_sha256',p_data->>'thumbnail_sha256',(p_data->'photo_crop'->>'x')::numeric,(p_data->'photo_crop'->>'y')::numeric,(p_data->'photo_crop'->>'width')::numeric,(p_data->'photo_crop'->>'height')::numeric,p_request_id) returning * into doc;result:=to_jsonb(doc);
elsif p_kind in ('document_activate','document_archive','document_abandon') then
 select * into doc from public.fu_documents where id=rid for update;
 if doc.version is distinct from (p_data->>'version')::int then raise exception 'تغير المستند' using errcode='PT409';end if;oldval:=to_jsonb(doc);
 if p_kind='document_activate' then
  if doc.state<>'pending' or doc.uploaded_by<>u then raise exception 'المستند ليس رفعاً معلقاً لهذا المستخدم';end if;
  if not exists(select 1 from storage.objects o where o.bucket_id=doc.bucket and o.name=doc.object_path and (o.metadata->>'size')::bigint=doc.byte_size and coalesce(o.metadata->>'mimetype',o.metadata->>'contentType')=doc.mime_type) then raise exception 'لم يكتمل رفع الملف أو بياناته غير متطابقة';end if;
  if doc.thumbnail_object_path is not null and not exists(select 1 from storage.objects o where o.bucket_id=doc.bucket and o.name=doc.thumbnail_object_path and (o.metadata->>'size')::bigint=doc.thumbnail_byte_size and coalesce(o.metadata->>'mimetype',o.metadata->>'contentType')='image/jpeg') then raise exception 'لم يكتمل رفع الصورة المصغرة';end if;
 elsif p_kind='document_abandon' then if doc.state<>'pending' or reason='' or doc.uploaded_by<>u then raise exception 'إلغاء الرفع يحتاج رفعاً معلقاً مصرحاً وسبباً';end if;
 else if doc.state<>'active' or reason='' then raise exception 'أرشفة المستند تحتاج مستنداً فعالاً وسبباً';end if;end if;
 update public.fu_documents set state=case when p_kind='document_activate' then 'active' when p_kind='document_abandon' then 'abandoned' else 'archived' end,version=version+1,updated_at=now() where id=rid returning to_jsonb(public.fu_documents.*) into result;
 if p_kind='document_activate' and doc.previous_document_id is not null then
  perform 1 from public.fu_documents x where x.id=doc.previous_document_id and x.state='active' for update;
  if not found then raise exception 'استبدل المستند السابق بالفعل؛ راجع النسخة الحالية' using errcode='PT409';end if;
  update public.fu_documents set state='archived',version=version+1,updated_at=now() where id=doc.previous_document_id;
 end if;
elsif p_kind='reporter' then
 if rid is null then insert into public.fu_reporters(department_id,name,channel,contact,backup_contact,linked_user_id,active,created_by) values(d,p_data->>'name',p_data->>'channel',p_data->>'contact',p_data->>'backup_contact',nullif(p_data->>'linked_user_id','')::uuid,coalesce((p_data->>'active')::boolean,true),u) returning to_jsonb(public.fu_reporters.*) into result;
 else select to_jsonb(x) into oldval from public.fu_reporters x where x.id=rid and x.department_id=d for update;if oldval is null or (oldval->>'version')::int is distinct from (p_data->>'version')::int then raise exception 'تغير سجل المبلّغ' using errcode='PT409';end if;update public.fu_reporters set name=p_data->>'name',channel=p_data->>'channel',contact=p_data->>'contact',backup_contact=p_data->>'backup_contact',linked_user_id=nullif(p_data->>'linked_user_id','')::uuid,active=(p_data->>'active')::boolean,version=version+1,updated_at=now() where id=rid returning to_jsonb(public.fu_reporters.*) into result;end if;
elsif p_kind='communication' then
 if nullif(p_data->>'reporter_id','') is not null and not exists(select 1 from public.fu_reporters where id=(p_data->>'reporter_id')::uuid and department_id=d) then raise exception 'المبلّغ خارج القسم';end if;
 if rid is null then insert into public.fu_communications(department_id,reporter_id,work_date,kind,channel,summary,outcome,actor) values(d,nullif(p_data->>'reporter_id','')::uuid,sd,p_data->>'kind',p_data->>'channel',p_data->>'summary',p_data->>'outcome',u) returning to_jsonb(public.fu_communications.*) into result;
 else select to_jsonb(x) into oldval from public.fu_communications x where x.id=rid and x.department_id=d for update;if oldval is null or (oldval->>'version')::int is distinct from (p_data->>'version')::int then raise exception 'تغير سجل الاتصال' using errcode='PT409';end if;update public.fu_communications set summary=p_data->>'summary',outcome=p_data->>'outcome',version=version+1 where id=rid returning to_jsonb(public.fu_communications.*) into result;end if;
elsif p_kind='handover' then
 uid:=(p_data->>'owner_id')::uuid;
 if not exists(select 1 from public.fu_accounts a join public.profiles p on p.id=a.user_id where a.user_id=uid and a.active and p.is_active and a.role in ('ADMIN','FOLLOWUP','SUPERVISOR') and ((d is null and a.role in ('ADMIN','FOLLOWUP')) or followup_private.user_scope_at(uid,d,sd))) then raise exception 'مسؤول التسليم خارج النطاق';end if;
 if rid is null then insert into public.fu_handovers(work_date,department_id,owner_id,completed,remaining,next_action,state,created_by) values(sd,d,uid,coalesce(p_data->>'completed',''),coalesce(p_data->>'remaining',''),p_data->>'next_action',coalesce(p_data->>'state','open'),u) returning to_jsonb(public.fu_handovers.*) into result;
 else select to_jsonb(x) into oldval from public.fu_handovers x where x.id=rid and x.department_id is not distinct from d for update;if oldval is null or (oldval->>'version')::int is distinct from (p_data->>'version')::int then raise exception 'تغير التسليم' using errcode='PT409';end if;update public.fu_handovers set owner_id=uid,completed=coalesce(p_data->>'completed',''),remaining=coalesce(p_data->>'remaining',''),next_action=p_data->>'next_action',state=p_data->>'state',version=version+1,updated_at=now() where id=rid returning to_jsonb(public.fu_handovers.*) into result;end if;
elsif p_kind='action_comment' then
 rid:=(p_data->>'action_id')::uuid;
 if not exists(select 1 from public.fu_actions a where a.id=rid and a.department_id=d) then raise exception 'الإجراء خارج القسم';end if;
 if nullif(p_data->>'document_id','') is not null and not exists(select 1 from public.fu_documents attachment join public.fu_actions a on a.employee_id=attachment.employee_id where a.id=rid and attachment.id=(p_data->>'document_id')::uuid and attachment.state='active' and followup_private.document_access(attachment,false)) then raise exception 'مرفق الإجراء خارج النطاق';end if;
 insert into public.fu_action_comments(action_id,body,document_id,actor) values(rid,p_data->>'body',nullif(p_data->>'document_id','')::uuid,u) returning to_jsonb(public.fu_action_comments.*) into result;
elsif p_kind='saved_view' then
 if rid is null then insert into public.fu_saved_views(user_id,name,page,start_date,end_date,department_id,employee_id,state) values(u,p_data->>'name',p_data->>'page',nullif(p_data->>'start','')::date,nullif(p_data->>'end','')::date,d,eid,p_data->>'state') returning to_jsonb(public.fu_saved_views.*) into result;
 else
  select to_jsonb(x) into oldval from public.fu_saved_views x where x.id=rid and x.user_id=u for update;
  if oldval is null or (oldval->>'version')::int is distinct from (p_data->>'version')::int then raise exception 'Saved view version changed' using errcode='PT409';end if;
  if coalesce((p_data->>'remove')::boolean,false) then
   delete from public.fu_saved_views where id=rid and user_id=u;result:=jsonb_build_object('id',rid,'removed',true);
  else
   update public.fu_saved_views set name=p_data->>'name',page=p_data->>'page',start_date=nullif(p_data->>'start','')::date,end_date=nullif(p_data->>'end','')::date,department_id=d,employee_id=eid,state=p_data->>'state',version=version+1 where id=rid returning to_jsonb(public.fu_saved_views.*) into result;
  end if;
 end if;
end if;
rid:=coalesce(nullif(result->>'id','')::uuid,rid);
insert into public.fu_business_events(actor,kind,entity_id,department_id,employee_id,old_value,new_value,reason) values(u,p_kind,rid,d,eid,oldval,result,nullif(reason,''));
if p_kind='profile' and not followup_private.capability('documents_sensitive_read') then result:=result-'reference_number';end if;
insert into public.fu_requests values(u,p_request_id,result,jsonb_build_object('kind',p_kind,'data',p_data));return result;
end$$;

-- Private storage objects are immutable and read only after activation. A pending
-- upload is authorized against server-generated metadata and its original actor.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('fu-private','fu-private',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
create or replace function followup_private.storage_access(b text,path text,writing boolean) returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$declare doc public.fu_documents;r text;begin r:=followup_private.account_role();select * into doc from public.fu_documents where bucket=b and (object_path=path or thumbnail_object_path=path);if doc.id is null then return false;end if;if writing then return doc.state='pending' and doc.uploaded_by=auth.uid() and followup_private.document_access(doc,true);else return case when doc.state in ('pending','abandoned') then doc.uploaded_by=auth.uid() and followup_private.document_access(doc,true) else doc.state in ('active','archived') and followup_private.document_access(doc,false) end;end if;exception when insufficient_privilege then return false;end$$;
create or replace function followup_private.storage_delete_access(b text,path text) returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$declare doc public.fu_documents;r text;begin r:=followup_private.account_role();select * into doc from public.fu_documents where bucket=b and (object_path=path or thumbnail_object_path=path);return doc.id is not null and doc.state='abandoned' and doc.uploaded_by=auth.uid() and followup_private.document_access(doc,true);exception when insufficient_privilege then return false;end$$;
grant usage on schema followup_private to authenticated;
revoke all on all functions in schema followup_private from public,anon,authenticated;
grant execute on function followup_private.storage_access(text,text,boolean) to authenticated;
grant execute on function followup_private.storage_delete_access(text,text) to authenticated;
create policy fu_private_upload on storage.objects for insert to authenticated with check(bucket_id='fu-private' and followup_private.storage_access(bucket_id,name,true));
create policy fu_private_read on storage.objects for select to authenticated using(bucket_id='fu-private' and followup_private.storage_access(bucket_id,name,false));
create policy fu_private_abandoned_cleanup on storage.objects for delete to authenticated using(bucket_id='fu-private' and followup_private.storage_delete_access(bucket_id,name));
revoke execute on function public.followup_read(text,jsonb),public.followup_write(text,jsonb,uuid),public.followup_session() from public,anon;
grant execute on function public.followup_read(text,jsonb),public.followup_write(text,jsonb,uuid),public.followup_session() to authenticated;
notify pgrst,'reload schema';
commit;
