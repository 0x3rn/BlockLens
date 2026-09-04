-- Extend existing paper futures accounts with a durable pending-order ledger.
-- Run this after 0002_blocklens_history.sql for projects created before orders were added.

alter table public.paper_futures_accounts
  add column if not exists orders jsonb not null default '[]'::jsonb;

grant select, insert, update, delete on public.paper_futures_accounts to authenticated;
