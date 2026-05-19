# wavs-leads-bot

Internal Slack bot for Layer that surfaces high-signal tweets to `#leads`, scored against per-user "funnels" (each defining an ICP + search criteria).

Two services, one repo:

- **Slack app** (`npm run slack`) — Socket Mode Bolt app. Owns slash commands, modals, button interactions.
- **Worker**     (`npm run worker`) — Cron-driven. For each active funnel: Apify fetch → dedupe → velocity filter → Claude scoring → post to `#leads`.

Hosted on Railway as two services from the same repo. Until Phase 6, run locally.

---

## Setup (what you can test today)

What's wired: `/funnel new` (simple mode) + a manually-triggered worker that fetches tweets via Apify, scores them with Claude, and posts cards to `#leads`. No cron yet, no buttons yet.

### 1. Supabase

1. Create a project at https://supabase.com.
2. Open the SQL editor → paste & run `supabase/schema.sql`.
3. Project settings → API:
   - **URL** → `SUPABASE_URL`
   - **service_role** key → `SUPABASE_SERVICE_ROLE_KEY`

If you already have a Supabase project from earlier phases, run `supabase/migrations/001_interval_hours.sql` once to swap `schedule_cron` → `interval_hours`.

### 2. Slack app

1. Go to https://api.slack.com/apps → **Create New App** → **From an app manifest**.
2. Pick your workspace, paste `slack-manifest.yaml`, hit **Create**.
3. **Install to Workspace** (you may need a workspace admin to approve).
4. After install:
   - **OAuth & Permissions** → copy **Bot User OAuth Token** → `SLACK_BOT_TOKEN`
   - **Basic Information** → copy **Signing Secret** → `SLACK_SIGNING_SECRET`
   - **Basic Information** → **App-Level Tokens** → **Generate Token** with scope `connections:write` → `SLACK_APP_TOKEN`
5. In Slack, create/pick the `#leads` channel and grab its ID:
   - Channel header → channel name → **About** → bottom of the modal has the channel ID → `SLACK_LEADS_CHANNEL_ID`
6. Your own Slack user ID (for admin DMs in Phase 6): click your name → **Copy member ID** → `SLACK_ADMIN_USER_ID`
7. Invite the bot to `#leads`: `/invite @WAVS Leads`.

### 3. Apify

1. Create an account at https://apify.com.
2. Console → Settings → Integrations → API → copy your **Personal API Token** → `APIFY_TOKEN`.
3. The default actor is `apidojo/tweet-scraper` (already in `.env.example`). It's pay-per-result; small test runs are cents.

### 4. Anthropic

1. https://console.anthropic.com → API keys → create one → `ANTHROPIC_API_KEY`.
2. The default model is `claude-sonnet-4-6`. Override via `ANTHROPIC_MODEL` if needed.

### 5. Local env

```bash
cp .env.example .env
# fill in Slack + Supabase + Apify + Anthropic vars.
npm install
npm run slack
```

You should see a log line like:

```json
{"t":"...","level":"info","msg":"slack_connected","mode":"socket"}
```

### 6. Try the Slack app

In any channel where the bot is, run:

```
/funnel new
```

Fill the modal, submit. You'll get a DM confirming the funnel was created. Check it in Supabase: `select * from funnels;`.

Other subcommands (`list`, `show`, `pause`, etc.) currently respond with a "coming soon" stub. They'll come online in Phases 3–5.

### 7. Try the worker

In a second terminal, run a single funnel by name:

```
npm run worker:once -- <your-funnel-name>
```

Or every active funnel:

```
npm run worker:once -- --all
```

To run continuously:

```
npm run worker
```

The worker ticks every 5 minutes (set `WORKER_TICK_MS` to override). On each tick, it lists active funnels and runs the ones whose `interval_hours` has elapsed since `last_run_at`. Pausing/creating/deleting funnels in Slack takes effect on the next tick — no worker restart needed.

The worker will: search Twitter via Apify → drop tweets older than `max_age_hours` or already in `seen_tweets` → keep only those above `velocity_floor` → score with Claude → post the top `max_per_digest` (default 5) that hit `min_score` (default 7) to `#leads`. It prints a JSON summary at the end (counts, cost in USD).

If nothing posts, check the summary: most likely `passed_velocity: 0` (too high a floor for what your queries return) or `qualified: 0` (Claude scored everything below 7). Tune the funnel — for now in Supabase, in Phase 5 via `/funnel edit`.

---

## Phase roadmap

- **Phase 1** ✅ Scaffold, Supabase schema, `/funnel new` (simple mode).
- **Phase 2** ✅ Worker: Apify → velocity → Claude → post cards (no buttons). Run with `npm run worker:once`.
- **Phase 3** ✅ Cron scheduling (`npm run worker`), `/funnel list | pause | delete`.
- **Phase 4** ✅ Card buttons (🔗 / 👍 / 👎 / 📌 / 🙈), feedback writes, `/funnel stats`.
- **Phase 5** ✅ Advanced mode, `/funnel edit [advanced]`, `/funnel fork`.
- **Phase 6** Budget caps, admin daily DM, Railway deploy.
