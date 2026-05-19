import cron from 'node-cron';

import { env } from '../lib/env.js';
import { log } from '../lib/log.js';
import { listActiveFunnels, getFunnelById } from '../lib/db.js';
import { runFunnel } from './runFunnel.js';

const RESYNC_MS = 60_000;

// funnel.id → { cron: string, task: ScheduledTask, running: boolean }
const tasks = new Map();

function scheduleFunnel(funnel) {
  if (!cron.validate(funnel.schedule_cron)) {
    log.warn('cron_invalid', { id: funnel.id, name: funnel.name, schedule: funnel.schedule_cron });
    return;
  }

  const entry = { cron: funnel.schedule_cron, task: null, running: false };

  const task = cron.schedule(
    funnel.schedule_cron,
    async () => {
      if (entry.running) {
        log.warn('cron_skipped_overlap', { id: funnel.id, name: funnel.name });
        return;
      }
      entry.running = true;
      try {
        // Re-read so we don't run with stale config (e.g. just-paused).
        const fresh = await getFunnelById(funnel.id);
        if (!fresh || fresh.status !== 'active') {
          log.info('cron_skipped_inactive', { id: funnel.id, name: funnel.name });
          return;
        }
        await runFunnel(fresh);
      } catch (err) {
        log.error('cron_run_failed', { id: funnel.id, error: String(err) });
      } finally {
        entry.running = false;
      }
    },
    { timezone: env.TZ },
  );

  entry.task = task;
  tasks.set(funnel.id, entry);
  log.info('cron_scheduled', { id: funnel.id, name: funnel.name, schedule: funnel.schedule_cron });
}

async function syncFunnels() {
  const funnels = await listActiveFunnels();
  const activeIds = new Set(funnels.map((f) => f.id));

  // Drop tasks for funnels that disappeared or got paused.
  for (const [id, entry] of tasks) {
    if (!activeIds.has(id)) {
      entry.task.stop();
      tasks.delete(id);
      log.info('cron_removed', { id });
    }
  }

  // Add new funnels; reschedule any whose cron string changed.
  for (const f of funnels) {
    const existing = tasks.get(f.id);
    if (existing && existing.cron === f.schedule_cron) continue;
    if (existing) {
      existing.task.stop();
      tasks.delete(f.id);
    }
    scheduleFunnel(f);
  }
}

(async () => {
  log.info('worker_starting', { tz: env.TZ });
  await syncFunnels();
  log.info('worker_ready', { funnels: tasks.size });

  setInterval(() => {
    syncFunnels().catch((err) => log.error('sync_failed', { error: String(err) }));
  }, RESYNC_MS);
})();

// Keep the process alive even if all crons are removed.
process.stdin.resume();
