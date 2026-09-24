-- Independent, permanent internal identifier. UUID and device identifiers stay unchanged.
begin;
create sequence hr_private.employee_internal_code_seq as bigint minvalue 1 no cycle;
create function hr_private.next_employee_internal_code() returns text
language sql volatile set search_path='' as $$
 select 'FANU-'||lpad(n,greatest(6,length(n)),'0')
 from (select nextval('hr_private.employee_internal_code_seq'::regclass)::text n) x
$$;
-- A volatile ADD COLUMN default assigns once per existing row without firing
-- employee UPDATE/touch triggers: employment history, revisions and timestamps stay intact.
alter table public.employees add column internal_code text not null
 default hr_private.next_employee_internal_code();
alter table public.employees add constraint employee_internal_code_format check(internal_code ~ '^FANU-[0-9]{6,}$');
alter table public.employees add constraint employee_internal_code_unique unique(internal_code);
alter table public.employees alter column internal_code drop default;

create function hr_private.protect_employee_internal_code() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' then
  if new.internal_code is not null then raise exception 'الكود الوظيفي يولد آلياً ولا يمكن إدخاله يدوياً';end if;
  new.internal_code=hr_private.next_employee_internal_code();
 elsif new.internal_code is distinct from old.internal_code then
  raise exception 'الكود الوظيفي دائم ولا يمكن تغييره';
 end if;
 return new;
end $$;
create trigger protect_employee_internal_code before insert or update on public.employees
 for each row execute function hr_private.protect_employee_internal_code();

-- Append to the existing view signature; never shift columns referenced by older views.
create or replace view hr_private.employee_view as
 select e.id,e.employee_number,e.name,e.department_id,e.shift_id,e.direct_manager_id,
 e.employment_status,e.version,e.created_at,e.updated_at,e.created_by,e.updated_by,
 d.arabic_name||' ('||d.english_name||')' department,d.display_order,
 s.name shift,coalesce(me.name,m.name) manager,e.internal_code
 from public.employees e join public.departments d on d.id=e.department_id
 left join public.shifts s on s.id=e.shift_id left join public.managers m on m.id=e.direct_manager_id
 left join public.employees me on me.id=m.employee_id;

create function public.hr_read_v4(p_kind text,p_filters jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; filters jsonb=coalesce(p_filters,'{}'); term text=btrim(coalesce(p_filters->>'search',''));
 code_id uuid; page_no integer=greatest(0,least(coalesce((p_filters->>'page')::integer,1)-1,100000));
begin
 perform hr_private.require_role(array['ADMIN','HR','VIEWER']);
 if p_kind='employees' then
  with filtered as (
   select e.* from hr_private.employee_view e
   where (nullif(filters->>'department_id','') is null or e.department_id=(filters->>'department_id')::uuid)
    and(nullif(filters->>'shift_id','') is null or e.shift_id=(filters->>'shift_id')::uuid)
    and(nullif(filters->>'manager_id','') is null or e.direct_manager_id=(filters->>'manager_id')::uuid)
    and(coalesce(filters->>'employment_status','')='' or e.employment_status=filters->>'employment_status')
    and(term='' or e.name ilike '%'||term||'%' or e.employee_number ilike '%'||term||'%' or e.internal_code ilike '%'||term||'%')
  ), paged as(select * from filtered order by display_order,name,id offset page_no*25 limit 25)
  select jsonb_build_object('rows',(select coalesce(jsonb_agg(p),'[]') from paged p),'total',(select count(*) from filtered)) into result;
  return result;
 end if;
 if p_kind='report' and upper(term) like 'FANU-%' then
  select e.id into code_id from public.employees e where e.internal_code=upper(term);
  if code_id is not null then filters=(filters-'search')||jsonb_build_object('employee_id',code_id);end if;
 end if;
 result=public.hr_read_v3(p_kind,filters);
 if p_kind='report' then
  result=jsonb_set(result,'{rows}',coalesce((select jsonb_agg(r.value||jsonb_build_object('internal_code',e.internal_code) order by r.ordinality)
   from jsonb_array_elements(result->'rows') with ordinality r
   join public.employees e on e.id=(r.value->>'id')::uuid),'[]'));
 end if;
 return result;
end $$;
revoke all on sequence hr_private.employee_internal_code_seq from public,anon,authenticated;
revoke all on function hr_private.next_employee_internal_code(),hr_private.protect_employee_internal_code() from public,anon,authenticated;
revoke all on function public.hr_read_v4(text,jsonb) from public,anon,authenticated;
grant execute on function public.hr_read_v4(text,jsonb) to authenticated;
comment on column public.employees.internal_code is 'Permanent generated internal code, independent of UUID, employee_number and fingerprint Person Code. Issued sequence values are never reused.';
commit;
