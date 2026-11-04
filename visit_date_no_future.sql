-- Reject future visit dates on inserts and updates, including direct API requests.
create or replace function public.guard_visit_date()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.visit_date > (now() at time zone 'America/Argentina/Buenos_Aires')::date then
        raise exception 'Visit date cannot be in the future';
    end if;
    return new;
end;
$$;

drop trigger if exists visits_guard_date on public.visits;
create trigger visits_guard_date
before insert or update on public.visits
for each row execute function public.guard_visit_date();
