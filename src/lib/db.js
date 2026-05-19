import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ── funnels ──────────────────────────────────────────────────────────────
export async function createFunnel(row) {
  const { data, error } = await supabase.from('funnels').insert(row).select().single();
  if (error) throw error;
  return data;
}

export async function getFunnelById(id) {
  const { data, error } = await supabase.from('funnels').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getFunnelByName(ownerSlackId, name) {
  const { data, error } = await supabase
    .from('funnels')
    .select('*')
    .eq('owner_slack_id', ownerSlackId)
    .ilike('name', name)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function findFunnelByNameAnyOwner(name) {
  const { data, error } = await supabase
    .from('funnels')
    .select('*')
    .ilike('name', name)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function listFunnelsByOwner(ownerSlackId) {
  const { data, error } = await supabase
    .from('funnels')
    .select('*')
    .eq('owner_slack_id', ownerSlackId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function listActiveFunnels() {
  const { data, error } = await supabase
    .from('funnels')
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function addSpend(funnelId, amountUsd) {
  if (!amountUsd) return;
  const { error } = await supabase.rpc('increment_funnel_spend', {
    p_funnel_id: funnelId,
    p_amount: amountUsd,
  });
  // RPC may not exist yet — fall back to a read-modify-write that's good enough for v1.
  if (error) {
    const { data: row } = await supabase.from('funnels').select('spent_this_month_usd').eq('id', funnelId).single();
    const next = Number(row?.spent_this_month_usd ?? 0) + Number(amountUsd);
    await supabase.from('funnels').update({ spent_this_month_usd: next }).eq('id', funnelId);
  }
}

// ── seen_tweets ──────────────────────────────────────────────────────────
export async function filterUnseenTweetIds(tweetIds) {
  if (!tweetIds.length) return new Set();
  const { data, error } = await supabase
    .from('seen_tweets')
    .select('tweet_id')
    .in('tweet_id', tweetIds);
  if (error) throw error;
  const seen = new Set((data ?? []).map((r) => r.tweet_id));
  return new Set(tweetIds.filter((id) => !seen.has(id)));
}

export async function recordSeenTweets(tweetIds) {
  if (!tweetIds.length) return;
  const rows = tweetIds.map((tweet_id) => ({ tweet_id }));
  const { error } = await supabase.from('seen_tweets').upsert(rows, { onConflict: 'tweet_id' });
  if (error) throw error;
}

// ── candidates ───────────────────────────────────────────────────────────
export async function insertCandidate(row) {
  const { data, error } = await supabase.from('candidates').insert(row).select().single();
  if (error) throw error;
  return data;
}

export async function markCandidatePosted(candidateId, postedTs) {
  const { error } = await supabase
    .from('candidates')
    .update({ posted: true, posted_ts: postedTs })
    .eq('id', candidateId);
  if (error) throw error;
}
