import Anthropic from '@anthropic-ai/sdk';
import { env } from './env.js';
import { log } from './log.js';

// Claude Sonnet 4.6 pricing (USD per 1M tokens). Update if model changes.
const PRICE = {
  input:       3.00 / 1_000_000,
  output:      15.00 / 1_000_000,
  cache_write: 3.75  / 1_000_000,
  cache_read:  0.30  / 1_000_000,
};

let _client;
function client() {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is required to run the worker');
  if (!_client) _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return _client;
}

function userMessage(tweet) {
  return `Tweet to score:

Author: @${tweet.author}
URL: ${tweet.url}
Posted: ${tweet.created_at.toISOString()}
Engagement: ${tweet.likes} likes, ${tweet.replies} replies, ${tweet.quotes} quotes, ${tweet.retweets} retweets

---
${tweet.text}
---

Score this tweet. Respond with JSON only.`;
}

function extractJson(text) {
  const trimmed = text.trim();
  // Tolerate stray markdown fences if the model wraps the JSON.
  const fenced = trimmed.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  const raw = fenced ? fenced[1] : trimmed;
  return JSON.parse(raw);
}

export async function scoreTweet({ funnel, tweet }) {
  const resp = await client().messages.create({
    model: env.ANTHROPIC_MODEL,
    max_tokens: 400,
    // Cache the per-funnel system prompt so subsequent tweets in the same run pay ~10x less.
    system: [
      { type: 'text', text: funnel.relevance_prompt, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: userMessage(tweet) }],
  });

  const text = resp.content.find((b) => b.type === 'text')?.text ?? '';
  let parsed;
  try {
    parsed = extractJson(text);
  } catch (err) {
    log.warn('claude_parse_failed', { tweet_id: tweet.tweet_id, raw: text.slice(0, 200) });
    throw new Error(`Claude returned non-JSON: ${err.message}`);
  }

  const u = resp.usage;
  const cost_usd =
    (u.input_tokens                 ?? 0) * PRICE.input +
    (u.output_tokens                ?? 0) * PRICE.output +
    (u.cache_creation_input_tokens  ?? 0) * PRICE.cache_write +
    (u.cache_read_input_tokens      ?? 0) * PRICE.cache_read;

  return {
    score:           Math.max(1, Math.min(10, Math.round(Number(parsed.score) || 0))),
    reasoning:       String(parsed.reasoning ?? '').slice(0, 500),
    cost_usd,
    input_tokens:        u.input_tokens                ?? 0,
    output_tokens:       u.output_tokens               ?? 0,
    cache_write_tokens:  u.cache_creation_input_tokens ?? 0,
    cache_read_tokens:   u.cache_read_input_tokens     ?? 0,
  };
}
