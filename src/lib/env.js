import 'dotenv/config';
import { z } from 'zod';

// Phase 2+ vars are optional in Phase 1 so the Slack app can boot without them.
const schema = z.object({
  SLACK_BOT_TOKEN: z.string().startsWith('xoxb-'),
  SLACK_APP_TOKEN: z.string().startsWith('xapp-'),
  SLACK_SIGNING_SECRET: z.string().min(1),
  SLACK_LEADS_CHANNEL_ID: z.string().min(1),
  SLACK_ADMIN_USER_ID: z.string().min(1),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

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
