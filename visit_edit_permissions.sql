-- Limit technicians to editing their own active visits.
-- Admins can continue editing any visit.
drop policy if exists "visits_update_active_or_admin" on public.visits;
create policy "visits_update_active_or_admin"
on public.visits for update to authenticated
using (
    public.is_admin()
    or (
        created_by = auth.uid()
        and archived_at is null
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
        created_by = auth.uid()
        and archived_at is null
        and exists (
            select 1
            from public.properties
            where property_number = visits.property_number
              and archived_at is null
        )
    )
);
