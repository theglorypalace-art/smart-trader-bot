-- Run this once in the Supabase SQL editor for your project.

create table if not exists traders (
  address        text primary key,
  display_name   text not null,
  active         boolean default true,
  pool           text not null default 'quality',  -- 'quality' (top by profit) or 'activity' (top by trade frequency)
  added_at       timestamptz default now(),
  pnl_30d_usd    numeric,
  roi_30d_pct    numeric,
  win_rate_pct   numeric,
  account_value  numeric,
  trades_per_day numeric,
  stats_updated_at timestamptz
);

-- One row per (telegram chat, coin) the chat wants alerts for.
create table if not exists subscriptions (
  chat_id  bigint not null,
  coin     text not null,
  created_at timestamptz default now(),
  primary key (chat_id, coin)
);

-- One row per (telegram chat, trader) the chat wants alerts for.
create table if not exists trader_subscriptions (
  chat_id         bigint not null,
  trader_address  text not null,
  created_at      timestamptz default now(),
  primary key (chat_id, trader_address)
);

-- Open position per trader+coin, used to compute entry price / hold time
-- when a close fill arrives. Overwritten on every open/increase fill.
create table if not exists open_positions (
  trader_address text not null,
  coin           text not null,
  side           text not null,        -- 'long' or 'short'
  entry_price    numeric not null,
  size           numeric not null,
  opened_at      timestamptz not null,
  updated_at     timestamptz default now(),
  primary key (trader_address, coin)
);

-- Dedup: Hyperliquid fill "tid" is unique per fill. We skip anything
-- already processed (handles WS reconnect replay).
create table if not exists seen_fills (
  tid      bigint primary key,
  seen_at  timestamptz default now()
);

-- Migration for installs that already ran this file before the 'pool'
-- and 'trades_per_day' columns existed. Safe to re-run. Must run before
-- any index below references these columns.
alter table traders add column if not exists pool text not null default 'quality';
alter table traders add column if not exists trades_per_day numeric;

create index if not exists idx_subscriptions_coin on subscriptions (coin);
create index if not exists idx_trader_subscriptions_trader on trader_subscriptions (trader_address);
create index if not exists idx_traders_active on traders (active) where active = true;
create index if not exists idx_traders_pool on traders (pool);

-- One row per Telegram chat that has ever started the bot — used for the
-- admin /customers command. Independent of what they follow.
create table if not exists bot_users (
  chat_id    bigint primary key,
  username   text,
  first_seen timestamptz default now(),
  last_seen  timestamptz default now()
);

-- Force PostgREST to pick up the schema changes above immediately.
-- Without this, Supabase's API layer can keep serving a stale cached
-- schema for a few minutes after a DDL change, causing "Could not find
-- the 'X' column of 'Y' in the schema cache" errors even though the
-- column now exists.
notify pgrst, 'reload schema';

-- ============================================================
-- AUTO-TRADING (real execution) — non-custodial, agent-wallet model.
-- Each chat_id links to their OWN Hyperliquid main account address
-- (public) and an ENCRYPTED agent wallet key (never the main account's
-- key). The bot only ever signs orders with the agent key, which cannot
-- withdraw funds — see src/crypto.js for how the key is encrypted.
-- ============================================================
create table if not exists trading_accounts (
  chat_id             bigint primary key,
  main_address        text not null,
  agent_key_ciphertext text not null,
  agent_key_iv        text not null,
  agent_key_tag       text not null,
  capital_pct         numeric not null default 5,      -- % of account risked per auto-copied trade
  max_position_usd    numeric not null default 100,     -- hard cap per trade regardless of capital_pct
  auto_trade_enabled  boolean not null default false,   -- per-user master kill switch, off by default
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

-- Which followed traders a chat wants REAL orders for, not just alerts.
-- Deliberately separate from trader_subscriptions (alert-only following).
alter table trader_subscriptions add column if not exists auto_copy boolean not null default false;

-- Permanent audit trail of every auto-copy order attempt, success or fail.
create table if not exists trade_executions (
  id              bigserial primary key,
  chat_id         bigint not null,
  trader_address  text not null,
  coin            text not null,
  side            text not null,
  usd_size        numeric,
  order_result    jsonb,
  status          text not null,   -- 'submitted' | 'failed'
  error_message   text,
  created_at      timestamptz default now()
);

create index if not exists idx_trade_executions_chat on trade_executions (chat_id, created_at desc);

-- Reload again now that the auto-trading tables/columns above exist too.
notify pgrst, 'reload schema';
