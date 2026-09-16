-- PostgreSQL / Supabase: execute as migration owner. No client-side service key.
begin;
create schema if not exists hr_private;
revoke all on schema hr_private from public, anon, authenticated;
create table public.profiles (
 id uuid primary key references auth.users(id) on delete restrict,
 name text not null check(length(btrim(name)) between 1 and 150), email text not null,
 role text not null default 'VIEWER' check(role in ('ADMIN','HR','VIEWER')),
 is_active boolean not null default false, version integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.departments (
 id uuid primary key default gen_random_uuid(), arabic_name text not null check(length(btrim(arabic_name)) between 1 and 100),
 english_name text not null check(length(btrim(english_name)) between 1 and 100), display_order integer not null default 10 check(display_order>=0),
 is_active boolean not null default true, version integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index department_ar_unique on public.departments(lower(btrim(arabic_name)));
create unique index department_en_unique on public.departments(lower(btrim(english_name)));
create table public.shifts (
 id uuid primary key default gen_random_uuid(),name text not null check(length(btrim(name)) between 1 and 100),is_active boolean not null default true,
 version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create unique index shift_name_unique on public.shifts(lower(btrim(name)));
create table public.employees (
 id uuid primary key default gen_random_uuid(), employee_number text unique check(employee_number is null or length(btrim(employee_number)) between 1 and 50),
 name text not null check(length(btrim(name)) between 1 and 150),department_id uuid not null references public.departments(id) on delete restrict,
 shift_id uuid references public.shifts(id) on delete restrict, direct_manager_id uuid,
 employment_status text not null default 'active' check(employment_status in ('active','resigned','inactive','long_leave')),
 version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 created_by uuid references public.profiles(id) on delete restrict,updated_by uuid references public.profiles(id) on delete restrict
);
create table public.managers (
 id uuid primary key default gen_random_uuid(),name text not null check(length(btrim(name)) between 1 and 150),
 employee_id uuid unique references public.employees(id) on delete restrict,is_active boolean not null default true,
 version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.employees add constraint employee_manager_fk foreign key (direct_manager_id) references public.managers(id) on delete restrict;
create table public.hr_status_records (
 id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.employees(id) on delete restrict,
 record_date date not null, status_type text not null check(status_type in ('absence','absence2','absence3','leave','late')),
 late_minutes integer check(late_minutes between 0 and 10080), notes text check(length(notes)<=1000),
 version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 created_by uuid references public.profiles(id) on delete restrict, updated_by uuid references public.profiles(id) on delete restrict,
 deleted_at timestamptz,check((status_type='late' and late_minutes is not null) or (status_type<>'late' and late_minutes is null))
);
create unique index one_active_exception_per_day on public.hr_status_records(employee_id,record_date) where deleted_at is null;
create index employee_department on public.employees(department_id);
create index employee_shift on public.employees(shift_id);
create index employee_manager on public.employees(direct_manager_id);
create index employee_status_name on public.employees(employment_status,name);
create index employee_search on public.employees(lower(name) text_pattern_ops);
create index status_month on public.hr_status_records(record_date,employee_id) where deleted_at is null;
create index status_employee_history on public.hr_status_records(employee_id,record_date desc);
create table public.audit_logs (
 id uuid primary key default gen_random_uuid(), actor_id uuid references public.profiles(id) on delete restrict,
 actor_name text not null,created_at timestamptz not null default now(),action text not null,entity_type text not null,
 entity_id uuid not null,description text not null,old_values jsonb,new_values jsonb
);
create index audit_time on public.audit_logs(created_at desc);
create index audit_entity on public.audit_logs(entity_id,created_at desc);
create table public.app_settings(id uuid primary key default gen_random_uuid(), key text unique not null,value text not null check(length(value) between 1 and 150),version integer not null default 1,created_at timestamptz default now(),updated_at timestamptz default now());
create table public.import_batches(id uuid primary key, source_hash text unique not null, row_count integer not null,created_by uuid references public.profiles(id),created_at timestamptz not null default now());

create function hr_private.require_role(roles text[]) returns public.profiles language plpgsql security definer set search_path='' as $$
declare p public.profiles;
begin
 select * into p from public.profiles where id=auth.uid() and is_active;
 if p.id is null then raise exception using errcode='42501',message='الحساب غير مفعل أو الجلسة منتهية'; end if;
 if not(p.role=any(roles)) then raise exception using errcode='42501',message='ليست لديك صلاحية لهذه العملية'; end if;
 return p;
end $$;
create function hr_private.touch() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' then new.updated_at=now();new.version=old.version+1;end if;
 if tg_table_name in ('employees','hr_status_records') then
  new.updated_by=auth.uid();if tg_op='INSERT' then new.created_by=auth.uid();end if;
 end if;
 return new;
end $$;
create function hr_private.audit() returns trigger language plpgsql security definer set search_path='' as $$
declare previous jsonb; next_value jsonb; actor text; verb text; label text;
begin
 if tg_op='UPDATE' then previous=to_jsonb(old);end if; next_value=to_jsonb(new);
 select name into actor from public.profiles where id=auth.uid();
 verb=case when tg_op='INSERT' then 'create' else 'update' end;
 label=case tg_table_name when 'employees' then 'الموظف' when 'hr_status_records' then 'الحالة اليومية' when 'departments' then 'القسم' when 'shifts' then 'الشفت' when 'managers' then 'المسؤول المباشر' when 'profiles' then 'المستخدم' else 'الإعدادات' end;
 if tg_table_name='employees' and tg_op='UPDATE' then
  if previous->>'department_id' is distinct from next_value->>'department_id' then verb='transfer';end if;
  if previous->>'employment_status' is distinct from next_value->>'employment_status' then verb='employment_status';end if;
 end if;
 if tg_table_name='hr_status_records' and tg_op='UPDATE' and previous->>'deleted_at' is null and next_value->>'deleted_at' is not null then verb='soft_delete';end if;
 insert into public.audit_logs(actor_id,actor_name,action,entity_type,entity_id,description,old_values,new_values)
 values(auth.uid(),coalesce(actor,'استيراد النظام'),verb,tg_table_name,new.id,
 case verb when 'create' then 'إضافة ' when 'transfer' then 'نقل ' when 'employment_status' then 'تغيير حالة ' when 'soft_delete' then 'حذف ' else 'تعديل ' end ||label||coalesce(' · '||(next_value->>'name'),''),previous,next_value);
 return new;
end $$;
create function hr_private.immutable_audit() returns trigger language plpgsql as $$ begin raise exception 'سجل التعديلات غير قابل للتغيير';end $$;
create trigger audit_immutable before update or delete on public.audit_logs for each row execute function hr_private.immutable_audit();
do $$declare t text;begin
 foreach t in array array['employees','hr_status_records','departments','shifts','managers','profiles','app_settings'] loop
 execute format('create trigger touch before insert or update on public.%I for each row execute function hr_private.touch()',t);
 execute format('create trigger audit after insert or update on public.%I for each row execute function hr_private.audit()',t);
 end loop;
 foreach t in array array['profiles','employees','departments','shifts','managers','hr_status_records','audit_logs','app_settings','import_batches'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 end loop;
end $$;
-- No table-write policies: callers can only use the narrowly authorized RPCs below.
create policy own_profile_read on public.profiles for select to authenticated using(id=auth.uid());
grant select on public.profiles to authenticated;
create function hr_private.new_auth_user() returns trigger language plpgsql security definer set search_path='' as $$begin
 insert into public.profiles(id,email,name) values(new.id,new.email,coalesce(nullif(btrim(new.raw_user_meta_data->>'name'),''),split_part(new.email,'@',1))) on conflict(id) do nothing;return new;
end $$;
create trigger hr_new_auth_user after insert on auth.users for each row execute function hr_private.new_auth_user();

create view hr_private.employee_view as
 select e.*,d.arabic_name||' ('||d.english_name||')' department,d.display_order,
 s.name shift,coalesce(me.name,m.name) manager
 from public.employees e join public.departments d on d.id=e.department_id
 left join public.shifts s on s.id=e.shift_id left join public.managers m on m.id=e.direct_manager_id
 left join public.employees me on me.id=m.employee_id;
create view hr_private.record_view as
 select r.*,e.name employee_name,e.employee_number,e.department,e.department_id from public.hr_status_records r join hr_private.employee_view e on e.id=r.employee_id;
create view hr_private.review_view as
 select id employee_id,name,department,created_at,
 concat_ws('، ',case when shift_id is null then 'الشفت غير محدد' end,case when direct_manager_id is null then 'المسؤول المباشر غير محدد' end) issue
 from hr_private.employee_view where employment_status='active' and (shift_id is null or direct_manager_id is null);

create function public.hr_read(p_kind text,p_filters jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.profiles; result jsonb; from_day date; to_day date; today date=(now() at time zone 'Asia/Baghdad')::date; pg integer; dep uuid; sh uuid; v_manager uuid; term text;
begin
 p=hr_private.require_role(array['ADMIN','HR','VIEWER']);
 pg=greatest(0,least(coalesce((p_filters->>'page')::integer,1)-1,100000));
 dep=nullif(p_filters->>'department_id','')::uuid;sh=nullif(p_filters->>'shift_id','')::uuid;v_manager=nullif(p_filters->>'manager_id','')::uuid;
 term=btrim(coalesce(p_filters->>'search',''));
 if p_filters ? 'month' then
  if (p_filters->>'month') !~ '^\d{4}-(0[1-9]|1[012])$' then raise exception 'الشهر غير صالح';end if;
  from_day=((p_filters->>'month')||'-01')::date;
 else from_day=date_trunc('month',today)::date;end if;
 to_day=(from_day+interval '1 month')::date;
 if p_kind='session' then return to_jsonb(p);end if;
 if p_kind in ('audit','users','settings','import_reference') then perform hr_private.require_role(array['ADMIN']);end if;
 if p_kind='reference' or p_kind='settings' then
  return jsonb_build_object('departments',(select coalesce(jsonb_agg(d order by display_order,arabic_name),'[]') from public.departments d),
   'shifts',(select coalesce(jsonb_agg(s order by name),'[]') from public.shifts s),
   'managers',(select coalesce(jsonb_agg(x order by name),'[]') from (select m.id,coalesce(e.name,m.name) name,m.employee_id,m.is_active,m.version from public.managers m left join public.employees e on e.id=m.employee_id) x),
   'employees',(select coalesce(jsonb_agg(e order by display_order,name),'[]') from hr_private.employee_view e where employment_status='active'),
   'app_name',(select value from public.app_settings where key='app_name'),'app_version',(select version from public.app_settings where key='app_name'));
 elsif p_kind='import_reference' then
  select coalesce(jsonb_agg(e),'[]') into result from hr_private.employee_view e;return result;
 elsif p_kind='employees' then
  with filtered as(select * from hr_private.employee_view e where (dep is null or department_id=dep) and(sh is null or shift_id=sh) and(v_manager is null or direct_manager_id=v_manager)
   and(coalesce(p_filters->>'employment_status','')='' or employment_status=p_filters->>'employment_status')
   and(term='' or position(lower(term) in lower(name))>0 or position(lower(term) in lower(coalesce(employee_number,'')))>0)),
  page as(select * from filtered order by display_order,name,id offset pg*25 limit 25)
  select jsonb_build_object('rows',(select coalesce(jsonb_agg(page),'[]') from page),'total',(select count(*) from filtered)) into result;return result;
 elsif p_kind='employee' then
  select to_jsonb(e) into result from hr_private.employee_view e where id=(p_filters->>'id')::uuid;
  if result is null then raise exception 'الموظف غير موجود';end if;return result;
 elsif p_kind='records' then
  with filtered as(select * from hr_private.record_view r where deleted_at is null and
   ((p_filters ? 'date' and record_date=(p_filters->>'date')::date) or (not(p_filters?'date') and record_date>=from_day and record_date<to_day))
   and(dep is null or department_id=dep) and(not(p_filters?'employee_id') or employee_id=(p_filters->>'employee_id')::uuid)
   and(term='' or position(lower(term) in lower(employee_name))>0 or position(lower(term) in lower(coalesce(employee_number,'')))>0)),
  page as(select * from filtered order by record_date desc,created_at desc offset pg*50 limit 50)
  select jsonb_build_object('rows',(select coalesce(jsonb_agg(page),'[]') from page),'total',(select count(*) from filtered)) into result;return result;
 elsif p_kind='report' then
  with selected as(select * from hr_private.employee_view e where (employment_status='active' or p_filters->>'include_inactive'='true')
   and(dep is null or department_id=dep) and(sh is null or shift_id=sh) and(v_manager is null or direct_manager_id=v_manager)
   and(term='' or position(lower(term) in lower(name))>0 or position(lower(term) in lower(coalesce(employee_number,'')))>0)),
  counted as(select e.id,
   count(*) filter(where r.status_type='absence') absence,count(*) filter(where r.status_type='absence2') absence2,count(*) filter(where r.status_type='absence3') absence3,
   count(*) filter(where r.status_type='leave') leave,count(*) filter(where r.status_type='late') late,coalesce(sum(r.late_minutes),0) late_minutes,
   coalesce(sum(case r.status_type when 'absence' then 1 when 'absence2' then 2 when 'absence3' then 3 else 0 end),0) weighted,
   coalesce(jsonb_object_agg(extract(day from r.record_date)::integer::text,r.status_type) filter(where r.id is not null),'{}') cells
   from selected e left join public.hr_status_records r on r.employee_id=e.id and r.deleted_at is null and r.record_date>=from_day and r.record_date<to_day group by e.id),
  full_rows as(select e.*,c.absence,c.absence2,c.absence3,c.leave,c.late,c.late_minutes,c.weighted,c.cells from selected e join counted c using(id))
  select jsonb_build_object('month',to_char(from_day,'YYYY-MM'),'rows',coalesce(jsonb_agg(f order by display_order,name,id),'[]'),
   'totals',jsonb_build_object('absence',coalesce(sum(absence),0),'absence2',coalesce(sum(absence2),0),'absence3',coalesce(sum(absence3),0),'leave',coalesce(sum(leave),0),'late',coalesce(sum(late),0),'late_minutes',coalesce(sum(late_minutes),0),'weighted',coalesce(sum(weighted),0))) into result from full_rows f;return result;
 elsif p_kind='review' then
  select coalesce(jsonb_agg(x order by name),'[]') into result from hr_private.review_view x;return result;
 elsif p_kind='dashboard' then
  return jsonb_build_object('active',(select count(*) from public.employees where employment_status='active'),
   'absence',(select count(*) from public.hr_status_records where record_date=today and status_type in ('absence','absence2','absence3') and deleted_at is null),
   'leave',(select count(*) from public.hr_status_records where record_date=today and status_type='leave' and deleted_at is null),
   'late',(select count(*) from public.hr_status_records where record_date=today and status_type='late' and deleted_at is null),
   'review',(select count(*) from hr_private.review_view),'today',today,
   'recent',(select coalesce(jsonb_agg(x),'[]') from(select * from hr_private.record_view where deleted_at is null order by updated_at desc limit 8) x),
   'departments',(select coalesce(jsonb_agg(x order by display_order),'[]') from(select d.id,d.arabic_name||' ('||d.english_name||')' name,d.display_order,count(e.id) count from public.departments d left join public.employees e on e.department_id=d.id and e.employment_status='active' group by d.id) x));
 elsif p_kind='audit' then
  with filtered as(select * from public.audit_logs where (not(p_filters?'employee_id') or entity_id=(p_filters->>'employee_id')::uuid or new_values->>'employee_id'=p_filters->>'employee_id') and(term='' or position(term in description)>0 or position(term in actor_name)>0)),
  page as(select * from filtered order by created_at desc offset pg*50 limit 50)
  select jsonb_build_object('rows',(select coalesce(jsonb_agg(page),'[]') from page),'total',(select count(*) from filtered)) into result;return result;
 elsif p_kind='users' then
  select coalesce(jsonb_agg(x order by name),'[]') into result from public.profiles x;return result;
 end if;
 raise exception 'طلب غير صالح';
end $$;

create function public.hr_write(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
   insert into public.employees(name,employee_number,department_id,shift_id,direct_manager_id,employment_status)
   values(btrim(p_data->>'name'),nullif(btrim(p_data->>'employee_number'),''),d,s,m,p_data->>'employment_status') returning * into e;
  else
   update public.employees set name=btrim(p_data->>'name'),employee_number=nullif(btrim(p_data->>'employee_number'),''),department_id=d,shift_id=s,direct_manager_id=m,employment_status=p_data->>'employment_status' where id=item_id and version=rev returning * into e;
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

create function public.hr_import(p_batch uuid,p_hash text,p_rows jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.profiles; r jsonb; n integer=0; existing public.employees; result jsonb;
begin
 p=hr_private.require_role(array['ADMIN']);
 if jsonb_array_length(p_rows) not between 1 and 2000 then raise exception 'عدد الصفوف غير صالح';end if;
 if exists(select 1 from public.import_batches where source_hash=p_hash or id=p_batch) then raise exception 'تم استيراد هذا الملف مسبقاً';end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  if r->>'mode'='update' then
   select * into existing from public.employees where id=(r->>'id')::uuid;
   if existing.id is null or existing.version is distinct from (r->>'version')::integer then raise exception 'تغيرت البيانات منذ المعاينة. أعد الاستيراد';end if;
   if existing.employee_number is distinct from r->>'employee_number' then raise exception 'رقم الموظف غير مطابق';end if;
  elsif r->>'mode'<>'create' or r ? 'id' then raise exception 'طريقة استيراد غير صالحة';end if;
  result=public.hr_write('employee.save',r);n=n+1;
 end loop;
 insert into public.import_batches(id,source_hash,row_count,created_by) values(p_batch,p_hash,n,p.id);
 return jsonb_build_object('count',n);
end $$;
-- First admin can only be activated through the migration owner / service_role.
create function public.hr_bootstrap(p_user_id uuid) returns void language plpgsql security definer set search_path='' as $$begin
 perform pg_advisory_xact_lock(9042026);
 if exists(select 1 from public.profiles where role='ADMIN' and is_active) then raise exception 'تم إعداد مدير النظام مسبقاً';end if;
 update public.profiles set role='ADMIN',is_active=true where id=p_user_id;
 if not found then raise exception 'المستخدم غير موجود';end if;
end $$;
revoke all on function public.hr_read(text,jsonb),public.hr_write(text,jsonb),public.hr_import(uuid,text,jsonb),public.hr_bootstrap(uuid) from public,anon,authenticated;
grant execute on function public.hr_read(text,jsonb),public.hr_write(text,jsonb),public.hr_import(uuid,text,jsonb) to authenticated;
grant execute on function public.hr_bootstrap(uuid) to service_role;
revoke all on all functions in schema hr_private from public,anon,authenticated;
insert into public.app_settings(key,value) values('app_name','إدارة الموارد البشرية');
insert into public.shifts(name) values('صباحي'),('مسائي');
commit;
