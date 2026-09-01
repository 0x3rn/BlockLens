-- BlockLens history for saved AI briefs and portfolio position activity.
-- Run after 0001_blocklens_accounts.sql.

create table if not exists public.ai_analysis_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  coin_id text not null check (coin_id ~ '^[a-z0-9-]{1,100}$'),
  coin_name text not null,
  coin_symbol text not null,
  currency text not null check (currency in ('usd', 'eur', 'gbp', 'ngn')),
  price numeric(40, 18) not null check (price >= 0),
  analysis jsonb not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.position_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  coin_id text not null check (coin_id ~ '^[a-z0-9-]{1,100}$'),
  action text not null check (action in ('added', 'updated', 'removed')),
  quantity numeric(40, 18) not null check (quantity >= 0),
  average_cost numeric(40, 18) not null check (average_cost >= 0),
  currency text not null check (currency in ('usd', 'eur', 'gbp', 'ngn')),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists ai_analysis_history_user_created_idx
  on public.ai_analysis_history(user_id, created_at desc);
create index if not exists position_history_user_created_idx
  on public.position_history(user_id, created_at desc);

alter table public.ai_analysis_history enable row level security;
alter table public.position_history enable row level security;

drop policy if exists "Users manage their AI analysis history" on public.ai_analysis_history;
create policy "Users manage their AI analysis history"
  on public.ai_analysis_history for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage their position history" on public.position_history;
create policy "Users manage their position history"
  on public.position_history for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.ai_analysis_history to authenticated;
grant select, insert, update, delete on public.position_history to authenticated;
