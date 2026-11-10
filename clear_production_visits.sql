-- DESTRUCTIVE: removes visits, assignments, properties, and audit history.
-- Keeps Supabase Auth users, public.profiles, and coverage settings.
-- Review carefully and run manually in Supabase SQL Editor only when ready.
begin;

lock table public.properties in access exclusive mode;
lock table public.visits in access exclusive mode;
lock table public.property_assignments in access exclusive mode;
lock table public.audit_log in access exclusive mode;

alter table public.visits disable trigger visits_set_metadata;
alter table public.visits disable trigger visits_guard_payment;
alter table public.visits disable trigger visits_audit_changes;
alter table public.properties disable trigger properties_set_metadata;
alter table public.properties disable trigger properties_audit_changes;

with deleted_visits as (
    delete from public.visits
    returning 1
)
select count(*) as removed_visits from deleted_visits;

with deleted_assignments as (
    delete from public.property_assignments
    returning 1
)
select count(*) as removed_assignments from deleted_assignments;

with deleted_properties as (
    delete from public.properties
    returning 1
)
select count(*) as removed_properties from deleted_properties;

with deleted_audit as (
    delete from public.audit_log
    returning 1
)
select count(*) as removed_audit_events from deleted_audit;

alter table public.properties enable trigger properties_audit_changes;
alter table public.properties enable trigger properties_set_metadata;
alter table public.visits enable trigger visits_audit_changes;
alter table public.visits enable trigger visits_guard_payment;
alter table public.visits enable trigger visits_set_metadata;

commit;
