# Running Training Court on your own Supabase + Vercel

This repo was originally built against a Supabase project (`buddy-poffin`) and a
Vercel project you may not have access to. Everything below gets you a working
instance from scratch.

---

## 1. Supabase

### Create the project

1. Create a new project at [supabase.com/dashboard](https://supabase.com/dashboard).
2. Note the region — put your Vercel deployment in the same one.
3. From **Project Settings → API**, copy:
   - the **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - the **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - the **service_role** key → `SUPABASE_SERVICE_ROLE_KEY` (server-only — never expose this to the browser)

### Apply the schema

Run these two files **in order** in the SQL Editor:

1. `supabase/migrations/00000000000000_initial_schema.sql` — every table, view, RPC, trigger, and RLS policy the app needs
2. `supabase/migrations/20260811000000_battle_log_analyses.sql` — the AI match analysis table

Both are idempotent, so re-running them is safe.

Or with the CLI (`supabase` is already a devDependency):

```bash
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

### Verify

```sql
-- 12 tables
select table_name from information_schema.tables
where table_schema = 'public' order by table_name;

-- 8 functions
select routine_name from information_schema.routines
where routine_schema = 'public' order by routine_name;

-- every table should report rowsecurity = true
select tablename, rowsecurity from pg_tables where schemaname = 'public';
```

Then sign up a user through the app and confirm a matching row appears in
`"user data"` — that proves the `on_auth_user_created` trigger fired.

### Auth settings

Under **Authentication → URL Configuration**:

- **Site URL**: your production domain (e.g. `https://your-app.vercel.app`)
- **Redirect URLs**: add `http://localhost:3000/**` and `https://your-app.vercel.app/**`

For password reset to work, set the **Reset Password** email template to:

```
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password
```

### Two things to decide before going live

**`logs` is world-readable.** `app/ptcg/logs/[id]/page.tsx` renders server-side
metadata for link previews and does not require auth, so shared battle logs work
for logged-out visitors. If you don't want that, swap the `logs_select_public`
policy for the owner-only variant commented directly beneath it in the migration.
The app keeps working; shared URLs just redirect anonymous visitors home.

**`friend requests` is permissive.** A signed-in user holding a request UUID can
read it and decrement `uses_remaining` — that's how accepting an invite works.
Move the decrement into a `security definer` RPC if you want it unforgeable.

### Make yourself an admin

The AI analysis panel is gated behind `isPremiumUser`, which is a hardcoded list
in [components/admin/admin.utils.ts](../components/admin/admin.utils.ts). Replace
those UUIDs with your own user id (from **Authentication → Users**) or you will
never see the panel.

---

## 2. Vercel

```bash
npm i -g vercel@latest    # the installed CLI is several majors behind
vercel login
vercel link               # create a new project when prompted
```

### Environment variables

```bash
vercel env add NEXT_PUBLIC_SUPABASE_URL       # all environments
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY  # all environments
vercel env add SUPABASE_SERVICE_ROLE_KEY      # production + preview only
vercel env add ANTHROPIC_API_KEY              # production + preview only
vercel env add NEXT_PUBLIC_SITE_URL           # your production URL
```

| Variable | Scope | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | all | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | all | Browser Supabase client |
| `SUPABASE_SERVICE_ROLE_KEY` | server | Account deletion + writing analyses. **Never** prefix with `NEXT_PUBLIC_` |
| `ANTHROPIC_API_KEY` | server | Match analysis. An `sk-ant-api03-…` key from console.anthropic.com |
| `NEXT_PUBLIC_SITE_URL` | all | Auth redirect base |
| `AI_ANALYSIS_ENABLED` | server, optional | Set to `false` to kill match analysis without redeploying |
| `AI_ANALYSIS_TIMEOUT_MS` | server, optional | Server-side abort budget, default `90000` |

Then pull them locally:

```bash
vercel env pull .env.local
```

### Model provider

This instance calls **Anthropic directly** rather than going through the Vercel
AI Gateway, because the key in use is an `sk-ant-api03-…` key (the gateway
requires its own `vck_…` key and returns 401 for an Anthropic one).

The tradeoff: there is no gateway-level spend cap. Set usage limits in the
[Anthropic console](https://console.anthropic.com/settings/limits) instead — it
is the only cost control that does not depend on the app code being correct. The
in-app brakes (per-log cache, `maxOutputTokens`, the admin gate) sit upstream of
it.

To switch to the Gateway later: create a `vck_…` key, set `AI_GATEWAY_API_KEY`,
and change `lib/server/ai/battle-log-analysis/generate.ts` back to a bare
`'anthropic/claude-sonnet-5'` model string (dropping the `@ai-sdk/anthropic`
import), plus `ANALYSIS_MODEL` in `cache-key.ts`.

### Function timeout

`app/api/battle-logs/[id]/analysis/route.ts` declares `maxDuration = 300`. On
Hobby without Fluid Compute this is silently clamped to 60s. The route defends
itself with an internal 90s `AbortController`, so a clamp shows up as a `failed`
row with `error_code = 'timeout'` rather than a hang — but check your plan under
**Settings → Functions** before relying on long generations.

### Deploy

```bash
vercel            # preview
vercel --prod     # production
```

---

## 3. Local development

```bash
npm install
vercel env pull .env.local   # or write it by hand from the table above
npm run dev
```

For Playwright, add to `.env.local`:

```
TEST_USER_EMAIL=...
TEST_USER_PASSWORD=...
```

That account must exist in your Supabase project and have `live_screen_name` set
to `test` — `e2e/battle-log-paste.spec.ts` uses fixtures with that player name.

```bash
npm test                    # jest
npm run test:e2e            # playwright
npm run translations:check  # CI enforces this on every push
```

---

## 4. What is reconstructed, and what to double-check

The original schema was never committed — it lived in the Supabase dashboard.
`00000000000000_initial_schema.sql` is a reconstruction from `database.types.ts`
and from how the app actually queries the database. It was verified against a
real PostgreSQL 16 instance: both migrations apply cleanly and idempotently,
every column matches `database.types.ts`, the RPCs return correct values on
seeded data, and RLS was confirmed to block cross-user reads and writes.

Two areas are inference rather than recovery, and are worth a look once you have
real data:

- **RPC bodies.** Rewritten from their declared return types. `collapse_round_result`
  mirrors `convertGameResultsToRoundResult`, and `getusertournamentresults`
  excludes ID/No-show/Bye rounds and counts ties as ⅓ of a win to match
  `getMatchupWinRate`. Log a few tournaments and confirm `/ptcg/stats` shows the
  records you expect.
- **RLS policies.** Written to match observed app behavior, not recovered. The
  two judgement calls are flagged above.

One known gap: `notifications` is created by the migration (RealtimeProvider
subscribes to it) but is still absent from `database.types.ts`, which is
pre-existing drift. Nothing queries it through the typed client, so it compiles
either way.
