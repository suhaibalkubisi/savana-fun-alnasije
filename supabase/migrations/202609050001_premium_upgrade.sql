-- Additive production upgrade for FANU ALNASIJ HR.
-- Existing employee/status identities and history are intentionally untouched.
begin;

create table if not exists public.administrative_action_types (
  id uuid primary key default gen_random_uuid(),
  arabic_name text not null check (length(btrim(arabic_name)) between 1 and 100),
  display_order integer not null default 10 check (display_order >= 0),
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists administrative_action_type_name_unique
  on public.administrative_action_types(lower(btrim(arabic_name)));

create table if not exists public.administrative_actions (
  id uuid primary key default gen_random_uuid(),
  reference_number text not null unique default ('ADM-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  employee_id uuid not null references public.employees(id) on delete restrict,
  action_type_id uuid not null references public.administrative_action_types(id) on delete restrict,
  action_date date not null,
  reason text not null check (length(btrim(reason)) between 1 and 300),
  description text check (description is null or length(description) <= 3000),
  notes text check (notes is null or length(notes) <= 2000),
  related_status_record_id uuid references public.hr_status_records(id) on delete restrict,
  state text not null default 'active' check (state in ('active','closed','cancelled')),
  version integer not null default 1,
  created_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists administrative_actions_employee_date
  on public.administrative_actions(employee_id, action_date desc) where deleted_at is null;
create index if not exists administrative_actions_month
  on public.administrative_actions(action_date, action_type_id, state) where deleted_at is null;
create index if not exists administrative_actions_related_status
  on public.administrative_actions(related_status_record_id) where related_status_record_id is not null and deleted_at is null;

alter table public.administrative_action_types enable row level security;
alter table public.administrative_actions enable row level security;
revoke all on public.administrative_action_types, public.administrative_actions from public, anon, authenticated;

insert into public.administrative_action_types(arabic_name, display_order)
values
  ('تنبيه', 1),
  ('لفت نظر', 2),
  ('إنذار', 3),
  ('إنذار نهائي', 4),
  ('تعهد', 5),
  ('خصم إداري', 6),
  ('إجراء آخر', 7)
on conflict do nothing;

create or replace function hr_private.touch_administrative_action()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by = auth.uid();
    new.updated_by = auth.uid();
  else
    new.updated_by = auth.uid();
    new.updated_at = now();
    new.version = old.version + 1;
  end if;
  return new;
end $$;

create or replace function hr_private.touch_action_type()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    new.updated_at = now();
    new.version = old.version + 1;
  end if;
  return new;
end $$;

drop trigger if exists touch_administrative_action on public.administrative_actions;
create trigger touch_administrative_action before insert or update on public.administrative_actions
for each row execute function hr_private.touch_administrative_action();
drop trigger if exists touch_administrative_action_type on public.administrative_action_types;
create trigger touch_administrative_action_type before update on public.administrative_action_types
for each row execute function hr_private.touch_action_type();

create or replace function hr_private.audit_administrative_action()
returns trigger language plpgsql security definer set search_path = '' as $$
declare previous jsonb; next_value jsonb; actor text; verb text; label text;
begin
  if tg_op = 'UPDATE' then previous = to_jsonb(old); end if;
  next_value = to_jsonb(new);
  select name into actor from public.profiles where id = auth.uid();
  verb = case when tg_op = 'INSERT' then 'create' else 'update' end;
  label = case when tg_table_name = 'administrative_actions' then 'الإجراء الإداري' else 'نوع الإجراء الإداري' end;
  if tg_table_name = 'administrative_actions' and tg_op = 'UPDATE'
     and previous->>'deleted_at' is null and next_value->>'deleted_at' is not null then
    verb = 'soft_delete';
  end if;
  insert into public.audit_logs(actor_id, actor_name, action, entity_type, entity_id, description, old_values, new_values)
  values (
    auth.uid(), coalesce(actor, 'النظام'), verb, tg_table_name, new.id,
    case verb when 'create' then 'إضافة ' when 'soft_delete' then 'حذف ' else 'تعديل ' end || label ||
      coalesce(' · ' || nullif(next_value->>'reference_number', ''), '') ||
      coalesce(' · ' || nullif(next_value->>'reason', ''), '') ||
      coalesce(' · ' || nullif(next_value->>'arabic_name', ''), ''),
    previous, next_value
  );
  return new;
end $$;

drop trigger if exists audit_administrative_action on public.administrative_actions;
create trigger audit_administrative_action after insert or update on public.administrative_actions
for each row execute function hr_private.audit_administrative_action();
drop trigger if exists audit_administrative_action_type on public.administrative_action_types;
create trigger audit_administrative_action_type after insert or update on public.administrative_action_types
for each row execute function hr_private.audit_administrative_action();

create or replace view hr_private.record_view_v2 as
select r.*, e.name employee_name, e.employee_number, e.department, e.department_id,
       e.shift_id, e.shift, e.direct_manager_id, e.manager,
       cp.name created_by_name, up.name updated_by_name
from public.hr_status_records r
join hr_private.employee_view e on e.id = r.employee_id
left join public.profiles cp on cp.id = r.created_by
left join public.profiles up on up.id = r.updated_by;

create or replace view hr_private.administrative_action_view as
select a.*, t.arabic_name action_type, e.name employee_name, e.employee_number,
       e.department, e.department_id, e.shift_id, e.shift, e.direct_manager_id, e.manager,
       cp.name created_by_name, up.name updated_by_name
from public.administrative_actions a
join public.administrative_action_types t on t.id = a.action_type_id
join hr_private.employee_view e on e.id = a.employee_id
left join public.profiles cp on cp.id = a.created_by
left join public.profiles up on up.id = a.updated_by;

create or replace function public.hr_read_v2(p_kind text, p_filters jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p public.profiles;
  result jsonb;
  base jsonb;
  from_day date;
  to_day date;
  today date = (now() at time zone 'Asia/Baghdad')::date;
  pg integer;
  dep uuid;
  sh uuid;
  v_manager uuid;
  emp uuid;
  action_type_filter uuid;
  term text;
begin
  p = hr_private.require_role(array['ADMIN','HR','VIEWER']);
  pg = greatest(0, least(coalesce((p_filters->>'page')::integer, 1) - 1, 100000));
  dep = nullif(p_filters->>'department_id', '')::uuid;
  sh = nullif(p_filters->>'shift_id', '')::uuid;
  v_manager = nullif(p_filters->>'manager_id', '')::uuid;
  emp = nullif(p_filters->>'employee_id', '')::uuid;
  action_type_filter = nullif(p_filters->>'action_type_id', '')::uuid;
  term = btrim(coalesce(p_filters->>'search', ''));
  if p_filters ? 'month' then
    if (p_filters->>'month') !~ '^\d{4}-(0[1-9]|1[012])$' then raise exception 'الشهر غير صالح'; end if;
    from_day = ((p_filters->>'month') || '-01')::date;
  else
    from_day = date_trunc('month', today)::date;
  end if;
  to_day = (from_day + interval '1 month')::date;

  if p_kind in ('reference','settings') then
    base = public.hr_read(p_kind, p_filters);
    return base || jsonb_build_object(
      'action_types', (select coalesce(jsonb_agg(t order by display_order, arabic_name), '[]') from public.administrative_action_types t)
    );
  elsif p_kind = 'dashboard' then
    return jsonb_build_object(
      'active', (select count(*) from public.employees where employment_status = 'active'),
      'absence', (select count(*) from public.hr_status_records where record_date = today and status_type in ('absence','absence2','absence3') and deleted_at is null),
      'leave', (select count(*) from public.hr_status_records where record_date = today and status_type = 'leave' and deleted_at is null),
      'late', (select count(*) from public.hr_status_records where record_date = today and status_type = 'late' and deleted_at is null),
      'late_minutes', (select coalesce(sum(late_minutes),0) from public.hr_status_records where record_date = today and status_type = 'late' and deleted_at is null),
      'actions_month', (select count(*) from public.administrative_actions where action_date >= from_day and action_date < to_day and state <> 'cancelled' and deleted_at is null),
      'review', (select count(*) from hr_private.review_view),
      'today', today,
      'recent', (select coalesce(jsonb_agg(x), '[]') from (select * from hr_private.record_view_v2 where deleted_at is null order by updated_at desc limit 8) x),
      'recent_actions', (select coalesce(jsonb_agg(x), '[]') from (select * from hr_private.administrative_action_view where deleted_at is null order by updated_at desc limit 6) x),
      'top_late', (select coalesce(jsonb_agg(x), '[]') from (
        select e.id employee_id, e.name employee_name, e.department, count(r.id) occurrences, coalesce(sum(r.late_minutes),0) minutes
        from public.hr_status_records r join hr_private.employee_view e on e.id = r.employee_id
        where r.deleted_at is null and r.status_type = 'late' and r.record_date >= from_day and r.record_date < to_day
        group by e.id, e.name, e.department order by minutes desc, occurrences desc, e.name limit 6
      ) x),
      'departments', (select coalesce(jsonb_agg(x order by display_order), '[]') from (
        select d.id, d.arabic_name || ' (' || d.english_name || ')' name, d.display_order, count(e.id) count
        from public.departments d left join public.employees e on e.department_id = d.id and e.employment_status = 'active'
        group by d.id
      ) x)
    );
  elsif p_kind = 'report' then
    with selected as (
      select * from hr_private.employee_view e where
        (employment_status = 'active' or p_filters->>'include_inactive' = 'true')
        and (dep is null or department_id = dep)
        and (sh is null or shift_id = sh)
        and (v_manager is null or direct_manager_id = v_manager)
        and (emp is null or id = emp)
        and (term = '' or position(lower(term) in lower(name)) > 0 or position(lower(term) in lower(coalesce(employee_number,''))) > 0)
    ), counted as (
      select e.id,
        count(r.id) filter(where r.status_type='absence') absence,
        count(r.id) filter(where r.status_type='absence2') absence2,
        count(r.id) filter(where r.status_type='absence3') absence3,
        count(r.id) filter(where r.status_type='leave') leave,
        count(r.id) filter(where r.status_type='late') late,
        coalesce(sum(r.late_minutes),0) late_minutes,
        coalesce(sum(case r.status_type when 'absence' then 1 when 'absence2' then 2 when 'absence3' then 3 else 0 end),0) weighted,
        coalesce(jsonb_object_agg(extract(day from r.record_date)::integer::text,r.status_type) filter(where r.id is not null),'{}') cells
      from selected e left join public.hr_status_records r on r.employee_id=e.id and r.deleted_at is null and r.record_date>=from_day and r.record_date<to_day
      group by e.id
    ), action_counted as (
      select e.id, count(a.id) administrative_actions
      from selected e left join public.administrative_actions a on a.employee_id=e.id and a.deleted_at is null and a.state<>'cancelled' and a.action_date>=from_day and a.action_date<to_day
      group by e.id
    ), full_rows as (
      select e.*, c.absence, c.absence2, c.absence3, c.leave, c.late, c.late_minutes, c.weighted, c.cells, a.administrative_actions
      from selected e join counted c using(id) join action_counted a using(id)
    )
    select jsonb_build_object(
      'month', to_char(from_day,'YYYY-MM'),
      'rows', coalesce(jsonb_agg(f order by display_order,name,id),'[]'),
      'totals', jsonb_build_object(
        'absence',coalesce(sum(absence),0),'absence2',coalesce(sum(absence2),0),'absence3',coalesce(sum(absence3),0),
        'leave',coalesce(sum(leave),0),'late',coalesce(sum(late),0),'late_minutes',coalesce(sum(late_minutes),0),
        'weighted',coalesce(sum(weighted),0),'administrative_actions',coalesce(sum(administrative_actions),0)
      )
    ) into result from full_rows f;
    return result;
  elsif p_kind = 'lateness' then
    with filtered as (
      select * from hr_private.record_view_v2 r where r.deleted_at is null and r.status_type='late'
        and r.record_date>=from_day and r.record_date<to_day
        and (dep is null or r.department_id=dep) and (sh is null or r.shift_id=sh)
        and (v_manager is null or r.direct_manager_id=v_manager) and (emp is null or r.employee_id=emp)
        and (not(p_filters?'min_minutes') or r.late_minutes >= (p_filters->>'min_minutes')::integer)
        and (not(p_filters?'max_minutes') or r.late_minutes <= (p_filters->>'max_minutes')::integer)
        and (term='' or position(lower(term) in lower(r.employee_name))>0 or position(lower(term) in lower(coalesce(r.employee_number,'')))>0)
    ), page as (select * from filtered order by record_date desc, updated_at desc offset pg*50 limit 50),
    by_employee as (
      select employee_id, employee_name, employee_number, department, count(*) occurrences,
             sum(late_minutes) total_minutes, round(avg(late_minutes),1) average_minutes,
             max(late_minutes) highest_minutes, max(record_date) last_late
      from filtered group by employee_id, employee_name, employee_number, department
      order by total_minutes desc, occurrences desc, employee_name
    )
    select jsonb_build_object(
      'rows',(select coalesce(jsonb_agg(page),'[]') from page),
      'total',(select count(*) from filtered),
      'kpis',(select jsonb_build_object('occurrences',count(*),'minutes',coalesce(sum(late_minutes),0),'average',coalesce(round(avg(late_minutes),1),0),'highest',coalesce(max(late_minutes),0),'employees',count(distinct employee_id)) from filtered),
      'summary',(select coalesce(jsonb_agg(by_employee),'[]') from by_employee)
    ) into result;
    return result;
  elsif p_kind = 'absence_leave' then
    with filtered as (
      select * from hr_private.record_view_v2 r where r.deleted_at is null and r.status_type in ('absence','absence2','absence3','leave')
        and r.record_date>=from_day and r.record_date<to_day
        and (dep is null or r.department_id=dep) and (emp is null or r.employee_id=emp)
        and (not(p_filters?'status_type') or p_filters->>'status_type'='' or r.status_type=p_filters->>'status_type')
        and (term='' or position(lower(term) in lower(r.employee_name))>0 or position(lower(term) in lower(coalesce(r.employee_number,'')))>0)
    ), page as (select * from filtered order by record_date desc, updated_at desc offset pg*50 limit 50)
    select jsonb_build_object(
      'rows',(select coalesce(jsonb_agg(page),'[]') from page),
      'total',(select count(*) from filtered),
      'kpis',(select jsonb_build_object(
        'absence',count(*) filter(where status_type='absence'),
        'absence2',count(*) filter(where status_type='absence2'),
        'absence3',count(*) filter(where status_type='absence3'),
        'leave',count(*) filter(where status_type='leave'),
        'weighted',coalesce(sum(case status_type when 'absence' then 1 when 'absence2' then 2 when 'absence3' then 3 else 0 end),0)
      ) from filtered)
    ) into result;
    return result;
  elsif p_kind in ('administrative_actions','employee_actions') then
    with filtered as (
      select * from hr_private.administrative_action_view a where a.deleted_at is null
        and a.action_date>=from_day and a.action_date<to_day
        and (dep is null or a.department_id=dep) and (emp is null or a.employee_id=emp)
        and (action_type_filter is null or a.action_type_id=action_type_filter)
        and (not(p_filters?'state') or p_filters->>'state'='' or a.state=p_filters->>'state')
        and (term='' or position(lower(term) in lower(a.employee_name))>0 or position(lower(term) in lower(coalesce(a.employee_number,'')))>0 or position(lower(term) in lower(a.reason))>0)
    ), page as (select * from filtered order by action_date desc, updated_at desc offset pg*50 limit 50)
    select jsonb_build_object('rows',(select coalesce(jsonb_agg(page),'[]') from page),'total',(select count(*) from filtered)) into result;
    return result;
  elsif p_kind = 'administrative_action' then
    select to_jsonb(a) into result from hr_private.administrative_action_view a where a.id=(p_filters->>'id')::uuid and a.deleted_at is null;
    if result is null then raise exception 'الإجراء الإداري غير موجود'; end if;
    return result;
  elsif p_kind = 'employee_audit' then
    if p.role <> 'ADMIN' then raise exception using errcode='42501', message='ليست لديك صلاحية لهذه العملية'; end if;
    with filtered as (
      select * from public.audit_logs where entity_id=emp or new_values->>'employee_id'=emp::text or old_values->>'employee_id'=emp::text
    ), page as (select * from filtered order by created_at desc offset pg*50 limit 50)
    select jsonb_build_object('rows',(select coalesce(jsonb_agg(page),'[]') from page),'total',(select count(*) from filtered)) into result;
    return result;
  elsif p_kind = 'employee_report' then
    select jsonb_build_object(
      'employee', (select to_jsonb(e) from hr_private.employee_view e where e.id=emp),
      'report', public.hr_read_v2('report', p_filters),
      'records', (select coalesce(jsonb_agg(r order by record_date desc),'[]') from hr_private.record_view_v2 r where r.employee_id=emp and r.deleted_at is null and r.record_date>=from_day and r.record_date<to_day),
      'actions', (select coalesce(jsonb_agg(a order by action_date desc),'[]') from hr_private.administrative_action_view a where a.employee_id=emp and a.deleted_at is null and a.action_date>=from_day and a.action_date<to_day)
    ) into result;
    return result;
  end if;
  return public.hr_read(p_kind, p_filters);
end $$;

create or replace function public.hr_write_v2(p_action text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor public.profiles;
  item jsonb;
  op text;
  result jsonb;
  a public.administrative_actions;
  item_id uuid;
  rev integer;
  employee_id_value uuid;
  action_type_value uuid;
  related_value uuid;
  active_value boolean;
begin
  actor = hr_private.require_role(array['ADMIN','HR']);
  item_id = nullif(p_data->>'id','')::uuid;
  rev = nullif(p_data->>'version','')::integer;

  if p_action = 'status.bulk' then
    if jsonb_typeof(p_data->'items') <> 'array' or jsonb_array_length(p_data->'items') not between 1 and 200 then
      raise exception 'عدد الإدخالات غير صالح';
    end if;
    for item in select value from jsonb_array_elements(p_data->'items') loop
      op = item->>'operation';
      if op = 'save' then
        result = public.hr_write('status.save', item->'data');
        if coalesce((result->>'conflict')::boolean,false) then raise exception 'توجد حالة مسجلة لهذا الموظف بهذا التاريخ'; end if;
      elsif op = 'delete' then
        result = public.hr_write('status.delete', item->'data');
      else
        raise exception 'عملية إدخال سريع غير صالحة';
      end if;
    end loop;
    return jsonb_build_object('count',jsonb_array_length(p_data->'items'));
  elsif p_action = 'administrative_action.save' then
    employee_id_value = (p_data->>'employee_id')::uuid;
    action_type_value = (p_data->>'action_type_id')::uuid;
    related_value = nullif(p_data->>'related_status_record_id','')::uuid;
    perform 1 from public.employees where id=employee_id_value for share;
    if not found then raise exception 'الموظف غير موجود'; end if;
    perform 1 from public.administrative_action_types t
      where t.id=action_type_value
        and (t.is_active or exists (
          select 1 from public.administrative_actions current_action
          where current_action.id=item_id and current_action.action_type_id=t.id and current_action.deleted_at is null
        ))
      for share;
    if not found then raise exception 'نوع الإجراء غير صالح أو غير نشط'; end if;
    if related_value is not null then
      perform 1 from public.hr_status_records where id=related_value and employee_id=employee_id_value and deleted_at is null for share;
      if not found then raise exception 'الحالة المرتبطة غير صالحة'; end if;
    end if;
    if item_id is null then
      insert into public.administrative_actions(employee_id,action_type_id,action_date,reason,description,notes,related_status_record_id,state)
      values(employee_id_value,action_type_value,(p_data->>'action_date')::date,btrim(p_data->>'reason'),nullif(btrim(p_data->>'description'),''),nullif(btrim(p_data->>'notes'),''),related_value,p_data->>'state')
      returning * into a;
    else
      select * into a from public.administrative_actions where id=item_id and deleted_at is null for update;
      if a.id is null or a.version is distinct from rev then raise exception using errcode='40001',message='تم تعديل السجل بواسطة مستخدم آخر. أعد تحميله'; end if;
      if a.employee_id is distinct from employee_id_value then raise exception 'لا يمكن تغيير هوية الموظف في إجراء سابق'; end if;
      update public.administrative_actions set action_type_id=action_type_value,action_date=(p_data->>'action_date')::date,
        reason=btrim(p_data->>'reason'),description=nullif(btrim(p_data->>'description'),''),notes=nullif(btrim(p_data->>'notes'),''),
        related_status_record_id=related_value,state=p_data->>'state' where id=item_id returning * into a;
    end if;
    return to_jsonb(a);
  elsif p_action = 'administrative_action.delete' then
    perform hr_private.require_role(array['ADMIN']);
    if coalesce((p_data->>'confirmed')::boolean,false) is not true then raise exception 'تأكيد الحذف مطلوب'; end if;
    update public.administrative_actions set deleted_at=now() where id=item_id and version=rev and deleted_at is null returning * into a;
    if not found then raise exception using errcode='40001',message='تم تعديل السجل بواسطة مستخدم آخر. أعد تحميله'; end if;
    return jsonb_build_object('ok',true);
  elsif p_action = 'administrative_action_type.save' then
    perform hr_private.require_role(array['ADMIN']);
    active_value = coalesce((p_data->>'is_active')::boolean,true);
    if item_id is null then
      insert into public.administrative_action_types(arabic_name,display_order,is_active)
      values(btrim(p_data->>'arabic_name'),(p_data->>'display_order')::integer,active_value) returning to_jsonb(administrative_action_types.*) into result;
    else
      update public.administrative_action_types set arabic_name=btrim(p_data->>'arabic_name'),display_order=(p_data->>'display_order')::integer,is_active=active_value
      where id=item_id and version=rev returning to_jsonb(administrative_action_types.*) into result;
      if result is null then raise exception using errcode='40001',message='تم تعديل السجل بواسطة مستخدم آخر. أعد تحميله'; end if;
    end if;
    return result;
  end if;
  return public.hr_write(p_action,p_data);
exception when unique_violation then
  raise exception 'القيمة مستخدمة مسبقاً';
end $$;

revoke all on function public.hr_read_v2(text,jsonb), public.hr_write_v2(text,jsonb) from public,anon,authenticated;
grant execute on function public.hr_read_v2(text,jsonb), public.hr_write_v2(text,jsonb) to authenticated;
revoke all on all functions in schema hr_private from public,anon,authenticated;

update public.app_settings set value='قسم الموارد البشرية – مسائي' where key='app_name' and value='إدارة الموارد البشرية';

commit;
