alter table if exists public.profiles
  add column if not exists pro_plan text,
  add column if not exists pro_expires_at timestamptz,
  add column if not exists updated_at timestamptz default now();
