-- EOD database schema for Supabase.
-- Complete EOD schema: includes profile names, visit permissions, payments,
-- payment visibility restrictions, audit logging, future-date validation,
-- maintenance-mode access controls, property inventory, and assignments.
-- Run the full file in the Supabase SQL Editor for a new or existing EOD project.
-- This file creates/updates schema objects and policies; it does not delete application data.
-- Create/invite users in Supabase Auth, then promote the first admin:
-- UPDATE public.profiles SET role = 'admin' WHERE lower(email) = lower('admin@example.com');

create table if not exists public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    email text not null,
    display_name text,
    role text not null default 'technician'
        check (role in ('admin', 'technician')),
    created_at timestamptz not null default now()
);

alter table public.profiles
    add column if not exists display_name text;

create table if not exists public.maintenance_settings (
    id boolean primary key default true check (id),
    enabled boolean not null default false,
    updated_at timestamptz not null default now()
);

insert into public.maintenance_settings (id, enabled)
values (true, false)
on conflict (id) do nothing;

create or replace function public.sync_auth_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.profiles (id, email)
    values (new.id, coalesce(new.email, ''))
    on conflict (id) do update
        set email = excluded.email;
    return new;
end;
$$;

drop trigger if exists sync_profile_after_auth_insert on auth.users;
create trigger sync_profile_after_auth_insert
after insert on auth.users
for each row execute function public.sync_auth_profile();

drop trigger if exists sync_profile_after_auth_email_update on auth.users;
create trigger sync_profile_after_auth_email_update
after update of email on auth.users
for each row execute function public.sync_auth_profile();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.profiles
        where id = auth.uid()
          and role = 'admin'
    );
$$;

create or replace function public.get_maintenance_status()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(
        (select enabled from public.maintenance_settings where id is true),
        true
    );
$$;

create or replace function public.application_access_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select not public.get_maintenance_status() or public.is_admin();
$$;

create table if not exists public.properties (
    property_number integer primary key
        check (property_number between 100000 and 999999),
    created_by uuid not null,
    created_at timestamptz not null default now(),
    updated_by uuid not null,
    updated_at timestamptz not null default now(),
    archived_at timestamptz,
    archived_by uuid
);

create table if not exists public.visits (
    id uuid primary key default gen_random_uuid(),
    property_number integer not null
        references public.properties (property_number),
    visit_date date not null default current_date,
    contact_name varchar(50) not null
        check (length(trim(contact_name)) between 1 and 50),
    cellphone varchar(10) not null
        check (cellphone ~ '^[1-9][0-9]{9}$'),
    notes varchar(250),
    paid_at timestamptz,
    paid_by uuid references auth.users (id),
    created_by uuid not null,
    created_at timestamptz not null default now(),
    updated_by uuid not null,
    updated_at timestamptz not null default now(),
    archived_at timestamptz,
    archived_by uuid,
    unique (property_number, visit_date)
);

alter table public.visits
    add column if not exists paid_at timestamptz;
alter table public.visits
    add column if not exists paid_by uuid references auth.users (id);

alter table public.visits
    add column if not exists assignment_id uuid;

create table if not exists public.property_assignments (
    id uuid primary key default gen_random_uuid(),
    property_number integer not null
        references public.properties (property_number),
    assigned_to uuid not null references public.profiles (id),
    assigned_by uuid not null references public.profiles (id),
    assigned_at timestamptz not null default now(),
    completed_at timestamptz,
    completed_by uuid references public.profiles (id),
    closed_at timestamptz,
    closed_by uuid references public.profiles (id),
    close_reason text
        check (close_reason in ('visited', 'reassigned')),
    check (
        (completed_at is null and completed_by is null)
        or (completed_at is not null and completed_by is not null)
    ),
    check (
        (closed_at is null and closed_by is null and close_reason is null)
        or (closed_at is not null and closed_by is not null and close_reason is not null)
    )
);

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conrelid = 'public.visits'::regclass
          and conname = 'visits_assignment_id_fkey'
    ) then
        alter table public.visits
            add constraint visits_assignment_id_fkey
            foreign key (assignment_id) references public.property_assignments (id);
    end if;
end;
$$;

create unique index if not exists property_assignments_one_open_per_property_idx
    on public.property_assignments (property_number)
    where closed_at is null;
create unique index if not exists property_assignments_id_property_key
    on public.property_assignments (id, property_number);
create index if not exists property_assignments_assignee_idx
    on public.property_assignments (assigned_to, assigned_at desc);

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conrelid = 'public.visits'::regclass
          and conname = 'visits_assignment_property_fkey'
    ) then
        alter table public.visits
            add constraint visits_assignment_property_fkey
            foreign key (assignment_id, property_number)
            references public.property_assignments (id, property_number);
    end if;
end;
$$;

create table if not exists public.property_tracking_settings (
    id boolean primary key default true check (id),
    visits_per_workday integer not null default 2 check (visits_per_workday > 0),
    alert_days integer not null default 15 check (alert_days > 0),
    updated_by uuid references public.profiles (id),
    updated_at timestamptz not null default now()
);

insert into public.property_tracking_settings (id, visits_per_workday, alert_days)
values (true, 2, 15)
on conflict (id) do nothing;

create table if not exists public.audit_log (
    id bigint generated always as identity primary key,
    entity_type text not null,
    entity_id text not null,
    action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
    actor_id uuid,
    changed_at timestamptz not null default now(),
    old_data jsonb,
    new_data jsonb
);

alter table public.audit_log
    drop constraint if exists audit_log_entity_type_check;
alter table public.audit_log
    add constraint audit_log_entity_type_check
    check (entity_type in ('property', 'visit', 'assignment'));

create index if not exists visits_date_idx
    on public.visits (visit_date desc);
create index if not exists visits_created_by_date_idx
    on public.visits (created_by, visit_date desc);
create index if not exists visits_assignment_idx
    on public.visits (assignment_id);
create index if not exists audit_log_changed_at_idx
    on public.audit_log (changed_at desc);

create or replace function public.set_record_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    visit_assignee_id uuid;
begin
    if auth.uid() is null then
        raise exception 'An authenticated user is required';
    end if;

    if tg_op = 'INSERT' then
        if tg_table_name = 'properties' and not public.is_admin() then
            raise exception 'Only an admin can add properties to the inventory';
        end if;
        if tg_table_name = 'visits' and public.is_admin() then
            select assigned_to
            into visit_assignee_id
            from public.property_assignments
            where id = new.assignment_id
              and property_number = new.property_number
              and closed_at is null;
        end if;
        new.created_by := coalesce(visit_assignee_id, auth.uid());
        new.created_at := now();
        new.updated_by := auth.uid();
        new.updated_at := now();
        if new.archived_at is not null then
            if not public.is_admin() then
                raise exception 'Only an admin can archive records';
            end if;
            new.archived_by := auth.uid();
        else
            new.archived_by := null;
        end if;
        return new;
    end if;

    if tg_op = 'UPDATE' then
        if tg_table_name = 'properties'
           and new.property_number is distinct from old.property_number then
            raise exception 'A property number cannot be changed';
        end if;
        if tg_table_name = 'visits'
           and new.property_number is distinct from old.property_number then
            raise exception 'A visit property number cannot be changed';
        end if;

        new.created_by := old.created_by;
        new.created_at := old.created_at;
        new.updated_by := auth.uid();
        new.updated_at := now();

        if new.archived_at is distinct from old.archived_at
           or new.archived_by is distinct from old.archived_by then
            if not public.is_admin() then
                raise exception 'Only an admin can archive or restore records';
            end if;
            if new.archived_at is null then
                new.archived_by := null;
            else
                new.archived_by := auth.uid();
            end if;
        end if;

        return new;
    end if;

    return old;
end;
$$;

create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    old_row jsonb;
    new_row jsonb;
    record_id text;
begin
    if tg_op <> 'INSERT' then
        old_row := to_jsonb(old);
    end if;
    if tg_op <> 'DELETE' then
        new_row := to_jsonb(new);
    end if;

    record_id := coalesce(
        new_row ->> tg_argv[1],
        old_row ->> tg_argv[1]
    );

    insert into public.audit_log (
        entity_type,
        entity_id,
        action,
        actor_id,
        old_data,
        new_data
    )
    values (
        tg_argv[0],
        record_id,
        tg_op,
        auth.uid(),
        old_row,
        new_row
    );

    if tg_op = 'DELETE' then
        return old;
    end if;
    return new;
end;
$$;

create or replace function public.guard_visit_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if tg_op = 'INSERT' then
        if (new.paid_at is not null or new.paid_by is not null)
           and not public.is_admin() then
            raise exception 'Only an admin can mark a visit as paid';
        end if;
        if new.paid_at is null then
            new.paid_by := null;
        else
            new.paid_by := auth.uid();
        end if;
        return new;
    end if;

    if new.paid_at is distinct from old.paid_at
       or new.paid_by is distinct from old.paid_by then
        if not public.is_admin() then
            raise exception 'Only an admin can mark or correct a payment';
        end if;
        if new.paid_at is null then
            new.paid_by := null;
        else
            new.paid_by := auth.uid();
        end if;
    end if;

    return new;
end;
$$;

drop trigger if exists properties_set_metadata on public.properties;
create trigger properties_set_metadata
before insert or update on public.properties
for each row execute function public.set_record_metadata();

drop trigger if exists visits_set_metadata on public.visits;
create trigger visits_set_metadata
before insert or update on public.visits
for each row execute function public.set_record_metadata();

drop trigger if exists property_assignments_audit_changes on public.property_assignments;
create trigger property_assignments_audit_changes
after insert or update or delete on public.property_assignments
for each row execute function public.write_audit_log('assignment', 'id');

drop trigger if exists visits_guard_payment on public.visits;
create trigger visits_guard_payment
before insert or update on public.visits
for each row execute function public.guard_visit_payment();

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

drop trigger if exists properties_audit_changes on public.properties;
create trigger properties_audit_changes
after insert or update or delete on public.properties
for each row execute function public.write_audit_log('property', 'property_number');

drop trigger if exists visits_audit_changes on public.visits;
create trigger visits_audit_changes
after insert or update or delete on public.visits
for each row execute function public.write_audit_log('visit', 'id');

create or replace function public.has_active_property_assignment(
    p_property_number integer,
    p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select auth.uid() is not null
      and public.application_access_allowed()
      and (public.is_admin() or p_user_id = auth.uid())
      and exists (
          select 1
          from public.property_assignments as assignment
          where assignment.property_number = p_property_number
            and assignment.assigned_to = p_user_id
            and assignment.closed_at is null
      );
$$;

create or replace function public.can_access_visit(
    p_property_number integer,
    p_assignment_id uuid,
    p_created_by uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select auth.uid() is not null
      and public.application_access_allowed()
      and p_created_by = auth.uid()
      and exists (
          select 1
          from public.property_assignments as assignment
          where assignment.id = p_assignment_id
            and assignment.property_number = p_property_number
            and assignment.assigned_to = auth.uid()
      )
      and exists (
          select 1
          from public.properties as property
          where property.property_number = p_property_number
            and property.archived_at is null
      );
$$;

create or replace function public.add_properties(p_property_numbers text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_item text;
    v_number integer;
    v_seen text[] := array[]::text[];
    v_result jsonb := jsonb_build_object(
        'added', '[]'::jsonb,
        'existing', '[]'::jsonb,
        'duplicates', '[]'::jsonb,
        'invalid', '[]'::jsonb,
        'errors', '[]'::jsonb
    );
    v_rows integer;
begin
    if auth.uid() is null or not public.is_admin() then
        raise exception 'Only an admin can add properties to the inventory';
    end if;

    foreach v_item in array coalesce(p_property_numbers, array[]::text[])
    loop
        if v_item = any(v_seen) then
            v_result := jsonb_set(v_result, '{duplicates}',
                (v_result -> 'duplicates') || jsonb_build_array(v_item));
            continue;
        end if;
        v_seen := array_append(v_seen, v_item);

        if v_item is null or btrim(v_item) !~ '^[1-9][0-9]{5}$' then
            v_result := jsonb_set(v_result, '{invalid}',
                (v_result -> 'invalid') || jsonb_build_array(v_item));
            continue;
        end if;
        v_number := btrim(v_item)::integer;

        begin
            insert into public.properties (property_number, created_by, updated_by)
            values (v_number, auth.uid(), auth.uid())
            on conflict (property_number) do nothing;
            get diagnostics v_rows = row_count;
            if v_rows = 1 then
                v_result := jsonb_set(v_result, '{added}',
                    (v_result -> 'added') || jsonb_build_array(v_number));
            else
                v_result := jsonb_set(v_result, '{existing}',
                    (v_result -> 'existing') || jsonb_build_array(v_number));
            end if;
        exception when others then
            v_result := jsonb_set(v_result, '{errors}',
                (v_result -> 'errors') || jsonb_build_array(
                    jsonb_build_object('property', v_item, 'message', sqlerrm)
                ));
        end;
    end loop;

    return v_result;
end;
$$;

create or replace function public.assign_properties(
    p_property_numbers text[],
    p_assigned_to uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_item text;
    v_number integer;
    v_seen text[] := array[]::text[];
    v_assignee_role text;
    v_locked_property integer;
    v_active_assignment record;
    v_was_reassigned boolean;
    v_result jsonb := jsonb_build_object(
        'assigned', '[]'::jsonb,
        'reassigned', '[]'::jsonb,
        'already_assigned', '[]'::jsonb,
        'not_found', '[]'::jsonb,
        'invalid', '[]'::jsonb,
        'duplicates', '[]'::jsonb,
        'errors', '[]'::jsonb
    );
begin
    if auth.uid() is null or not public.is_admin() then
        raise exception 'Only an admin can assign properties';
    end if;
    if not public.application_access_allowed() then
        raise exception 'The application is in maintenance mode';
    end if;

    select role into v_assignee_role
    from public.profiles
    where id = p_assigned_to;
    if not found or v_assignee_role not in ('admin', 'technician') then
        raise exception 'The selected assignee does not exist';
    end if;

    foreach v_item in array coalesce(p_property_numbers, array[]::text[])
    loop
        if v_item = any(v_seen) then
            v_result := jsonb_set(v_result, '{duplicates}',
                (v_result -> 'duplicates') || jsonb_build_array(v_item));
            continue;
        end if;
        v_seen := array_append(v_seen, v_item);

        if v_item is null or btrim(v_item) !~ '^[1-9][0-9]{5}$' then
            v_result := jsonb_set(v_result, '{invalid}',
                (v_result -> 'invalid') || jsonb_build_array(v_item));
            continue;
        end if;
        v_number := btrim(v_item)::integer;

        begin
            select property_number
            into v_locked_property
            from public.properties
            where property_number = v_number
              and archived_at is null
            for update;
            if not found then
                v_result := jsonb_set(v_result, '{not_found}',
                    (v_result -> 'not_found') || jsonb_build_array(v_number));
                continue;
            end if;

            select id, assigned_to
            into v_active_assignment
            from public.property_assignments
            where property_number = v_number
              and closed_at is null
            for update;

            if found and v_active_assignment.assigned_to = p_assigned_to then
                v_result := jsonb_set(v_result, '{already_assigned}',
                    (v_result -> 'already_assigned') || jsonb_build_array(v_number));
                continue;
            end if;

            v_was_reassigned := found;
            if found then
                update public.property_assignments
                set closed_at = now(),
                    closed_by = auth.uid(),
                    close_reason = 'reassigned'
                where id = v_active_assignment.id;
            end if;

            insert into public.property_assignments (
                property_number, assigned_to, assigned_by
            )
            values (v_number, p_assigned_to, auth.uid());
            if v_was_reassigned then
                v_result := jsonb_set(v_result, '{reassigned}',
                    (v_result -> 'reassigned') || jsonb_build_array(v_number));
            else
                v_result := jsonb_set(v_result, '{assigned}',
                    (v_result -> 'assigned') || jsonb_build_array(v_number));
            end if;
        exception when others then
            v_result := jsonb_set(v_result, '{errors}',
                (v_result -> 'errors') || jsonb_build_array(
                    jsonb_build_object('property', v_item, 'message', sqlerrm)
                ));
        end;
    end loop;

    return v_result;
end;
$$;

create or replace function public.get_property_tracking_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_settings public.property_tracking_settings;
begin
    if auth.uid() is null or not public.is_admin() then
        raise exception 'Only an admin can view tracking settings';
    end if;
    select * into v_settings
    from public.property_tracking_settings
    where id is true;
    return jsonb_build_object(
        'visits_per_workday', v_settings.visits_per_workday,
        'alert_days', v_settings.alert_days
    );
end;
$$;

create or replace function public.update_property_tracking_settings(
    p_visits_per_workday integer,
    p_alert_days integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null or not public.is_admin() then
        raise exception 'Only an admin can update tracking settings';
    end if;
    if p_visits_per_workday is null or p_visits_per_workday <= 0
       or p_alert_days is null or p_alert_days <= 0 then
        raise exception 'Tracking settings must be positive whole numbers';
    end if;

    update public.property_tracking_settings
    set visits_per_workday = p_visits_per_workday,
        alert_days = p_alert_days,
        updated_by = auth.uid(),
        updated_at = now()
    where id is true;

    return jsonb_build_object(
        'visits_per_workday', p_visits_per_workday,
        'alert_days', p_alert_days
    );
end;
$$;

create or replace function public.create_visit(
    p_property_number integer,
    p_visit_date date,
    p_contact_name text,
    p_cellphone text,
    p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    new_visit_id uuid;
    property_archived_at timestamptz;
    active_assignment_id uuid;
begin
    if auth.uid() is null then
        raise exception 'An authenticated user is required';
    end if;
    if not public.application_access_allowed() then
        raise exception 'The application is in maintenance mode';
    end if;

    select archived_at
    into property_archived_at
    from public.properties
    where property_number = p_property_number
    for update;

    if not found then
        raise exception 'No tienes asignado el predio o el mismo no existe.';
    end if;
    if property_archived_at is not null then
        raise exception 'This property is archived';
    end if;

    select id
    into active_assignment_id
    from public.property_assignments
    where property_number = p_property_number
      and assigned_to = auth.uid()
      and closed_at is null
    for update;
    if not found then
        raise exception 'This property is not assigned to your account';
    end if;

    insert into public.visits (
        property_number,
        assignment_id,
        visit_date,
        contact_name,
        cellphone,
        notes,
        created_by,
        updated_by
    )
    values (
        p_property_number,
        active_assignment_id,
        coalesce(p_visit_date, current_date),
        p_contact_name,
        p_cellphone,
        p_notes,
        auth.uid(),
        auth.uid()
    )
    returning id into new_visit_id;

    update public.property_assignments
    set completed_at = now(),
        completed_by = auth.uid(),
        closed_at = now(),
        closed_by = auth.uid(),
        close_reason = 'visited'
    where id = active_assignment_id;

    return new_visit_id;
end;
$$;

create or replace function public.import_visits(
    p_assigned_to uuid,
    p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_row jsonb;
    v_ordinality bigint;
    v_row_number integer;
    v_property_text text;
    v_property_number integer;
    v_visit_date date;
    v_contact_name text;
    v_cellphone text;
    v_notes text;
    v_assignment_id uuid;
    v_profile_role text;
    v_seen_properties text[] := array[]::text[];
    v_imported jsonb := '[]'::jsonb;
    v_invalid jsonb := '[]'::jsonb;
    v_duplicate_in_file jsonb := '[]'::jsonb;
    v_duplicate_visit jsonb := '[]'::jsonb;
    v_not_found jsonb := '[]'::jsonb;
    v_archived jsonb := '[]'::jsonb;
    v_not_assigned jsonb := '[]'::jsonb;
    v_future jsonb := '[]'::jsonb;
    v_truncated jsonb := '[]'::jsonb;
    v_errors jsonb := '[]'::jsonb;
    v_property_archived_at timestamptz;
    v_contact_truncated boolean;
    v_notes_truncated boolean;
begin
    if auth.uid() is null or not public.is_admin() then
        raise exception 'Only an admin can import visits';
    end if;
    if not public.application_access_allowed() then
        raise exception 'The application is in maintenance mode';
    end if;
    if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
        raise exception 'The import rows must be a JSON array';
    end if;
    if jsonb_array_length(p_rows) > 2000 then
        raise exception 'Import at most 2000 visits at a time';
    end if;

    select role into v_profile_role
    from public.profiles
    where id = p_assigned_to;
    if not found or v_profile_role not in ('technician', 'admin') then
        raise exception 'The selected responsible user does not exist';
    end if;

    for v_row, v_ordinality in
        select item.value, item.ordinality
        from jsonb_array_elements(p_rows) with ordinality as item(value, ordinality)
    loop
        begin
            v_row_number := coalesce((v_row ->> 'row_number')::integer, v_ordinality::integer + 1);
        exception when others then
            v_row_number := v_ordinality::integer + 1;
        end;

        if coalesce(v_row ->> 'parse_error', '') <> '' then
            v_invalid := v_invalid || jsonb_build_array(jsonb_build_object(
                'row', v_row_number,
                'property', coalesce(v_row ->> 'property_number', ''),
                'reason', v_row ->> 'parse_error'
            ));
            continue;
        end if;

        v_property_text := btrim(coalesce(v_row ->> 'property_number', ''));

        if v_property_text !~ '^[1-9][0-9]{5}$' then
            v_invalid := v_invalid || jsonb_build_array(jsonb_build_object(
                'row', v_row_number,
                'property', v_property_text,
                'reason', 'El predio debe tener 6 dígitos y no comenzar con 0.'
            ));
            continue;
        end if;
        v_property_number := v_property_text::integer;

        v_contact_name := btrim(coalesce(v_row ->> 'contact_name', ''));
        v_cellphone := btrim(coalesce(v_row ->> 'cellphone', ''));
        v_notes := nullif(btrim(coalesce(v_row ->> 'notes', '')), '');

        v_contact_truncated := length(v_contact_name) > 50;
        v_notes_truncated := length(coalesce(v_notes, '')) > 250;
        if v_contact_truncated then
            v_contact_name := left(v_contact_name, 50);
        end if;
        if v_notes_truncated then
            v_notes := left(v_notes, 250);
        end if;

        if length(v_contact_name) not between 1 and 50
           or v_cellphone !~ '^[1-9][0-9]{9}$' then
            v_invalid := v_invalid || jsonb_build_array(jsonb_build_object(
                'row', v_row_number,
                'property', v_property_number,
                'reason', 'Revisá contacto (1 a 50 caracteres) y celular (10 dígitos).'
            ));
            continue;
        end if;

        begin
            if coalesce(v_row ->> 'visit_date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
                raise exception using errcode = '22007';
            end if;
            v_visit_date := (v_row ->> 'visit_date')::date;
        exception
            when others then
                v_invalid := v_invalid || jsonb_build_array(jsonb_build_object(
                    'row', v_row_number,
                    'property', v_property_number,
                    'reason', 'La fecha no es válida.'
                ));
                continue;
        end;

        if v_visit_date > (now() at time zone 'America/Argentina/Buenos_Aires')::date then
            v_future := v_future || jsonb_build_array(jsonb_build_object(
                'row', v_row_number,
                'property', v_property_number,
                'reason', 'La fecha de visita no puede ser futura.'
            ));
            continue;
        end if;

        if v_property_number::text = any(v_seen_properties) then
            v_duplicate_in_file := v_duplicate_in_file || jsonb_build_array(jsonb_build_object(
                'row', v_row_number,
                'property', v_property_number,
                'reason', 'El archivo solo puede incluir una fila válida por predio.'
            ));
            continue;
        end if;
        v_seen_properties := array_append(v_seen_properties, v_property_number::text);

        select archived_at
        into v_property_archived_at
        from public.properties
        where property_number = v_property_number
        for update;
        if not found then
            v_not_found := v_not_found || jsonb_build_array(jsonb_build_object(
                'row', v_row_number,
                'property', v_property_number,
                'reason', 'El predio no existe en el inventario.'
            ));
            continue;
        end if;
        if v_property_archived_at is not null then
            v_archived := v_archived || jsonb_build_array(jsonb_build_object(
                'row', v_row_number,
                'property', v_property_number,
                'reason', 'El predio está archivado.'
            ));
            continue;
        end if;

        if exists (
            select 1
            from public.visits
            where property_number = v_property_number
              and visit_date = v_visit_date
        ) then
            v_duplicate_visit := v_duplicate_visit || jsonb_build_array(jsonb_build_object(
                'row', v_row_number,
                'property', v_property_number,
                'reason', 'Ya existe una visita para ese predio en esa fecha.'
            ));
            continue;
        end if;

        select id
        into v_assignment_id
        from public.property_assignments
        where property_number = v_property_number
          and assigned_to = p_assigned_to
          and closed_at is null
        for update;
        if not found then
            v_not_assigned := v_not_assigned || jsonb_build_array(jsonb_build_object(
                'row', v_row_number,
                'property', v_property_number,
                'reason', 'El predio no tiene una asignación activa para el técnico seleccionado.'
            ));
            continue;
        end if;

        begin
            insert into public.visits (
                property_number,
                assignment_id,
                visit_date,
                contact_name,
                cellphone,
                notes,
                created_by,
                updated_by
            )
            values (
                v_property_number,
                v_assignment_id,
                v_visit_date,
                v_contact_name,
                v_cellphone,
                v_notes,
                p_assigned_to,
                auth.uid()
            );

            update public.property_assignments
            set completed_at = now(),
                completed_by = p_assigned_to,
                closed_at = now(),
                closed_by = auth.uid(),
                close_reason = 'visited'
            where id = v_assignment_id;

            v_imported := v_imported || jsonb_build_array(jsonb_build_object(
                'row', v_row_number,
                'property', v_property_number
            ));
            if v_contact_truncated or v_notes_truncated then
                v_truncated := v_truncated || jsonb_build_array(jsonb_build_object(
                    'row', v_row_number,
                    'property', v_property_number,
                    'reason', concat_ws(
                        ' ',
                        case when v_contact_truncated
                            then 'El contacto excedía 50 caracteres y se guardaron los primeros 50.' end,
                        case when v_notes_truncated
                            then 'Las notas excedían 250 caracteres y se guardaron los primeros 250.' end
                    )
                ));
            end if;
        exception
            when unique_violation then
                v_duplicate_visit := v_duplicate_visit || jsonb_build_array(jsonb_build_object(
                    'row', v_row_number,
                    'property', v_property_number,
                    'reason', 'Ya existe una visita para ese predio en esa fecha.'
                ));
            when others then
                v_errors := v_errors || jsonb_build_array(jsonb_build_object(
                    'row', v_row_number,
                    'property', v_property_number,
                    'reason', sqlerrm
                ));
        end;
    end loop;

    return jsonb_build_object(
        'imported', v_imported,
        'invalid', v_invalid,
        'duplicate_in_file', v_duplicate_in_file,
        'duplicate_visit', v_duplicate_visit,
        'not_found', v_not_found,
        'archived', v_archived,
        'not_assigned', v_not_assigned,
        'future', v_future,
        'truncated', v_truncated,
        'errors', v_errors
    );
end;
$$;

create or replace function public.mark_latest_visit_paid(p_property_number integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    property_archived_at timestamptz;
    target_visit record;
    payment_time timestamptz;
begin
    if auth.uid() is null or not public.is_admin() then
        raise exception 'Only an admin can mark visits as paid';
    end if;
    if not public.application_access_allowed() then
        raise exception 'The application is in maintenance mode';
    end if;

    select archived_at
    into property_archived_at
    from public.properties
    where property_number = p_property_number
    for update;

    if not found then
        return jsonb_build_object('status', 'not_found');
    end if;
    if property_archived_at is not null then
        return jsonb_build_object('status', 'property_archived');
    end if;

    select id, visit_date, paid_at
    into target_visit
    from public.visits
    where property_number = p_property_number
      and archived_at is null
      and paid_at is null
    order by visit_date desc, created_at desc
    limit 1
    for update;

    if not found then
        select id, visit_date, paid_at
        into target_visit
        from public.visits
        where property_number = p_property_number
          and archived_at is null
        order by visit_date desc, created_at desc
        limit 1
        for update;

        if not found then
            return jsonb_build_object('status', 'no_visit');
        end if;
        return jsonb_build_object(
            'status', 'already_paid',
            'visit_date', target_visit.visit_date,
            'paid_at', target_visit.paid_at
        );
    end if;

    update public.visits
    set paid_at = now()
    where id = target_visit.id
    returning paid_at into payment_time;

    return jsonb_build_object(
        'status', 'marked',
        'visit_id', target_visit.id,
        'visit_date', target_visit.visit_date,
        'paid_at', payment_time
    );
end;
$$;

create or replace function public.mark_visit_paid(p_visit_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_property_number integer;
    v_property_archived_at timestamptz;
    v_visit record;
    v_payment_time timestamptz;
begin
    if auth.uid() is null or not public.is_admin() then
        raise exception 'Only an admin can mark visits as paid';
    end if;
    if not public.application_access_allowed() then
        raise exception 'The application is in maintenance mode';
    end if;

    select property_number
    into v_property_number
    from public.visits
    where id = p_visit_id;
    if not found then
        return jsonb_build_object('status', 'not_found');
    end if;

    select archived_at
    into v_property_archived_at
    from public.properties
    where property_number = v_property_number
    for update;
    if not found then
        return jsonb_build_object('status', 'not_found');
    end if;
    if v_property_archived_at is not null then
        return jsonb_build_object('status', 'property_archived');
    end if;

    select id, visit_date, paid_at, archived_at
    into v_visit
    from public.visits
    where id = p_visit_id
    for update;
    if not found then
        return jsonb_build_object('status', 'not_found');
    end if;
    if v_visit.archived_at is not null then
        return jsonb_build_object('status', 'visit_archived');
    end if;
    if v_visit.paid_at is not null then
        return jsonb_build_object(
            'status', 'already_paid',
            'paid_at', v_visit.paid_at
        );
    end if;

    update public.visits
    set paid_at = now()
    where id = p_visit_id
    returning paid_at into v_payment_time;

    return jsonb_build_object(
        'status', 'marked',
        'visit_id', p_visit_id,
        'visit_date', v_visit.visit_date,
        'paid_at', v_payment_time
    );
end;
$$;

create or replace function public.import_payments(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_row jsonb;
    v_ordinality bigint;
    v_row_number integer;
    v_property_text text;
    v_property_number integer;
    v_payment_date date;
    v_visit_id uuid;
    v_paid_at timestamptz;
    v_seen_properties text[] := array[]::text[];
    v_imported jsonb := '[]'::jsonb;
    v_invalid jsonb := '[]'::jsonb;
    v_future jsonb := '[]'::jsonb;
    v_duplicate_in_file jsonb := '[]'::jsonb;
    v_not_found jsonb := '[]'::jsonb;
    v_archived jsonb := '[]'::jsonb;
    v_no_visit jsonb := '[]'::jsonb;
    v_already_paid jsonb := '[]'::jsonb;
    v_errors jsonb := '[]'::jsonb;
    v_property_archived_at timestamptz;
begin
    if auth.uid() is null or not public.is_admin() then
        raise exception 'Only an admin can import payments';
    end if;
    if not public.application_access_allowed() then
        raise exception 'The application is in maintenance mode';
    end if;
    if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
        raise exception 'The import rows must be a JSON array';
    end if;
    if jsonb_array_length(p_rows) > 2000 then
        raise exception 'Import at most 2000 payments at a time';
    end if;

    for v_row, v_ordinality in
        select item.value, item.ordinality
        from jsonb_array_elements(p_rows) with ordinality as item(value, ordinality)
    loop
        begin
            v_row_number := coalesce((v_row ->> 'row_number')::integer, v_ordinality::integer + 1);
        exception when others then
            v_row_number := v_ordinality::integer + 1;
        end;

        v_property_text := btrim(coalesce(v_row ->> 'property_number', ''));
        if coalesce(v_row ->> 'parse_error', '') <> '' then
            v_invalid := v_invalid || jsonb_build_array(jsonb_build_object(
                'row', v_row_number,
                'property', v_property_text,
                'reason', v_row ->> 'parse_error'
            ));
            continue;
        end if;

        if v_property_text !~ '^[1-9][0-9]{5}$' then
            v_invalid := v_invalid || jsonb_build_array(jsonb_build_object(
                'row', v_row_number,
                'property', v_property_text,
                'reason', 'El predio debe tener 6 dígitos y no comenzar con 0.'
            ));
            continue;
        end if;
        v_property_number := v_property_text::integer;

        begin
            if coalesce(v_row ->> 'payment_date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
                raise exception using errcode = '22007';
            end if;
            v_payment_date := (v_row ->> 'payment_date')::date;
        exception
            when others then
                v_invalid := v_invalid || jsonb_build_array(jsonb_build_object(
                    'row', v_row_number,
                    'property', v_property_number,
                    'reason', 'La fecha de pago no es válida.'
                ));
                continue;
        end;

        if v_payment_date > (now() at time zone 'America/Argentina/Buenos_Aires')::date then
            v_future := v_future || jsonb_build_array(jsonb_build_object(
                'row', v_row_number,
                'property', v_property_number,
                'reason', 'La fecha de pago no puede ser futura.'
            ));
            continue;
        end if;

        if v_property_number::text = any(v_seen_properties) then
            v_duplicate_in_file := v_duplicate_in_file || jsonb_build_array(jsonb_build_object(
                'row', v_row_number,
                'property', v_property_number,
                'reason', 'El archivo solo puede incluir una fila por predio.'
            ));
            continue;
        end if;
        v_seen_properties := array_append(v_seen_properties, v_property_number::text);

        select archived_at
        into v_property_archived_at
        from public.properties
        where property_number = v_property_number
        for update;
        if not found then
            v_not_found := v_not_found || jsonb_build_array(jsonb_build_object(
                'row', v_row_number,
                'property', v_property_number,
                'reason', 'El predio no existe.'
            ));
            continue;
        end if;
        if v_property_archived_at is not null then
            v_archived := v_archived || jsonb_build_array(jsonb_build_object(
                'row', v_row_number,
                'property', v_property_number,
                'reason', 'El predio está archivado.'
            ));
            continue;
        end if;

        select id, paid_at
        into v_visit_id, v_paid_at
        from public.visits
        where property_number = v_property_number
          and archived_at is null
          and paid_at is null
        order by visit_date desc, created_at desc
        limit 1
        for update;
        if not found then
            if exists (
                select 1
                from public.visits
                where property_number = v_property_number
                  and archived_at is null
            ) then
                v_already_paid := v_already_paid || jsonb_build_array(jsonb_build_object(
                    'row', v_row_number,
                    'property', v_property_number,
                    'reason', 'No hay visitas pendientes de pago para este predio.'
                ));
            else
                v_no_visit := v_no_visit || jsonb_build_array(jsonb_build_object(
                    'row', v_row_number,
                    'property', v_property_number,
                    'reason', 'El predio no tiene visitas activas.'
                ));
            end if;
            continue;
        end if;

        begin
            update public.visits
            set paid_at = v_payment_date::timestamp at time zone 'America/Argentina/Buenos_Aires'
            where id = v_visit_id;

            v_imported := v_imported || jsonb_build_array(jsonb_build_object(
                'row', v_row_number,
                'property', v_property_number,
                'payment_date', v_payment_date
            ));
        exception
            when others then
                v_errors := v_errors || jsonb_build_array(jsonb_build_object(
                    'row', v_row_number,
                    'property', v_property_number,
                    'reason', sqlerrm
                ));
        end;
    end loop;

    return jsonb_build_object(
        'imported', v_imported,
        'invalid', v_invalid,
        'future', v_future,
        'duplicate_in_file', v_duplicate_in_file,
        'not_found', v_not_found,
        'property_archived', v_archived,
        'no_visit', v_no_visit,
        'already_paid', v_already_paid,
        'errors', v_errors
    );
end;
$$;

create or replace function public.get_visible_visit_payments()
returns table (
    visit_id uuid,
    paid_at timestamptz,
    paid_by uuid
)
language sql
stable
security definer
set search_path = ''
as $$
    select visit.id, visit.paid_at, visit.paid_by
    from public.visits as visit
    where auth.uid() is not null
      and public.application_access_allowed()
      and visit.paid_at is not null
      and (
          public.is_admin()
          or (
              visit.created_by = auth.uid()
              and visit.archived_at is null
              and exists (
                  select 1
                  from public.properties as property
                  where property.property_number = visit.property_number
                    and property.archived_at is null
              )
          )
      );
$$;

alter table public.profiles enable row level security;
alter table public.maintenance_settings enable row level security;
alter table public.properties enable row level security;
alter table public.visits enable row level security;
alter table public.property_assignments enable row level security;
alter table public.property_tracking_settings enable row level security;
alter table public.audit_log enable row level security;

drop policy if exists "profiles_select_self_or_admin" on public.profiles;
drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
on public.profiles for select to authenticated
using (auth.uid() is not null and public.application_access_allowed());

drop policy if exists "properties_select_active_or_admin" on public.properties;
create policy "properties_select_active_or_admin"
on public.properties for select to authenticated
using (
    public.application_access_allowed()
    and (
        public.is_admin()
        or (
            archived_at is null
            and public.has_active_property_assignment(property_number, auth.uid())
        )
    )
);

drop policy if exists "properties_update_admin" on public.properties;
create policy "properties_update_admin"
on public.properties for update to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "visits_select_active_or_admin" on public.visits;
create policy "visits_select_active_or_admin"
on public.visits for select to authenticated
using (
    public.application_access_allowed()
    and (
        public.is_admin()
        or (
            archived_at is null
            and public.can_access_visit(property_number, assignment_id, created_by)
        )
    )
);

drop policy if exists "visits_update_active_or_admin" on public.visits;
create policy "visits_update_active_or_admin"
on public.visits for update to authenticated
using (
    public.application_access_allowed()
    and (
        public.is_admin()
        or (
            archived_at is null
            and public.can_access_visit(property_number, assignment_id, created_by)
        )
    )
)
with check (
    public.application_access_allowed()
    and (
        public.is_admin()
        or (
            archived_at is null
            and public.can_access_visit(property_number, assignment_id, created_by)
        )
    )
);

drop policy if exists "property_assignments_select_admin_or_assignee"
    on public.property_assignments;
create policy "property_assignments_select_admin_or_assignee"
on public.property_assignments for select to authenticated
using (
    public.application_access_allowed()
    and (public.is_admin() or assigned_to = auth.uid())
);

drop policy if exists "property_tracking_settings_select_admin"
    on public.property_tracking_settings;
create policy "property_tracking_settings_select_admin"
on public.property_tracking_settings for select to authenticated
using (public.is_admin());

drop policy if exists "audit_select_admin" on public.audit_log;
create policy "audit_select_admin"
on public.audit_log for select to authenticated
using (public.is_admin());

revoke all on public.profiles, public.properties, public.visits, public.audit_log,
    public.property_assignments, public.property_tracking_settings
    from public, anon, authenticated;
revoke all on public.maintenance_settings from public, anon, authenticated;
grant select on public.profiles, public.properties, public.audit_log,
    public.property_assignments, public.property_tracking_settings
    to authenticated;
revoke select (paid_at, paid_by) on public.visits
    from public, anon, authenticated;
grant select (
    id,
    property_number,
    assignment_id,
    visit_date,
    contact_name,
    cellphone,
    notes,
    created_by,
    created_at,
    updated_by,
    updated_at,
    archived_at,
    archived_by
) on public.visits to authenticated;
grant update on public.properties, public.visits to authenticated;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

revoke all on function public.get_maintenance_status() from public;
grant execute on function public.get_maintenance_status() to anon, authenticated;

revoke all on function public.application_access_allowed() from public, anon;
grant execute on function public.application_access_allowed() to authenticated;

revoke all on function public.create_visit(integer, date, text, text, text)
    from public, anon;
grant execute on function public.create_visit(integer, date, text, text, text)
    to authenticated;

revoke all on function public.import_visits(uuid, jsonb) from public, anon;
grant execute on function public.import_visits(uuid, jsonb) to authenticated;

revoke all on function public.has_active_property_assignment(integer, uuid)
    from public, anon;
grant execute on function public.has_active_property_assignment(integer, uuid)
    to authenticated;

revoke all on function public.can_access_visit(integer, uuid, uuid)
    from public, anon;
grant execute on function public.can_access_visit(integer, uuid, uuid)
    to authenticated;

revoke all on function public.add_properties(text[]) from public, anon;
grant execute on function public.add_properties(text[]) to authenticated;

revoke all on function public.assign_properties(text[], uuid) from public, anon;
grant execute on function public.assign_properties(text[], uuid) to authenticated;

revoke all on function public.get_property_tracking_settings()
    from public, anon;
grant execute on function public.get_property_tracking_settings()
    to authenticated;

revoke all on function public.update_property_tracking_settings(integer, integer)
    from public, anon;
grant execute on function public.update_property_tracking_settings(integer, integer)
    to authenticated;

revoke all on function public.mark_latest_visit_paid(integer)
    from public, anon;
grant execute on function public.mark_latest_visit_paid(integer)
    to authenticated;

revoke all on function public.mark_visit_paid(uuid) from public, anon;
grant execute on function public.mark_visit_paid(uuid) to authenticated;

revoke all on function public.import_payments(jsonb) from public, anon;
grant execute on function public.import_payments(jsonb) to authenticated;

revoke all on function public.get_visible_visit_payments()
    from public, anon;
grant execute on function public.get_visible_visit_payments()
    to authenticated;

notify pgrst, 'reload schema';
