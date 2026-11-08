-- TEST DATA ONLY: run manually in the intended, empty EOD project.
-- Adds 50 visits for each technician currently present in public.profiles.
-- Each technician receives 10 visits per week over five weekdays, from 2026-04-13.
-- The first 40 visits per technician are paid on their week's Friday; the last 10
-- remain unpaid. One property and corresponding audit events are created per visit.
-- JWT claim settings are transaction-local and let the existing metadata and
-- payment triggers attribute each change to the selected account.
begin;

create temporary table eod_seed_participants (
    participant_order integer primary key,
    participant_id uuid not null unique,
    participant_label text not null
) on commit drop;

insert into pg_temp.eod_seed_participants
    (participant_order, participant_id, participant_label)
select
    row_number() over (order by profile.id)::integer,
    profile.id,
    format(
        'Técnico %s',
        row_number() over (order by profile.id)
    )
from public.profiles as profile
where profile.role = 'technician';

do $$
begin
    if not exists (select 1 from pg_temp.eod_seed_participants) then
        raise exception 'At least one technician profile is required before seeding test data';
    end if;

    if not exists (
        select 1
        from public.profiles
        where role = 'admin'
    ) then
        raise exception 'At least one admin profile is required before seeding test data';
    end if;

    if exists (select 1 from public.properties)
       or exists (select 1 from public.visits) then
        raise exception 'Test data can only be seeded when properties and visits are empty';
    end if;
end;
$$;

create temporary table eod_seed_visits (
    participant_id uuid not null,
    participant_order integer not null,
    visit_index integer not null,
    week_index integer not null,
    property_number integer primary key,
    visit_date date not null,
    contact_name text not null,
    cellphone text not null,
    notes text not null
) on commit drop;

with weekly_random as (
    select
        participant.participant_id,
        participant.participant_order,
        week.week_index,
        high_day.day_index as high_day,
        ((high_day.day_index + 1 + floor(random() * 4)::integer) % 5) as low_day
    from pg_temp.eod_seed_participants as participant
    cross join generate_series(0, 4) as week(week_index)
    cross join lateral (
        select floor(random() * 5)::integer as day_index
    ) as high_day
),
daily_counts as (
    select
        weekly.participant_id,
        weekly.participant_order,
        weekly.week_index,
        day.day_index,
        2
          + (day.day_index = weekly.high_day)::integer
          - (day.day_index = weekly.low_day)::integer as visit_count
    from weekly_random as weekly
    cross join generate_series(0, 4) as day(day_index)
),
planned_visits as (
    select
        daily.participant_id,
        daily.participant_order,
        daily.week_index,
        daily.day_index,
        visit.visit_sequence
    from daily_counts as daily
    cross join lateral generate_series(1, daily.visit_count) as visit(visit_sequence)
),
numbered_visits as (
    select
        planned.*,
        row_number() over (
            partition by planned.participant_id
            order by planned.week_index, planned.day_index, planned.visit_sequence
        )::integer as visit_index
    from planned_visits as planned
)
insert into pg_temp.eod_seed_visits (
    participant_id,
    participant_order,
    visit_index,
    week_index,
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
    planned.week_index,
    900000 + ((planned.participant_order - 1) * 50) + planned.visit_index,
    date '2026-04-13' + (planned.week_index * 7) + planned.day_index,
    format('Prueba T%s V%s', planned.participant_order, lpad(planned.visit_index::text, 3, '0')),
    '3' || lpad((((planned.participant_order - 1) * 50) + planned.visit_index)::text, 9, '0'),
    'Registro de prueba generado'
from numbered_visits as planned;

do $$
declare
    participant record;
    admin_id uuid;
begin
    for participant in
        select participant_id
        from pg_temp.eod_seed_participants
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
        from pg_temp.eod_seed_visits
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
        from pg_temp.eod_seed_visits
        where participant_id = participant.participant_id;
    end loop;

    select id
    into admin_id
    from public.profiles
    where role = 'admin'
    order by id
    limit 1;

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
        date '2026-04-17' + (seed.week_index * 7) + time '18:00'
    ) at time zone 'America/Argentina/Buenos_Aires'
    from pg_temp.eod_seed_visits as seed
    where seed.visit_index <= 40
      and visit.property_number = seed.property_number;
end;
$$;

do $$
declare
    expected_visits integer;
begin
    select count(*) * 50
    into expected_visits
    from pg_temp.eod_seed_participants;

    if (select count(*) from public.visits) <> expected_visits
       or (select count(*) from public.properties) <> expected_visits
       or (select count(*) from public.visits where paid_at is not null)
            <> (expected_visits * 4 / 5)
       or (select count(*) from public.visits where paid_at is null)
            <> (expected_visits / 5)
       or exists (
           select participant_id, week_index
           from pg_temp.eod_seed_visits
           group by participant_id, week_index
           having count(*) <> 10
       )
       or exists (
           select participant_id, visit_date
           from pg_temp.eod_seed_visits
           group by participant_id, visit_date
           having count(*) not between 1 and 3
       )
       or exists (
           select created_by
           from public.visits
           group by created_by
           having count(*) <> 50
       )
       or exists (
           select 1
           from public.visits as visit
           where not exists (
              select 1
              from pg_temp.eod_seed_participants as participant
              where participant.participant_id = visit.created_by
           )
       ) then
        raise exception 'Seed validation failed; the transaction must not be committed';
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
from pg_temp.eod_seed_participants as participant
join public.visits as visit
    on visit.created_by = participant.participant_id
group by participant.participant_order, participant.participant_label
order by participant.participant_order;

commit;
