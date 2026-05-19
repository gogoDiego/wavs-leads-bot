# wavs-leads-bot

Internal Slack bot for **Layer** that surfaces high-signal tweets to `#leads`, scored against per-user "funnels" you define inside Slack.

## What it does

You create a **funnel** with `/funnel new` — describe your Ideal Customer Profile, add some boost keywords and hard skips, and pick a check interval. The bot then:

1. Searches Twitter on your terms every `N` hours
2. Filters out tweets it's already seen and tweets without enough engagement-per-hour
3. Asks Claude to score what's left against your ICP (1–10)
4. Posts the top hits as cards in `#leads`, each tagged with your name + the funnel + a suggested DM angle
5. Tracks 👍/👎/📌/🙈 reactions per user to keep stats

Everything lives in Slack. No web dashboard. No accounts for coworkers.

---

## Slash command reference

| Command | What it does |
|---|---|
| `/funnel new` | Open the modal to create a new funnel (simple mode) |
| `/funnel list` | List all your funnels with status + interval + last run |
| `/funnel stats <name>` | Counts, avg score, feedback rates, spend this month |
| `/funnel pause <name>` | Stop the funnel from running (does not delete it) |
| `/funnel edit <name>` | Reopen the funnel's modal pre-filled with current settings |
| `/funnel edit <name> advanced` | Open the advanced modal (raw queries, full prompt, thresholds) |
| `/funnel fork <name>` | Clone any user's funnel to you as `<name>-copy` |
| `/funnel delete <name> confirm` | Permanently delete a funnel (two-step) |

Card buttons in `#leads`:

| Button | Effect |
|---|---|
| 🔗 Open | Opens the tweet in your browser |
| 👍 Good | Records positive feedback |
| 👎 Noise | Records negative feedback |
| 📌 Saved | Records save + opens a thread for notes/draft replies |
| 🙈 Hide | Soft-negative for that funnel only |

---

## Deployment guide (one-time setup)

This bot runs entirely on **Vercel** plus a Postgres database. Everything else (Slack, Apify, Anthropic) is plug-in credentials.

### Accounts you'll need

| # | Service | What for | Cost |
|---|---|---|---|
| 1 | **GitHub** | Code lives here | Free |
| 2 | **Slack workspace** | The bot lives in your workspace | Free |
| 3 | **Vercel** | Hosts the Slack endpoint, the cron worker, **and the Postgres database** | Free, no card |
| 4 | **Apify** | Twitter scraping | $5/mo free credit, no card |
| 5 | **Anthropic API key** | Claude scoring | $5 trial credit, then card required |

That's **one infrastructure account (Vercel)** — it covers the app and the database. No credit card needed to start. You'll need one eventually for Anthropic (after the trial credit runs out — typically a few thousand scorings in).

### Step 1 — Create the Slack app

1. Go to https://api.slack.com/apps → **Create New App** → **From an app manifest**.
2. Pick your workspace, paste the contents of `slack-manifest.yaml`. **Leave `{VERCEL_URL}` placeholder as-is** — you'll replace it after Step 5.
3. Click **Create**, then **Install to Workspace**. A workspace admin may need to approve.
4. Capture these values for later:
   - **OAuth & Permissions → Bot User OAuth Token** → call this `SLACK_BOT_TOKEN`
   - **Basic Information → Signing Secret** → call this `SLACK_SIGNING_SECRET`
5. In your Slack workspace:
   - Create or pick the `#leads` channel. Open the channel → click name → **About** at the bottom shows the channel ID (starts with `C`). Save as `SLACK_LEADS_CHANNEL_ID`.
   - Click your own name → **Copy member ID** (starts with `U`). Save as `SLACK_ADMIN_USER_ID`.
6. In `#leads`, run `/invite @WAVS Leads` so the bot can post there.

### Step 2 — Get external API tokens

**Apify** (Twitter scraping)
1. https://apify.com → sign up (no card required).
2. Console → **Settings → Integrations → API → Personal API Token** → save as `APIFY_TOKEN`.

**Anthropic** (Claude scoring)
1. https://console.anthropic.com → **API keys** → create one → save as `ANTHROPIC_API_KEY`.
   Separate billing track from Claude.ai or Claude Code. Initial signup gives ~$5 credit, then a card is required.

### Step 3 — Create the Vercel project (without deploying yet)

1. https://vercel.com → sign up with GitHub (no card required for the Hobby plan).
2. **Add New → Project** → import `gogoDiego/wavs-leads-bot` (or your fork).
3. Framework Preset: **Other**. Leave build settings at defaults.
4. **Don't click Deploy yet** — first we'll attach a database (next step) so its connection string is wired in automatically.

### Step 4 — Attach Vercel Postgres

1. In your new Vercel project → **Storage** tab → **Create Database** → **Postgres** → pick a region close to you → **Create**.
2. Vercel auto-injects `POSTGRES_URL` (and a few related vars) into your project's env. Our code reads it via the same alias as `DATABASE_URL` — no extra config needed.
3. In the new database's **Query** console, paste the contents of `db/schema.sql` → **Run**. You should see "OK" with the tables created.

### Step 5 — Set the remaining env vars + deploy

Back in your Vercel project → **Settings → Environment Variables** → add each of these to **Production** *and* **Preview**:

| Name | Value |
|---|---|
| `SLACK_BOT_TOKEN` | from Step 1 |
| `SLACK_SIGNING_SECRET` | from Step 1 |
| `SLACK_LEADS_CHANNEL_ID` | from Step 1 |
| `SLACK_ADMIN_USER_ID` | from Step 1 |
| `SLACK_SOCKET_MODE` | `false` |
| `APIFY_TOKEN` | from Step 2 |
| `APIFY_TWEET_ACTOR` | `apidojo/tweet-scraper` |
| `ANTHROPIC_API_KEY` | from Step 2 |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` |
| `CRON_SECRET` | any random string (`openssl rand -hex 32` or just make one up) |
| `TZ` | `America/Chicago` |

(`POSTGRES_URL` and friends are already set automatically by Vercel Postgres — leave those alone.)

Then **Deployments** tab → click **Redeploy** on the latest. You'll get a URL like `https://wavs-leads-bot-abc123.vercel.app`.

### Step 6 — Point Slack at your Vercel URL

1. Back at https://api.slack.com/apps → your app → **App Manifest**.
2. Replace `{VERCEL_URL}` with your Vercel domain (no `https://` prefix). It appears in 3 places:
   - `slash_commands → url`
   - `event_subscriptions → request_url`
   - `interactivity → request_url`
3. Save. Slack will ping the URL with a verification challenge — Bolt handles it automatically. You'll see a green checkmark if it works.
4. Re-install the app if Slack prompts you to.

### Step 7 — Verify

- In Slack, run `/funnel list`. You should get an ephemeral reply (probably "you don't have any funnels yet").
- Run `/funnel new` and create one with a real ICP and keywords.
- In Vercel → **Crons** tab → manually trigger `/api/worker` to test the worker (or wait 30 min for the auto-fire). The function logs should show `tick_running` and per-funnel summaries.
- Within a few minutes, a card should appear in `#leads`.

If a card doesn't show up, see **Troubleshooting** below.

---

## Architecture

```
GitHub repo ──── push ────► Vercel
                              │
                              ├──── /api/slack  (Bolt HTTP — slash commands, modals, buttons)
                              │
                              └──── /api/worker (Vercel cron, every 30 min)
                                         │
                                         ▼
                                    Vercel Postgres (attached to same project)
                                         │
                                         ▼
                              Apify (Twitter)  +  Anthropic (Claude)
                                         │
                                         ▼
                                    Slack #leads channel
```

Three jobs, one host (Vercel). All env vars and logs in one dashboard.

---

## Local development

Want to work on the code? Optional flow:

1. `cp .env.example .env` — fill values
2. Set `SLACK_SOCKET_MODE=true` and add an `SLACK_APP_TOKEN` (Basic Information → App-Level Tokens → generate one with `connections:write`)
3. In Slack app manifest, temporarily set `socket_mode_enabled: true` and re-install
4. `npm install`
5. `npm run slack` (in one terminal) and `npm run worker` (in another)

Manual worker triggers:

```bash
npm run worker:once -- <funnel-name>   # specific funnel
npm run worker:once -- --all           # every active funnel
npm run worker:due                     # only funnels whose interval has elapsed
```

When done, flip `SLACK_SOCKET_MODE` back to `false` and re-install the app in HTTP mode for production.

---

## Troubleshooting

**Slack manifest URL verification fails when you save.**
The Vercel function might still be cold-starting. Wait 30 seconds and try again. If still failing, check that `SLACK_SIGNING_SECRET` in Vercel env vars exactly matches the one in Slack's Basic Information.

**`/funnel` slash command times out (`/funnel failed`).**
- Open Vercel → your project → **Logs**. Find the `/api/slack` request.
- 99% of the time it's a missing env var. Vercel logs will say which.

**No cards appear in `#leads` even with active funnels.**
Manually trigger the worker: in Vercel → **Crons** tab → run `/api/worker`. Then check the function's logs for the JSON summary. Look at:
- `passed_velocity: 0` → your `velocity_floor` is too high. `/funnel edit <name> advanced` and drop it to 5–10.
- `qualified: 0` → Claude scored everything < `min_score`. Try `min_score: 6` or rewrite the prompt.
- `fetched: 0` → your search queries return nothing on Apify. Test them at https://twitter.com/search-advanced.

**Worker run hits the 60s Vercel timeout.**
Happens when you have many funnels or slow Apify calls. Workarounds:
- Use larger `interval_hours` per funnel so fewer fire on each tick
- Pause some funnels
- (Code change) parallelize funnel runs inside `runDueFunnels`

**Anthropic returns 401.**
Your trial credit ran out. Add a card at https://console.anthropic.com → Plans & Billing.

**Apify returns 429 or "out of credit".**
Your $5/mo free credit ran out. Add a card or wait until next month.

**Bot says "you already have a funnel with this name."**
Names are unique per owner. Use `/funnel list` to see what you have, then pick a different name or `/funnel edit` the existing one.

**A coworker can't see `/funnel`.**
The bot needs to be a member of the channel where they're typing the command (or they can type it from any channel — slash commands work workspace-wide). For card posts in `#leads`, the bot must be invited (`/invite @WAVS Leads`).

---

## Phase roadmap

- **Phase 1–5** ✅ Full feature set: funnels, advanced mode, edit/fork, buttons, stats.
- **Refactor** ✅ `interval_hours` replaces cron strings. `pg` replaces `@supabase/supabase-js`. Vercel handler + Vercel Cron worker. Single-vendor infra.
- **Phase 6** Budget caps + auto-pause when over budget. Daily admin DM with per-funnel stats.

---

## Repo conventions

- One commit per logical change. Phase tags in commit messages.
- No tests in v1 — manual smoke-testing in Slack + local runs.
- ES Modules throughout (`"type": "module"`).
- Single `pg` pool for the whole process. Serverless functions get their own.

PRs welcome.
