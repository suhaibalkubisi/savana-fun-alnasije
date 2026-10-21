-- REVIEW ONLY: included in the local proposal, never applied to an existing project.
-- No business mutation is performed by staging, reading or closing a recovery.
create table public.fu_decision_recoveries(
 user_id uuid not null references public.profiles(id),request_id uuid not null,
 employee_id uuid not null references public.employees(id),kind text not null check(kind in ('service_state','employee_identity')),
 data jsonb,state text not null check(state in ('staged','closed')),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 primary key(user_id,request_id));
alter table public.fu_decision_recoveries enable row level security;
revoke all on public.fu_decision_recoveries from public,anon,authenticated;

create function followup_private.decision_recovery(rid uuid,eid uuid,decision_kind text,data jsonb,operation text) returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare u uuid:=auth.uid();r text:=followup_private.account_role();stored public.fu_decision_recoveries;committed public.fu_requests;answer jsonb;
begin
 if rid is null or eid is null or decision_kind not in ('service_state','employee_identity') or decision_kind is null then raise exception 'معرفات الاستكمال غير صالحة' using errcode='22023';end if;
 if r='VIEWER' or not followup_private.employee_scope(eid) or not followup_private.capability(case decision_kind when 'service_state' then 'service_manage' else 'identity_edit' end) then raise exception 'صلاحية استكمال القرار غير متاحة' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text||rid::text,0));
 select * into stored from public.fu_decision_recoveries x where x.user_id=u and x.request_id=rid for update;
 select * into committed from public.fu_requests q where q.user_id=u and q.request_id=rid;
 if stored.request_id is not null and (stored.employee_id is distinct from eid or stored.kind is distinct from decision_kind) then raise exception 'تغيرت هوية طلب الاستكمال' using errcode='PT409';end if;
 if committed.request_id is not null and (committed.payload->>'kind' is distinct from decision_kind or committed.payload->'data'->>'employee_id' is distinct from eid::text) then raise exception 'تغيرت هوية الطلب المحفوظ' using errcode='PT409';end if;
 answer:=jsonb_build_object('request_id',rid,'actor',u,'kind',decision_kind,'employee_id',eid);
 if operation='stage' then
  if stored.state='closed' then raise exception 'أغلق الطلب قبل الحفظ؛ ابدأ قراراً جديداً' using errcode='PT409';end if;
  if jsonb_typeof(data) is distinct from 'object' or length(data::text)>16000 or data->>'employee_id' is distinct from eid::text or jsonb_typeof(data->'version') is distinct from 'number' or coalesce(data->>'version','') !~ '^[1-9][0-9]*$' or length(btrim(coalesce(data->>'reason',''))) not between 5 and 2000 then raise exception 'بيانات الاستكمال غير صالحة' using errcode='22023';end if;
  if stored.request_id is not null and stored.data is distinct from data then raise exception 'تغير محتوى طلب الاستكمال' using errcode='PT409';end if;
  if committed.request_id is not null and committed.payload->'data' is distinct from data then raise exception 'تغير محتوى الطلب المحفوظ' using errcode='PT409';end if;
  if stored.request_id is null then insert into public.fu_decision_recoveries(user_id,request_id,employee_id,kind,data,state) values(u,rid,eid,decision_kind,data,'staged');end if;
 elsif operation='close' then
  -- The same lock is held by business writes. A delayed, not-yet-committed
  -- request cannot begin after this tombstone; an existing receipt wins.
  if committed.request_id is null then
   insert into public.fu_decision_recoveries(user_id,request_id,employee_id,kind,data,state) values(u,rid,eid,decision_kind,null,'closed')
    on conflict(user_id,request_id) do update set state='closed',updated_at=clock_timestamp();
   return answer||jsonb_build_object('state','closed');
  end if;
 elsif operation<>'read' then raise exception 'عملية استكمال غير صالحة' using errcode='22023';end if;
 if committed.request_id is not null then return answer||jsonb_build_object('state','committed','data',committed.payload->'data');end if;
 if stored.state='closed' then return answer||jsonb_build_object('state','closed');end if;
 if operation='stage' then return answer||jsonb_build_object('state','staged','data',data);end if;
 if stored.request_id is not null then return answer||jsonb_build_object('state','staged','data',stored.data);end if;
 return answer||jsonb_build_object('state','not_found');
end$$;

create function followup_private.decision_recovery_guard(rid uuid,eid uuid,decision_kind text,data jsonb) returns void language plpgsql set search_path=pg_catalog,public as $$
declare stored public.fu_decision_recoveries;
begin
 -- Called only after the business-write actor/request lock and live permission guard.
 select * into stored from public.fu_decision_recoveries x where x.user_id=auth.uid() and x.request_id=rid;
 if stored.request_id is null then return;end if;
 if stored.employee_id is distinct from eid or stored.kind is distinct from decision_kind or stored.data is distinct from data or stored.state='closed' then raise exception 'أغلق طلب الاستكمال أو تغير محتواه؛ تحقق من الطلب الأصلي' using errcode='PT409';end if;
end$$;
revoke all on function followup_private.decision_recovery(uuid,uuid,text,jsonb,text),followup_private.decision_recovery_guard(uuid,uuid,text,jsonb) from public,anon,authenticated;
