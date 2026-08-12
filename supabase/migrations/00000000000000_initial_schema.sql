-- ============================================================================
-- Training Court — full database build-out
-- ============================================================================
--
-- Run this ONCE against a brand-new Supabase project, before
-- 20260811000000_battle_log_analyses.sql.
--
-- WHY THIS FILE EXISTS
-- The live schema was built by hand in the Supabase dashboard and never
-- committed; `supabase/migrations/` held only four files, two of which
-- (`profiles`, `decks`) describe tables the app no longer uses. This file
-- reconstructs the real schema from `database.types.ts` and from how the
-- application actually queries it, so a fresh project can run the app.
--
-- WHAT IS RECONSTRUCTED vs. VERBATIM
--   * Table columns and types: taken from `database.types.ts`. High confidence.
--   * Foreign keys: inferred. `database.types.ts` reports most user FKs as
--     pointing at the `top_5_users_battle_logs` VIEW, which is a quirk of the
--     type generator, not a real constraint. They point at `auth.users` here.
--   * RLS policies: NOT recoverable — they lived only in the dashboard. These
--     are written to match observed application behavior. Read section 6
--     before trusting them; one of them is deliberately permissive.
--   * RPC function bodies: NOT recoverable. Rewritten from their declared
--     return types in `database.types.ts` and from the code that consumes them.
--     Verify the matchup numbers against a few known results after seeding.
--
-- NAMING WARNINGS (these are real, and they bite)
--   * Three tables have spaces: "user data", "tournament rounds",
--     "friend requests". They must always be quoted.
--   * The owner column is "user" (a reserved word) on most tables, but
--     `user_id` on `decklists` and `feedback`.
--   * On "tournament rounds", `deck` is the OPPONENT's deck. The user's own
--     deck for the event lives on `tournaments.deck`.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ============================================================================
-- 1. PROFILE TABLE
-- ============================================================================
-- 1:1 with auth.users. `live_screen_name` is load-bearing: it is how the battle
-- log parser decides which player in a log is the current user. Without it the
-- paste box is disabled and match analysis refuses to run.

create table if not exists public."user data" (
  id               uuid primary key references auth.users (id) on delete cascade,
  created_at       timestamptz not null default now(),
  avatar           text,
  live_screen_name text,
  preferred_games  text[] default array['pokemon-tcg']::text[]
);

-- ============================================================================
-- 2. DECKLISTS
-- ============================================================================
-- `cards` is a JSON array of DeckEntry objects (see DeckbuilderClient.tsx).
-- `content_hash` is a printing-agnostic SHA-256 over qty + normalized name +
-- card text, written by the client on save. It is nullable for legacy rows,
-- which is why the analysis cache key falls back to `updated_at`.

create table if not exists public.decklists (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  name         text not null,
  cards        jsonb not null default '[]'::jsonb,
  archetype    text,
  format       text,
  game         text not null default 'pokemon-tcg',
  content_hash text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists decklists_user_id_idx on public.decklists (user_id, updated_at desc);

-- ============================================================================
-- 3. PTCG: BATTLE LOGS, TOURNAMENTS, ROUNDS
-- ============================================================================

-- The raw PTCG Live text in `log` is the only durable record; `archetype`,
-- `result`, and `turn_order` are denormalized caches written at insert time,
-- and the log is re-parsed from scratch on every page view.
create table if not exists public.logs (
  id            uuid primary key default gen_random_uuid(),
  "user"        uuid not null references auth.users (id) on delete cascade,
  created_at    timestamptz not null default now(),
  log           text not null,
  format        text not null default '',
  archetype     text,
  opp_archetype text,
  result        text,
  turn_order    text,
  notes         text,
  decklist_id   uuid references public.decklists (id) on delete set null
);

create index if not exists logs_user_created_at_idx on public.logs ("user", created_at desc);
create index if not exists logs_user_decklist_id_idx on public.logs ("user", decklist_id);

create table if not exists public.tournaments (
  id          uuid primary key default gen_random_uuid(),
  "user"      uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  name        text not null,
  -- timestamptz, not date: the client normalizes to UTC noon (toUtcNoon in
  -- TournamentCreate.tsx) so a tournament never renders a day early or late in
  -- a non-UTC timezone. That trick only works if the time survives the round trip.
  date_from   timestamptz not null,
  date_to     timestamptz not null,
  category    text,
  format      text,
  deck        text,          -- the USER's deck for this event
  decklist_id uuid references public.decklists (id) on delete set null,
  placement   text,
  hat_type    text,
  notes       text
);

create index if not exists tournaments_user_date_idx on public.tournaments ("user", date_from desc);

-- `result` is one entry per game in the match, e.g. {W,L,W}.
-- `turn_orders` is the parallel array of '1'/'2'.
-- `deck` is the OPPONENT's deck. See the naming warning at the top.
create table if not exists public."tournament rounds" (
  id               uuid primary key default gen_random_uuid(),
  "user"           uuid not null references auth.users (id) on delete cascade,
  tournament       uuid not null references public.tournaments (id) on delete cascade,
  created_at       timestamptz not null default now(),
  round_num        integer not null,
  result           text[] not null default '{}'::text[],
  turn_orders      text[],
  deck             text,
  match_end_reason text
);

create index if not exists tournament_rounds_tournament_idx
  on public."tournament rounds" (tournament, round_num);
create index if not exists tournament_rounds_user_idx on public."tournament rounds" ("user");

-- ============================================================================
-- 4. POKEMON POCKET MIRROR TABLES
-- ============================================================================

create table if not exists public.pocket_games (
  id         bigint generated by default as identity primary key,
  "user"     uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  deck       text not null,
  opp_deck   text not null,
  result     text not null
);

create index if not exists pocket_games_user_idx on public.pocket_games ("user", created_at desc);

create table if not exists public.pocket_tournaments (
  id         uuid primary key default gen_random_uuid(),
  "user"     uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  name       text not null,
  date_from  timestamptz not null,
  date_to    timestamptz not null,
  category   text,
  format     text,
  deck       text,
  placement  text,
  hat_type   text,
  notes      text
);

create table if not exists public.pocket_tournament_rounds (
  id               uuid primary key default gen_random_uuid(),
  "user"           uuid not null references auth.users (id) on delete cascade,
  tournament       uuid not null references public.pocket_tournaments (id) on delete cascade,
  created_at       timestamptz not null default now(),
  round_num        integer not null,
  result           text[] not null default '{}'::text[],
  turn_orders      text[],
  deck             text,
  match_end_reason text
);

create index if not exists pocket_tournament_rounds_tournament_idx
  on public.pocket_tournament_rounds (tournament, round_num);

-- ============================================================================
-- 5. SOCIAL AND META
-- ============================================================================

-- A share link. The RECIPIENT reads it and decrements uses_remaining, which is
-- why its policies are looser than everything else here.
create table if not exists public."friend requests" (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  user_sending   uuid not null references auth.users (id) on delete cascade,
  uses_remaining integer not null default 1
);

-- Stored bidirectionally: accepting a request inserts two rows.
create table if not exists public.friends (
  id         bigint generated by default as identity primary key,
  created_at timestamptz not null default now(),
  "user"     uuid not null references auth.users (id) on delete cascade,
  friend     uuid not null references auth.users (id) on delete cascade,
  unique ("user", friend)
);

create index if not exists friends_user_idx on public.friends ("user");

create table if not exists public.feedback (
  id           bigint generated by default as identity primary key,
  created_at   timestamptz not null default now(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  feature_name text not null,
  bug_type     text,
  description  text,
  dev_notes    text,
  is_fixed     boolean default false
);

-- Absent from `database.types.ts` but subscribed to by RealtimeProvider.
-- Shape follows the Notification interface in app/recoil/atoms/notifications.ts.
create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  "user"       uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  type         text not null,
  title        text not null,
  message      text not null default '',
  read         boolean not null default false,
  action_url   text,
  action_label text,
  expires_at   timestamptz,
  metadata     jsonb not null default '{}'::jsonb
);

create index if not exists notifications_user_idx on public.notifications ("user", created_at desc);

-- ============================================================================
-- 6. ROW LEVEL SECURITY
-- ============================================================================
-- The app writes directly from the browser with the anon key and filters every
-- query by user id in application code. RLS is what actually enforces that.
--
-- >>> READ THIS BEFORE GOING TO PRODUCTION <<<
-- `logs` is world-readable on purpose. app/ptcg/logs/[id]/page.tsx renders a
-- server-side generateMetadata for link previews and passes requireAuth=false,
-- so a shared battle log must be readable by logged-out visitors. If you do not
-- want public share links, replace the logs SELECT policy with the owner-only
-- variant commented beneath it — the app keeps working, but shared URLs will
-- redirect anonymous visitors to the home page.

alter table public."user data"               enable row level security;
alter table public.decklists                 enable row level security;
alter table public.logs                      enable row level security;
alter table public.tournaments               enable row level security;
alter table public."tournament rounds"       enable row level security;
alter table public.pocket_games              enable row level security;
alter table public.pocket_tournaments        enable row level security;
alter table public.pocket_tournament_rounds  enable row level security;
alter table public."friend requests"         enable row level security;
alter table public.friends                   enable row level security;
alter table public.feedback                  enable row level security;
alter table public.notifications             enable row level security;

-- ---- user data -------------------------------------------------------------
-- Readable by any signed-in user: friends lists join this table to show another
-- person's avatar and screen name.
drop policy if exists user_data_select on public."user data";
create policy user_data_select on public."user data"
  for select to authenticated using (true);

drop policy if exists user_data_insert on public."user data";
create policy user_data_insert on public."user data"
  for insert to authenticated with check (auth.uid() = id);

drop policy if exists user_data_update on public."user data";
create policy user_data_update on public."user data"
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- ---- decklists (owner only; note the column is user_id, not "user") --------
drop policy if exists decklists_all_own on public.decklists;
create policy decklists_all_own on public.decklists
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---- logs ------------------------------------------------------------------
drop policy if exists logs_select_public on public.logs;
create policy logs_select_public on public.logs
  for select to anon, authenticated using (true);

-- Owner-only alternative — swap for the policy above to disable public sharing:
-- create policy logs_select_own on public.logs
--   for select to authenticated using (auth.uid() = "user");

drop policy if exists logs_insert_own on public.logs;
create policy logs_insert_own on public.logs
  for insert to authenticated with check (auth.uid() = "user");

drop policy if exists logs_update_own on public.logs;
create policy logs_update_own on public.logs
  for update to authenticated using (auth.uid() = "user") with check (auth.uid() = "user");

drop policy if exists logs_delete_own on public.logs;
create policy logs_delete_own on public.logs
  for delete to authenticated using (auth.uid() = "user");

-- ---- tournaments, rounds, pocket mirrors (owner only) ----------------------
drop policy if exists tournaments_all_own on public.tournaments;
create policy tournaments_all_own on public.tournaments
  for all to authenticated using (auth.uid() = "user") with check (auth.uid() = "user");

drop policy if exists tournament_rounds_all_own on public."tournament rounds";
create policy tournament_rounds_all_own on public."tournament rounds"
  for all to authenticated using (auth.uid() = "user") with check (auth.uid() = "user");

drop policy if exists pocket_games_all_own on public.pocket_games;
create policy pocket_games_all_own on public.pocket_games
  for all to authenticated using (auth.uid() = "user") with check (auth.uid() = "user");

drop policy if exists pocket_tournaments_all_own on public.pocket_tournaments;
create policy pocket_tournaments_all_own on public.pocket_tournaments
  for all to authenticated using (auth.uid() = "user") with check (auth.uid() = "user");

drop policy if exists pocket_tournament_rounds_all_own on public.pocket_tournament_rounds;
create policy pocket_tournament_rounds_all_own on public.pocket_tournament_rounds
  for all to authenticated using (auth.uid() = "user") with check (auth.uid() = "user");

-- ---- friend requests -------------------------------------------------------
-- Deliberately permissive: the whole point is that a DIFFERENT user opens the
-- link, reads the row, and decrements uses_remaining. Anyone signed in who
-- holds a request UUID can therefore read and decrement it. That is the
-- existing product behavior; tighten it with a server-side RPC if you want the
-- decrement to be unforgeable.
drop policy if exists friend_requests_select on public."friend requests";
create policy friend_requests_select on public."friend requests"
  for select to authenticated using (true);

drop policy if exists friend_requests_insert_own on public."friend requests";
create policy friend_requests_insert_own on public."friend requests"
  for insert to authenticated with check (auth.uid() = user_sending);

drop policy if exists friend_requests_update on public."friend requests";
create policy friend_requests_update on public."friend requests"
  for update to authenticated using (true) with check (true);

drop policy if exists friend_requests_delete_own on public."friend requests";
create policy friend_requests_delete_own on public."friend requests"
  for delete to authenticated using (auth.uid() = user_sending);

-- ---- friends ---------------------------------------------------------------
-- Accepting a request inserts a row where "user" is the SENDER, so the insert
-- check has to allow either side of the pair.
drop policy if exists friends_select_own on public.friends;
create policy friends_select_own on public.friends
  for select to authenticated using (auth.uid() = "user" or auth.uid() = friend);

drop policy if exists friends_insert_pair on public.friends;
create policy friends_insert_pair on public.friends
  for insert to authenticated with check (auth.uid() = "user" or auth.uid() = friend);

drop policy if exists friends_delete_own on public.friends;
create policy friends_delete_own on public.friends
  for delete to authenticated using (auth.uid() = "user" or auth.uid() = friend);

-- ---- feedback --------------------------------------------------------------
drop policy if exists feedback_insert_own on public.feedback;
create policy feedback_insert_own on public.feedback
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists feedback_select_own on public.feedback;
create policy feedback_select_own on public.feedback
  for select to authenticated using (auth.uid() = user_id);

-- ---- notifications ---------------------------------------------------------
-- Read/update own only. Inserts come from the service role.
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select to authenticated using (auth.uid() = "user");

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update to authenticated using (auth.uid() = "user") with check (auth.uid() = "user");

-- ============================================================================
-- 7. NEW-USER TRIGGER
-- ============================================================================
-- Creates the "user data" row on signup. The historical version of this
-- function wrote to a `profiles` table that no longer exists; this one targets
-- the live table. `preferred_games` accepts either shape the app has sent:
-- a JSON array (login flow) or a booleans object (signup flow).

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  games text[] := array[]::text[];
begin
  if new.raw_user_meta_data ? 'selected_games'
     and jsonb_typeof(new.raw_user_meta_data->'selected_games') = 'array' then
    games := array(select jsonb_array_elements_text(new.raw_user_meta_data->'selected_games'));

  elsif new.raw_user_meta_data ? 'games'
        and jsonb_typeof(new.raw_user_meta_data->'games') = 'object' then
    if coalesce((new.raw_user_meta_data->'games'->>'tradingCardGame')::boolean, false) then
      games := array_append(games, 'pokemon-tcg');
    end if;
    if coalesce((new.raw_user_meta_data->'games'->>'pocket')::boolean, false) then
      games := array_append(games, 'pocket');
    end if;
  end if;

  if array_length(games, 1) is null then
    games := array['pokemon-tcg'];
  end if;

  insert into public."user data" (id, preferred_games)
  values (new.id, games)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- 8. VIEWS
-- ============================================================================
-- Neither view is referenced anywhere in the application. They exist only
-- because `database.types.ts` declares them; recreated here so the generated
-- types stay accurate if you ever re-run the type generator.

create or replace view public.top_5_users_battle_logs as
  select l."user" as id, count(*) as battle_count
  from public.logs l
  group by l."user"
  order by count(*) desc
  limit 5;

create or replace view public.pilot_users as
  select distinct l."user" as "user"
  from public.logs l;

-- ============================================================================
-- 9. RPC FUNCTIONS
-- ============================================================================
-- Bodies are reconstructed from declared return types and consuming code.
-- All are SECURITY INVOKER, so RLS still applies and a caller can only ever
-- aggregate their own rows.

-- Admin dashboard: avatar usage histogram.
create or replace function public.avatar_count()
returns table (avatar text, avatar_count bigint)
language sql
stable
as $$
  select u.avatar, count(*) as avatar_count
  from public."user data" u
  where u.avatar is not null
  group by u.avatar
  order by count(*) desc;
$$;

-- Flattened rounds joined to their tournament.
create or replace function public.get_tournament_rounds_by_user(user_id uuid)
returns table (
  tournament_round_id   uuid,
  round_created_at      timestamptz,
  round_num             integer,
  tournament_id         uuid,
  tournament_name       text,
  tournament_created_at timestamptz,
  tournament_user       uuid,
  tournament_date_from  timestamptz,
  tournament_date_to    timestamptz,
  tournament_deck       text,
  tournament_category   text,
  tournament_placement  text,
  tournament_format     text
)
language sql
stable
as $$
  select r.id, r.created_at, r.round_num,
         t.id, t.name, t.created_at, t."user",
         t.date_from, t.date_to, t.deck, t.category, t.placement, t.format
  from public."tournament rounds" r
  join public.tournaments t on t.id = r.tournament
  where r."user" = user_id
  order by t.date_from desc, r.round_num asc;
$$;

-- Collapse a best-of-three result array to a single W/L/T.
-- Mirrors convertGameResultsToRoundResult in tournaments.utils.ts.
create or replace function public.collapse_round_result(result text[])
returns text
language sql
immutable
as $$
  select case
    when array_length(result, 1) = 1 then result[1]
    when array_length(result, 1) = 2 and result[1] = result[2] then result[1]
    when array_length(result, 1) = 3 then result[3]
    else 'T'
  end;
$$;

-- The unified matchup feed: one row per game across both sources.
--
-- `source` MUST be exactly 'Battle Logs' or 'Tournament Rounds' — those strings
-- are the defaults in sourceFilterAtom and are compared with includes().
--
-- For a tournament round, `deck` is the user's deck (from the tournament) and
-- `opp_deck` is the round's deck column. For a battle log it is archetype vs
-- opp_archetype. Turn order for a round uses the first game's entry.
create or replace function public.get_user_tournament_and_battle_logs_v5(user_id uuid)
returns table (
  source           text,
  deck             text,
  decklist_id      uuid,
  opp_deck         text,
  result           text,
  match_end_reason text,
  turn_order       text,
  date             timestamptz,
  format           text
)
language sql
stable
as $$
  select 'Battle Logs'::text,
         l.archetype,
         l.decklist_id,
         l.opp_archetype,
         l.result,
         null::text,
         l.turn_order,
         l.created_at,
         l.format
  from public.logs l
  where l."user" = user_id

  union all

  select 'Tournament Rounds'::text,
         t.deck,
         t.decklist_id,
         r.deck,
         public.collapse_round_result(r.result),
         r.match_end_reason,
         r.turn_orders[1],
         t.date_from,
         t.format
  from public."tournament rounds" r
  join public.tournaments t on t.id = r.tournament
  where r."user" = user_id;
$$;

-- v1/v2/v3 are dead in the current app (only v5 is called) but are declared in
-- database.types.ts. Defined as thin wrappers so the types stay honest.
create or replace function public.get_user_tournament_and_battle_logs_v3(user_id uuid)
returns table (
  source text, deck text, opp_deck text, result text,
  match_end_reason text, turn_order text, date timestamptz, format text
)
language sql
stable
as $$
  select v.source, v.deck, v.opp_deck, v.result,
         v.match_end_reason, v.turn_order, v.date, v.format
  from public.get_user_tournament_and_battle_logs_v5(user_id) v;
$$;

create or replace function public.get_user_tournament_and_battle_logs_v2(user_id uuid)
returns table (
  source text, deck text, opp_deck text, result text,
  match_end_reason text, turn_order text, date timestamptz, format text
)
language sql
stable
as $$
  select * from public.get_user_tournament_and_battle_logs_v3(user_id);
$$;

create or replace function public.get_user_tournament_and_battle_logs(user_id uuid)
returns table (
  source text, deck text, opp_deck text, result text,
  match_end_reason text, turn_order text, date timestamptz
)
language sql
stable
as $$
  select v.source, v.deck, v.opp_deck, v.result,
         v.match_end_reason, v.turn_order, v.date
  from public.get_user_tournament_and_battle_logs_v3(user_id) v;
$$;

-- Per-deck tournament win rates. Ties count as a third of a win, matching
-- getMatchupWinRate in Matchups.utils.ts. ID / No show / Bye rounds are
-- excluded, matching isImmediateMatchEndReason.
create or replace function public.getusertournamentresults(userid uuid)
returns table (
  tournament_deck text,
  round_deck      text,
  total_wins      bigint,
  total_losses    bigint,
  total_ties      bigint,
  total_matches   bigint,
  win_rate        numeric,
  tie_rate        numeric
)
language sql
stable
as $$
  with games as (
    select t.deck as tournament_deck,
           r.deck as round_deck,
           public.collapse_round_result(r.result) as result
    from public."tournament rounds" r
    join public.tournaments t on t.id = r.tournament
    where r."user" = userid
      and (r.match_end_reason is null
           or r.match_end_reason not in ('ID', 'No show', 'Bye'))
  )
  select g.tournament_deck,
         g.round_deck,
         count(*) filter (where g.result = 'W'),
         count(*) filter (where g.result = 'L'),
         count(*) filter (where g.result = 'T'),
         count(*),
         round(
           (count(*) filter (where g.result = 'W')
            + count(*) filter (where g.result = 'T') / 3.0)
           / nullif(count(*), 0), 4),
         round(count(*) filter (where g.result = 'T') / nullif(count(*), 0)::numeric, 4)
  from games g
  where g.tournament_deck is not null
  group by g.tournament_deck, g.round_deck;
$$;

-- ============================================================================
-- 10. REALTIME
-- ============================================================================
-- RealtimeProvider subscribes to postgres_changes on exactly these five tables,
-- filtered by user. Adding a table to the publication is required for those
-- subscriptions to fire.

do $$
begin
  alter publication supabase_realtime add table public.logs;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.tournaments;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public."tournament rounds";
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.friends;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null;
end $$;

-- ============================================================================
-- 11. BACKFILL
-- ============================================================================
-- If you created any auth users before installing the trigger above.

insert into public."user data" (id)
select u.id from auth.users u
where not exists (select 1 from public."user data" d where d.id = u.id);
