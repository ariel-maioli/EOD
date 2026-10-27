-- EOD database schema for Supabase.
-- Run this file in the Supabase SQL Editor before connecting the web app.
-- Create/invite users in Supabase Auth, then promote the first admin:
-- UPDATE public.profiles SET role = 'admin' WHERE lower(email) = lower('admin@example.com');

create table if not exists public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    email text not null,
    role text not null default 'technician'
        check (role in ('admin', 'technician')),
    created_at timestamptz not null default now()
);

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
    created_by uuid not null,
    created_at timestamptz not null default now(),
    updated_by uuid not null,
    updated_at timestamptz not null default now(),
    archived_at timestamptz,
    archived_by uuid,
    unique (property_number, visit_date)
);

create table if not exists public.audit_log (
    id bigint generated always as identity primary key,
    entity_type text not null check (entity_type in ('property', 'visit')),
    entity_id text not null,
    action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
    actor_id uuid,
    changed_at timestamptz not null default now(),
    old_data jsonb,
    new_data jsonb
);

create index if not exists visits_date_idx
    on public.visits (visit_date desc);
create index if not exists visits_created_by_date_idx
    on public.visits (created_by, visit_date desc);
create index if not exists audit_log_changed_at_idx
    on public.audit_log (changed_at desc);

create or replace function public.set_record_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null then
        raise exception 'An authenticated user is required';
    end if;

    if tg_op = 'INSERT' then
        new.created_by := auth.uid();
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

drop trigger if exists properties_set_metadata on public.properties;
create trigger properties_set_metadata
before insert or update on public.properties
for each row execute function public.set_record_metadata();

drop trigger if exists visits_set_metadata on public.visits;
create trigger visits_set_metadata
before insert or update on public.visits
for each row execute function public.set_record_metadata();

drop trigger if exists properties_audit_changes on public.properties;
create trigger properties_audit_changes
after insert or update or delete on public.properties
for each row execute function public.write_audit_log('property', 'property_number');

drop trigger if exists visits_audit_changes on public.visits;
create trigger visits_audit_changes
after insert or update or delete on public.visits
for each row execute function public.write_audit_log('visit', 'id');

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
begin
    if auth.uid() is null then
        raise exception 'An authenticated user is required';
    end if;

    insert into public.properties (property_number, created_by, updated_by)
    values (p_property_number, auth.uid(), auth.uid())
    on conflict (property_number) do nothing;

    if exists (
        select 1
        from public.properties
        where property_number = p_property_number
          and archived_at is not null
    ) then
        raise exception 'This property is archived';
    end if;

    insert into public.visits (
        property_number,
        visit_date,
        contact_name,
        cellphone,
        notes,
        created_by,
        updated_by
    )
    values (
        p_property_number,
        coalesce(p_visit_date, current_date),
        p_contact_name,
        p_cellphone,
        p_notes,
        auth.uid(),
        auth.uid()
    )
    returning id into new_visit_id;

    return new_visit_id;
end;
$$;

alter table public.profiles enable row level security;
alter table public.properties enable row level security;
alter table public.visits enable row level security;
alter table public.audit_log enable row level security;

drop policy if exists "profiles_select_self_or_admin" on public.profiles;
create policy "profiles_select_self_or_admin"
on public.profiles for select to authenticated
using (id = auth.uid() or public.is_admin());

drop policy if exists "properties_select_active_or_admin" on public.properties;
create policy "properties_select_active_or_admin"
on public.properties for select to authenticated
using (archived_at is null or public.is_admin());

drop policy if exists "properties_update_admin" on public.properties;
create policy "properties_update_admin"
on public.properties for update to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "visits_select_active_or_admin" on public.visits;
create policy "visits_select_active_or_admin"
on public.visits for select to authenticated
using (
    public.is_admin()
    or (
        archived_at is null
        and exists (
            select 1
            from public.properties
            where property_number = visits.property_number
              and archived_at is null
        )
    )
);

drop policy if exists "visits_update_active_or_admin" on public.visits;
create policy "visits_update_active_or_admin"
on public.visits for update to authenticated
using (
    public.is_admin()
    or (
        archived_at is null
        and exists (
            select 1
            from public.properties
            where property_number = visits.property_number
              and archived_at is null
        )
    )
)
with check (
    public.is_admin()
    or (
        archived_at is null
        and exists (
            select 1
            from public.properties
            where property_number = visits.property_number
              and archived_at is null
        )
    )
);

drop policy if exists "audit_select_admin" on public.audit_log;
create policy "audit_select_admin"
on public.audit_log for select to authenticated
using (public.is_admin());

revoke all on public.profiles, public.properties, public.visits, public.audit_log
    from public, anon, authenticated;
grant select on public.profiles, public.properties, public.visits, public.audit_log
    to authenticated;
grant update on public.properties, public.visits to authenticated;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

revoke all on function public.create_visit(integer, date, text, text, text)
    from public, anon;
grant execute on function public.create_visit(integer, date, text, text, text)
    to authenticated;
