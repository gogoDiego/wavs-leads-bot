// Worker entrypoints. Used by:
//   - api/worker.js (Vercel HTTP endpoint, fired by cron or curl)
//   - /funnel run slash command (in-process)
//   - scripts/runDueOnce.js (local manual)

import { listActiveFunnels, markFunnelRan, findFunnelByNameAnyOwner } from '../lib/db.js';
import { log } from '../lib/log.js';
import { runFunnel } from './runFunnel.js';

export function isDue(funnel, now = new Date()) {
  // interval_hours of 0 (or null/undefined) = manual-only funnel — never
  // auto-runs on a tick, only via /funnel run or the curl endpoint.
  if (!funnel.interval_hours) return false;
  if (!funnel.last_run_at) return true;
  const elapsedH = (now - new Date(funnel.last_run_at)) / 3_600_000;
  return elapsedH >= funnel.interval_hours;
}

async function runOne(f) {
  const summary = await runFunnel(f);
  // Always mark ran — even on error — so a broken funnel doesn't retry on every tick.
  await markFunnelRan(f.id);
  return summary;
}

export async function runDueFunnels({ now = new Date() } = {}) {
  const funnels = await listActiveFunnels();
  const due = funnels.filter((f) => isDue(f, now));

  if (!due.length) {
    log.debug('tick_no_due_funnels', { active: funnels.length });
    return [];
  }

  log.info('tick_running', { due: due.length, active: funnels.length });
  const summaries = [];
  for (const f of due) {
    summaries.push(await runOne(f));
  }
  return summaries;
}

// Force-run every active funnel regardless of interval. Used by /funnel run
// and by ?force=1 on /api/worker.
export async function runAllActive() {
  const funnels = await listActiveFunnels();
  if (!funnels.length) {
    log.info('run_all_no_active_funnels');
    return [];
  }
  log.info('run_all_active', { count: funnels.length });
  const summaries = [];
  for (const f of funnels) {
    summaries.push(await runOne(f));
  }
  return summaries;
}

// Force-run one funnel by name (any owner — useful for "run someone's funnel
// for me" patterns). Throws if no funnel matches.
export async function runFunnelByName(name) {
  const f = await findFunnelByNameAnyOwner(name);
  if (!f) {
    const err = new Error(`No funnel named "${name}" found.`);
    err.code = 'FUNNEL_NOT_FOUND';
    throw err;
  }
  return runOne(f);
}
