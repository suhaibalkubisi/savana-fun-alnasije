-- POST-DEPLOY ONLY: first verify the deployed API uses attendance_read_v5
-- and the canonical daily/monthly evidence engines. No business rows change.
-- Recovery: keep the current app and fix forward. Restoring older app code
-- also needs the exact previous grants from the private backup checkpoint.
begin;
revoke all on function public.attendance_read(text,jsonb),
 public.attendance_read_v2(text,jsonb),public.attendance_read_v3(text,jsonb),
 public.attendance_read_v4(text,jsonb) from public,anon,authenticated;
-- Owners retain internal execution; v5 only delegates non-calculation kinds.
commit;
