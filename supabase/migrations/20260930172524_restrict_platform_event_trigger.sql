-- Platform event triggers are invoked by PostgreSQL, never by application users.
-- Keep the owner/event trigger intact and remove unnecessary Data API execution.
begin;
do $$ begin
 if to_regprocedure('public.rls_auto_enable()') is not null then
  revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
 end if;
end $$;
commit;
