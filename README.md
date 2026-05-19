# wavs-leads-bot

> Internal Slack bot for **Layer** that finds high-signal tweets and drops them in `#leads`, scored by Claude against per-user "funnels" you define right in Slack.
>
> **Status:** in active development — Phases 1–5 complete (everything you'd use today is working). Phase 6 (budget caps + admin digest) pending. Not yet deployed.

---

## Where to go from here

Pick the section that matches what you're trying to do:

| You are… | Go to |
|---|---|
| **A teammate who wants to use the bot** once it's live | [Using the bot](#using-the-bot) |
| **The person deploying** this for the team (needs admin permissions + a credit-cardable Anthropic account) | [Deploying your own instance](#deploying-your-own-instance) |
| **A contributor** modifying the code | [Local development](#local-development) |
| **Skeptical** and wondering whether this is worth deploying at all | [Why deploy this](#why-deploy-this) |

---

## Why deploy this

The pitch, for whoever has the permissions and the API budget to set this up:

**Problem:** Your team's best leads are happening in real time on Twitter — protocol founders complaining about market makers, devs frustrated with their orchestration framework, etc. By the time anyone notices, the conversation's cold and someone else has slid in.

**What this does:** Every coworker defines their Ideal Customer Profile in plain language inside Slack. The bot then runs continuous Twitter searches, has Claude score the matches against each ICP, and drops the top 3–5 hits per funnel into `#leads` as cards with the tweet, score, and a suggested DM angle. One-click reactions (👍/👎/📌/🙈) build a feedback loop.

**What it costs to run:** ~$10–25/month in API usage at 5 active funnels checking every 6 hours, after the free credits run out. No hosting cost — runs on Vercel's free tier. See [Cost](#cost) for the math.

**What's needed from you (deployer):**
- 30 minutes of one-time setup
- A credit card on the Anthropic account (after the $5 trial credit; ~thousands of scorings)
- Optional Apify card (the $5/mo free credit covers low-volume testing)

That's it. Code is fully working today. The deploy guide is below.

---

## What it looks like

When a card hits `#leads`, it looks like this:

```
┌─────────────────────────────────────────────────────────────────────┐
│  *distributed-systems-builders* · score *8/10* · @diego             │
│  @jane_eng · velocity 64                                            │
│                                                                     │
│  > Spent the weekend wiring up Kafka -> Temporal -> custom glue     │
│  > code and I'm convinced there has to be a better primitive for    │
│  > event-driven services. Anyone tried [WAVS-like things]?          │
│                                                                     │
│  *Suggested angle:* Lead with the "no custom glue" framing — they   │
│  named the exact pain point WAVS solves.                            │
│                                                                     │
│  [🔗 Open] [👍 Good] [👎 Noise] [📌 Saved] [🙈 Hide]                │
└─────────────────────────────────────────────────────────────────────┘
```

And `/funnel list` looks like this:

```
🟢 distributed-systems-builders — active, every 6h, last run 2.1h ago, min_score 7
🟢 smart-vault-foundations     — active, every 6h, last run 1.3h ago, min_score 7
⏸️ kafka-replacers              — paused, every 12h, last run 18.2h ago, min_score 7
```

---

## Concepts

A few project-specific terms:

| Term | Meaning |
|---|---|
| **Funnel** | One person's saved search + scoring rules. Each owner can have many. Lives in the `funnels` Postgres table. |
| **ICP** | Ideal Customer Profile. 1–2 sentences describing who you're trying to find. |
| **Candidate** | A single tweet that's been scored by a funnel. May or may not have been posted. |
| **Velocity** | Engagement per hour: `(likes + replies×2 + quotes×5 + retweets×3) / hoursOld`. A cheap pre-filter before paying Claude to score. |
| **Score** | Claude's 1–10 rating of how well a tweet matches the funnel's ICP. Funnels post tweets that hit `min_score` (default 7). |
| **Simple mode vs. advanced mode** | Simple mode hides scoring thresholds and asks for ICP/keywords/skips. Advanced exposes everything: raw search queries, full prompt, all thresholds. |

---

## Using the bot

Once the deployer has it running and you've been invited to `#leads`:

### Slash command reference

| Command | What it does |
|---|---|
| `/funnel new` | Open a modal to create your first funnel (simple mode) |
| `/funnel list` | List all your funnels with status + interval + last run |
| `/funnel stats <name>` | Counts, avg score, feedback rates, $ spent this month |
| `/funnel pause <name>` | Stop the funnel from running (doesn't delete it) |
| `/funnel edit <name>` | Re-open the modal pre-filled to tune ICP, keywords, interval |
| `/funnel edit <name> advanced` | Open the advanced modal — raw search queries, full prompt, thresholds |
| `/funnel fork <name>` | Clone any user's funnel to you as `<name>-copy` |
| `/funnel delete <name> confirm` | Permanently delete a funnel (two-step, requires the `confirm` token) |

### Card buttons

| Button | What happens |
|---|---|
| 🔗 Open | Opens the tweet in your browser |
| 👍 Good | Records positive feedback (shows up in `/funnel stats`) |
| 👎 Noise | Records negative feedback |
| 📌 Saved | Saves + opens a thread on the card for your notes / draft DMs |
| 🙈 Hide | Soft-negative for that funnel only |

### Example funnel — Smart Vault buyers

A worked-out example for finding the people most likely to buy WAVS Smart Vault. **Copy these values into `/funnel new` to start:**

**Funnel name:** `smart-vault-protocols`

**ICP (paste this into the modal):**
> Protocol founders, foundation contributors, DAO treasury operators, or governance leads at projects with their own token. Currently dealing with private market-maker relationships (Wintermute, GSR, Flowdesk, Amber) or running protocol-owned liquidity, and frustrated with extractive fees, opaque execution, MMs pulling liquidity during volatility, or impermanent loss eating treasury value.

**Boost keywords:**
```
market maker, market making, protocol owned liquidity, POL, treasury management,
DAO treasury, impermanent loss, delta neutral, token liquidity, order book depth,
LP yield, Wintermute, Flowdesk, GSR, Amber
```

**Hard skips (capped at score 3):**
```
hiring, looking for a job, interview, airdrop, memecoin, pump, 100x, moon,
price prediction, ngmi, gm, gn
```

**Frequency:** Every 6 hours (default).

**What a *9/10* tweet looks like (the kind that should win):**
> "We're 18 months into a contract with [MM] paying ~$120k/quarter and they widen spreads every time vol spikes — exactly when we need them. What are protocols using as alternatives? POL with a Curve gauge isn't cutting it either, IL is brutal."

**What a *2/10* tweet looks like (should be rejected):**
> "$ABC just got listed by a top market maker, this is going to moon 🚀🚀"

(Pumpy, no buying signal, no real pain.)

**Tuning advice:**
- If you get too few cards: drop `min_score` to 6 in advanced mode, or drop `velocity_floor` from 20 to 10.
- If the cards are mostly noise: tighten the hard skips list (add common false-positive phrases) and bump `min_score` to 8.
- After a week of clicking 👎 on certain patterns, paste a one-liner into the funnel's `relevance_prompt` (advanced mode) telling Claude what to deprioritize.

You can have multiple funnels. A second one for "WAVS framework builders" (developers researching event-driven orchestration), a third for "early-stage DeFi infra founders," etc.

---

## Deploying your own instance

**Total time:** ~30 minutes if no waiting on admins, longer if your workspace needs admin approval for Slack apps.

### What you need before starting

| What | Where to get it |
|---|---|
| GitHub account with access to this repo | already done if you can see this |
| Slack workspace admin (to approve the app install) | DM them ahead of time |
| About 30 minutes |

### The 7 steps

#### Step 1 — Create the Slack app

1. https://api.slack.com/apps → **Create New App** → **From an app manifest**.
2. Paste `slack-manifest.yaml` (don't worry about the `{VERCEL_URL}` placeholders — fixed in Step 6).
3. **Install to Workspace**. Admin approval may be required.
4. Capture:
   - **OAuth & Permissions → Bot User OAuth Token** → `SLACK_BOT_TOKEN`
   - **Basic Information → Signing Secret** → `SLACK_SIGNING_SECRET`
5. In Slack:
   - `#leads` channel ID (channel header → About → bottom) → `SLACK_LEADS_CHANNEL_ID`
   - Your member ID (your name → Copy member ID) → `SLACK_ADMIN_USER_ID`
6. `/invite @WAVS Leads` in `#leads`.

#### Step 2 — Apify + Anthropic tokens

- **Apify:** https://apify.com → sign up → Settings → Integrations → API → token → `APIFY_TOKEN`. No card.
- **Anthropic:** https://console.anthropic.com → API keys → create one → `ANTHROPIC_API_KEY`. Has $5 trial; card required after.

#### Step 3 — Create the Vercel project

1. https://vercel.com → **Sign up with GitHub** (no card).
2. **Add New → Project** → import this repo.
3. Framework Preset: **Other**. Don't deploy yet.

#### Step 4 — Attach Vercel Postgres

1. Project → **Storage** tab → **Create Database → Postgres** → pick a region → **Create**.
2. Vercel auto-injects `POSTGRES_URL` — our code reads it as `DATABASE_URL`. No copy-paste needed.
3. Database → **Query** tab → paste `db/schema.sql` → **Run**.

#### Step 5 — Set env vars + deploy

Project → **Settings → Environment Variables** → add each, scoped to **Production** + **Preview**:

| Name | Value |
|---|---|
| `SLACK_BOT_TOKEN` | Step 1 |
| `SLACK_SIGNING_SECRET` | Step 1 |
| `SLACK_LEADS_CHANNEL_ID` | Step 1 |
| `SLACK_ADMIN_USER_ID` | Step 1 |
| `SLACK_SOCKET_MODE` | `false` |
| `APIFY_TOKEN` | Step 2 |
| `APIFY_TWEET_ACTOR` | `apidojo/tweet-scraper` |
| `ANTHROPIC_API_KEY` | Step 2 |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` |
| `CRON_SECRET` | run `openssl rand -hex 32` or invent one |
| `TZ` | `America/Chicago` |

Then **Deployments** → **Redeploy**. Copy your production URL (e.g. `https://wavs-leads-bot-abc.vercel.app`).

#### Step 6 — Point Slack at your Vercel URL

1. api.slack.com/apps → your app → **App Manifest**.
2. Replace `{VERCEL_URL}` with your Vercel domain (no `https://` prefix) in 3 places: `slash_commands.url`, `event_subscriptions.request_url`, `interactivity.request_url`.
3. Save. Slack pings the URL; Bolt handles the challenge automatically.
4. Re-install the app if prompted.

#### Step 7 — Verify

- Slack: `/funnel list` → "you don't have any funnels yet" (correct).
- `/funnel new` → fill modal → submit → DM confirmation.
- Vercel → Crons tab → **Run now** on `/api/worker`. Logs should show `tick_running` and per-funnel summaries within seconds.

You're live.

---

## Architecture

```
GitHub repo ──── push to main ───► Vercel project
                                       │
                                       ├──── /api/slack       (Bolt HTTP — slash commands, modals, buttons)
                                       │
                                       └──── /api/worker      (Vercel Cron, every 30 min)
                                                  │
                                                  │  reads
                                                  ▼
                                       Vercel Postgres (attached to same project)
                                                  │
                                                  ▼  
                                       Apify (Twitter)  +  Anthropic (Claude)
                                                  │
                                                  ▼
                                            Slack #leads channel
```

**Single Vercel project** holds the code, the database, and the cron — one dashboard, one log feed, one place for env vars. GitHub is just code storage.

Worker invocation flow on each cron tick:
1. List active funnels.
2. For each, check if `interval_hours` has elapsed since `last_run_at`. Skip if not due.
3. Fetch tweets via Apify, drop anything older than `max_age_hours` or already in `seen_tweets`.
4. Apply velocity filter.
5. Score each survivor with Claude (`relevance_prompt` is cached on the first scoring call within a run → ~10x cost reduction on tweets 2+).
6. Keep the top `max_per_digest` that hit `min_score`.
7. Post cards to `#leads`. Mark candidates posted.
8. Mark funnel as ran.

---

## Cost

**Infrastructure:** $0 — Vercel Hobby covers app + database. (Hobby is "personal, non-commercial" in Vercel's terms — for an internal company tool this is a gray area; budget for $20/mo Pro if you want to be safe long-term.)

**Per-funnel API costs** (after free credits run out):

Assumes a typical funnel: every 6h, fetching ~50 tweets per run, scoring ~10 of them (velocity-filtered).

| Service | Per-run | Per-funnel/month | 5 funnels/month |
|---|---|---|---|
| Apify | ~$0.02 | ~$2.40 | ~$12 |
| Anthropic (Sonnet 4.6, cached prompt) | ~$0.04 | ~$4.80 | ~$24 |
| **Total** | ~$0.06 | **~$7.20** | **~$36** |

Add Vercel Pro if you go that route ($20/mo flat). Without Pro: **~$36/mo for 5 active funnels**.

The free credits stretch this further:
- **Apify** gives $5/mo free → covers ~2 funnels indefinitely
- **Anthropic** $5 trial → covers ~1,000 scorings, then card required

The funnel-level `budget_monthly_usd` setting (default $20) will auto-pause runaway funnels once Phase 6 is wired.

---

## What this is NOT

To set expectations: this bot intentionally does *not* do any of the following. Don't ask for them in v1.

- **Auto-reply drafting.** It suggests an angle for you to use; it does not DM or reply on your behalf.
- **LinkedIn, Reddit, HN, Discord, or any non-Twitter source.** Twitter only.
- **A web dashboard.** Everything is in Slack. There is no UI outside Slack.
- **Auto-prompt-tuning.** Your 👍/👎 feedback is stored but does not retrain the prompt automatically. Tune it manually via `/funnel edit <name> advanced`.
- **Cross-funnel deduplication.** If two funnels match the same tweet, both post a card. (Easy future tweak if anyone complains.)
- **Image/video analysis.** Claude scores tweet text only. Embedded media is ignored.
- **Historical search.** Funnels score only tweets newer than `max_age_hours` (default 12h).

---

## FAQ

**How much will this cost me personally?**
Nothing if you're using a shared deployment — only the deployer pays. If you deploy your own, see [Cost](#cost).

**Can I see what funnels my coworkers have set up?**
You can `/funnel fork <name>` any funnel by name (it's a global lookup), which lets you copy its config. There's no `/funnel show` for someone else's funnel in v1 — fork it to inspect.

**What if Claude gives a bad score on a tweet I'd actually love?**
Click 👍 anyway — feedback is recorded for stats but doesn't change scoring (v1 limitation). To improve future runs, `/funnel edit <name> advanced` and edit the prompt directly.

**How do I know the bot is actually running?**
`/funnel list` shows `last run Xh ago` for each of your funnels. If it's been > `interval_hours` since the last run, something's wrong — check the Vercel logs (deployer) or DM the deployer.

**Why is `#leads` quiet some days?**
Usually one of: Twitter has no fresh tweets matching your queries (lower `velocity_floor`), Claude scored everything below your `min_score` threshold (lower it, or relax the ICP), or your funnel is paused (`/funnel list` will show 🟢/⏸️).

**Can multiple people fork the same funnel and tune it differently?**
Yes — forks are independent rows. Two people forking `smart-vault-protocols` get two separate funnels they can tune independently.

**Is this used by other teams at Layer?**
Not yet. v1 is for your immediate team. If it works well, easy to roll out wider.

**What happens if Slack/Vercel/Anthropic has an outage?**
Bot stops working for the duration. State is in Postgres so nothing is lost; runs resume automatically when services come back. The worker is idempotent — re-running a tick is safe.

---

## Troubleshooting

**Slack manifest URL verification fails when you save.**
Vercel function might still be cold-starting. Wait 30 seconds and try again. If still failing, verify `SLACK_SIGNING_SECRET` in Vercel exactly matches Slack's Basic Information page.

**`/funnel` slash command shows "failed".**
Open Vercel → Logs tab → find the `/api/slack` request. 99% of the time it's a missing env var; the log will say which.

**Worker manual trigger returns 401.**
`CRON_SECRET` not set in Vercel, or you're hitting the URL without the `Authorization: Bearer <secret>` header. Vercel Cron sets this automatically for scheduled fires; for manual `curl` you'd add it.

**Postgres queries fail.**
Schema didn't run. Re-run `db/schema.sql` in Vercel Postgres → Query tab.

**No cards appear in `#leads` even with active funnels.**
Manually trigger the worker: Vercel → Crons → Run now. Then check function logs for the JSON summary. Look at:
- `passed_velocity: 0` → `velocity_floor` is too high. `/funnel edit <name> advanced` and drop it.
- `qualified: 0` → Claude scored everything below `min_score`. Lower it or rewrite the prompt.
- `fetched: 0` → search queries return nothing on Apify. Test the query at https://twitter.com/search-advanced.

**Worker hits the 60s Vercel timeout.**
You probably have >10 active funnels firing in the same tick. Workarounds: bump `interval_hours` on some funnels so they spread out, pause some, or split the cron into multiple jobs (code change).

**Anthropic returns 401.**
Trial credit ran out. Add a card at console.anthropic.com → Plans & Billing.

**Apify returns 429 / "out of credit".**
$5/mo free ran out. Add a card or wait until next month.

**"You already have a funnel with this name."**
Names are unique per owner. `/funnel list` to see what you have, or `/funnel edit` the existing one.

---

## Local development

For contributors. Run the bot on your laptop with Socket Mode (no public URL).

1. `cp .env.example .env`. Fill in values from the existing Vercel deployment (or your own dev creds).
2. Set `SLACK_SOCKET_MODE=true` and add `SLACK_APP_TOKEN` (Slack app → Basic Information → App-Level Tokens → generate with `connections:write`).
3. In the Slack app manifest, temporarily set `socket_mode_enabled: true`. Re-install.
4. `npm install`.
5. Run in two terminals:
   ```
   npm run slack
   npm run worker
   ```

Manual worker triggers:
```
npm run worker:once -- <funnel-name>   # specific funnel, force-run
npm run worker:once -- --all           # every active funnel, force-run
npm run worker:due                     # only the ones whose interval has elapsed
```

When you push to `main`, Vercel auto-deploys production from the same code. Local Socket Mode and production HTTP mode use the same handlers — only the transport differs.

---

## Contributing + feedback

- **Bug or unexpected behavior:** open a GitHub issue or DM @diego in Slack.
- **Feature ideas:** GitHub issue with the `enhancement` label, or bring it up in our weekly sync.
- **Pull requests welcome.** No formal review process; keep changes focused, write a clear commit message, and one of us will merge within a day.

---

## Phase roadmap

- **Phase 1** ✅ Scaffold, schema, `/funnel new` (simple mode).
- **Phase 2** ✅ Worker pipeline: Apify → velocity → Claude → cards.
- **Phase 3** ✅ Per-funnel scheduling, `/funnel list | pause | delete`.
- **Phase 4** ✅ Card buttons + feedback, `/funnel stats`.
- **Phase 5** ✅ Advanced mode, `/funnel edit [advanced]`, `/funnel fork`.
- **Refactor** ✅ `interval_hours` replaces cron strings. `pg` replaces the Supabase SDK. Vercel handler + Vercel Cron worker. Single-vendor infra.
- **Phase 6** Budget caps + auto-pause when over budget, daily admin DM with per-funnel stats.

---

## Repo conventions

- One commit per logical change. Phase tags in commit messages.
- No tests in v1 — manual smoke-testing in Slack + local runs.
- ES Modules throughout (`"type": "module"`).
- Single `pg` pool per process. Serverless functions get their own.
- Comments only where intent isn't obvious from code.
