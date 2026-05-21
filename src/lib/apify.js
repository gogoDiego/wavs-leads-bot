import { ApifyClient } from 'apify-client';
import { env } from './env.js';
import { log } from './log.js';

let _client;
function client() {
  if (!env.APIFY_TOKEN) throw new Error('APIFY_TOKEN is required to run the worker');
  if (!_client) _client = new ApifyClient({ token: env.APIFY_TOKEN });
  return _client;
}

// Normalize tweet objects from any of the actors we've used.
// apidojo:   id, text, url, createdAt, author.userName, likeCount, retweetCount, replyCount, quoteCount
// Scweet:    id, text, tweet_url, created_at, handle,    favorite_count, retweet_count, reply_count, quote_count
function normalize(raw) {
  const author = raw.handle
    || raw.author?.userName
    || raw.author?.username
    || raw.author?.handle
    || raw.user?.username;
  const created = raw.createdAt || raw.created_at || raw.date;
  const url = raw.url
    || raw.tweet_url
    || (author && raw.id ? `https://twitter.com/${author}/status/${raw.id}` : null);
  return {
    tweet_id:   String(raw.id ?? raw.tweetId ?? raw.conversationId ?? raw.conversation_id ?? ''),
    text:       raw.text ?? raw.fullText ?? '',
    url,
    author,
    created_at: created ? new Date(created) : null,
    likes:    raw.likeCount    ?? raw.favoriteCount ?? raw.favorite_count ?? raw.likes    ?? 0,
    replies:  raw.replyCount   ?? raw.reply_count   ?? raw.replies  ?? 0,
    quotes:   raw.quoteCount   ?? raw.quote_count   ?? raw.quotes   ?? 0,
    retweets: raw.retweetCount ?? raw.retweet_count ?? raw.retweets ?? 0,
  };
}

// Build the actor's input shape. apidojo's tweet-scraper takes an array of
// searchTerms; Scweet takes a single search_query. We pick based on actor slug
// so swapping actors stays a one-env-var change.
function buildInput({ searchTerms, maxItems, language }) {
  const slug = env.APIFY_TWEET_ACTOR.toLowerCase();
  if (slug.includes('scweet')) {
    return {
      source_mode:  'search',
      search_query: searchTerms[0],
      max_items:    Math.max(100, maxItems),
      lang:         language,
      search_sort:  'Latest',
    };
  }
  // Default: apidojo-style (also works for several other actors).
  return {
    searchTerms,
    maxItems,
    sort: 'Latest',
    tweetLanguage: language,
  };
}

export async function searchTweets({ searchTerms, maxItems = 100, language = 'en' }) {
  if (!searchTerms?.length) return [];

  const input = buildInput({ searchTerms, maxItems, language });

  log.info('apify_run_start', { actor: env.APIFY_TWEET_ACTOR, queries: searchTerms.length, maxItems });
  const run = await client().actor(env.APIFY_TWEET_ACTOR).call(input, { waitSecs: 180 });
  const { items } = await client().dataset(run.defaultDatasetId).listItems();
  log.info('apify_run_done', { items: items.length, runId: run.id });

  return items
    .map(normalize)
    .filter((t) => t.tweet_id && t.text && t.url && t.created_at);
}
