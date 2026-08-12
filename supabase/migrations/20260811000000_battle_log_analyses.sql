-- AI match analysis for battle logs.
--
-- Analyses live in their own table rather than as columns on `logs` for two reasons:
--   1. Every read of `logs` in the app is `select()` / `select('*')`, so a multi-KB
--      jsonb column would ship on every home-page widget render and list page.
--   2. `logs` is publicly SELECT-able (the log detail page renders link previews for
--      logged-out visitors). An analysis column would inherit that policy and expose
--      paid model output to anyone with a log id.
--
-- Writes are performed exclusively by the service-role client from
-- app/api/battle-logs/[id]/analysis/route.ts. This table therefore has a SELECT
-- policy and no write policies at all: without them PostgREST rejects every
-- insert/update/delete from `anon` and `authenticated`, which stops a user from
-- forging a row with a hand-crafted cache_key to seed themselves a free analysis.
--
-- NOTE: `logs.id` is assumed to be `uuid`. Verify before applying:
--   select column_name, data_type from information_schema.columns
--   where table_schema = 'public' and table_name = 'logs' and column_name = 'id';
-- If it is `text`, change `log_id uuid` to `log_id text` below.

create table if not exists public.battle_log_analyses (
  id               uuid primary key default gen_random_uuid(),
  log_id           uuid not null references public.logs (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,

  -- Invalidation. cache_key is a SHA-256 over every prompt input (log text,
  -- user-editable archetype/format fields, decklist fingerprint, screen name);
  -- pipeline_version is the manual lever, bumped when the prompt or schema changes.
  cache_key        text not null,
  pipeline_version integer not null,

  -- Lifecycle. The row is written as 'pending' before the model is called so a
  -- function timeout leaves a durable record instead of a silent loss.
  status           text not null default 'pending'
                     check (status in ('pending', 'succeeded', 'failed')),
  error_code       text,

  -- Payload. `result` holds only the sanitized, card-validated analysis;
  -- `warnings` records what the validator dropped or corrected.
  model            text not null,
  result           jsonb,
  warnings         jsonb not null default '[]'::jsonb,
  grounding        jsonb not null default '{}'::jsonb,

  -- Cost and observability.
  input_tokens     integer,
  output_tokens    integer,
  latency_ms       integer,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- One row per (log, exact input fingerprint). Doubles as the concurrency lock:
-- a second simultaneous POST upserts onto the in-flight pending row rather than
-- starting a second billed generation.
create unique index if not exists battle_log_analyses_log_cache_key_uidx
  on public.battle_log_analyses (log_id, cache_key);

-- "Show me the newest analysis for this log", for the GET handler.
create index if not exists battle_log_analyses_log_created_idx
  on public.battle_log_analyses (log_id, created_at desc);

-- Usage reporting and the future per-user quota.
create index if not exists battle_log_analyses_user_created_idx
  on public.battle_log_analyses (user_id, created_at desc);

-- Reaper for rows stranded by a function timeout.
create index if not exists battle_log_analyses_pending_idx
  on public.battle_log_analyses (created_at)
  where status = 'pending';

alter table public.battle_log_analyses enable row level security;

drop policy if exists battle_log_analyses_select_own on public.battle_log_analyses;
create policy battle_log_analyses_select_own
  on public.battle_log_analyses
  for select
  to authenticated
  using (auth.uid() = user_id);

-- Belt and braces against Supabase's default schema grants. service_role
-- bypasses RLS entirely and is unaffected.
revoke insert, update, delete on public.battle_log_analyses from anon, authenticated;

-- `logs` has no updated_at and `decklists` maintains its own in app code; do it in
-- the database here so a partial update cannot leave a stale timestamp behind.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists battle_log_analyses_set_updated_at on public.battle_log_analyses;
create trigger battle_log_analyses_set_updated_at
  before update on public.battle_log_analyses
  for each row execute function public.set_updated_at();
