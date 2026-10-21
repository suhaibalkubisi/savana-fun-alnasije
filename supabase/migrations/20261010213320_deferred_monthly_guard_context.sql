-- PostgREST commits after its SECURITY DEFINER gateway has returned. The deferred
-- integrity check therefore needs its own bounded read context. It is a private
-- trigger-only predicate, not a data API or a grant of direct table access.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

do $$
begin
 if not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='hr_private' and p.proname='require_monthly_import_approval'
   and not p.prosecdef
   and md5(regexp_replace(replace(p.prosrc,E'\r',''), '^\s+|\s+$','','g'))='dc43381067b1a01396a7786489031d73'
 ) then raise exception 'Monthly integrity guard changed; review drift before this migration';end if;
 if not exists (
  select 1 from pg_trigger t
  where t.tgrelid='public.attendance_imports'::regclass
   and t.tgname='require_monthly_import_approval' and t.tgdeferrable and t.tginitdeferred
   and t.tgfoid='hr_private.require_monthly_import_approval()'::regprocedure
 ) then raise exception 'Expected deferred monthly integrity trigger is missing or changed';end if;
end $$;

create or replace function hr_private.require_monthly_import_approval() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.import_kind<>'monthly' or new.state<>'applied' then return null;end if;
 if tg_op='UPDATE' and old.state='applied' then return null;end if;
 -- API operations must retain a genuine live ADMIN/HR session at the deferred
 -- check. Privileged native restore/maintenance has no PostgREST claims GUC.
 if nullif(current_setting('request.jwt.claims',true),'') is not null then
  perform hr_private.require_role(array['ADMIN','HR']);
 end if;
 if exists (
  select 1 from public.attendance_imports i
  left join public.attendance_import_reviews r on r.import_id=i.id
  where i.id=new.id and i.state='applied' and r.lifecycle_state is distinct from 'approved'
 ) then
  raise exception 'الملف الشهري يحتاج مراجعة ثم اعتماد؛ حدّث الصفحة واستخدم شاشة الاستيراد الشهري';
 end if;
 return null;
end $$;
-- CREATE OR REPLACE preserves the existing owner. No table, RLS, gateway,
-- business record or trigger timing is changed, and no direct execution is added.
revoke all on function hr_private.require_monthly_import_approval() from public,anon,authenticated;
comment on function hr_private.require_monthly_import_approval() is
 'Private deferred integrity predicate: read protected monthly approval state after RPC return; API callers still require a live ADMIN/HR session.';
commit;
