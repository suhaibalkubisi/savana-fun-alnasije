-- Additive fingerprint foundation. No employee/history backfill or reimport.
-- Pending production approval. Existing RPCs and policies are unchanged.
begin;

create table public.attendance_imports (
  id uuid primary key default gen_random_uuid(),
  source_name text not null check(length(source_name) between 1 and 250),
  source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
  import_kind text not null check(import_kind in ('daily','monthly')),
  period_start date not null,
  period_end date not null check(period_end >= period_start),
  state text not null default 'preview' check(state in ('preview','applied','cancelled')),
  summary jsonb not null default '{}',
  version integer not null default 1,
  created_by uuid references public.profiles(id) on delete restrict,
  updated_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_hash,import_kind,period_start,period_end)
);

create table public.fingerprint_identities (
  id uuid primary key default gen_random_uuid(),
  person_code text not null unique check(length(btrim(person_code)) between 1 and 100),
  employee_id uuid not null references public.employees(id) on delete restrict,
  source_name text not null check(length(btrim(source_name)) between 1 and 250),
  is_active boolean not null default true,
  version integer not null default 1,
  created_by uuid references public.profiles(id) on delete restrict,
  updated_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index fingerprint_identity_employee on public.fingerprint_identities(employee_id);

-- Preserve the original calendar date, even when a morning punch is interpreted
-- as the previous operational day's exit. Missing exits never imply absence.
create table public.fingerprint_source_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.attendance_imports(id) on delete restrict,
  source_sheet text not null,
  source_row integer not null check(source_row > 0),
  calendar_date date not null,
  person_code text,
  source_name text not null,
  raw_values jsonb not null,
  punch_minutes integer[] not null default '{}',
  employee_id uuid references public.employees(id) on delete restrict,
  match_state text not null check(match_state in ('code','unique_name','confirmed','unmatched','ambiguous','invalid')),
  version integer not null default 1,
  created_by uuid references public.profiles(id) on delete restrict,
  updated_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(import_id,source_sheet,source_row,calendar_date),
  check (0 <= all(punch_minutes) and 1439 >= all(punch_minutes)),
  check ((match_state in ('code','unique_name','confirmed')) = (employee_id is not null))
);
create index fingerprint_source_employee_day on public.fingerprint_source_rows(employee_id,calendar_date);
create index fingerprint_source_import on public.fingerprint_source_rows(import_id);

create table public.fingerprint_issues (
  id uuid primary key default gen_random_uuid(),
  source_row_id uuid not null references public.fingerprint_source_rows(id) on delete restrict,
  issue_type text not null check(issue_type in ('unmatched','ambiguous','invalid','code_conflict','missing_schedule','punch_conflict')),
  details text not null check(length(details) between 1 and 2000),
  state text not null default 'open' check(state in ('open','resolved','ignored')),
  resolution_note text check(length(resolution_note) <= 2000),
  version integer not null default 1,
  created_by uuid references public.profiles(id) on delete restrict,
  updated_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_row_id,issue_type)
);
create index fingerprint_issue_state on public.fingerprint_issues(state,created_at desc);

-- Date-effective department defaults; no mass changes to employee identities.
create table public.attendance_department_rules (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete restrict,
  effective_from date not null,
  start_minute integer not null check(start_minute between 0 and 1439),
  grace_minutes integer not null default 0 check(grace_minutes between 0 and 180),
  entry_window_start integer not null default 720 check(entry_window_start between 0 and 1439),
  entry_window_end integer not null default 1439 check(entry_window_end between entry_window_start and 1439),
  working_weekdays integer[] not null default array[0,1,2,3,4,5,6],
  default_manager_id uuid references public.managers(id) on delete restrict,
  version integer not null default 1,
  created_by uuid references public.profiles(id) on delete restrict,
  updated_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(department_id,effective_from),
  check (0 <= all(working_weekdays) and 6 >= all(working_weekdays))
);

create table public.attendance_daily_notes (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete restrict,
  work_date date not null,
  notes text not null default '' check(length(notes) <= 2000),
  procedure_text text not null default '' check(length(procedure_text) <= 2000),
  version integer not null default 1,
  created_by uuid references public.profiles(id) on delete restrict,
  updated_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id,work_date)
);
create index attendance_notes_day on public.attendance_daily_notes(work_date);

create function hr_private.touch_attendance() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then new.created_by = auth.uid();
  else
    new.created_by = old.created_by;
    new.created_at = old.created_at;
    new.version = old.version + 1;
  end if;
  new.updated_by = auth.uid();
  new.updated_at = now();
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['attendance_imports','fingerprint_identities',
    'fingerprint_source_rows','fingerprint_issues','attendance_department_rules',
    'attendance_daily_notes'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public, anon, authenticated',t);
    execute format('create trigger touch_attendance before insert or update on public.%I for each row execute function hr_private.touch_attendance()',t);
    execute format('create trigger audit_attendance after insert or update on public.%I for each row execute function hr_private.audit()',t);
  end loop;
end $$;
-- Deny all direct access. Role-checked attendance RPCs are a separate migration.
-- Existing roles, policies, RPC grants, UUIDs, and records remain untouched.
commit;
