import {
  listFunnelsByOwner,
  getFunnelByName,
  setFunnelStatus,
  deleteFunnel,
  getFunnelStats,
  findFunnelByNameAnyOwner,
  createFunnel,
} from '../../lib/db.js';
import { openNewFunnelSimpleModal } from '../modals/newFunnelSimple.js';
import { openNewFunnelAdvancedModal } from '../modals/newFunnelAdvanced.js';

const STUB = (sub) =>
  `\`${sub}\` is coming in a later phase. Available now: \`/funnel new | list | pause <name> | delete <name> | stats <name> | edit <name> [advanced] | fork <name>\`.`;

function describeSchedule(funnel) {
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
      response_type: 'ephemeral',
      text: 'You don\'t have any funnels yet. Run `/funnel new` to make one.',
    });
    return;
  }

  const lines = rows.map((f) => {
    const statusIcon = f.status === 'active' ? '🟢' : '⏸️';
    return `${statusIcon} *${f.name}* — ${f.status}, ${describeSchedule(f)}, last run ${describeLastRun(f)}, min_score ${f.min_score}`;
  });

  await respond({
    response_type: 'ephemeral',
    text: `Your funnels:\n${lines.join('\n')}`,
  });
}

async function handlePause({ ownerSlackId, name, respond }) {
  if (!name) {
    await respond({ response_type: 'ephemeral', text: 'Usage: `/funnel pause <name>`' });
    return;
  }
  const f = await getFunnelByName(ownerSlackId, name);
  if (!f) {
    await respond({ response_type: 'ephemeral', text: `No funnel named *${name}* found.` });
    return;
  }
  if (f.status === 'paused') {
    await respond({ response_type: 'ephemeral', text: `*${f.name}* is already paused.` });
    return;
  }
  await setFunnelStatus(f.id, 'paused');
  await respond({
    response_type: 'ephemeral',
    text: `⏸️ *${f.name}* paused. The worker will skip it on the next tick. To resume, run \`/funnel edit ${f.name} advanced\` and flip status to active.`,
  });
}

function pct(n, total) {
  if (!total) return '0%';
  return `${Math.round((n / total) * 100)}%`;
}

async function handleStats({ ownerSlackId, name, respond }) {
  if (!name) {
    await respond({ response_type: 'ephemeral', text: 'Usage: `/funnel stats <name>`' });
    return;
  }
  const f = await getFunnelByName(ownerSlackId, name);
  if (!f) {
    await respond({ response_type: 'ephemeral', text: `No funnel named *${name}* found.` });
    return;
  }
  const s = await getFunnelStats(f.id);
  const fb = s.feedback;
  const lines = [
    `📊 *${f.name}*`,
    `Status: ${f.status === 'active' ? '🟢 active' : '⏸️ paused'} · ${describeSchedule(f)} · last run ${describeLastRun(f)}`,
    `Candidates scored: *${s.total}* · posted: *${s.posted}* · avg score *${s.avg_score.toFixed(1)}*`,
    s.posted
      ? `Feedback (of ${s.posted} posted): 👍 ${fb.good} (${pct(fb.good, s.posted)}) · 👎 ${fb.noise} (${pct(fb.noise, s.posted)}) · 📌 ${fb.saved} (${pct(fb.saved, s.posted)}) · 🙈 ${fb.hide} (${pct(fb.hide, s.posted)})`
      : `Feedback: nothing posted yet.`,
    `Spend: $${Number(f.spent_this_month_usd).toFixed(2)} / $${Number(f.budget_monthly_usd).toFixed(2)} this month (lifetime scoring cost: $${s.total_cost.toFixed(4)})`,
  ];
  await respond({ response_type: 'ephemeral', text: lines.join('\n') });
}

async function handleEdit({ ownerSlackId, name, mode, client, trigger_id, respond }) {
  if (!name) {
    await respond({ response_type: 'ephemeral', text: 'Usage: `/funnel edit <name> [advanced]`' });
    return;
  }
  const f = await getFunnelByName(ownerSlackId, name);
  if (!f) {
    await respond({ response_type: 'ephemeral', text: `No funnel named *${name}* found.` });
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
    await respond({ response_type: 'ephemeral', text: 'Usage: `/funnel fork <name>`' });
    return;
  }
  const src = await findFunnelByNameAnyOwner(name);
  if (!src) {
    await respond({ response_type: 'ephemeral', text: `No funnel named *${name}* found.` });
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
    response_type: 'ephemeral',
    text: `🍴 Forked *${src.name}* (owned by <@${src.owner_slack_id}>) → *${row.name}*. Run \`/funnel edit ${row.name}\` to tune before it runs.`,
  });
}

async function handleDelete({ ownerSlackId, name, confirm, respond }) {
  if (!name) {
    await respond({ response_type: 'ephemeral', text: 'Usage: `/funnel delete <name> confirm`' });
    return;
  }
  const f = await getFunnelByName(ownerSlackId, name);
  if (!f) {
    await respond({ response_type: 'ephemeral', text: `No funnel named *${name}* found.` });
    return;
  }
  if (!confirm) {
    await respond({
      response_type: 'ephemeral',
      text: `⚠️ This will permanently delete *${f.name}* and all its candidates + feedback. To proceed, run:\n\`/funnel delete ${f.name} confirm\``,
    });
    return;
  }
  await deleteFunnel(f.id);
  await respond({
    response_type: 'ephemeral',
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
        case 'new':
          await openNewFunnelSimpleModal({ client, trigger_id: command.trigger_id });
          return;

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

        case 'fork': {
          const name = tokens.slice(1).join(' ').trim();
          await handleFork({ ownerSlackId, name, respond });
          return;
        }

        case 'show':
          await respond({ response_type: 'ephemeral', text: STUB(sub) });
          return;

        default:
          await respond({
            response_type: 'ephemeral',
            text: `Unknown subcommand: \`${sub}\`. Try \`/funnel list\`.`,
          });
      }
    } catch (err) {
      await respond({
        response_type: 'ephemeral',
        text: `Something broke handling \`/funnel ${command.text}\`: ${err.message}`,
      });
    }
  });
}
