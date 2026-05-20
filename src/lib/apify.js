import { ApifyClient } from 'apify-client';
import { env } from './env.js';
import { log } from './log.js';

let _client;
function client() {
  if (!env.APIFY_TOKEN) throw new Error('APIFY_TOKEN is required to run the worker');
  if (!_client) _client = new ApifyClient({ token: env.APIFY_TOKEN });
  return _client;
}

// Scweet tweet output → normalized shape used by runFunnel. The fallbacks let
// the same normalizer accept a few historical actor schemas without code edits.
function normalize(raw) {
  const author = raw.handle
    || raw.author?.handle
    || raw.author?.userName
    || raw.author?.username
    || raw.user?.username;
  const created = raw.created_at || raw.createdAt || raw.date;
  const url = raw.tweet_url
    || raw.url
    || (author && raw.id ? `https://twitter.com/${author}/status/${raw.id}` : null);
  return {
    tweet_id:   String(raw.id ?? raw.tweetId ?? raw.conversation_id ?? raw.conversationId ?? ''),
    text:       raw.text ?? raw.fullText ?? '',
    url,
    author,
    created_at: created ? new Date(created) : null,
    likes:    raw.favorite_count ?? raw.likeCount    ?? raw.likes    ?? raw.favoriteCount ?? 0,
    replies:  raw.reply_count    ?? raw.replyCount   ?? raw.replies  ?? 0,
    quotes:   raw.quote_count    ?? raw.quoteCount   ?? raw.quotes   ?? 0,
    retweets: raw.retweet_count  ?? raw.retweetCount ?? raw.retweets ?? 0,
  };
}

export async function searchTweets({ searchTerms, maxItems = 50, language = 'en' }) {
  if (!searchTerms?.length) return [];

  // Scweet takes a single search_query per actor run. Running multiple times
  // would burn the per-run startup fee each time, so collapse to the first
  // query — owners should combine queries with OR inside one string instead.
  if (searchTerms.length > 1) {
    log.warn('apify_multi_query_collapsed', {
      provided: searchTerms.length,
      using: searchTerms[0],
    });
  }

  const input = {
    source_mode:  'search',
    search_query: searchTerms[0],
    max_items:    maxItems,
    lang:         language,
    search_sort:  'Latest',
  };

  log.info('apify_run_start', { actor: env.APIFY_TWEET_ACTOR, query: searchTerms[0], maxItems });
  const run = await client().actor(env.APIFY_TWEET_ACTOR).call(input, { waitSecs: 180 });
  const { items } = await client().dataset(run.defaultDatasetId).listItems();
  log.info('apify_run_done', { items: items.length, runId: run.id });

  return items
    .map(normalize)
    .filter((t) => t.tweet_id && t.text && t.url && t.created_at);
}
