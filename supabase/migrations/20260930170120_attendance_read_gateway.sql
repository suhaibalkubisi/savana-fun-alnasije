-- Pre-deployment: add the restricted metadata gateway; the existing release
-- remains compatible until the later permissions-only cutover migration.
begin;
create function public.attendance_read_v5(p_kind text,p_filters jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform hr_private.require_role(array['ADMIN','HR','VIEWER']);
 if p_kind is null or p_kind not in ('rules','imports','import','issues','matching_employees','employee_duplicates','work_queue') then
  raise exception 'مسار الحساب القديم متوقف؛ استخدم الموقف اليومي أو الشهري المحدث' using errcode='22023';
 end if;
 return public.attendance_read_v4(p_kind,coalesce(p_filters,'{}'));
end $$;
revoke all on function public.attendance_read_v5(text,jsonb) from public,anon,authenticated;
grant execute on function public.attendance_read_v5(text,jsonb) to authenticated;
commit;
