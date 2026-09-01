-- BlockLens account and portfolio foundation.
-- Run this migration in the Supabase SQL editor, then keep new table exposure disabled.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.portfolios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Main portfolio',
  base_currency text not null default 'usd' check (base_currency in ('usd', 'eur', 'gbp', 'ngn')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, name)
);

create table if not exists public.portfolio_positions (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios(id) on delete cascade,
  coin_id text not null check (coin_id ~ '^[a-z0-9-]{1,100}$'),
  quantity numeric(40, 18) not null check (quantity >= 0),
  average_cost numeric(40, 18) not null check (average_cost >= 0),
  currency text not null check (currency in ('usd', 'eur', 'gbp', 'ngn')),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (portfolio_id, coin_id)
);

create table if not exists public.watchlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  coin_id text not null check (coin_id ~ '^[a-z0-9-]{1,100}$'),
  created_at timestamptz not null default timezone('utc', now()),
  unique (user_id, coin_id)
);

create table if not exists public.price_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  coin_id text not null check (coin_id ~ '^[a-z0-9-]{1,100}$'),
  condition text not null check (condition in ('above', 'below', 'change')),
  threshold numeric(40, 18) not null check (threshold > 0),
  currency text not null check (currency in ('usd', 'eur', 'gbp', 'ngn')),
  created_at timestamptz not null default timezone('utc', now()),
  triggered_at timestamptz
);

create index if not exists portfolios_user_id_idx on public.portfolios(user_id);
create index if not exists portfolio_positions_portfolio_id_idx on public.portfolio_positions(portfolio_id);
create index if not exists watchlist_items_user_id_idx on public.watchlist_items(user_id);
create index if not exists price_alerts_user_id_idx on public.price_alerts(user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;

  insert into public.portfolios (user_id, name)
  values (new.id, 'Main portfolio')
  on conflict (user_id, name) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.portfolios enable row level security;
alter table public.portfolio_positions enable row level security;
alter table public.watchlist_items enable row level security;
alter table public.price_alerts enable row level security;

drop policy if exists "Users can read their profile" on public.profiles;
create policy "Users can read their profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "Users can update their profile" on public.profiles;
create policy "Users can update their profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "Users manage their portfolios" on public.portfolios;
create policy "Users manage their portfolios"
  on public.portfolios for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage positions in their portfolios" on public.portfolio_positions;
create policy "Users manage positions in their portfolios"
  on public.portfolio_positions for all to authenticated
  using (exists (
    select 1 from public.portfolios p
    where p.id = portfolio_id and p.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.portfolios p
    where p.id = portfolio_id and p.user_id = (select auth.uid())
  ));

drop policy if exists "Users manage their watchlist" on public.watchlist_items;
create policy "Users manage their watchlist"
  on public.watchlist_items for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage their alerts" on public.price_alerts;
create policy "Users manage their alerts"
  on public.price_alerts for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Automatic exposure is intentionally opt-in. These grants are only for signed-in users.
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.portfolios to authenticated;
grant select, insert, update, delete on public.portfolio_positions to authenticated;
grant select, insert, update, delete on public.watchlist_items to authenticated;
grant select, insert, update, delete on public.price_alerts to authenticated;

