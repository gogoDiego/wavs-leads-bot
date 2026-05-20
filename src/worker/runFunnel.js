import { WebClient } from '@slack/web-api';

import { env } from '../lib/env.js';
import { log } from '../lib/log.js';
import { searchTweets } from '../lib/apify.js';
import { velocity, hoursSince } from '../lib/velocity.js';
import { scoreTweet } from '../lib/claude.js';
import {
  filterUnseenTweetIds,
  recordSeenTweets,
  insertCandidate,
  markCandidatePosted,
  addSpend,
} from '../lib/db.js';
import { buildLeadCard } from '../slack/views/leadCard.js';

// Safety cap so a runaway query can't trigger 1000 Claude calls.
const MAX_TO_SCORE = 40;

let _slack;
function slack() {
  if (!_slack) _slack = new WebClient(env.SLACK_BOT_TOKEN);
  return _slack;
}

export async function runFunnel(funnel) {
  const t0 = Date.now();
  const summary = {
    funnel: funnel.name,
    fetched: 0,
    unseen: 0,
    passed_velocity: 0,
    scored: 0,
    qualified: 0,
    posted: 0,
    cost_usd: 0,
    error: null,
  };

  try {
    // 1. Fetch (Scweet rejects max_items < 100)
    const raw = await searchTweets({
      searchTerms: funnel.search_queries,
      maxItems: 100,
    });
    summary.fetched = raw.length;

    // 2. Age filter (max_age_hours)
    const now = new Date();
    const fresh = raw.filter((t) => hoursSince(t.created_at, now) <= funnel.max_age_hours);

    // 3. Global dedupe
    const unseenIds = await filterUnseenTweetIds(fresh.map((t) => t.tweet_id));
    const unseen = fresh.filter((t) => unseenIds.has(t.tweet_id));
    summary.unseen = unseen.length;

    // 4. Velocity filter + sort
    const withVelocity = unseen
      .map((t) => ({ tweet: t, v: velocity(t, now) }))
      .filter(({ v }) => v >= funnel.velocity_floor)
      .sort((a, b) => b.v - a.v);
    summary.passed_velocity = withVelocity.length;

    const toScore = withVelocity.slice(0, MAX_TO_SCORE);

    // 5. Claude scoring + persist
    const scoredRows = [];
    for (const { tweet, v } of toScore) {
      try {
        const result = await scoreTweet({ funnel, tweet });
        summary.cost_usd += result.cost_usd;
        const row = await insertCandidate({
          funnel_id:         funnel.id,
          tweet_id:          tweet.tweet_id,
          author_handle:     tweet.author,
          tweet_url:         tweet.url,
          tweet_text:        tweet.text,
          tweet_created_at:  tweet.created_at.toISOString(),
          likes:    tweet.likes,
          replies:  tweet.replies,
          quotes:   tweet.quotes,
          retweets: tweet.retweets,
          velocity: v,
          score:           result.score,
          suggested_angle: result.suggested_angle,
          reasoning:       result.reasoning,
          scoring_cost_usd: result.cost_usd,
        });
        scoredRows.push({ row, tweet, v, ...result });
        summary.scored += 1;
      } catch (err) {
        log.warn('score_failed', { tweet_id: tweet.tweet_id, error: String(err) });
      }
    }

    // 6. Always record seen — even for tweets we couldn't score, so we don't retry endlessly.
    await recordSeenTweets(toScore.map(({ tweet }) => tweet.tweet_id));

    // 7. Spend
    await addSpend(funnel.id, summary.cost_usd);

    // 8. Top-N qualified
    const qualified = scoredRows
      .filter((r) => r.score >= funnel.min_score)
      .sort((a, b) => b.score - a.score)
      .slice(0, funnel.max_per_digest);
    summary.qualified = qualified.length;

    // 9. Post cards
    for (const r of qualified) {
      const card = buildLeadCard({
        funnel,
        candidateId: r.row.id,
        tweet: r.tweet,
        score: r.score,
        suggested_angle: r.suggested_angle,
        velocity: r.v,
      });
      const resp = await slack().chat.postMessage({
        channel: env.SLACK_LEADS_CHANNEL_ID,
        text: card.text,
        blocks: card.blocks,
        unfurl_links: false,
        unfurl_media: false,
      });
      await markCandidatePosted(r.row.id, resp.ts);
      summary.posted += 1;
    }
  } catch (err) {
    summary.error = String(err);
    log.error('funnel_run_failed', { funnel: funnel.name, error: String(err) });
  }

  summary.duration_ms = Date.now() - t0;
  log.info('funnel_run_done', summary);
  return summary;
}
