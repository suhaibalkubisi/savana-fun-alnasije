-- Human-confirmed private company identity batches; never approves attendance.
begin;
set local lock_timeout='5s';set local statement_timeout='60s';
create index attendance_source_import_person_code on public.fingerprint_source_rows(import_id,person_code);
create table hr_private.company_identity_batches (
 batch_id text primary key, version integer not null default 1,
 source_id uuid not null references public.attendance_device_sources(id), namespace text not null,
 proposal jsonb not null, proposal_sha256 text not null check(proposal_sha256 ~ '^[a-f0-9]{64}$'),
 file_sha256 text not null check(file_sha256 ~ '^[a-f0-9]{64}$'), preview_guards jsonb not null,
 mapping_guard jsonb not null, created_at timestamptz not null default now()
);
create table hr_private.company_identity_confirmations (
 id uuid primary key default gen_random_uuid(), batch_id text not null references hr_private.company_identity_batches(batch_id),
 batch_version integer not null, request_id uuid not null unique, request_hash text not null,
 decisions jsonb not null, evidence_reference text not null check(length(btrim(evidence_reference)) between 3 and 1800),
 confirmed_by uuid not null references public.profiles(id), confirmed_at timestamptz not null default now(),
 applied_by uuid references public.profiles(id), applied_at timestamptz, result jsonb
);
create index company_confirmation_batch on hr_private.company_identity_confirmations(batch_id,confirmed_at desc);
create table hr_private.company_onboarding_notes (
 import_id uuid primary key references public.attendance_imports(id), version integer not null default 1,
 answers jsonb not null, updated_by uuid not null references public.profiles(id), updated_at timestamptz not null default now()
);
alter table hr_private.company_identity_batches enable row level security;
alter table hr_private.company_identity_confirmations enable row level security;
alter table hr_private.company_onboarding_notes enable row level security;
revoke all on hr_private.company_identity_batches,hr_private.company_identity_confirmations,hr_private.company_onboarding_notes from public,anon,authenticated;
CREATE OR REPLACE FUNCTION hr_private.company_identity_guard(b hr_private.company_identity_batches, decisions jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
AS $function$
declare g jsonb; d jsonb; i public.attendance_imports; r public.attendance_import_reviews; ids uuid[]; current_mappings jsonb; proposed_codes text[];
begin
 select array_agg((x->>'id')::uuid order by x->>'id') into ids from jsonb_array_elements(b.preview_guards) x;
 if cardinality(ids)<>2 or ids[1]=ids[2] then raise exception 'نطاق الدفعة غير صالح';end if;
 perform 1 from public.attendance_imports where id=any(ids) order by id for update;
 perform 1 from public.attendance_import_reviews where import_id=any(ids) order by import_id for update;
 perform 1 from public.fingerprint_source_rows where id in (select (s->>'id')::uuid from jsonb_array_elements(decisions) x cross join lateral jsonb_array_elements(x->'expected_source_rows') s) order by id for update;
 perform 1 from public.fingerprint_issues where id in (select (s->>'id')::uuid from jsonb_array_elements(decisions) x cross join lateral jsonb_array_elements(x->'expected_identity_issues') s) order by id for update;
 lock table public.fingerprint_identities in share row exclusive mode;
 perform 1 from public.employees where id in (select (x->>'employee_uuid')::uuid from jsonb_array_elements(decisions) x) order by id for share;
 perform 1 from public.attendance_device_sources where id=b.source_id for share;
 if not exists(select 1 from public.attendance_device_sources s where s.id=b.source_id and s.namespace=b.namespace and s.is_active and s.version=(b.proposal->'source_scope'->>'expected_source_revision')::integer) then raise exception 'تغير تعريف المصدر؛ حدّث المراجعة';end if;
 select coalesce(jsonb_agg(to_jsonb(f) order by f.id),'[]') into current_mappings from public.fingerprint_identities f;
 if current_mappings is distinct from b.mapping_guard then raise exception 'ظهرت قرارات ربط أحدث؛ أوقف الدفعة للمراجعة دون الكتابة فوقها';end if;
 for g in select value from jsonb_array_elements(b.preview_guards) loop
  select * into i from public.attendance_imports where id=(g->>'id')::uuid;
  if i.id is null or i.version<>(g->>'expected_revision')::integer or i.state<>'preview' or i.device_namespace<>b.namespace or i.device_namespace<>(g->>'expected_namespace') or i.source_hash<>(g->>'source_hash') or i.import_kind<>(g->>'kind') then raise exception 'تغيرت المعاينة أو نطاقها؛ حدّث المراجعة';end if;
  if i.import_kind='monthly' then
   select * into r from public.attendance_import_reviews where import_id=i.id;
   if r.id is distinct from (g->>'review_id')::uuid or r.version is distinct from (g->>'expected_review_revision')::integer or r.lifecycle_state is distinct from 'preview' then raise exception 'تغيرت مراجعة الشهر؛ أوقف الدفعة';end if;
  end if;
 end loop;
 if jsonb_array_length(decisions) not between 1 and 500 or
  (select count(distinct x->>'person_code') from jsonb_array_elements(decisions) x)<>jsonb_array_length(decisions) or
  (select count(distinct x->>'employee_uuid') from jsonb_array_elements(decisions) x)<>jsonb_array_length(decisions) then raise exception 'رمز أو موظف مكرر في الدفعة';end if;
 select array_agg(x->>'person_code') into proposed_codes from jsonb_array_elements(b.proposal->'selected_decisions') x;
 for d in select value from jsonb_array_elements(decisions) loop
  if not exists(select 1 from public.employees e where e.id=(d->>'employee_uuid')::uuid and e.version=(d->>'expected_employee_revision')::integer and e.employment_status='active') then raise exception 'تغير الموظف أو أصبح غير نشط؛ راجع الاختيار';end if;
  if exists(select 1 from public.fingerprint_identities f where f.device_namespace=b.namespace and (f.person_code=d->>'person_code' or (f.employee_id=(d->>'employee_uuid')::uuid and f.is_active))) then raise exception 'تعارض رمز أو موظف مرتبط مسبقاً في نطاق الشركة';end if;
  if not ((d->>'person_code')=any(proposed_codes)) then raise exception 'الاختيار خارج المقترح المحفوظ';end if;
  if jsonb_array_length(d->'expected_source_rows')=0 or exists(select 1 from jsonb_array_elements(d->'expected_source_rows') x where not ((x->>'import_id')::uuid=any(ids)) or x->>'expected_person_code' is distinct from d->>'person_code') then raise exception 'صف خارج نطاق المعاينتين';end if;
  if (select count(*) from public.fingerprint_source_rows s where s.import_id=any(ids) and s.person_code=d->>'person_code')<>jsonb_array_length(d->'expected_source_rows') or exists(
   select 1 from jsonb_array_elements(d->'expected_source_rows') x left join public.fingerprint_source_rows s on s.id=(x->>'id')::uuid
   where s.id is null or s.import_id is distinct from (x->>'import_id')::uuid or s.version is distinct from (x->>'expected_revision')::integer or s.employee_id is distinct from nullif(x->>'expected_employee_uuid','')::uuid or s.match_state is distinct from x->>'expected_match_state' or s.person_code is distinct from x->>'expected_person_code' or s.source_name is distinct from x->>'expected_name'
  ) then raise exception 'تغير دليل هوية ضمن المعاينة؛ أوقف الدفعة';end if;
  if exists(select 1 from jsonb_array_elements(d->'expected_identity_issues') x left join public.fingerprint_issues f on f.id=(x->>'id')::uuid left join public.fingerprint_source_rows s on s.id=f.source_row_id
   where f.id is null or f.version is distinct from (x->>'expected_revision')::integer or f.source_row_id is distinct from (x->>'source_row_id')::uuid or s.import_id is distinct from (x->>'import_id')::uuid or f.state is distinct from x->>'expected_state' or f.issue_type is distinct from x->>'issue_type') or
   (select count(*) from public.fingerprint_issues f join public.fingerprint_source_rows s on s.id=f.source_row_id where s.import_id=any(ids) and s.person_code=d->>'person_code' and f.state='open' and f.issue_type in ('unmatched','ambiguous','code_conflict'))<>jsonb_array_length(d->'expected_identity_issues') then raise exception 'تغيرت مشاكل الهوية؛ أوقف الدفعة';end if;
 end loop;
end $function$;
CREATE OR REPLACE FUNCTION public.attendance_company_apply(p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
AS $function$
declare actor public.profiles; b hr_private.company_identity_batches; c hr_private.company_identity_confirmations; d jsonb; g jsonb; guards jsonb='[]'; applied_result jsonb; sid uuid; n integer; changed integer=0; note text; before_counts jsonb;
begin
 perform set_config('lock_timeout','5s',true);perform set_config('statement_timeout','60s',true);
 actor=hr_private.require_role(array['ADMIN','HR']);
 if p_data->>'apply_confirmed' is distinct from 'true' then raise exception 'اطلب تطبيق الموافقة المحفوظة صراحة';end if;
 select x.* into b from hr_private.company_identity_batches x join hr_private.company_identity_confirmations y on y.batch_id=x.batch_id where y.id=(p_data->>'confirmation_id')::uuid for update of x;
 select * into c from hr_private.company_identity_confirmations where id=(p_data->>'confirmation_id')::uuid for update;
 if c.id is null or c.confirmed_by<>actor.id then raise exception 'افتح موافقتك المحفوظة قبل التطبيق';end if;
 if c.result is not null then return c.result;end if;
 if b.version<>c.batch_version then raise exception 'تغيرت الدفعة بعد الموافقة؛ حدّث المراجعة وأكّد الاختيارات مجدداً';end if;
 perform hr_private.company_identity_guard(b,c.decisions);
 select jsonb_agg(jsonb_build_object('id',i.id,'linked_rows',(select count(*) from public.fingerprint_source_rows s where s.import_id=i.id and s.employee_id is not null),'linked_people',(select count(distinct s.employee_id) from public.fingerprint_source_rows s where s.import_id=i.id)) order by i.id) into before_counts from public.attendance_imports i where exists(select 1 from jsonb_array_elements(b.preview_guards) x where x->>'id'=i.id::text);
 for d in select value from jsonb_array_elements(c.decisions) order by value->>'person_code' loop
  sid=(d->'expected_source_rows'->0->>'id')::uuid;
  note=left('موافقة هوية داخل الموقع · '||c.id||' · '||c.evidence_reference||coalesce(' · تصحيح: '||(d->'user_correction'->>'evidence_reference'),''),2000);
  perform hr_private.confirm_fingerprint_mapping(sid,(d->>'employee_uuid')::uuid,note);
  update public.fingerprint_identities f set confirmed_names=array(select distinct hr_private.fingerprint_name(s.source_name) from public.fingerprint_source_rows s where s.id in (select (x->>'id')::uuid from jsonb_array_elements(d->'expected_source_rows') x)) where f.device_namespace=b.namespace and f.person_code=d->>'person_code';
  update public.fingerprint_source_rows s set employee_id=(d->>'employee_uuid')::uuid,match_state='confirmed' where s.id in (select (x->>'id')::uuid from jsonb_array_elements(d->'expected_source_rows') x);
  get diagnostics n=row_count;changed=changed+n;
  if n<>jsonb_array_length(d->'expected_source_rows') then raise exception 'لم تتطابق صفوف التنفيذ؛ ألغيت المعاملة كلها';end if;
  update public.fingerprint_issues f set state='resolved',resolution_note=note where f.id in (select (x->>'id')::uuid from jsonb_array_elements(d->'expected_identity_issues') x);
 end loop;
 for g in select value from jsonb_array_elements(b.preview_guards) loop
  -- Only selected identity rows were reprocessed. Unselected evidence/issues stay untouched.
  perform hr_private.refresh_import_summary((g->>'id')::uuid);
  guards=guards||jsonb_build_array(g||jsonb_build_object('expected_revision',(select version from public.attendance_imports where id=(g->>'id')::uuid)));
 end loop;
 select jsonb_build_object('confirmation_id',c.id,'batch_id',b.batch_id,'selected_count',jsonb_array_length(c.decisions),'linked_rows_changed',changed,'attendance_approved',false,'before',before_counts,'previews',jsonb_agg(jsonb_build_object('id',i.id,'version',i.version,'state',i.state,'coverage_confirmed',i.coverage_confirmed,'summary',i.summary,'review_state',r.lifecycle_state,'review_version',r.version) order by i.id)) into applied_result from public.attendance_imports i left join public.attendance_import_reviews r on r.import_id=i.id where exists(select 1 from jsonb_array_elements(b.preview_guards) x where x->>'id'=i.id::text);
 update hr_private.company_identity_confirmations set applied_by=actor.id,applied_at=now(),result=applied_result where id=c.id;
 update hr_private.company_identity_batches set version=version+1,preview_guards=guards,mapping_guard=(select coalesce(jsonb_agg(to_jsonb(f) order by f.id),'[]') from public.fingerprint_identities f) where batch_id=b.batch_id;
 insert into public.audit_logs(actor_id,actor_name,action,entity_type,entity_id,description,new_values) values(actor.id,actor.name,'identity_batch.apply','company_identity_batch',c.id,'تطبيق الروابط المؤكدة وإعادة معالجة صفوفها ضمن المعاينتين فقط',applied_result);
 return applied_result;
end $function$;
CREATE OR REPLACE FUNCTION public.attendance_company_confirm(p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
AS $function$
declare actor public.profiles; b hr_private.company_identity_batches; c hr_private.company_identity_confirmations; x jsonb; d jsonb; decisions jsonb='[]'; e public.employees; h text; corrected boolean; candidate_index jsonb; evidence text=btrim(p_data->>'evidence_reference');
begin
 perform set_config('lock_timeout','5s',true);perform set_config('statement_timeout','60s',true);
 actor=hr_private.require_role(array['ADMIN','HR']);
 if p_data->>'review_confirmed' is distinct from 'true' or length(coalesce(evidence,'')) not between 3 and 1800 or jsonb_typeof(p_data->'selections') is distinct from 'array' or jsonb_array_length(p_data->'selections') not between 1 and 500 then raise exception 'اختيارات وموافقة صريحة ومرجع دليل حقيقي مطلوبة';end if;
 h=encode(sha256(convert_to(p_data::text,'UTF8')),'hex');
 select * into b from hr_private.company_identity_batches where batch_id=p_data->>'batch_id' for update;
 if b.batch_id is null then raise exception 'الدفعة غير موجودة';end if;
 select * into c from hr_private.company_identity_confirmations where request_id=(p_data->>'request_id')::uuid;
 if c.id is not null then
  if c.request_hash<>h or c.confirmed_by<>actor.id then raise exception 'معرف الطلب مستخدم لقرار مختلف';end if;
  return jsonb_build_object('id',c.id,'selected_count',jsonb_array_length(c.decisions),'batch_version',c.batch_version,'result',c.result);
 end if;
 if b.version is distinct from (p_data->>'batch_version')::integer then raise exception 'تغير إصدار الدفعة؛ حدّث المراجعة';end if;
 select jsonb_object_agg(value->>'person_code',value) into candidate_index from jsonb_array_elements(b.proposal->'selected_decisions');
 for x in select value from jsonb_array_elements(p_data->'selections') loop
  d=candidate_index->(x->>'person_code');
  if d is null then raise exception 'هوية غير مقترحة؛ تبقى ضمن الاستثناءات';end if;
  select * into e from public.employees where id=(x->>'employee_uuid')::uuid;
  if e.id is null or e.version is distinct from (x->>'employee_version')::integer or e.employment_status<>'active' then raise exception 'تغير الموظف المختار';end if;
  corrected=e.id<>(d->>'employee_uuid')::uuid;
  if not corrected and e.version<>(d->>'expected_employee_revision')::integer then raise exception 'تغير الموظف منذ إعداد المقترح';end if;
  if corrected and (length(btrim(coalesce(x->>'reason','')))<3 or length(btrim(coalesce(x->>'evidence_reference','')))<3 or length(x->>'reason')>1800 or length(x->>'evidence_reference')>1800) then raise exception 'التصحيح يحتاج سبباً ومرجع دليل جديد';end if;
  d=d||jsonb_build_object('employee_uuid',e.id,'employee_name',e.name,'expected_employee_revision',e.version,'decision',case when corrected then 'USER_CORRECTED_EXISTING_EMPLOYEE' else 'USER_APPROVED_PROPOSED_EXISTING_EMPLOYEE' end,'user_correction',case when corrected then jsonb_build_object('original_proposed_employee_uuid',d->>'employee_uuid','reason',btrim(x->>'reason'),'evidence_reference',btrim(x->>'evidence_reference'),'original_algorithm_evidence_not_claimed_for_corrected_target',true) else null end);
  decisions=decisions||jsonb_build_array(d);
 end loop;
 perform hr_private.company_identity_guard(b,decisions);
 insert into hr_private.company_identity_confirmations(batch_id,batch_version,request_id,request_hash,decisions,evidence_reference,confirmed_by) values(b.batch_id,b.version,(p_data->>'request_id')::uuid,h,decisions,evidence,actor.id) returning * into c;
 insert into public.audit_logs(actor_id,actor_name,action,entity_type,entity_id,description,new_values) values(actor.id,actor.name,'identity_batch.confirm','company_identity_batch',c.id,'موافقة صريحة على اختيارات الهوية فقط',jsonb_build_object('batch_id',b.batch_id,'batch_version',b.version,'selected_count',jsonb_array_length(decisions),'proposal_sha256',b.proposal_sha256,'attendance_approved',false));
 return jsonb_build_object('id',c.id,'selected_count',jsonb_array_length(decisions),'batch_version',b.version,'result',null);
end $function$;
CREATE OR REPLACE FUNCTION public.attendance_company_notes(p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
AS $function$
declare actor public.profiles; i public.attendance_imports; n hr_private.company_onboarding_notes; a jsonb=p_data->'answers';
begin
 perform set_config('lock_timeout','5s',true);perform set_config('statement_timeout','60s',true);
 actor=hr_private.require_role(array['ADMIN','HR']);
 if jsonb_typeof(a) is distinct from 'object' or (select count(*) from jsonb_each(a)) not between 1 and 100 or exists(select 1 from jsonb_each(a) x where jsonb_typeof(x.value)<>'string' or length(x.key)>200 or length(x.value#>>'{}')>2000) then raise exception 'مراجع الأدلة غير صالحة';end if;
 select * into i from public.attendance_imports where id=(p_data->>'import_id')::uuid for update;
 perform 1 from public.attendance_import_reviews where import_id=i.id for update;
 if i.id is null or i.version is distinct from (p_data->>'preview_version')::integer or i.state<>'preview' or (i.import_kind='monthly' and not exists(select 1 from public.attendance_import_reviews where import_id=i.id and lifecycle_state='preview')) or not exists(select 1 from hr_private.company_identity_batches b cross join lateral jsonb_array_elements(b.preview_guards) g where g->>'id'=i.id::text) then raise exception 'تغيرت المعاينة أو تجاوز الطلب نطاق التهيئة';end if;
 select * into n from hr_private.company_onboarding_notes where import_id=i.id for update;
 if coalesce(n.version,0) is distinct from (p_data->>'notes_version')::integer then raise exception 'حُفظ دليل أحدث؛ حدّث النموذج قبل التصحيح';end if;
 insert into hr_private.company_onboarding_notes(import_id,answers,updated_by) values(i.id,a,actor.id) on conflict(import_id) do update set answers=excluded.answers,updated_by=excluded.updated_by,updated_at=now(),version=hr_private.company_onboarding_notes.version+1 returning * into n;
 insert into public.audit_logs(actor_id,actor_name,action,entity_type,entity_id,description,new_values) values(actor.id,actor.name,'onboarding.evidence.save','company_onboarding',i.id,'حفظ مراجع أدلة التهيئة؛ بلا اعتماد هوية أو حضور',jsonb_build_object('notes_version',n.version,'fields',(select jsonb_agg(key) from jsonb_each(a)),'attendance_approved',false));
 return to_jsonb(n);
end $function$;
CREATE OR REPLACE FUNCTION public.attendance_company_review(p_filters jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
AS $function$
declare b hr_private.company_identity_batches; receipt jsonb; remaining jsonb;
begin
 perform hr_private.require_role(array['ADMIN','HR']);
 select x.* into b from hr_private.company_identity_batches x where exists(select 1 from jsonb_array_elements(x.preview_guards) g where g->>'id'=p_filters->>'import_id');
 if b.batch_id is null then return jsonb_build_object('proposal',null);end if;
 select coalesce(jsonb_agg(jsonb_build_object('person_code',x->>'person_code','company_name',x->>'company_name','company_organizations',x->'company_organizations','employee_uuid',x->>'employee_uuid','employee_name',x->>'employee_name','employee_department',x->>'employee_department','expected_employee_revision',x->'expected_employee_revision','expected_employee_status',x->>'expected_employee_status','evidence_brief',x->>'evidence_brief','supporting_evidence',jsonb_build_object('original_roster',x->'supporting_evidence'->'original_roster','distinct_export_contents',x->'supporting_evidence'->'distinct_export_contents'),'import_ids',(select jsonb_agg(distinct r->>'import_id') from jsonb_array_elements(x->'expected_source_rows') r)) order by x->>'person_code'),'[]') into remaining
 from jsonb_array_elements(b.proposal->'selected_decisions') x where not exists(select 1 from hr_private.company_identity_confirmations c cross join lateral jsonb_array_elements(c.decisions) d where c.batch_id=b.batch_id and c.applied_at is not null and d->>'person_code'=x->>'person_code');
 select jsonb_build_object('id',c.id,'selected_count',jsonb_array_length(c.decisions),'confirmed_at',c.confirmed_at,'batch_version',c.batch_version,'result',c.result,'decisions',(select jsonb_agg(jsonb_build_object('person_code',d->>'person_code','company_name',d->>'company_name','employee_uuid',d->>'employee_uuid','employee_name',d->>'employee_name','decision',d->>'decision')) from jsonb_array_elements(c.decisions) d)) into receipt
 from hr_private.company_identity_confirmations c where c.batch_id=b.batch_id and c.confirmed_by=auth.uid() and (c.batch_version=b.version or c.applied_at is not null) order by c.confirmed_at desc limit 1;
 return jsonb_build_object('proposal',jsonb_build_object('batch_id',b.batch_id,'version',b.version,'proposal_sha256',b.proposal_sha256,'source_scope',b.proposal->'source_scope','evidence_reference',b.proposal->>'evidence_reference','selected_count',jsonb_array_length(remaining),'selected_decisions',remaining,'preview_guards',b.preview_guards,'exceptions_not_in_batch',b.proposal->'exceptions_not_in_batch'),'confirmation',receipt,'notes',(select to_jsonb(n) from hr_private.company_onboarding_notes n where n.import_id=(p_filters->>'import_id')::uuid));
end $function$;revoke all on function hr_private.company_identity_guard(hr_private.company_identity_batches,jsonb) from public,anon,authenticated;
revoke all on function public.attendance_company_review(jsonb),public.attendance_company_confirm(jsonb),public.attendance_company_apply(jsonb),public.attendance_company_notes(jsonb) from public,anon;
grant execute on function public.attendance_company_review(jsonb),public.attendance_company_confirm(jsonb),public.attendance_company_apply(jsonb),public.attendance_company_notes(jsonb) to authenticated;
notify pgrst,'reload schema';commit;
