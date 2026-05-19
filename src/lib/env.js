import 'dotenv/config';
import { z } from 'zod';

// SLACK_APP_TOKEN is only needed in Socket Mode (local dev); HTTP/Vercel uses signing secret only.
const schema = z.object({
  SLACK_BOT_TOKEN: z.string().startsWith('xoxb-'),
  SLACK_APP_TOKEN: z.string().startsWith('xapp-').optional(),
  SLACK_SIGNING_SECRET: z.string().min(1),
  SLACK_LEADS_CHANNEL_ID: z.string().min(1),
  SLACK_ADMIN_USER_ID: z.string().min(1),
  SLACK_SOCKET_MODE: z.enum(['true', 'false']).default('false'),

  DATABASE_URL: z.string().url(),

  // Set in Vercel; required for the /api/worker cron endpoint.
  // Local dev can leave it unset (the endpoint is ungated when CRON_SECRET is empty).
  CRON_SECRET: z.string().optional(),

  APIFY_TOKEN: z.string().optional(),
  APIFY_TWEET_ACTOR: z.string().default('apidojo/tweet-scraper'),

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-6'),

  TZ: z.string().default('America/Chicago'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
