-- READ-ONLY production drift preflight. This file does not apply a migration.
-- Run only against the explicitly selected project; do not output personal rows.
select version from supabase_migrations.schema_migrations order by version;
select conname,pg_get_constraintdef(oid) as definition from pg_constraint
 where conrelid='public.attendance_imports'::regclass and contype in ('u','f');
select indexname,indexdef from pg_indexes where schemaname='public' and tablename='attendance_imports';
select tablename,rowsecurity from pg_tables where schemaname='public' order by tablename;
select n.nspname,p.proname,p.prosecdef,p.proconfig,
 has_function_privilege('anon',p.oid,'execute') as anon_execute,
 has_function_privilege('authenticated',p.oid,'execute') as authenticated_execute
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','hr_private') and (p.proname like 'attendance%' or p.proname like 'hr_%' or p.proname like 'employee_assignment%') order by 1,2;
select state,import_kind,count(*) from public.attendance_imports group by state,import_kind;
select match_state,count(*) from public.fingerprint_source_rows group by match_state;
select count(*) as assignments,min(valid_from) as earliest,max(valid_from) as latest
 from public.employee_assignment_history where voided_at is null;
select employment_status,count(*) as employees,count(distinct id) as uuid_count,count(distinct internal_code) as code_count
 from public.employees group by employment_status;
-- Native rehearsal additionally needs real GoTrue/PostgREST sessions per role,
-- backup restore, two-session concurrency and Worker browser acceptance.
-- Catalog grants alone do not verify those workflows.
