-- Additive rebuild. Employee and historical biometric rows are never rewritten.
begin;
create schema if not exists followup_private;
revoke all on schema followup_private from public,anon,authenticated;
create table public.fu_accounts(user_id uuid primary key references public.profiles(id),role text not null check(role in ('ADMIN','SUPERVISOR','FOLLOWUP','VIEWER')),active boolean not null default true,version int not null default 1);
create table public.fu_departments(user_id uuid references public.fu_accounts(user_id),department_id uuid references public.departments(id),primary key(user_id,department_id));
create table public.fu_statuses(code text primary key check(code ~ '^[a-z][a-z0-9_]{2,30}$'),label text not null check(length(btrim(label)) between 1 and 100),category text not null check(category in ('present','absent','leave','other','unresolved')),weight int not null default 0 check((category='absent' and weight between 1 and 3) or (category<>'absent' and weight=0)),enabled boolean not null default true);
insert into public.fu_statuses values ('present','حاضر','present',0,true),('absent1','غياب ×1','absent',1,true),('absent2','غياب ×2','absent',2,false),('absent3','غياب ×3','absent',3,true),('leave','إجازة','leave',0,true),('unresolved','لم يُبلّغ / غير محدد','unresolved',0,true);
create table public.fu_reports(id uuid primary key default gen_random_uuid(),work_date date not null,department_id uuid not null references public.departments(id),shift_id uuid references public.shifts(id),reporter_id uuid not null references public.profiles(id),entered_by uuid not null references public.profiles(id),channel text not null check(channel in ('account','message','phone','person')),note text not null default '',state text not null default 'draft' check(state in ('draft','submitted','returned','reviewed')),version int not null default 1,submitted_at timestamptz,reviewed_at timestamptz,reviewed_by uuid references public.profiles(id),return_reason text,updated_at timestamptz not null default now());
create unique index fu_report_scope on public.fu_reports(work_date,department_id,coalesce(shift_id,'00000000-0000-0000-0000-000000000000'::uuid));
create table public.fu_entries(report_id uuid references public.fu_reports(id),employee_id uuid references public.employees(id),status text not null default 'unresolved' references public.fu_statuses(code),employee_name text not null,permanent_code text not null,primary key(report_id,employee_id));
create table public.fu_final(employee_id uuid references public.employees(id),work_date date not null,shift_key uuid not null,report_id uuid references public.fu_reports(id),status text not null references public.fu_statuses(code),primary key(employee_id,work_date,shift_key));
create table public.fu_revisions(id bigint generated always as identity primary key,report_id uuid not null references public.fu_reports(id),version int not null,actor uuid not null references public.profiles(id),at timestamptz not null default now(),reason text not null,snapshot jsonb not null,unique(report_id,version));
create table public.fu_actions(id uuid primary key default gen_random_uuid(),department_id uuid not null references public.departments(id),employee_id uuid references public.employees(id),description text not null check(length(btrim(description)) between 1 and 2000),responsible_id uuid not null references public.profiles(id),due_date date not null,state text not null default 'open' check(state in ('open','progress','decision','completed')),notes text not null default '',completion text,created_by uuid not null references public.profiles(id),updated_at timestamptz not null default now(),version int not null default 1);
create table public.fu_activity(id bigint generated always as identity primary key,action_id uuid references public.fu_actions(id),actor uuid references public.profiles(id),at timestamptz not null default now(),details jsonb not null);
create table public.fu_requests(user_id uuid references public.profiles(id),request_id uuid not null,result jsonb not null,payload jsonb not null,primary key(user_id,request_id));
insert into public.fu_accounts(user_id,role) select id,'ADMIN' from public.profiles where role='ADMIN' and is_active;

create function followup_private.account_role() returns text language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare r text;
begin
if nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id' is null or not exists(select 1 from auth.sessions s where s.id=(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id')::uuid and s.user_id=auth.uid() and (s.not_after is null or s.not_after>now())) then raise exception 'انتهت الجلسة. يرجى تسجيل الدخول' using errcode='42501';end if;
select a.role into r from public.fu_accounts a join public.profiles p on p.id=a.user_id where a.user_id=auth.uid() and a.active and p.is_active;
if r is null then raise exception 'الحساب غير مخوّل لقسم المتابعة' using errcode='42501';end if;
return r;end$$;
create function followup_private.scope(d uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
select followup_private.account_role()='ADMIN' or exists(select 1 from public.fu_departments where user_id=auth.uid() and department_id=d)$$;
create function followup_private.snapshot(r uuid) returns jsonb language sql stable set search_path=pg_catalog,public as $$
select to_jsonb(a)||jsonb_build_object('entries',coalesce((select jsonb_agg(to_jsonb(e) order by e.employee_name,e.employee_id) from public.fu_entries e where e.report_id=a.id),'[]'::jsonb)) from public.fu_reports a where a.id=r$$;
create function public.followup_session() returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare p jsonb;r text;
begin r:=followup_private.account_role();select to_jsonb(t)||jsonb_build_object('followup_role',r) into p from public.profiles t where id=auth.uid();return p;end$$;
create function public.followup_read(p_kind text,p_filters jsonb default '{}') returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
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
select e.id employee_id,e.name,e.internal_code,day::date work_date,coalesce(h.department_id,e.department_id) department_id,dep.arabic_name department_name,coalesce(h.shift_id,e.shift_id) shift_id,coalesce(f.status,'unresolved') status,case when f.report_id is null then coalesce(rp.state,'missing') else rp.state end review_state,rp.id report_id,
case when rp.id is null then 'missing' when exists(select 1 from public.fu_entries x where x.report_id=rp.id and x.status='unresolved') then 'partial' else 'complete' end completeness
from generate_series(startdate,enddate,'1 day'::interval) day cross join public.employees e
left join lateral(select a.* from public.employee_assignment_history a where a.employee_id=e.id and a.voided_at is null and a.valid_from<=day::date and (a.valid_to is null or a.valid_to>=day::date) order by a.valid_from desc limit 1)h on true
join public.departments dep on dep.id=coalesce(h.department_id,e.department_id)
left join public.fu_final f on f.employee_id=e.id and f.work_date=day::date
left join public.fu_reports rp on rp.id=f.report_id
where coalesce(h.employment_status,e.employment_status) in ('active','long_leave') and followup_private.scope(coalesce(h.department_id,e.department_id)) and (d is null or coalesce(h.department_id,e.department_id)=d) and (f.report_id is null or followup_private.scope(rp.department_id))
)t),'[]'::jsonb);
elsif p_kind='roster' then
if d is null then raise exception 'اختر القسم';end if;
return coalesce((select jsonb_agg(to_jsonb(t) order by name,id) from (
select e.id,e.name,e.internal_code,e.employee_number,e.department_id,e.shift_id,e.employment_status,
coalesce(h.department_id,e.department_id) effective_department,coalesce(h.shift_id,e.shift_id) effective_shift
from public.employees e left join lateral(select a.* from public.employee_assignment_history a where a.employee_id=e.id and a.voided_at is null and a.valid_from<=startdate and (a.valid_to is null or a.valid_to>=startdate) order by a.valid_from desc limit 1)h on true
where coalesce(h.department_id,e.department_id)=d and coalesce(h.employment_status,e.employment_status) in ('active','long_leave') and (nullif(p_filters->>'shift_id','') is null or coalesce(h.shift_id,e.shift_id)=nullif(p_filters->>'shift_id','')::uuid))t),'[]'::jsonb);
elsif p_kind='reports' then
return coalesce((select jsonb_agg(followup_private.snapshot(t.id) order by t.work_date desc,t.updated_at desc) from public.fu_reports t where followup_private.scope(t.department_id) and t.work_date between startdate and enddate and (d is null or t.department_id=d)),'[]'::jsonb);
elsif p_kind='actions' then
return coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('activity',coalesce((select jsonb_agg(to_jsonb(x) order by at,id) from public.fu_activity x where x.action_id=t.id),'[]'::jsonb)) order by due_date,id) from public.fu_actions t where followup_private.scope(t.department_id) and (d is null or t.department_id=d)),'[]'::jsonb);
elsif p_kind='revisions' then
return coalesce((select jsonb_agg(to_jsonb(t) order by t.version desc) from public.fu_revisions t join public.fu_reports a on a.id=t.report_id where a.id=(p_filters->>'id')::uuid and followup_private.scope(a.department_id)),'[]'::jsonb);
elsif p_kind='archive' and r='ADMIN' then
return jsonb_build_object('provenance','historical biometric source; not supervisor declarations','imports',coalesce((select jsonb_agg(to_jsonb(t)) from public.attendance_imports t),'[]'::jsonb),'rows',coalesce((select jsonb_agg(to_jsonb(t)) from public.fingerprint_source_rows t where t.import_id=(p_filters->>'import_id')::uuid),'[]'::jsonb));
end if;
raise exception 'طلب غير متاح' using errcode='42501';end$$;

create function public.followup_write(p_kind text,p_data jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r text:=followup_private.account_role();u uuid:=auth.uid();d uuid;rid uuid;aid uuid;rep public.fu_reports;act public.fu_actions;result jsonb;oldpayload jsonb;rows jsonb;item jsonb;reason text:=btrim(coalesce(p_data->>'reason',''));newstate text;shiftkey uuid;uid uuid;
begin
perform pg_advisory_xact_lock(hashtextextended(u::text||p_request_id::text,0));
select q.result,q.payload into result,oldpayload from public.fu_requests q where q.user_id=u and q.request_id=p_request_id;
if result is not null then if oldpayload<>jsonb_build_object('kind',p_kind,'data',p_data) then raise exception 'معرّف إعادة المحاولة مستخدم لطلب آخر';end if;return result;end if;
if r='VIEWER' then raise exception 'صلاحية قراءة فقط' using errcode='42501';end if;
if p_kind in ('save','submit','return','review','revise','reconcile') then
d:=(p_data->>'department_id')::uuid;
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
if rep.version<> (p_data->>'version')::int then raise exception 'تغير التقرير. حدّثه قبل الحفظ' using errcode='40001';end if;
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
if act.id is null or act.department_id<>d or act.version<>(p_data->>'version')::int then raise exception 'تغير الإجراء. حدّثه قبل الحفظ' using errcode='40001';end if;
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

do $$declare t text;f record;begin
foreach t in array array['fu_accounts','fu_departments','fu_statuses','fu_reports','fu_entries','fu_final','fu_revisions','fu_actions','fu_activity','fu_requests'] loop
execute format('alter table public.%I enable row level security',t);
execute format('revoke all on public.%I from public,anon,authenticated',t);
end loop;
-- Archive remains physically intact. Old operational RPCs and direct table access are closed.
for f in select p.oid::regprocedure::text signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'hr_%' or p.proname like 'attendance_%' or p.proname like 'employee_%') loop execute 'revoke execute on function '||f.signature||' from public,anon,authenticated';end loop;
for t in select tablename from pg_tables where schemaname='public' and tablename not like 'fu_%' loop execute format('revoke all on public.%I from anon,authenticated',t);end loop;
end$$;
revoke all on function public.followup_session(),public.followup_read(text,jsonb),public.followup_write(text,jsonb,uuid) from public,anon;
grant execute on function public.followup_session(),public.followup_read(text,jsonb),public.followup_write(text,jsonb,uuid) to authenticated;
revoke all on all functions in schema followup_private from public,anon,authenticated;
commit;

