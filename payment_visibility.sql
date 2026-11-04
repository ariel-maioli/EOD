-- Limit payment details to admins and the technician who created each visit.
-- Technicians retain access to shared visit details, but not other users' payment status.

revoke all on public.visits from public, anon, authenticated;
revoke select (paid_at, paid_by) on public.visits from public, anon, authenticated;
grant select (
    id,
    property_number,
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
grant update on public.visits to authenticated;

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

revoke all on function public.get_visible_visit_payments()
    from public, anon;
grant execute on function public.get_visible_visit_payments()
    to authenticated;
