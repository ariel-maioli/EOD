-- TEST DATA ONLY: run manually in the intended EOD development project.
-- Adds two visits per technician for each weekday elapsed in the current
-- Argentina week (Monday-Friday), without requiring empty application tables.
-- If Friday has passed 18:00 Argentina time, the first eight visits per
-- technician are paid on Friday; the remaining two stay unpaid.
begin;

lock table public.properties in share row exclusive mode;
lock table public.visits in share row exclusive mode;

create temporary table eod_week_participants (
    participant_order integer primary key,
    participant_id uuid not null unique,
    participant_label text not null
) on commit drop;

insert into pg_temp.eod_week_participants
    (participant_order, participant_id, participant_label)
select
    row_number() over (order by profile.id)::integer,
    profile.id,
    format('Técnico %s', row_number() over (order by profile.id))
from public.profiles as profile
where profile.role = 'technician';

create temporary table eod_week_config on commit drop as
with local_time as (
    select now() at time zone 'America/Argentina/Buenos_Aires' as local_now
),
week_start as (
    select
        local_now,
        local_now::date as today,
        local_now::date
            - (extract(isodow from local_now)::integer - 1) as monday
    from local_time
)
select
    today,
    monday,
    least(extract(isodow from today)::integer - 1, 4) as last_workday_offset,
    today > monday + 4
        or (today = monday + 4 and local_now::time >= time '18:00')
        as payments_ready,
    format('Datos de prueba EOD semana %s', to_char(monday, 'YYYY-MM-DD')) as marker
from week_start;

do $$
begin
    if not exists (select 1 from pg_temp.eod_week_participants) then
        raise exception 'At least one technician profile is required before seeding test data';
    end if;

    if not exists (
        select 1
        from public.profiles
        where role = 'admin'
    ) then
        raise exception 'At least one admin profile is required before seeding test data';
    end if;

    if exists (
        select 1
        from public.visits
        where notes = (select marker from pg_temp.eod_week_config)
    ) then
        raise exception 'Current-week test data already exists; no records were added';
    end if;
end;
$$;

create temporary table eod_week_visits (
    participant_id uuid not null,
    participant_order integer not null,
    visit_index integer not null,
    property_number integer primary key,
    visit_date date not null,
    contact_name text not null,
    cellphone text not null,
    notes text not null
) on commit drop;

with planned_visits as (
    select
        participant.participant_id,
        participant.participant_order,
        day.day_index,
        visit.visit_sequence,
        row_number() over (
            partition by participant.participant_id
            order by day.day_index, visit.visit_sequence
        )::integer as visit_index,
        row_number() over (
            order by participant.participant_order, day.day_index, visit.visit_sequence
        )::integer as seed_order,
        config.monday + day.day_index as visit_date,
        config.marker
    from pg_temp.eod_week_participants as participant
    cross join pg_temp.eod_week_config as config
    cross join lateral generate_series(0, config.last_workday_offset) as day(day_index)
    cross join lateral generate_series(1, 2) as visit(visit_sequence)
),
available_property_numbers as (
    select
        candidate.property_number,
        row_number() over (order by candidate.property_number)::integer as seed_order
    from generate_series(800000, 899999) as candidate(property_number)
    where not exists (
        select 1
        from public.properties as property
        where property.property_number = candidate.property_number
    )
)
insert into pg_temp.eod_week_visits (
    participant_id,
    participant_order,
    visit_index,
    property_number,
    visit_date,
    contact_name,
    cellphone,
    notes
)
select
    planned.participant_id,
    planned.participant_order,
    planned.visit_index,
    available.property_number,
    planned.visit_date,
    format(
        'Prueba semana %s T%s V%s',
        to_char((select monday from pg_temp.eod_week_config), 'MMDD'),
        planned.participant_order,
        lpad(planned.visit_index::text, 2, '0')
    ),
    '3' || lpad(available.property_number::text, 9, '0'),
    planned.marker
from planned_visits as planned
join available_property_numbers as available using (seed_order);

do $$
declare
    participant record;
    admin_id uuid;
    expected_visits integer;
begin
    select id
    into admin_id
    from public.profiles
    where role = 'admin'
    order by id
    limit 1;

    select
        (select count(*) from pg_temp.eod_week_participants)
        * ((select last_workday_offset from pg_temp.eod_week_config) + 1)
        * 2
    into expected_visits;

    if (select count(*) from pg_temp.eod_week_visits) <> expected_visits then
        raise exception 'Not enough unused test property numbers; no records were added';
    end if;

    for participant in
        select participant_id
        from pg_temp.eod_week_participants
        order by participant_order
    loop
        perform set_config('request.jwt.claim.sub', participant.participant_id::text, true);
        perform set_config('request.jwt.claim.role', 'authenticated', true);
        perform set_config(
            'request.jwt.claims',
            jsonb_build_object(
                'sub', participant.participant_id::text,
                'role', 'authenticated'
            )::text,
            true
        );

        insert into public.properties (property_number, created_by, updated_by)
        select property_number, participant.participant_id, participant.participant_id
        from pg_temp.eod_week_visits
        where participant_id = participant.participant_id;

        insert into public.visits (
            property_number,
            visit_date,
            contact_name,
            cellphone,
            notes,
            created_by,
            updated_by
        )
        select
            property_number,
            visit_date,
            contact_name,
            cellphone,
            notes,
            participant.participant_id,
            participant.participant_id
        from pg_temp.eod_week_visits
        where participant_id = participant.participant_id;
    end loop;

    if (select payments_ready from pg_temp.eod_week_config) then
        perform set_config('request.jwt.claim.sub', admin_id::text, true);
        perform set_config('request.jwt.claim.role', 'authenticated', true);
        perform set_config(
            'request.jwt.claims',
            jsonb_build_object(
                'sub', admin_id::text,
                'role', 'authenticated'
            )::text,
            true
        );

        update public.visits as visit
        set paid_at = (
            (select monday + 4 from pg_temp.eod_week_config) + time '18:00'
        ) at time zone 'America/Argentina/Buenos_Aires'
        from pg_temp.eod_week_visits as seed
        where seed.visit_index <= 8
          and visit.property_number = seed.property_number;
    end if;
end;
$$;

do $$
declare
    expected_visits integer;
    expected_paid_visits integer;
begin
    select
        count(*) * (config.last_workday_offset + 1) * 2,
        case when config.payments_ready
            then count(*) * 8
            else 0
        end
    into expected_visits, expected_paid_visits
    from pg_temp.eod_week_participants
    cross join pg_temp.eod_week_config as config
    group by config.last_workday_offset, config.payments_ready;

    if (select count(*) from pg_temp.eod_week_visits) <> expected_visits
       or (
           select count(*)
           from public.visits
           where notes = (select marker from pg_temp.eod_week_config)
       ) <> expected_visits
       or (
           select count(*)
           from public.visits as visit
           join pg_temp.eod_week_visits as seed
             on seed.property_number = visit.property_number
           where visit.paid_at is not null
       ) <> expected_paid_visits
       or exists (
           select 1
           from public.visits as visit
           join pg_temp.eod_week_visits as seed
             on seed.property_number = visit.property_number
           where visit.visit_date > (select today from pg_temp.eod_week_config)
       )
       or exists (
           select participant_id
           from pg_temp.eod_week_visits
           group by participant_id
           having count(*) <> (
               select (last_workday_offset + 1) * 2
               from pg_temp.eod_week_config
           )
       ) then
        raise exception 'Current-week seed validation failed; the transaction must not be committed';
    end if;
end;
$$;

select
    participant.participant_label,
    count(visit.id) as total_visits,
    count(visit.id) filter (where visit.paid_at is not null) as paid_visits,
    count(visit.id) filter (where visit.paid_at is null) as unpaid_visits,
    min(visit.visit_date) as first_visit,
    max(visit.visit_date) as last_visit
from pg_temp.eod_week_participants as participant
join pg_temp.eod_week_visits as seed
  on seed.participant_id = participant.participant_id
join public.visits as visit
  on visit.property_number = seed.property_number
group by participant.participant_order, participant.participant_label
order by participant.participant_order;

commit;
