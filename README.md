# wavs-leads-bot

Internal Slack bot for Layer that surfaces high-signal tweets to `#leads`, scored against per-user "funnels" (each defining an ICP + search criteria).

Two services, one repo:

- **Slack app** (`npm run slack`) — Socket Mode Bolt app. Owns slash commands, modals, button interactions.
- **Worker**     (`npm run worker`) — Cron-driven. For each active funnel: Apify fetch → dedupe → velocity filter → Claude scoring → post to `#leads`.

Hosted on Railway as two services from the same repo. Until Phase 6, run locally.

---

## Phase 1 setup (what you can test today)

What's wired: `/funnel new` (simple mode only). Creates a funnel row in Supabase and DMs you a confirmation. No worker, no tweets, no scoring yet.

### 1. Supabase

1. Create a project at https://supabase.com.
2. Open the SQL editor → paste & run `supabase/schema.sql`.
3. Project settings → API:
   - **URL** → `SUPABASE_URL`
   - **service_role** key → `SUPABASE_SERVICE_ROLE_KEY`

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

### 3. Local env

```bash
cp .env.example .env
# fill in the Phase 1 vars (Slack + Supabase). Apify/Anthropic can stay empty.
npm install
npm run slack
```

You should see a log line like:

```json
{"t":"...","level":"info","msg":"slack_connected","mode":"socket"}
```

### 4. Try it

In any channel where the bot is, run:

```
/funnel new
```

Fill the modal, submit. You'll get a DM confirming the funnel was created. Check it in Supabase: `select * from funnels;`.

Other subcommands (`list`, `show`, `pause`, etc.) currently respond with a "coming soon" stub. They'll come online in Phases 3–5.

---

## Phase roadmap

- **Phase 1** ✅ Scaffold, Supabase schema, `/funnel new` (simple mode).
- **Phase 2** Worker: Apify → velocity → Claude → post cards (no buttons). Run with `npm run worker:once`.
- **Phase 3** Cron scheduling, `/funnel list | pause | delete`.
- **Phase 4** Card buttons, `feedback` table, `/funnel stats`.
- **Phase 5** Advanced mode, `/funnel edit | fork`.
- **Phase 6** Budget caps, admin daily DM, Railway deploy.
