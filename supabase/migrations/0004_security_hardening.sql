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
  user_id uuid not null references auth.users(id) on delete cascade,
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

revoke all on public.ai_analysis_rate_limits from public, anon, authenticated;
revoke all on public.ai_analysis_global_limit from public, anon, authenticated;
revoke all on public.history_write_limits from public, anon, authenticated;

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

revoke all on function public.consume_ai_analysis_quota(text) from public, anon, authenticated;
grant execute on function public.consume_ai_analysis_quota(text) to service_role;

create or replace function public.enforce_ai_analysis_history_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
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
  caller_id uuid := auth.uid();
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

revoke all on function public.enforce_ai_analysis_history_limits() from public, anon, authenticated;
revoke all on function public.enforce_position_history_limits() from public, anon, authenticated;

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
