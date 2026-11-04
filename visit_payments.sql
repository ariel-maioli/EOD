-- Add payment state to visits. The payment date is the date the admin marks it.
alter table public.visits
    add column if not exists paid_at timestamptz;
alter table public.visits
    add column if not exists paid_by uuid references auth.users (id);

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

drop trigger if exists visits_guard_payment on public.visits;
create trigger visits_guard_payment
before insert or update on public.visits
for each row execute function public.guard_visit_payment();

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
    order by visit_date desc, created_at desc
    limit 1
    for update;

    if not found then
        return jsonb_build_object('status', 'no_visit');
    end if;
    if target_visit.paid_at is not null then
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

revoke all on function public.mark_latest_visit_paid(integer)
    from public, anon;
grant execute on function public.mark_latest_visit_paid(integer)
    to authenticated;

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
begin
    if auth.uid() is null then
        raise exception 'An authenticated user is required';
    end if;

    insert into public.properties (property_number, created_by, updated_by)
    values (p_property_number, auth.uid(), auth.uid())
    on conflict (property_number) do nothing;

    select archived_at
    into property_archived_at
    from public.properties
    where property_number = p_property_number
    for update;

    if not found then
        raise exception 'Property could not be created';
    end if;
    if property_archived_at is not null then
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

revoke all on function public.create_visit(integer, date, text, text, text)
    from public, anon;
grant execute on function public.create_visit(integer, date, text, text, text)
    to authenticated;
