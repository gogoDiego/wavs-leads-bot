import { ApifyClient } from 'apify-client';
import { env } from './env.js';
import { log } from './log.js';

let _client;
function client() {
  if (!env.APIFY_TOKEN) throw new Error('APIFY_TOKEN is required to run the worker');
  if (!_client) _client = new ApifyClient({ token: env.APIFY_TOKEN });
  return _client;
}

function normalize(raw) {
  // apidojo/tweet-scraper fields vary slightly between versions; coalesce defensively.
  const author = raw.author?.userName || raw.author?.username || raw.user?.username;
  const created = raw.createdAt || raw.created_at || raw.date;
  const url = raw.url || (author && raw.id ? `https://twitter.com/${author}/status/${raw.id}` : null);
  return {
    tweet_id:   String(raw.id ?? raw.tweetId ?? raw.conversationId ?? ''),
    text:       raw.text ?? raw.fullText ?? '',
    url,
    author,
    created_at: created ? new Date(created) : null,
    likes:    raw.likeCount    ?? raw.likes    ?? raw.favoriteCount ?? 0,
    replies:  raw.replyCount   ?? raw.replies  ?? 0,
    quotes:   raw.quoteCount   ?? raw.quotes   ?? 0,
    retweets: raw.retweetCount ?? raw.retweets ?? 0,
  };
}

export async function searchTweets({ searchTerms, maxItems = 50, language = 'en' }) {
  if (!searchTerms?.length) return [];

  const input = {
    searchTerms,
    maxItems,
    sort: 'Latest',
    tweetLanguage: language,
  };

  log.info('apify_run_start', { actor: env.APIFY_TWEET_ACTOR, searchTerms, maxItems });
  const run = await client().actor(env.APIFY_TWEET_ACTOR).call(input, { waitSecs: 180 });
  const { items } = await client().dataset(run.defaultDatasetId).listItems();
  log.info('apify_run_done', { items: items.length, runId: run.id });

  return items
    .map(normalize)
    .filter((t) => t.tweet_id && t.text && t.url && t.created_at);
}
