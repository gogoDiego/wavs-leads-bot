// Long-running worker: ticks every TICK_MS, checks for due funnels, runs them.
// Same logic works for a future GitHub Actions one-shot — just invoke runDueFunnels once.

import { log } from '../lib/log.js';
import { runDueFunnels } from './runDueFunnels.js';

const TICK_MS = Number(process.env.WORKER_TICK_MS ?? 5 * 60_000);

let running = false;
async function tick() {
  if (running) {
    log.warn('tick_skipped_overlap');
    return;
  }
  running = true;
  try {
    await runDueFunnels();
  } catch (err) {
    log.error('tick_failed', { error: String(err) });
  } finally {
    running = false;
  }
}

(async () => {
  log.info('worker_starting', { tick_ms: TICK_MS });
  await tick();
  setInterval(tick, TICK_MS);
  log.info('worker_ready');
})();

process.stdin.resume();
