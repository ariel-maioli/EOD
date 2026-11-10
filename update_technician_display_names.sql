-- Update technician names shown in EOD instead of their email addresses.
-- Replace the example emails and names before running in Supabase SQL Editor.
with names(email, display_name) as (
    values
        ('tecnico1@example.com', 'Nombre Apellido'),
        ('tecnico2@example.com', 'Nombre Apellido')
)
update public.profiles as p
set display_name = n.display_name
from names as n
where lower(p.email) = lower(n.email)
  and p.role = 'technician'
returning p.email, p.display_name, p.role;
