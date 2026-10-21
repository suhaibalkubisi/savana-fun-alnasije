create or replace function followup_private.snapshot(r uuid) returns jsonb language sql stable set search_path=pg_catalog,public as $$
select to_jsonb(a)||jsonb_build_object('reporter_name',(select name from public.profiles where id=a.reporter_id),'entered_by_name',(select name from public.profiles where id=a.entered_by),'entries',coalesce((select jsonb_agg(to_jsonb(e) order by e.employee_name,e.employee_id) from public.fu_entries e where e.report_id=a.id),'[]'::jsonb)) from public.fu_reports a where a.id=r$$;

create or replace function public.followup_read(p_kind text,p_filters jsonb default '{}') returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r text:=followup_private.account_role();startdate date:=coalesce(nullif(p_filters->>'start','')::date,current_date);enddate date:=coalesce(nullif(p_filters->>'end','')::date,startdate);d uuid:=nullif(p_filters->>'department_id','')::uuid;result jsonb;
begin
if d is not null and not followup_private.scope(d) then raise exception 'القسم خارج صلاحيتك' using errcode='42501';end if;
if enddate<startdate or enddate-startdate>366 then raise exception 'الفترة غير صالحة';end if;
if p_kind='bootstrap' then
return jsonb_build_object('user',public.followup_session(),'departments',coalesce((select jsonb_agg(to_jsonb(t) order by t.display_order,t.arabic_name) from public.departments t where followup_private.scope(t.id)),'[]'::jsonb),'shifts',coalesce((select jsonb_agg(to_jsonb(t)) from public.shifts t),'[]'::jsonb),'statuses',(select jsonb_agg(to_jsonb(t) order by code) from public.fu_statuses t),'users',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'email',p.email,'role',a.role,'active',a.active,'version',a.version,'departments',coalesce((select jsonb_agg(department_id) from public.fu_departments where user_id=p.id),'[]'::jsonb))) from public.profiles p left join public.fu_accounts a on a.user_id=p.id where r='ADMIN' or (a.active and (p.id=auth.uid() or exists(select 1 from public.fu_departments x where x.user_id=p.id and followup_private.scope(x.department_id))))),'[]'::jsonb));
elsif p_kind='employees' then
return coalesce((select jsonb_agg(to_jsonb(t) order by department_name,name) from (select e.id,e.name,e.internal_code,e.employee_number,e.department_id,e.shift_id,e.employment_status,e.version,dep.arabic_name department_name from public.employees e join public.departments dep on dep.id=e.department_id where followup_private.scope(e.department_id) and (d is null or e.department_id=d))t),'[]'::jsonb);
elsif p_kind='position' then
return coalesce((select jsonb_agg(to_jsonb(t) order by department_name,name,work_date,shift_id) from (
select e.id employee_id,e.name,e.internal_code,day::date work_date,coalesce(h.department_id,e.department_id) department_id,dep.arabic_name department_name,(case when h.id is not null then h.shift_id else e.shift_id end) shift_id,coalesce(f.status,'unresolved') status,case when f.report_id is null then coalesce(rp.state,'missing') else rp.state end review_state,rp.id report_id,
case when exists(select 1 from public.fu_final xf join public.fu_reports xr on xr.id=xf.report_id where xf.employee_id=e.id and xf.work_date=day::date and (xr.department_id<>coalesce(h.department_id,e.department_id) or (xf.shift_key<>'00000000-0000-0000-0000-000000000000'::uuid and xf.shift_key is distinct from (case when h.id is not null then h.shift_id else e.shift_id end)))) then 'exception' when rp.id is null then 'missing' when not exists(select 1 from public.fu_entries xe where xe.report_id=rp.id and xe.employee_id=e.id) then 'exception' when exists(select 1 from public.fu_entries x where x.report_id=rp.id and x.status='unresolved') then 'partial' else 'complete' end completeness
from generate_series(startdate,enddate,'1 day'::interval) day cross join public.employees e
left join lateral(select a.* from public.employee_assignment_history a where a.employee_id=e.id and a.voided_at is null and a.valid_from<=day::date and (a.valid_to is null or a.valid_to>=day::date) order by a.valid_from desc limit 1)h on true
join public.departments dep on dep.id=coalesce(h.department_id,e.department_id)
left join public.fu_final f on f.employee_id=e.id and f.work_date=day::date and (f.shift_key='00000000-0000-0000-0000-000000000000'::uuid or f.shift_key=(case when h.id is not null then h.shift_id else e.shift_id end)) and exists(select 1 from public.fu_reports fr where fr.id=f.report_id and fr.department_id=coalesce(h.department_id,e.department_id))
left join lateral(select rr.* from public.fu_reports rr where rr.id=f.report_id or (f.report_id is null and rr.department_id=coalesce(h.department_id,e.department_id) and rr.work_date=day::date and (rr.shift_id is null or rr.shift_id=(case when h.id is not null then h.shift_id else e.shift_id end))) order by (rr.id=f.report_id) desc nulls last,rr.updated_at desc limit 1)rp on true
where coalesce(h.employment_status,e.employment_status) in ('active','long_leave') and followup_private.scope(coalesce(h.department_id,e.department_id)) and (d is null or coalesce(h.department_id,e.department_id)=d)
)t),'[]'::jsonb);
elsif p_kind='roster' then
if d is null then raise exception 'اختر القسم';end if;
return coalesce((select jsonb_agg(to_jsonb(t) order by name,id) from (
select e.id,e.name,e.internal_code,e.employee_number,e.department_id,e.shift_id,e.employment_status,
coalesce(h.department_id,e.department_id) effective_department,(case when h.id is not null then h.shift_id else e.shift_id end) effective_shift
from public.employees e left join lateral(select a.* from public.employee_assignment_history a where a.employee_id=e.id and a.voided_at is null and a.valid_from<=startdate and (a.valid_to is null or a.valid_to>=startdate) order by a.valid_from desc limit 1)h on true
where coalesce(h.department_id,e.department_id)=d and coalesce(h.employment_status,e.employment_status) in ('active','long_leave') and (nullif(p_filters->>'shift_id','') is null or (case when h.id is not null then h.shift_id else e.shift_id end)=nullif(p_filters->>'shift_id','')::uuid))t),'[]'::jsonb);
elsif p_kind='reports' then
return coalesce((select jsonb_agg(followup_private.snapshot(t.id) order by t.work_date desc,t.updated_at desc) from public.fu_reports t where followup_private.scope(t.department_id) and t.work_date between startdate and enddate and (d is null or t.department_id=d)),'[]'::jsonb);
elsif p_kind='actions' then
return coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('activity',coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object('actor_name',(select name from public.profiles where id=x.actor)) order by at,id) from public.fu_activity x where x.action_id=t.id),'[]'::jsonb)) order by due_date,id) from public.fu_actions t where followup_private.scope(t.department_id) and (d is null or t.department_id=d)),'[]'::jsonb);
elsif p_kind='revisions' then
return coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('actor_name',(select name from public.profiles where id=t.actor)) order by t.version desc) from public.fu_revisions t join public.fu_reports a on a.id=t.report_id where a.id=(p_filters->>'id')::uuid and followup_private.scope(a.department_id)),'[]'::jsonb);
elsif p_kind='archive' and r='ADMIN' then
return jsonb_build_object('provenance','historical biometric source; not supervisor declarations','imports',coalesce((select jsonb_agg(to_jsonb(t)) from public.attendance_imports t),'[]'::jsonb),'rows',coalesce((select jsonb_agg(to_jsonb(t)) from public.fingerprint_source_rows t where t.import_id=(p_filters->>'import_id')::uuid),'[]'::jsonb));
end if;
raise exception 'طلب غير متاح' using errcode='42501';end$$;

create or replace function public.followup_write(p_kind text,p_data jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r text:=followup_private.account_role();u uuid:=auth.uid();d uuid;rid uuid;aid uuid;rep public.fu_reports;act public.fu_actions;result jsonb;oldpayload jsonb;rows jsonb;item jsonb;reason text:=btrim(coalesce(p_data->>'reason',''));newstate text;shiftkey uuid;uid uuid;
begin
-- A durable retry must still be authorized by the current role and scope.
if r='VIEWER' then raise exception 'صلاحية قراءة فقط' using errcode='42501';end if;
if p_kind in ('account','policy','department') and r<>'ADMIN' then raise exception 'طلب غير متاح' using errcode='42501';end if;
if p_kind in ('return','review') and r not in ('ADMIN','FOLLOWUP') then raise exception 'المراجعة لقسم المتابعة' using errcode='42501';end if;
if p_kind in ('save','submit','return','review','revise','reconcile','action') then
d:=nullif(p_data->>'department_id','')::uuid;
if d is null or not followup_private.scope(d) then raise exception 'القسم خارج صلاحيتك' using errcode='42501';end if;
if r='SUPERVISOR' then
if p_kind='action' then
if nullif(p_data->>'id','') is null or not exists(select 1 from public.fu_actions a where a.id=(p_data->>'id')::uuid and a.department_id=d and a.responsible_id=u) then raise exception 'المشرف يحدّث إجراءاته فقط' using errcode='42501';end if;
elsif nullif(p_data->>'id','') is not null then
if not exists(select 1 from public.fu_reports a where a.id=(p_data->>'id')::uuid and a.department_id=d and a.reporter_id=u) then raise exception 'التقرير يخص مشرفاً آخر' using errcode='42501';end if;
elsif (p_data->>'reporter_id')::uuid is distinct from u or p_data->>'channel' is distinct from 'account' then raise exception 'المشرف يبلّغ باسمه' using errcode='42501';end if;
end if;
end if;
perform pg_advisory_xact_lock(hashtextextended(u::text||p_request_id::text,0));
select q.result,q.payload into result,oldpayload from public.fu_requests q where q.user_id=u and q.request_id=p_request_id;
if result is not null then if oldpayload<>jsonb_build_object('kind',p_kind,'data',p_data) then raise exception 'معرّف إعادة المحاولة مستخدم لطلب آخر';end if;return result;end if;
if r='VIEWER' then raise exception 'صلاحية قراءة فقط' using errcode='42501';end if;
if p_kind in ('save','submit','return','review','revise','reconcile') then
d:=(p_data->>'department_id')::uuid;
if d is null or nullif(p_data->>'work_date','') is null then raise exception 'حدد القسم وتاريخ العمل';end if;
if not followup_private.scope(d) then raise exception 'القسم خارج صلاحيتك' using errcode='42501';end if;
perform pg_advisory_xact_lock(hashtextextended(d::text||(p_data->>'work_date'),0));
rid:=nullif(p_data->>'id','')::uuid;
if rid is null then
if p_kind not in ('save','submit') then raise exception 'التقرير غير موجود';end if;
if r='SUPERVISOR' and ((p_data->>'reporter_id')::uuid<>u or p_data->>'channel'<>'account') then raise exception 'المشرف يبلّغ باسمه' using errcode='42501';end if;
if not exists(select 1 from public.fu_accounts a join public.profiles p on p.id=a.user_id where a.user_id=(p_data->>'reporter_id')::uuid and a.active and p.is_active and a.role in ('SUPERVISOR','ADMIN') and (a.role='ADMIN' or exists(select 1 from public.fu_departments x where x.user_id=a.user_id and x.department_id=d))) then raise exception 'حدد المشرف المسؤول عن القسم';end if;
if p_data->>'channel'='account' and (p_data->>'reporter_id')::uuid<>u then raise exception 'حدد قناة استلام التصريح';end if;
insert into public.fu_reports(work_date,department_id,shift_id,reporter_id,entered_by,channel,note) values((p_data->>'work_date')::date,d,nullif(p_data->>'shift_id','')::uuid,(p_data->>'reporter_id')::uuid,u,p_data->>'channel',coalesce(p_data->>'note','')) returning * into rep;rid:=rep.id;
rows:=public.followup_read('roster',jsonb_build_object('department_id',d,'start',rep.work_date,'shift_id',rep.shift_id));
if jsonb_array_length(rows)=0 then raise exception 'لا يوجد موظفون في هذا النطاق';end if;
insert into public.fu_entries(report_id,employee_id,employee_name,permanent_code) select rid,(x->>'id')::uuid,x->>'name',x->>'internal_code' from jsonb_array_elements(rows)x;
else
select * into rep from public.fu_reports where id=rid for update;
if rep.id is null or rep.department_id<>d or rep.work_date<>(p_data->>'work_date')::date or rep.shift_id is distinct from nullif(p_data->>'shift_id','')::uuid then raise exception 'نطاق التقرير لا يتطابق';end if;
if rep.version is distinct from (p_data->>'version')::int then raise exception 'تغير التقرير. حدّثه قبل الحفظ' using errcode='40001';end if;
if r='SUPERVISOR' and rep.reporter_id<>u then raise exception 'التقرير يخص مشرفاً آخر' using errcode='42501';end if;
if p_kind in ('return','review') and r not in ('ADMIN','FOLLOWUP') then raise exception 'المراجعة لقسم المتابعة' using errcode='42501';end if;
if p_kind in ('save','submit') and rep.state not in ('draft','returned') then raise exception 'افتح مراجعة جديدة مع سبب';end if;
if p_kind='revise' and (rep.state not in ('submitted','reviewed') or reason='') then raise exception 'سبب المراجعة مطلوب';end if;
if p_kind in ('return','review') and rep.state<>'submitted' then raise exception 'التقرير غير مقدّم';end if;
if p_kind='return' and reason='' then raise exception 'سبب الإرجاع مطلوب';end if;
if p_kind='reconcile' and (rep.state not in ('draft','returned') or reason='') then raise exception 'تسوية القائمة تحتاج مسودة وسبباً';end if;
insert into public.fu_revisions(report_id,version,actor,reason,snapshot) values(rid,rep.version,u,coalesce(nullif(reason,''),p_kind),followup_private.snapshot(rid));
end if;
if p_kind='reconcile' then
rows:=public.followup_read('roster',jsonb_build_object('department_id',d,'start',rep.work_date,'shift_id',rep.shift_id));
if jsonb_array_length(rows)=0 then raise exception 'قائمة القسم فارغة. افتح إجراء لتسوية النقل';end if;
delete from public.fu_entries e where e.report_id=rid and not exists(select 1 from jsonb_array_elements(rows)x where (x->>'id')::uuid=e.employee_id);
insert into public.fu_entries(report_id,employee_id,employee_name,permanent_code) select rid,(x->>'id')::uuid,x->>'name',x->>'internal_code' from jsonb_array_elements(rows)x on conflict(report_id,employee_id) do nothing;
end if;
if p_kind in ('save','submit') then
for item in select value from jsonb_array_elements(coalesce(p_data->'entries','[]'::jsonb)) loop
if not exists(select 1 from public.fu_statuses where code=item->>'status' and enabled) then raise exception 'الحالة غير مفعّلة';end if;
update public.fu_entries set status=item->>'status' where report_id=rid and employee_id=(item->>'employee_id')::uuid;
if not found then raise exception 'الموظف خارج قائمة التقرير';end if;
end loop;
if (p_data->>'reporter_id')::uuid<>rep.reporter_id or p_data->>'channel'<>rep.channel then raise exception 'هوية المبلّغ وقناة التقرير محفوظتان. افتح تصريحاً صحيحاً من البداية';end if;
update public.fu_reports set note=coalesce(p_data->>'note',note) where id=rid;
end if;
newstate:=case p_kind when 'submit' then 'submitted' when 'return' then 'returned' when 'review' then 'reviewed' when 'revise' then 'draft' else rep.state end;
if p_kind='submit' then
rows:=public.followup_read('roster',jsonb_build_object('department_id',d,'start',rep.work_date,'shift_id',rep.shift_id));
if exists(select 1 from public.fu_entries e where e.report_id=rid and not exists(select 1 from jsonb_array_elements(rows)x where (x->>'id')::uuid=e.employee_id)) or jsonb_array_length(rows)<>(select count(*) from public.fu_entries where report_id=rid) then raise exception 'تغيرت قائمة القسم. يلزم تسوية نقل الموظفين';end if;
shiftkey:=coalesce(rep.shift_id,'00000000-0000-0000-0000-000000000000'::uuid);
-- Serialize every employee/day so an unshifted report also conflicts with a shift report.
for uid in select employee_id from public.fu_entries where report_id=rid order by employee_id loop perform pg_advisory_xact_lock(hashtextextended(uid::text||rep.work_date::text,0));end loop;
if exists(select 1 from public.fu_entries e join public.fu_final f on f.employee_id=e.employee_id and f.work_date=rep.work_date where e.report_id=rid and f.report_id<>rid and (f.shift_key=shiftkey or f.shift_key='00000000-0000-0000-0000-000000000000'::uuid or shiftkey='00000000-0000-0000-0000-000000000000'::uuid)) then raise exception 'تصريح متعارض للموظف والتاريخ والوردية' using errcode='23505';end if;
delete from public.fu_final where report_id=rid;
insert into public.fu_final select employee_id,rep.work_date,shiftkey,rid,status from public.fu_entries where report_id=rid;
elsif p_kind in ('return','revise') then delete from public.fu_final where report_id=rid;
end if;
update public.fu_reports set state=newstate,version=case when rep.updated_at is null then 1 else version+1 end,updated_at=now(),submitted_at=case when p_kind='submit' then now() else submitted_at end,reviewed_at=case when p_kind='review' then now() else null end,reviewed_by=case when p_kind='review' then u else null end,return_reason=case when p_kind='return' then reason else null end where id=rid;
result:=followup_private.snapshot(rid);
elsif p_kind='action' then
d:=(p_data->>'department_id')::uuid;
if not followup_private.scope(d) or (r not in ('ADMIN','FOLLOWUP') and (r<>'SUPERVISOR' or nullif(p_data->>'id','') is null)) then raise exception 'لا تملك صلاحية إدارة إجراءات القسم' using errcode='42501';end if;
if nullif(p_data->>'employee_id','') is not null and not exists(select 1 from public.employees where id=(p_data->>'employee_id')::uuid and department_id=d) then raise exception 'الموظف خارج القسم';end if;
if not exists(select 1 from public.fu_accounts a where a.user_id=(p_data->>'responsible_id')::uuid and a.active and (a.role='ADMIN' or exists(select 1 from public.fu_departments x where x.user_id=a.user_id and x.department_id=d))) then raise exception 'المسؤول خارج نطاق القسم';end if;
aid:=nullif(p_data->>'id','')::uuid;
if aid is null then
if p_data->>'state'='completed' and btrim(coalesce(p_data->>'completion',''))='' then raise exception 'تفاصيل الإنجاز مطلوبة';end if;
insert into public.fu_actions(department_id,employee_id,description,responsible_id,due_date,notes,created_by,state,completion) values(d,nullif(p_data->>'employee_id','')::uuid,p_data->>'description',(p_data->>'responsible_id')::uuid,(p_data->>'due_date')::date,coalesce(p_data->>'notes',''),u,coalesce(p_data->>'state','open'),p_data->>'completion') returning id into aid;
else
select * into act from public.fu_actions where id=aid for update;
if act.id is null or act.department_id is distinct from d or act.version is distinct from (p_data->>'version')::int then raise exception 'تغير الإجراء. حدّثه قبل الحفظ' using errcode='40001';end if;
if r='SUPERVISOR' and (act.responsible_id<>u or p_data->>'description'<>act.description or (p_data->>'responsible_id')::uuid<>act.responsible_id or (p_data->>'due_date')::date<>act.due_date or nullif(p_data->>'employee_id','')::uuid is distinct from act.employee_id) then raise exception 'المشرف يحدّث حالة إجراءاته وملاحظاته فقط' using errcode='42501';end if;
if p_data->>'state'='completed' and btrim(coalesce(p_data->>'completion',''))='' then raise exception 'تفاصيل الإنجاز مطلوبة';end if;
update public.fu_actions set employee_id=nullif(p_data->>'employee_id','')::uuid,description=p_data->>'description',responsible_id=(p_data->>'responsible_id')::uuid,due_date=(p_data->>'due_date')::date,state=p_data->>'state',notes=coalesce(p_data->>'notes',''),completion=p_data->>'completion',version=version+1,updated_at=now() where id=aid;
end if;
select to_jsonb(t) into result from public.fu_actions t where id=aid;
insert into public.fu_activity(action_id,actor,details) values(aid,u,result);
elsif p_kind='account' and r='ADMIN' then
uid:=(p_data->>'user_id')::uuid;
if uid=u and (p_data->>'role'<>'ADMIN' or not (p_data->>'active')::boolean) then raise exception 'لا يمكنك تعطيل صلاحيتك الإدارية';end if;
insert into public.fu_accounts values(uid,p_data->>'role',(p_data->>'active')::boolean,1) on conflict(user_id) do update set role=excluded.role,active=excluded.active,version=public.fu_accounts.version+1 where public.fu_accounts.version=(p_data->>'version')::int;
if not found then raise exception 'تغير الحساب' using errcode='40001';end if;
delete from public.fu_departments where user_id=uid;
insert into public.fu_departments select uid,value::text::uuid from jsonb_array_elements_text(p_data->'departments');result:=jsonb_build_object('ok',true);
update public.profiles set is_active=(p_data->>'active')::boolean,version=version+1 where id=uid;
elsif p_kind='policy' and r='ADMIN' then
if p_data->>'code'='unresolved' and not (p_data->>'enabled')::boolean then raise exception 'حالة غير محدد لازمة لتعداد القائمة';end if;
insert into public.fu_statuses(code,label,category,weight,enabled) values(p_data->>'code',p_data->>'label',p_data->>'category',coalesce((p_data->>'weight')::int,0),(p_data->>'enabled')::boolean) on conflict(code) do update set enabled=excluded.enabled;
result:=jsonb_build_object('ok',true);
elsif p_kind='department' and r='ADMIN' then
insert into public.departments(arabic_name,english_name,display_order) values(p_data->>'name',p_data->>'name',coalesce((p_data->>'order')::int,10)) returning to_jsonb(public.departments.*) into result;
else raise exception 'طلب غير متاح' using errcode='42501';end if;
insert into public.fu_requests values(u,p_request_id,result,jsonb_build_object('kind',p_kind,'data',p_data));return result;
end$$;

