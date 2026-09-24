-- Monthly previews perform this exact normalized-name lookup for every calendar
-- cell. Index the existing expression; do not change matching or approval rules.
begin;
create index employees_fingerprint_name_idx
 on public.employees (hr_private.fingerprint_name(name));
commit;
