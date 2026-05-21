import pg from 'pg';
import { env } from './env.js';

// Single shared pool — pg manages connection reuse. For serverless (Vercel),
// each function instance gets its own pool; that's fine for our volume.
export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.DATABASE_URL.includes('sslmode=require') || env.DATABASE_URL.includes('neon.tech')
    ? { rejectUnauthorized: false }
    : undefined,
  max: 5,
});

async function q(text, params) {
  const r = await pool.query(text, params);
  return r.rows;
}
async function q1(text, params) {
  const rows = await q(text, params);
  return rows[0] ?? null;
}

// Postgres session-level advisory lock — auto-released when the connection
// closes, so a crashed worker won't leave the lock stuck.
const WORKER_LOCK_KEY = 4242;

export async function withWorkerLock(fn) {
  const client = await pool.connect();
  try {
    const { rows } = await client.query('select pg_try_advisory_lock($1) as locked', [WORKER_LOCK_KEY]);
    if (!rows[0].locked) return { skipped: true, reason: 'worker_lock_held' };
    try {
      const result = await fn();
      return { skipped: false, result };
    } finally {
      await client.query('select pg_advisory_unlock($1)', [WORKER_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

// ── funnels ──────────────────────────────────────────────────────────────
export async function createFunnel(row) {
  const cols = Object.keys(row);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  const values = cols.map((c) => row[c]);
  return q1(
    `insert into funnels (${cols.join(', ')}) values (${placeholders}) returning *`,
    values,
  );
}

export async function getFunnelById(id) {
  return q1('select * from funnels where id = $1', [id]);
}

export async function getFunnelByName(ownerSlackId, name) {
  return q1(
    'select * from funnels where owner_slack_id = $1 and lower(name) = lower($2) limit 1',
    [ownerSlackId, name],
  );
}

export async function findFunnelByNameAnyOwner(name) {
  return q1(
    'select * from funnels where lower(name) = lower($1) order by created_at desc limit 1',
    [name],
  );
}

export async function listFunnelsByOwner(ownerSlackId) {
  return q(
    'select * from funnels where owner_slack_id = $1 order by created_at desc',
    [ownerSlackId],
  );
}

export async function listActiveFunnels() {
  return q("select * from funnels where status = 'active' order by created_at asc");
}

export async function updateFunnel(id, patch) {
  const cols = Object.keys(patch);
  if (!cols.length) return getFunnelById(id);
  const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
  const values = [id, ...cols.map((c) => patch[c])];
  return q1(
    `update funnels set ${sets} where id = $1 returning *`,
    values,
  );
}

export async function setFunnelStatus(id, status) {
  return q1(
    'update funnels set status = $2 where id = $1 returning *',
    [id, status],
  );
}

export async function deleteFunnel(id) {
  await q('delete from funnels where id = $1', [id]);
}

export async function markFunnelRan(id, when = new Date()) {
  await q('update funnels set last_run_at = $2 where id = $1', [id, when.toISOString()]);
}

export async function addSpend(funnelId, amountUsd) {
  if (!amountUsd) return;
  await q(
    'update funnels set spent_this_month_usd = spent_this_month_usd + $2 where id = $1',
    [funnelId, amountUsd],
  );
}

// ── seen_tweets ──────────────────────────────────────────────────────────
export async function filterUnseenTweetIds(tweetIds) {
  if (!tweetIds.length) return new Set();
  const rows = await q(
    'select tweet_id from seen_tweets where tweet_id = any($1::text[])',
    [tweetIds],
  );
  const seen = new Set(rows.map((r) => r.tweet_id));
  return new Set(tweetIds.filter((id) => !seen.has(id)));
}

export async function recordSeenTweets(tweetIds) {
  if (!tweetIds.length) return;
  await q(
    `insert into seen_tweets (tweet_id)
     select unnest($1::text[])
     on conflict (tweet_id) do nothing`,
    [tweetIds],
  );
}

// ── candidates ───────────────────────────────────────────────────────────
export async function insertCandidate(row) {
  const cols = Object.keys(row);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  const values = cols.map((c) => row[c]);
  return q1(
    `insert into candidates (${cols.join(', ')}) values (${placeholders}) returning *`,
    values,
  );
}

export async function markCandidatePosted(candidateId, postedTs) {
  await q(
    'update candidates set posted = true, posted_ts = $2 where id = $1',
    [candidateId, postedTs],
  );
}

export async function getCandidateById(id) {
  return q1('select * from candidates where id = $1', [id]);
}

export async function getRecentCandidatesForFunnel(funnelId, limit = 8) {
  return q(
    `select id, score, posted, author_handle, tweet_text, tweet_url, velocity, reasoning, created_at
     from candidates
     where funnel_id = $1
     order by created_at desc
     limit $2`,
    [funnelId, limit],
  );
}

// ── feedback ─────────────────────────────────────────────────────────────
export async function insertFeedback({ candidate_id, user_slack_id, kind }) {
  await q(
    `insert into feedback (candidate_id, user_slack_id, kind)
     values ($1, $2, $3)
     on conflict (candidate_id, user_slack_id, kind) do nothing`,
    [candidate_id, user_slack_id, kind],
  );
}

// ── stats ────────────────────────────────────────────────────────────────
export async function getFunnelStats(funnelId) {
  const candidates = await q(
    'select id, score, posted, scoring_cost_usd from candidates where funnel_id = $1',
    [funnelId],
  );

  const total  = candidates.length;
  const posted = candidates.filter((c) => c.posted).length;
  const avg_score = total ? candidates.reduce((a, c) => a + (c.score || 0), 0) / total : 0;
  const total_cost = candidates.reduce((a, c) => a + Number(c.scoring_cost_usd || 0), 0);

  const counts = { good: 0, noise: 0, hide: 0, saved: 0 };
  if (candidates.length) {
    const ids = candidates.map((c) => c.id);
    const fb = await q(
      'select kind from feedback where candidate_id = any($1::uuid[])',
      [ids],
    );
    for (const row of fb) {
      if (counts[row.kind] !== undefined) counts[row.kind] += 1;
    }
  }

  return { total, posted, avg_score, total_cost, feedback: counts };
}
