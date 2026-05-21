// Vercel cron endpoint. Configured in vercel.json to fire every 30 min.
// Vercel sends `Authorization: Bearer <CRON_SECRET>` automatically when
// CRON_SECRET is set in the project's env vars.
//
// Manual trigger:
//   curl -H "Authorization: Bearer $CRON_SECRET" https://<your-domain>/api/worker
// Force-run all active funnels (skip per-funnel interval_hours check):
//   curl -H "Authorization: Bearer $CRON_SECRET" "https://<your-domain>/api/worker?force=1"
// Force-run a single funnel by name:
//   curl -H "Authorization: Bearer $CRON_SECRET" "https://<your-domain>/api/worker?funnel=smart-vault-leads"

import { env } from '../src/lib/env.js';
import { log } from '../src/lib/log.js';
import {
  runDueFunnels,
  runAllActive,
  runFunnelByName,
} from '../src/worker/runDueFunnels.js';
import { withWorkerLock } from '../src/lib/db.js';

function unauthorized(req) {
  const expected = env.CRON_SECRET;
  if (!expected) return false; // CRON_SECRET unset → don't gate (useful in dev)
  const auth = req.headers.authorization || req.headers.Authorization;
  return auth !== `Bearer ${expected}`;
}

export default async function handler(req, res) {
  if (unauthorized(req)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const funnelName = req.query?.funnel;
  const force = req.query?.force === '1' || req.url?.includes('force=1');

  try {
    const { skipped, reason, result } = await withWorkerLock(async () => {
      if (funnelName) return [await runFunnelByName(funnelName)];
      if (force)      return runAllActive();
      return runDueFunnels();
    });
    if (skipped) {
      log.warn('worker_skipped', { reason });
      res.status(200).json({ ok: true, skipped: true, reason });
      return;
    }
    res.status(200).json({ ok: true, ran: result.length, summaries: result });
  } catch (err) {
    if (err.code === 'FUNNEL_NOT_FOUND') {
      res.status(404).json({ error: err.message });
      return;
    }
    log.error('worker_endpoint_failed', { error: String(err) });
    res.status(500).json({ error: String(err) });
  }
}
