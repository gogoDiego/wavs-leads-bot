import { waitUntil } from '@vercel/functions';

import { env } from '../../lib/env.js';
import {
  listFunnelsByOwner,
  getFunnelByName,
  setFunnelStatus,
  deleteFunnel,
  getFunnelStats,
  findFunnelByNameAnyOwner,
  createFunnel,
  withWorkerLock,
} from '../../lib/db.js';
import { runAllActive, runFunnelByName } from '../../worker/runDueFunnels.js';
import { openNewFunnelSimpleModal } from '../modals/newFunnelSimple.js';
import { openNewFunnelAdvancedModal } from '../modals/newFunnelAdvanced.js';
import { openNewFunnelAiModal } from '../modals/newFunnelAi.js';

const STUB = (sub) =>
  `\`${sub}\` is coming in a later phase. Available now: \`/funnel new | list | pause <name> | delete <name> | stats <name> | edit <name> [advanced] | fork <name> | run [name]\`.`;

function describeSchedule(funnel) {
  if (!funnel.interval_hours) return 'manual only';
  return `every ${funnel.interval_hours}h`;
}

function describeLastRun(funnel) {
  if (!funnel.last_run_at) return 'never run';
  const hoursAgo = (Date.now() - new Date(funnel.last_run_at).getTime()) / 3_600_000;
  if (hoursAgo < 1) return `${Math.round(hoursAgo * 60)}min ago`;
  return `${hoursAgo.toFixed(1)}h ago`;
}

async function handleList({ ownerSlackId, respond }) {
  const rows = await listFunnelsByOwner(ownerSlackId);
  if (!rows.length) {
    await respond({
      response_type: 'in_channel',
      text: 'You don\'t have any funnels yet. Run `/funnel new` to make one.',
    });
    return;
  }

  const lines = rows.map((f) => {
    const statusIcon = f.status === 'active' ? '🟢' : '⏸️';
    return `${statusIcon} *${f.name}* — ${f.status}, ${describeSchedule(f)}, last run ${describeLastRun(f)}, min_score ${f.min_score}`;
  });

  await respond({
    response_type: 'in_channel',
    text: `Your funnels:\n${lines.join('\n')}`,
  });
}

async function handlePause({ ownerSlackId, name, respond }) {
  if (!name) {
    await respond({ response_type: 'in_channel', text: 'Usage: `/funnel pause <name>`' });
    return;
  }
  const f = await getFunnelByName(ownerSlackId, name);
  if (!f) {
    await respond({ response_type: 'in_channel', text: `No funnel named *${name}* found.` });
    return;
  }
  if (f.status === 'paused') {
    await respond({ response_type: 'in_channel', text: `*${f.name}* is already paused.` });
    return;
  }
  await setFunnelStatus(f.id, 'paused');
  await respond({
    response_type: 'in_channel',
    text: `⏸️ *${f.name}* paused. The worker will skip it on the next tick. To resume, run \`/funnel edit ${f.name} advanced\` and flip status to active.`,
  });
}

function pct(n, total) {
  if (!total) return '0%';
  return `${Math.round((n / total) * 100)}%`;
}

async function handleStats({ ownerSlackId, name, respond }) {
  if (!name) {
    await respond({ response_type: 'in_channel', text: 'Usage: `/funnel stats <name>`' });
    return;
  }
  const f = await getFunnelByName(ownerSlackId, name);
  if (!f) {
    await respond({ response_type: 'in_channel', text: `No funnel named *${name}* found.` });
    return;
  }
  const s = await getFunnelStats(f.id);
  const fb = s.feedback;
  const lines = [
    `📊 *${f.name}*`,
    `Status: ${f.status === 'active' ? '🟢 active' : '⏸️ paused'} · ${describeSchedule(f)} · last run ${describeLastRun(f)}`,
    `Candidates scored: *${s.total}* · posted: *${s.posted}* · avg score *${s.avg_score.toFixed(1)}*`,
    s.posted
      ? `Reactions (of ${s.posted} posted): 📌 ${fb.saved} (${pct(fb.saved, s.posted)}) · 🙈 ${fb.hide} (${pct(fb.hide, s.posted)})`
      : `Reactions: nothing posted yet.`,
    `Spend: $${Number(f.spent_this_month_usd).toFixed(2)} / $${Number(f.budget_monthly_usd).toFixed(2)} this month (lifetime scoring cost: $${s.total_cost.toFixed(4)})`,
  ];
  await respond({ response_type: 'in_channel', text: lines.join('\n') });
}

async function handleRun({ name, respond }) {
  const label = name ? `*${name}*` : 'all active funnels';
  const startTime = Date.now();

  // Initial "Running…" ephemeral. Includes a hint so the message is
  // self-contained even if our cleanup path fails (e.g., 60s function
  // timeout) — user knows what to do without a stuck mystery message.
  await respond({
    response_type: 'ephemeral',
    text: `🤖 Running ${label}…\n_Results will land in <#${env.SLACK_LEADS_CHANNEL_ID}> in 30–60s. If nothing appears in 2 minutes, the worker may have timed out — try \`/funnel run\` again or check Vercel logs._`,
  });

  waitUntil((async () => {
    let runError = null;
    try {
      await withWorkerLock(async () => {
        if (name) return [await runFunnelByName(name)];
        return runAllActive();
      });
    } catch (err) {
      runError = err;
      console.error('funnel_run_failed', { name, error: err.message, code: err.code });
    }

    const durationS = Math.round((Date.now() - startTime) / 1000);

    // Try delete_original first — cleanest UX on success. If Slack rejects
    // it (some response_url variants need a body), fall back to a final
    // status message so the user always sees a resolution.
    try {
      await respond({ delete_original: true });
    } catch (deleteErr) {
      const finalText = runError
        ? (runError.code === 'FUNNEL_NOT_FOUND'
            ? `❌ ${runError.message} Try \`/funnel list\` to see exact names.`
            : `❌ Run failed after ${durationS}s: ${runError.message}`)
        : `✅ Done in ${durationS}s. See <#${env.SLACK_LEADS_CHANNEL_ID}>.`;
      try {
        await respond({ response_type: 'ephemeral', replace_original: true, text: finalText });
      } catch (replaceErr) {
        console.warn('funnel_run_ephemeral_finalize_failed', { delete: deleteErr.message, replace: replaceErr.message });
      }
    }
  })());
}

async function handleEdit({ ownerSlackId, name, mode, client, trigger_id, respond }) {
  if (!name) {
    await respond({ response_type: 'in_channel', text: 'Usage: `/funnel edit <name> [advanced]`' });
    return;
  }
  const f = await getFunnelByName(ownerSlackId, name);
  if (!f) {
    await respond({ response_type: 'in_channel', text: `No funnel named *${name}* found.` });
    return;
  }
  const chosen = mode || f.prompt_mode || 'simple';
  if (chosen === 'advanced') {
    await openNewFunnelAdvancedModal({ client, trigger_id, funnel: f });
  } else {
    await openNewFunnelSimpleModal({ client, trigger_id, funnel: f });
  }
}

async function handleFork({ ownerSlackId, name, respond }) {
  if (!name) {
    await respond({ response_type: 'in_channel', text: 'Usage: `/funnel fork <name>`' });
    return;
  }
  const src = await findFunnelByNameAnyOwner(name);
  if (!src) {
    await respond({ response_type: 'in_channel', text: `No funnel named *${name}* found.` });
    return;
  }

  // Pick a non-colliding name for the caller.
  const base = `${src.name}-copy`;
  let candidate = base;
  for (let i = 2; i <= 20; i += 1) {
    if (!(await getFunnelByName(ownerSlackId, candidate))) break;
    candidate = `${base}-${i}`;
  }

  const row = await createFunnel({
    owner_slack_id:    ownerSlackId,
    name:              candidate,
    status:            'active',
    search_queries:    src.search_queries,
    prompt_mode:       src.prompt_mode,
    simple_config:     src.simple_config,
    relevance_prompt:  src.relevance_prompt,
    min_score:         src.min_score,
    velocity_floor:    src.velocity_floor,
    max_age_hours:     src.max_age_hours,
    max_per_digest:    src.max_per_digest,
    schedule_cron:     src.schedule_cron,
    budget_monthly_usd: src.budget_monthly_usd,
    // spent_this_month_usd resets to 0 via default.
  });

  await respond({
    response_type: 'in_channel',
    text: `🍴 Forked *${src.name}* (owned by <@${src.owner_slack_id}>) → *${row.name}*. Run \`/funnel edit ${row.name}\` to tune before it runs.`,
  });
}

async function handleDelete({ ownerSlackId, name, confirm, respond }) {
  if (!name) {
    await respond({ response_type: 'in_channel', text: 'Usage: `/funnel delete <name> confirm`' });
    return;
  }
  const f = await getFunnelByName(ownerSlackId, name);
  if (!f) {
    await respond({ response_type: 'in_channel', text: `No funnel named *${name}* found.` });
    return;
  }
  if (!confirm) {
    await respond({
      response_type: 'in_channel',
      text: `⚠️ This will permanently delete *${f.name}* and all its candidates + feedback. To proceed, run:\n\`/funnel delete ${f.name} confirm\``,
    });
    return;
  }
  await deleteFunnel(f.id);
  await respond({
    response_type: 'in_channel',
    text: `🗑️ Deleted *${f.name}*.`,
  });
}

export function registerFunnelCommand(app) {
  app.command('/funnel', async ({ command, ack, client, respond }) => {
    await ack();

    const tokens = (command.text || '').trim().split(/\s+/).filter(Boolean);
    const sub = tokens[0];
    const ownerSlackId = command.user_id;

    try {
      switch (sub) {
        case undefined:
        case 'new': {
          // `/funnel new`      → simple modal (manual entry)
          // `/funnel new ai`   → AI-build (intent → preview → save)
          // `/funnel new adv*` → advanced modal (full control)
          const mode = tokens[1];
          if (mode === 'ai') {
            await openNewFunnelAiModal({ client, trigger_id: command.trigger_id });
          } else if (mode === 'advanced' || mode === 'adv') {
            await openNewFunnelAdvancedModal({ client, trigger_id: command.trigger_id });
          } else {
            await openNewFunnelSimpleModal({ client, trigger_id: command.trigger_id });
          }
          return;
        }

        case 'list':
          await handleList({ ownerSlackId, respond });
          return;

        case 'pause': {
          const name = tokens.slice(1).join(' ').trim();
          await handlePause({ ownerSlackId, name, respond });
          return;
        }

        case 'delete': {
          const rest = tokens.slice(1);
          const confirm = rest[rest.length - 1] === 'confirm';
          const name = (confirm ? rest.slice(0, -1) : rest).join(' ').trim();
          await handleDelete({ ownerSlackId, name, confirm, respond });
          return;
        }

        case 'stats': {
          const name = tokens.slice(1).join(' ').trim();
          await handleStats({ ownerSlackId, name, respond });
          return;
        }

        case 'edit': {
          const rest = tokens.slice(1);
          const last = rest[rest.length - 1];
          const mode = last === 'advanced' || last === 'simple' ? last : null;
          const name = (mode ? rest.slice(0, -1) : rest).join(' ').trim();
          await handleEdit({ ownerSlackId, name, mode, client, trigger_id: command.trigger_id, respond });
          return;
        }

        case 'run': {
          const name = tokens.slice(1).join(' ').trim() || null;
          await handleRun({ name, respond });
          return;
        }

        case 'fork': {
          const name = tokens.slice(1).join(' ').trim();
          await handleFork({ ownerSlackId, name, respond });
          return;
        }

        case 'show':
          await respond({ response_type: 'in_channel', text: STUB(sub) });
          return;

        default:
          await respond({
            response_type: 'in_channel',
            text: `Unknown subcommand: \`${sub}\`. Try \`/funnel list\`.`,
          });
      }
    } catch (err) {
      // Surface Slack WebAPI error details to Vercel logs — err.message alone
      // is too vague ("invalid_arguments") to pinpoint a malformed view field.
      console.error('funnel_command_failed', {
        command: command.text,
        error: err.message,
        data: err.data ? JSON.stringify(err.data) : undefined,
      });
      await respond({
        response_type: 'in_channel',
        text: `Something broke handling \`/funnel ${command.text}\`: ${err.message}`,
      });
    }
  });
}
