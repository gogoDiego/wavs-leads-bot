// Engagement-per-hour score. Used as a cheap pre-filter before paying for
// Claude scoring. Floor on hoursOld prevents fresh tweets from posting absurd
// velocity numbers.

const MIN_HOURS = 0.5;

export function hoursSince(createdAt, now = new Date()) {
  const created = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const ms = now.getTime() - created.getTime();
  return Math.max(ms / 3_600_000, MIN_HOURS);
}

export function velocity({ likes = 0, replies = 0, quotes = 0, retweets = 0, created_at }, now = new Date()) {
  const engagement = likes + replies * 2 + quotes * 5 + retweets * 3;
  return engagement / hoursSince(created_at, now);
}
