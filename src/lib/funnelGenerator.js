import Anthropic from '@anthropic-ai/sdk';
import { env } from './env.js';
import { log } from './log.js';

// Meta-prompt: turns a one-paragraph intent into the structured inputs our
// simple-mode prompt template + Apify search expect. JSON-only output so we
// can parse it deterministically.
const META_PROMPT = `You are a B2B lead-funnel architect helping build a Twitter scraping bot for sales prospecting.

Given the user's intent (who they're trying to find on Twitter), generate:
1. A one-sentence ICP summary.
2. 6–12 boost keywords — short phrases that, when present in a tweet, suggest a match.
3. 5–10 hard-skip phrases — words that, if present, mean it's NOT a match (price hype, hiring, airdrops, etc).
4. 1–2 Twitter advanced search queries that would surface relevant tweets.
5. 3 hypothetical example tweets that would score 9/10. Make them realistic, varied, and reflect the intent — NOT real tweets.

Twitter advanced search syntax tips:
- Quoted phrases for exact matches: "phrase here"
- Parens + OR for groups: ("foo" OR "bar")
- Add lang:en for English only
- Use -word to exclude: -hiring
- Combine: ("term A" OR "term B") (context1 OR context2) lang:en -hiring

Respond with ONLY a JSON object, no preamble:
{
  "icp": "<one-sentence summary>",
  "keywords": ["kw1", "kw2", ...],
  "hard_skips": ["skip1", "skip2", ...],
  "search_queries": ["query1", "query2"],
  "example_tweets": [
    {"author": "handle", "text": "tweet text"},
    {"author": "handle", "text": "tweet text"},
    {"author": "handle", "text": "tweet text"}
  ]
}`;

let _client;
function client() {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is required');
  if (!_client) _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return _client;
}

function extractJson(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  return JSON.parse(fenced ? fenced[1] : trimmed);
}

export async function generateFunnel({ intent }) {
  const resp = await client().messages.create({
    model: env.ANTHROPIC_MODEL,
    max_tokens: 1500,
    system: META_PROMPT,
    messages: [{ role: 'user', content: `Intent: ${intent}` }],
  });

  const text = resp.content.find((b) => b.type === 'text')?.text ?? '';
  let parsed;
  try {
    parsed = extractJson(text);
  } catch (err) {
    log.warn('funnel_gen_parse_failed', { raw: text.slice(0, 300) });
    throw new Error('Claude returned malformed JSON. Try rephrasing your intent.');
  }

  return {
    icp:            String(parsed.icp ?? '').slice(0, 600),
    keywords:       (parsed.keywords ?? []).map((k) => String(k)).slice(0, 15),
    hard_skips:     (parsed.hard_skips ?? []).map((k) => String(k)).slice(0, 15),
    search_queries: (parsed.search_queries ?? []).map((k) => String(k)).slice(0, 3),
    example_tweets: (parsed.example_tweets ?? []).slice(0, 3).map((t) => ({
      author: String(t.author ?? '').slice(0, 30).replace(/^@/, ''),
      text:   String(t.text   ?? '').slice(0, 280),
    })),
  };
}
