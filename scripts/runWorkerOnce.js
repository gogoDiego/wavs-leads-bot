#!/usr/bin/env node
// Manually trigger a single funnel run. Usage:
//   npm run worker:once -- <funnel-name>
//   npm run worker:once -- --all          # run every active funnel sequentially
//
// Useful for Phase 2 verification before cron is wired up.

import { runFunnel } from '../src/worker/runFunnel.js';
import { findFunnelByNameAnyOwner, listActiveFunnels } from '../src/lib/db.js';

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('usage: npm run worker:once -- <funnel-name>');
    console.error('       npm run worker:once -- --all');
    process.exit(2);
  }

  let funnels;
  if (arg === '--all') {
    funnels = await listActiveFunnels();
    if (!funnels.length) { console.error('no active funnels'); process.exit(1); }
  } else {
    const f = await findFunnelByNameAnyOwner(arg);
    if (!f) { console.error(`no funnel named "${arg}"`); process.exit(1); }
    funnels = [f];
  }

  for (const f of funnels) {
    const summary = await runFunnel(f);
    console.log(JSON.stringify(summary, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
