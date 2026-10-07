-- Firebase UIDs are arbitrary strings (up to 128 characters). Widen account
-- IDs without changing their values so imported legacy UUIDs retain ownership.
-- The runner wraps this migration in a transaction: policies and FK checks
-- are restored before any other connection can see the converted schema.

create temporary table blocklens_auth_policies on commit drop as
select * from pg_policies
where schemaname = 'public' and tablename in (
  'profiles', 'portfolios', 'portfolio_positions', 'watchlist_items',
  'price_alerts', 'ai_analysis_history', 'position_history', 'paper_futures_accounts'
);

create temporary table blocklens_auth_foreign_keys on commit drop as
select n.nspname as schemaname, t.relname as tablename, c.conname,
  pg_get_constraintdef(c.oid) as definition
from pg_constraint c
join pg_class t on t.oid = c.conrelid
join pg_namespace n on n.oid = t.relnamespace
where c.contype = 'f' and c.confrelid = 'public.profiles'::regclass;

do $$ declare item record; begin
  for item in select * from blocklens_auth_policies loop
    execute format('drop policy %I on %I.%I', item.policyname, item.schemaname, item.tablename);
  end loop;
  for item in select * from blocklens_auth_foreign_keys loop
    execute format('alter table %I.%I drop constraint %I', item.schemaname, item.tablename, item.conname);
  end loop;
end $$;

drop function public.current_account_id();
alter table public.profiles alter column id type text using id::text;
alter table public.profiles add constraint profiles_firebase_uid_length check (char_length(id) between 1 and 128);

do $$ declare account_table text; begin
  foreach account_table in array array[
    'portfolios', 'watchlist_items', 'price_alerts', 'ai_analysis_history',
    'position_history', 'paper_futures_accounts', 'history_write_limits'
  ] loop
    execute format('alter table public.%I alter column user_id type text using user_id::text', account_table);
  end loop;
end $$;

create function public.current_account_id()
returns text language sql stable
as $$ select nullif(current_setting('blocklens.user_id', true), '') $$;
revoke all on function public.current_account_id() from public;
grant execute on function public.current_account_id() to blocklens_app;

-- Preserve the complete retention/quota functions and their permissions,
-- changing only the type of the account identifier in each trigger.
do $$ declare history_function text; begin
  foreach history_function in array array[
    'public.enforce_ai_analysis_history_limits()',
    'public.enforce_position_history_limits()'
  ] loop
    execute replace(pg_get_functiondef(history_function::regprocedure), 'caller_id uuid', 'caller_id text');
  end loop;
end $$;

do $$ declare item record; role_list text; statement text; begin
  for item in select * from blocklens_auth_foreign_keys loop
    execute format('alter table %I.%I add constraint %I %s', item.schemaname, item.tablename, item.conname, item.definition);
  end loop;
  for item in select * from blocklens_auth_policies loop
    select string_agg(quote_ident(role_name::text), ', ') into role_list from unnest(item.roles) role_name;
    statement := format('create policy %I on %I.%I as %s for %s to %s',
      item.policyname, item.schemaname, item.tablename, item.permissive, item.cmd, role_list);
    if item.qual is not null then statement := statement || ' using (' || item.qual || ')'; end if;
    if item.with_check is not null then statement := statement || ' with check (' || item.with_check || ')'; end if;
    execute statement;
  end loop;
end $$;
