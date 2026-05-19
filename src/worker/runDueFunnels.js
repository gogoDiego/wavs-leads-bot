// Pure function: find active funnels whose interval_hours has elapsed since
// last_run_at, run each, mark ran. Used by:
//   - src/worker/index.js (Railway-style long-running loop)
//   - eventually a GitHub Actions one-shot script

import { listActiveFunnels, markFunnelRan } from '../lib/db.js';
import { log } from '../lib/log.js';
import { runFunnel } from './runFunnel.js';

export function isDue(funnel, now = new Date()) {
  if (!funnel.last_run_at) return true;
  const elapsedH = (now - new Date(funnel.last_run_at)) / 3_600_000;
  return elapsedH >= funnel.interval_hours;
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
    const summary = await runFunnel(f);
    // Always mark ran — even on error — so a broken funnel doesn't retry on every tick.
    await markFunnelRan(f.id);
    summaries.push(summary);
  }
  return summaries;
}
