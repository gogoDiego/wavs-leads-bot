-- wavs-leads-bot schema (v1)
-- Run in Supabase SQL editor. Idempotent: safe to re-run.

create extension if not exists "pgcrypto";

-- ──────────────────────────────────────────────────────────────────────────
-- funnels: one per coworker per ICP definition
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists funnels (
  id                      uuid primary key default gen_random_uuid(),
  owner_slack_id          text not null,
  name                    text not null,
  status                  text not null default 'active' check (status in ('active','paused')),

  search_queries          text[] not null default '{}',
  prompt_mode             text not null default 'simple' check (prompt_mode in ('simple','advanced')),
  simple_config           jsonb,                     -- {icp, keywords[], hard_skips[], frequency}
  relevance_prompt        text not null,             -- assembled (simple) or hand-written (advanced)

  min_score               int  not null default 7,
  velocity_floor          int  not null default 20,
  max_age_hours           int  not null default 12,
  max_per_digest          int  not null default 5,

  interval_hours          int  not null default 6,   -- how often the worker reruns this funnel
  last_run_at             timestamptz,               -- null until first run
  budget_monthly_usd      numeric(10,2) not null default 20.00,
  spent_this_month_usd    numeric(10,4) not null default 0,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  unique (owner_slack_id, lower(name))
);

create index if not exists funnels_active_idx on funnels (status) where status = 'active';

-- ──────────────────────────────────────────────────────────────────────────
-- seen_tweets: global dedupe so we never score the same tweet twice
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists seen_tweets (
  tweet_id     text primary key,
  first_seen   timestamptz not null default now()
);

-- ──────────────────────────────────────────────────────────────────────────
-- candidates: every tweet we scored (whether posted or not)
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists candidates (
  id                uuid primary key default gen_random_uuid(),
  funnel_id         uuid not null references funnels(id) on delete cascade,
  tweet_id          text not null,
  author_handle     text,
  tweet_url         text not null,
  tweet_text        text not null,
  tweet_created_at  timestamptz,

  likes             int not null default 0,
  replies           int not null default 0,
  quotes            int not null default 0,
  retweets          int not null default 0,
  velocity          numeric(10,2),

  score             int,
  suggested_angle   text,
  reasoning         text,
  posted            boolean not null default false,
  posted_ts         text,                            -- Slack message ts, for thread anchoring

  scoring_cost_usd  numeric(10,6) not null default 0,
  created_at        timestamptz not null default now(),

  unique (funnel_id, tweet_id)
);

create index if not exists candidates_funnel_idx       on candidates (funnel_id, created_at desc);
create index if not exists candidates_posted_idx       on candidates (posted_ts) where posted_ts is not null;

-- ──────────────────────────────────────────────────────────────────────────
-- feedback: per-user reactions to a card
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists feedback (
  id            uuid primary key default gen_random_uuid(),
  candidate_id  uuid not null references candidates(id) on delete cascade,
  user_slack_id text not null,
  kind          text not null check (kind in ('good','noise','hide','saved')),
  created_at    timestamptz not null default now(),
  unique (candidate_id, user_slack_id, kind)
);

create index if not exists feedback_candidate_idx on feedback (candidate_id);

-- ──────────────────────────────────────────────────────────────────────────
-- updated_at trigger for funnels
-- ──────────────────────────────────────────────────────────────────────────
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists funnels_updated_at on funnels;
create trigger funnels_updated_at
  before update on funnels
  for each row execute function set_updated_at();
