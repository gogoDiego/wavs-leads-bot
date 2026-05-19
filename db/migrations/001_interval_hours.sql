-- Migration: schedule_cron (string) → interval_hours (int) + last_run_at.
-- Run once in the Supabase SQL editor against an existing project.
-- Idempotent: re-running is safe.

alter table funnels
  add column if not exists interval_hours int not null default 6,
  add column if not exists last_run_at    timestamptz;

-- Best-effort mapping for the cron strings the simple-mode modal used to set.
update funnels set interval_hours = 3  where schedule_cron = '0 */3 * * *'   and interval_hours = 6;
update funnels set interval_hours = 24 where schedule_cron = '0 9 * * *'     and interval_hours = 6;
update funnels set interval_hours = 8  where schedule_cron = '0 9,13,17 * * *' and interval_hours = 6;

-- Drop the old column. (Comment this out if you'd rather keep it around for a while.)
alter table funnels drop column if exists schedule_cron;
