-- Keep legacy import entry points compatible without granting implicit approval.
-- Separate migration: never rewrite an attendance-core migration already shared.
begin;

create function hr_private.sync_monthly_import_review() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.import_kind='monthly' then
  if tg_op='INSERT' then
   insert into public.attendance_import_reviews(import_id,period_month,lifecycle_state,created_by,updated_by)
   values(new.id,date_trunc('month',new.period_start)::date,
    case when new.state='cancelled' then 'cancelled' else 'preview' end,new.created_by,new.updated_by)
   on conflict(import_id) do nothing;
  elsif new.state='cancelled' and old.state is distinct from new.state then
   update public.attendance_import_reviews r set lifecycle_state='cancelled'
   where r.import_id=new.id and r.lifecycle_state in ('preview','reviewed');
  end if;
 end if;
 return new;
end $$;

-- Check at transaction end: V3 changes the import and review in one transaction.
-- V1/V2 apply cannot commit without the same explicit review/approval decision.
create function hr_private.require_monthly_import_approval() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.import_kind<>'monthly' or new.state<>'applied' then return null; end if;
 if tg_op='UPDATE' and old.state='applied' then return null; end if;
 if exists(
  select 1 from public.attendance_imports i
  left join public.attendance_import_reviews r on r.import_id=i.id
  where i.id=new.id and i.state='applied' and r.lifecycle_state is distinct from 'approved'
 ) then
  raise exception 'الملف الشهري يحتاج مراجعة ثم اعتماد؛ حدّث الصفحة واستخدم شاشة الاستيراد الشهري';
 end if;
 return null;
end $$;

create trigger sync_monthly_import_review after insert or update on public.attendance_imports
 for each row execute function hr_private.sync_monthly_import_review();
create constraint trigger require_monthly_import_approval
 after insert or update on public.attendance_imports deferrable initially deferred
 for each row execute function hr_private.require_monthly_import_approval();

-- Support databases where core was installed earlier, but never infer a missing
-- approval. An applied import without a review requires explicit reconciliation.
do $$begin
 if exists(select 1 from public.attendance_imports i
  where i.import_kind='monthly' and i.state='applied'
  and not exists(select 1 from public.attendance_import_reviews r where r.import_id=i.id)) then
  raise exception 'Unreviewed applied monthly imports require explicit reconciliation';
 end if;
end $$;
insert into public.attendance_import_reviews(import_id,period_month,lifecycle_state,created_by,updated_by)
select i.id,date_trunc('month',i.period_start)::date,
 case when i.state='cancelled' then 'cancelled' else 'preview' end,i.created_by,i.updated_by
from public.attendance_imports i
where i.import_kind='monthly' and i.state in ('preview','cancelled')
and not exists(select 1 from public.attendance_import_reviews r where r.import_id=i.id);

revoke all on function hr_private.sync_monthly_import_review(),hr_private.require_monthly_import_approval()
 from public,anon,authenticated;
commit;
