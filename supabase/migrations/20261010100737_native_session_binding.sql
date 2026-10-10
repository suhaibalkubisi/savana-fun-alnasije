-- Native integration finding: a cryptographically valid access token can outlive logout.
-- Bind every legacy/current HR RPC to its live Auth session; local SQL fixtures without
-- JWT claim settings remain usable, but every PostgREST authenticated request must
-- carry a real session_id. No role decision uses user-editable metadata.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create function hr_private.session_is_live() returns boolean language plpgsql stable security definer set search_path='' as $$
declare actor_id uuid=auth.uid(); claims jsonb; sid uuid;
begin
 if actor_id is null or not exists(select 1 from public.profiles where id=actor_id and is_active) then return false;end if;
 claims=nullif(current_setting('request.jwt.claims',true),'')::jsonb;
 -- A privileged direct SQL test/migration context has no JWT claims. Browser/Data API
 -- requests always get the claims GUC from PostgREST and cannot take this branch.
 if claims is null then return true;end if;
 if claims->>'role' is distinct from 'authenticated' or nullif(claims->>'session_id','') is null then return false;end if;
 begin sid=(claims->>'session_id')::uuid;exception when invalid_text_representation then return false;end;
 return exists(select 1 from auth.sessions s where s.id=sid and s.user_id=actor_id and (s.not_after is null or s.not_after>now()));
end $$;
revoke all on function hr_private.session_is_live() from public,anon,authenticated;
-- Required only for the stored own-profile RLS expression; hr_private remains unexposed.
grant execute on function hr_private.session_is_live() to authenticated;
create or replace function hr_private.require_role(roles text[]) returns public.profiles language plpgsql security definer set search_path='' as $$
declare p public.profiles;
begin
 if not hr_private.session_is_live() then raise exception using errcode='42501',message='الحساب غير مفعل أو الجلسة منتهية';end if;
 select * into p from public.profiles where id=auth.uid() and is_active;
 if p.id is null then raise exception using errcode='42501',message='الحساب غير مفعل أو الجلسة منتهية';end if;
 if not(p.role=any(roles)) then raise exception using errcode='42501',message='ليست لديك صلاحية لهذه العملية';end if;
 return p;
end $$;
alter policy own_profile_read on public.profiles using(id=(select auth.uid()) and (select hr_private.session_is_live()));
commit;
