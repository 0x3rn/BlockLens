-- Neon schema for BlockLens. Supabase remains the identity provider only.
-- Execute using the Neon database owner, on an isolated branch first.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'blocklens_app') then
    create role blocklens_app nologin;
  end if;
end $$;
do $$ begin
  execute format('grant blocklens_app to %I', current_user);
end $$;
grant usage on schema public to blocklens_app;
create or replace function public.current_account_id()
returns uuid language sql stable
as $$ select nullif(current_setting('blocklens.user_id', true), '')::uuid $$;
revoke all on function public.current_account_id() from public;
grant execute on function public.current_account_id() to blocklens_app;
create table if not exists public.profiles (
  id uuid primary key,
  display_name text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.portfolios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
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
  user_id uuid not null references public.profiles(id) on delete cascade,
  coin_id text not null check (coin_id ~ '^[a-z0-9-]{1,100}$'),
  created_at timestamptz not null default timezone('utc', now()),
  unique (user_id, coin_id)
);

create table if not exists public.price_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
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



alter table public.profiles enable row level security;
alter table public.portfolios enable row level security;
alter table public.portfolio_positions enable row level security;
alter table public.watchlist_items enable row level security;
alter table public.price_alerts enable row level security;

drop policy if exists "Users can read their profile" on public.profiles;
create policy "Users can read their profile"
  on public.profiles for select to blocklens_app
  using ((select public.current_account_id()) = id);

drop policy if exists "Users can update their profile" on public.profiles;
create policy "Users can update their profile"
  on public.profiles for update to blocklens_app
  using ((select public.current_account_id()) = id)
  with check ((select public.current_account_id()) = id);

drop policy if exists "Users manage their portfolios" on public.portfolios;
create policy "Users manage their portfolios"
  on public.portfolios for all to blocklens_app
  using ((select public.current_account_id()) = user_id)
  with check ((select public.current_account_id()) = user_id);

drop policy if exists "Users manage positions in their portfolios" on public.portfolio_positions;
create policy "Users manage positions in their portfolios"
  on public.portfolio_positions for all to blocklens_app
  using (exists (
    select 1 from public.portfolios p
    where p.id = portfolio_id and p.user_id = (select public.current_account_id())
  ))
  with check (exists (
    select 1 from public.portfolios p
    where p.id = portfolio_id and p.user_id = (select public.current_account_id())
  ));

drop policy if exists "Users manage their watchlist" on public.watchlist_items;
create policy "Users manage their watchlist"
  on public.watchlist_items for all to blocklens_app
  using ((select public.current_account_id()) = user_id)
  with check ((select public.current_account_id()) = user_id);

drop policy if exists "Users manage their alerts" on public.price_alerts;
create policy "Users manage their alerts"
  on public.price_alerts for all to blocklens_app
  using ((select public.current_account_id()) = user_id)
  with check ((select public.current_account_id()) = user_id);

-- Automatic exposure is intentionally opt-in. These grants are only for signed-in users.
grant select, insert, update on public.profiles to blocklens_app;
grant select, insert, update, delete on public.portfolios to blocklens_app;
grant select, insert, update, delete on public.portfolio_positions to blocklens_app;
grant select, insert, update, delete on public.watchlist_items to blocklens_app;
grant select, insert, update, delete on public.price_alerts to blocklens_app;

-- BlockLens history for saved AI briefs and portfolio position activity.
-- Run after 0001_blocklens_accounts.sql.

create table if not exists public.ai_analysis_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
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
  user_id uuid not null references public.profiles(id) on delete cascade,
  coin_id text not null check (coin_id ~ '^[a-z0-9-]{1,100}$'),
  action text not null check (action in ('added', 'updated', 'removed')),
  quantity numeric(40, 18) not null check (quantity >= 0),
  average_cost numeric(40, 18) not null check (average_cost >= 0),
  currency text not null check (currency in ('usd', 'eur', 'gbp', 'ngn')),
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.paper_futures_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade unique,
  balance numeric(40, 18) not null check (balance >= 0),
  realized_pnl numeric(40, 18) not null default 0,
  positions jsonb not null default '[]'::jsonb,
  orders jsonb not null default '[]'::jsonb,
  trades jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists ai_analysis_history_user_created_idx
  on public.ai_analysis_history(user_id, created_at desc);
create index if not exists position_history_user_created_idx
  on public.position_history(user_id, created_at desc);
create index if not exists paper_futures_accounts_user_id_idx
  on public.paper_futures_accounts(user_id);

alter table public.ai_analysis_history enable row level security;
alter table public.position_history enable row level security;
alter table public.paper_futures_accounts enable row level security;

drop policy if exists "Users manage their AI analysis history" on public.ai_analysis_history;
create policy "Users manage their AI analysis history"
  on public.ai_analysis_history for all to blocklens_app
  using ((select public.current_account_id()) = user_id)
  with check ((select public.current_account_id()) = user_id);

drop policy if exists "Users manage their position history" on public.position_history;
create policy "Users manage their position history"
  on public.position_history for all to blocklens_app
  using ((select public.current_account_id()) = user_id)
  with check ((select public.current_account_id()) = user_id);

drop policy if exists "Users manage their paper futures account" on public.paper_futures_accounts;
create policy "Users manage their paper futures account"
  on public.paper_futures_accounts for all to blocklens_app
  using ((select public.current_account_id()) = user_id)
  with check ((select public.current_account_id()) = user_id);

grant select, insert, update, delete on public.ai_analysis_history to blocklens_app;
grant select, insert, update, delete on public.position_history to blocklens_app;
grant select, insert, update, delete on public.paper_futures_accounts to blocklens_app;
-- Bound shared history storage and provide an atomic, server-only AI quota.
-- Run after 0003_paper_futures_orders.sql.

create table if not exists public.ai_analysis_rate_limits (
  key_hash text primary key check (key_hash ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz not null default timezone('utc', now()),
  request_count integer not null default 0 check (request_count >= 0)
);

create table if not exists public.ai_analysis_global_limit (
  singleton boolean primary key default true check (singleton),
  day_started_at date not null default current_date,
  request_count integer not null default 0 check (request_count >= 0)
);

create table if not exists public.history_write_limits (
  user_id uuid not null references public.profiles(id) on delete cascade,
  history_kind text not null check (history_kind in ('ai', 'position')),
  window_started_at timestamptz not null default timezone('utc', now()),
  request_count integer not null default 0 check (request_count >= 0),
  primary key (user_id, history_kind)
);

insert into public.ai_analysis_global_limit (singleton)
values (true)
on conflict (singleton) do nothing;

alter table public.ai_analysis_rate_limits enable row level security;
alter table public.ai_analysis_global_limit enable row level security;
alter table public.history_write_limits enable row level security;

revoke all on public.ai_analysis_rate_limits from public, blocklens_app;
revoke all on public.ai_analysis_global_limit from public, blocklens_app;
revoke all on public.history_write_limits from public, blocklens_app;

create or replace function public.consume_ai_analysis_quota(p_key_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  now_utc timestamptz := pg_catalog.now();
  current_window timestamptz;
  current_key_count integer;
  current_day date;
  current_global_count integer;
begin
  if p_key_hash is null or p_key_hash !~ '^[a-f0-9]{64}$' then
    return false;
  end if;

  -- Serialize admission so the global budget cannot be exceeded by concurrent calls.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('blocklens-ai-global', 0));
  insert into public.ai_analysis_global_limit (singleton)
  values (true)
  on conflict (singleton) do nothing;
  select day_started_at, request_count
    into current_day, current_global_count
    from public.ai_analysis_global_limit
    where singleton = true
    for update;
  if current_day <> (now_utc at time zone 'UTC')::date then
    current_day := (now_utc at time zone 'UTC')::date;
    current_global_count := 0;
    delete from public.ai_analysis_rate_limits
      where window_started_at < now_utc - interval '1 day';
  end if;
  if current_global_count >= 2000 then
    return false;
  end if;

  insert into public.ai_analysis_rate_limits (key_hash, window_started_at, request_count)
  values (p_key_hash, now_utc, 0)
  on conflict (key_hash) do nothing;
  select window_started_at, request_count
    into current_window, current_key_count
    from public.ai_analysis_rate_limits
    where key_hash = p_key_hash
    for update;
  if now_utc - current_window >= interval '1 minute' then
    current_window := now_utc;
    current_key_count := 0;
  end if;
  if current_key_count >= 8 then
    return false;
  end if;

  update public.ai_analysis_global_limit
    set day_started_at = current_day,
        request_count = current_global_count + 1
    where singleton = true;
  update public.ai_analysis_rate_limits
    set window_started_at = current_window,
        request_count = current_key_count + 1
    where key_hash = p_key_hash;
  return true;
end;
$$;

revoke all on function public.consume_ai_analysis_quota(text) from public, blocklens_app;


create or replace function public.enforce_ai_analysis_history_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.current_account_id();
  quota_window timestamptz;
  quota_count integer;
begin
  if caller_id is null or caller_id <> new.user_id then
    raise exception 'History ownership check failed' using errcode = '42501';
  end if;
  if pg_catalog.char_length(new.coin_name) > 80
     or pg_catalog.char_length(new.coin_symbol) > 20
     or pg_catalog.octet_length(new.analysis::text) > 65536 then
    raise exception 'AI analysis history payload exceeds its storage limit'
      using errcode = '22001';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ai-history:' || new.user_id::text, 0));
  if tg_op = 'INSERT' then
    insert into public.history_write_limits (user_id, history_kind)
    values (new.user_id, 'ai')
    on conflict (user_id, history_kind) do nothing;
    select window_started_at, request_count
      into quota_window, quota_count
      from public.history_write_limits
      where user_id = new.user_id and history_kind = 'ai'
      for update;
    if pg_catalog.now() - quota_window >= interval '1 minute' then
      quota_window := pg_catalog.now();
      quota_count := 0;
    end if;
    if quota_count >= 20 then
      raise exception 'AI analysis history write rate exceeded' using errcode = '54000';
    end if;
    update public.history_write_limits
      set window_started_at = quota_window, request_count = quota_count + 1
      where user_id = new.user_id and history_kind = 'ai';
    delete from public.ai_analysis_history
      where user_id = new.user_id
        and id in (
          select id from public.ai_analysis_history
          where user_id = new.user_id
          order by created_at desc, id desc
          offset 49
        );
  end if;
  return new;
end;
$$;

create or replace function public.enforce_position_history_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.current_account_id();
  quota_window timestamptz;
  quota_count integer;
begin
  if caller_id is null or caller_id <> new.user_id then
    raise exception 'History ownership check failed' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('position-history:' || new.user_id::text, 0));
  if tg_op = 'INSERT' then
    insert into public.history_write_limits (user_id, history_kind)
    values (new.user_id, 'position')
    on conflict (user_id, history_kind) do nothing;
    select window_started_at, request_count
      into quota_window, quota_count
      from public.history_write_limits
      where user_id = new.user_id and history_kind = 'position'
      for update;
    if pg_catalog.now() - quota_window >= interval '1 minute' then
      quota_window := pg_catalog.now();
      quota_count := 0;
    end if;
    if quota_count >= 120 then
      raise exception 'Position history write rate exceeded' using errcode = '54000';
    end if;
    update public.history_write_limits
      set window_started_at = quota_window, request_count = quota_count + 1
      where user_id = new.user_id and history_kind = 'position';
    delete from public.position_history
      where user_id = new.user_id
        and id in (
          select id from public.position_history
          where user_id = new.user_id
          order by created_at desc, id desc
          offset 99
        );
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_ai_analysis_history_limits() from public, blocklens_app;
revoke all on function public.enforce_position_history_limits() from public, blocklens_app;

drop trigger if exists enforce_ai_analysis_history_limits on public.ai_analysis_history;
create trigger enforce_ai_analysis_history_limits
  before insert or update on public.ai_analysis_history
  for each row execute function public.enforce_ai_analysis_history_limits();

drop trigger if exists enforce_position_history_limits on public.position_history;
create trigger enforce_position_history_limits
  before insert or update on public.position_history
  for each row execute function public.enforce_position_history_limits();

-- Bring existing deployments under the same deterministic retention bounds.
with ranked as (
  select id, pg_catalog.row_number() over (
    partition by user_id order by created_at desc, id desc
  ) as row_number
  from public.ai_analysis_history
)
delete from public.ai_analysis_history
where id in (select id from ranked where row_number > 50);

with ranked as (
  select id, pg_catalog.row_number() over (
    partition by user_id order by created_at desc, id desc
  ) as row_number
  from public.position_history
)
delete from public.position_history
where id in (select id from ranked where row_number > 100);

create policy "Users can create their profile" on public.profiles
  for insert to blocklens_app with check (public.current_account_id() = id);
-- The browser role cannot call quotas or write quota tables. Only the owner
-- connection used by the server can call this function.
revoke all on schema public from public;
grant usage on schema public to blocklens_app;
