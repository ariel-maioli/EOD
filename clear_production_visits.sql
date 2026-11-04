-- DESTRUCTIVE: removes every visit and visit-related audit event.
-- Keeps property records, profiles, and property audit events.
-- Review carefully and run manually in Supabase SQL Editor only when ready.
begin;

lock table public.visits in access exclusive mode;

alter table public.visits disable trigger visits_set_metadata;
alter table public.visits disable trigger visits_guard_payment;
alter table public.visits disable trigger visits_audit_changes;

with deleted_audit as (
    delete from public.audit_log
    where entity_type = 'visit'
    returning 1
)
select count(*) as removed_visit_audit_events from deleted_audit;

with deleted_visits as (
    delete from public.visits
    returning 1
)
select count(*) as removed_visits from deleted_visits;

alter table public.visits enable trigger visits_audit_changes;
alter table public.visits enable trigger visits_guard_payment;
alter table public.visits enable trigger visits_set_metadata;

commit;
