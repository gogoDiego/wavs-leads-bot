# wavs-leads-bot

Internal Slack bot for Layer that surfaces high-signal tweets to `#leads`, scored against per-user "funnels" (each defining an ICP + search criteria).

## Architecture

- **Slack app** — Bolt app exposed as a Vercel serverless function at `/api/slack`. HTTP mode in production; Socket Mode for local dev.
- **Worker** — GitHub Actions workflow (`.github/workflows/worker.yml`) that fires every 30 minutes. Each run calls `runDueFunnels()`, which lists active funnels and runs only those whose `interval_hours` has elapsed since `last_run_at`. Idle ticks are cheap no-ops.
- **Database** — any Postgres reachable via `DATABASE_URL` (Supabase, Vercel Postgres, anything). Schema in `supabase/schema.sql`.

What you sign up for to run this: **Vercel** (free, no card), **Apify** (free $5/mo credit), **Anthropic** (API key). Plus GitHub + Slack + a Postgres host (use the Supabase you already have, or Vercel Postgres).

---

## Local development

Use Socket Mode locally — no public URL needed.

### 1. Database

If you don't have one yet, create a free Supabase project (or Vercel Postgres later). Open the SQL editor and run `supabase/schema.sql`. Grab the **Postgres connection string** (Supabase: Project Settings → Database → Connection string → URI). It looks like `postgres://user:pass@host:5432/db?sslmode=require`.

If you're migrating from an earlier `schedule_cron` schema, run `supabase/migrations/001_interval_hours.sql` once.

### 2. Slack app (Socket Mode for local)

1. https://api.slack.com/apps → **Create New App** → **From an app manifest** → paste `slack-manifest.yaml` → **Create**.
2. For *local* dev, override the manifest temporarily: set `socket_mode_enabled: true`. (After deploying to Vercel you'll switch it back.)
3. **Install to Workspace**.
4. Copy:
   - **OAuth & Permissions** → Bot User OAuth Token → `SLACK_BOT_TOKEN`
   - **Basic Information** → Signing Secret → `SLACK_SIGNING_SECRET`
   - **Basic Information** → App-Level Tokens → generate one with `connections:write` → `SLACK_APP_TOKEN`
5. Channel + admin IDs:
   - `#leads` channel ID → `SLACK_LEADS_CHANNEL_ID`
   - Your member ID → `SLACK_ADMIN_USER_ID`
6. `/invite @WAVS Leads` in `#leads`.

### 3. Apify + Anthropic

- Apify: https://apify.com → Settings → API → token → `APIFY_TOKEN`.
- Anthropic: https://console.anthropic.com → API keys → `ANTHROPIC_API_KEY`.

### 4. Run locally

```bash
cp .env.example .env
# fill all the vars; set SLACK_SOCKET_MODE=true for local
npm install
npm run slack       # in one terminal
npm run worker      # in another (ticks every 5 min, runs due funnels)
```

Try `/funnel new` in Slack. Other commands: `list`, `pause`, `delete`, `stats`, `edit [advanced]`, `fork`.

For a single-shot worker run (manual debugging):

```bash
npm run worker:once -- <funnel-name>     # specific funnel
npm run worker:once -- --all             # every active funnel
npm run worker:due                       # only the ones whose interval has elapsed
```

---

## Production deploy (Vercel + GitHub Actions)

### Step 1 — Deploy to Vercel

1. https://vercel.com → sign up with GitHub. **No card required** for the Hobby plan.
2. **Add New → Project** → pick `gogoDiego/wavs-leads-bot`.
3. Framework preset: **Other**. Build command + output: leave defaults (Vercel detects `api/`).
4. **Environment Variables** (add each to "Production" and "Preview"):
   - `SLACK_BOT_TOKEN`
   - `SLACK_SIGNING_SECRET`
   - `SLACK_LEADS_CHANNEL_ID`
   - `SLACK_ADMIN_USER_ID`
   - `SLACK_SOCKET_MODE` = `false`
   - `DATABASE_URL`
   - `APIFY_TOKEN`
   - `APIFY_TWEET_ACTOR` = `apidojo/tweet-scraper`
   - `ANTHROPIC_API_KEY`
   - `ANTHROPIC_MODEL` = `claude-sonnet-4-6`
5. Deploy. You'll get a URL like `https://wavs-leads-bot-abc123.vercel.app`.
6. **Update the Slack app manifest:** back at api.slack.com/apps → your app → **App Manifest** → replace `{VERCEL_URL}` with your real domain (3 places). Save. Slack will verify the URL by sending a challenge request — Bolt handles it automatically.

(Optional — instead of using your existing DB, create **Vercel Postgres** under the project → Storage tab → Create Database → Postgres. Run `supabase/schema.sql` against it via the Vercel Postgres console. Replace `DATABASE_URL` accordingly. Now Vercel = your only infra account.)

### Step 2 — Enable the worker on GitHub Actions

1. In the GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**. Add:
   - `DATABASE_URL`
   - `SLACK_BOT_TOKEN`
   - `SLACK_SIGNING_SECRET`
   - `SLACK_LEADS_CHANNEL_ID`
   - `SLACK_ADMIN_USER_ID`
   - `APIFY_TOKEN`
   - `ANTHROPIC_API_KEY`
2. (Optional variables — under the same page, "Variables" tab — only if overriding defaults):
   - `APIFY_TWEET_ACTOR`
   - `ANTHROPIC_MODEL`
3. **Actions tab** → enable workflows if prompted. The `Worker` workflow fires every 30 min automatically. To test immediately, click **Worker → Run workflow → Run workflow**.

### Step 3 — Verify

- In Slack, run `/funnel list`. Should respond.
- In the Actions tab, watch the first scheduled `Worker` run. The job log should show `tick_no_due_funnels` or per-funnel `funnel_run_done` JSON lines.

---

## Phase roadmap

- **Phase 1** ✅ Scaffold, schema, `/funnel new` (simple mode).
- **Phase 2** ✅ Worker pipeline: Apify → velocity → Claude → cards.
- **Phase 3** ✅ Per-funnel scheduling, `/funnel list | pause | delete`.
- **Phase 4** ✅ Card buttons + feedback, `/funnel stats`.
- **Phase 5** ✅ Advanced mode, `/funnel edit [advanced]`, `/funnel fork`.
- **Refactor** ✅ `interval_hours` replaces `schedule_cron`; `pg` replaces `@supabase/supabase-js`; Vercel handler + GitHub Actions worker; Socket Mode → HTTP for production.
- **Phase 6** Budget caps + auto-pause, daily admin DM, deploy.
