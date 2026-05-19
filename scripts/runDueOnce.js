#!/usr/bin/env node
// One-shot worker invocation. Used by GitHub Actions on a schedule.
// Runs every active funnel that's due (last_run_at + interval_hours has passed),
// then exits. Idempotent — re-running mid-tick just no-ops on not-yet-due funnels.

import { runDueFunnels } from '../src/worker/runDueFunnels.js';

(async () => {
  const summaries = await runDueFunnels();
  for (const s of summaries) {
    console.log(JSON.stringify(s));
  }
  // Force exit — pg pool keeps the event loop alive otherwise.
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
