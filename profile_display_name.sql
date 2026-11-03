-- Migration for an existing EOD Supabase project.
-- Adds an optional friendly name to each profile; email remains the login.
alter table public.profiles
    add column if not exists display_name text;
