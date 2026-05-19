import {
  listFunnelsByOwner,
  getFunnelByName,
  setFunnelStatus,
  deleteFunnel,
} from '../../lib/db.js';
import { openNewFunnelSimpleModal } from '../modals/newFunnelSimple.js';

const STUB = (sub) =>
  `\`${sub}\` is coming in a later phase. Available now: \`/funnel new | list | pause <name> | delete <name>\`.`;

// Reverse of FREQUENCY_TO_CRON in newFunnelSimple.js — just for display.
const CRON_LABEL = {
  '0 */3 * * *':      'every 3h',
  '0 9,13,17 * * *':  '9 AM / 1 PM / 5 PM CT',
  '0 9 * * *':        'once daily (9 AM CT)',
};

function describeSchedule(cron) {
  return CRON_LABEL[cron] || `cron \`${cron}\``;
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
    return `${statusIcon} *${f.name}* — ${f.status}, ${describeSchedule(f.schedule_cron)}, min_score ${f.min_score}, top ${f.max_per_digest}/digest`;
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
    text: `⏸️ *${f.name}* paused. The worker will stop scheduling it within ~60s. (To resume in v1, edit the row in Supabase; \`/funnel edit\` is Phase 5.)`,
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

        case 'show':
        case 'edit':
        case 'stats':
        case 'fork':
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
