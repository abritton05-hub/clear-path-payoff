alter table if exists public.profiles
  add column if not exists is_pro boolean default false,
  add column if not exists pro_type text,
  add column if not exists pro_until timestamptz,
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_price_id text;
