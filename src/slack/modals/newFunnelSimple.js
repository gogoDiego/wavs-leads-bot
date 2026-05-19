import { createFunnel, getFunnelByName, updateFunnel } from '../../lib/db.js';
import { assembleSimplePrompt } from '../../lib/prompt.js';
import { log } from '../../lib/log.js';

const CALLBACK_ID = 'funnel_simple';

const FREQUENCY_TO_CRON = {
  every_3h:    '0 */3 * * *',
  business_ct: '0 9,13,17 * * *',
  once_daily:  '0 9 * * *',
};

const FREQUENCY_LABELS = {
  every_3h:    'Every 3 hours',
  business_ct: '9 AM / 1 PM / 5 PM CT',
  once_daily:  'Once daily (9 AM CT)',
};

function freqOption(value) {
  return { text: { type: 'plain_text', text: FREQUENCY_LABELS[value] }, value };
}

function buildView({ funnel } = {}) {
  const cfg = funnel?.simple_config ?? {};
  const isEdit = !!funnel;

  const initialFrequency = cfg.frequency && FREQUENCY_LABELS[cfg.frequency] ? cfg.frequency : 'every_3h';

  const initial = (v) => (v == null ? undefined : String(v));

  const view = {
    type: 'modal',
    callback_id: CALLBACK_ID,
    private_metadata: isEdit ? JSON.stringify({ funnel_id: funnel.id }) : '',
    title:  { type: 'plain_text', text: isEdit ? 'Edit funnel' : 'New funnel' },
    submit: { type: 'plain_text', text: isEdit ? 'Save' : 'Create' },
    close:  { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'name',
        label: { type: 'plain_text', text: 'Funnel name' },
        element: {
          type: 'plain_text_input',
          action_id: 'value',
          initial_value: initial(funnel?.name),
          placeholder: { type: 'plain_text', text: 'e.g. distributed-systems-builders' },
          max_length: 60,
        },
      },
      {
        type: 'input',
        block_id: 'icp',
        label: { type: 'plain_text', text: 'Ideal customer (2 sentences)' },
        element: {
          type: 'plain_text_input',
          action_id: 'value',
          multiline: true,
          initial_value: initial(cfg.icp),
          placeholder: {
            type: 'plain_text',
            text: 'Senior eng or platform lead at a startup building event-driven services. Likely already on Kafka/NATS and frustrated with custom glue code.',
          },
          max_length: 600,
        },
      },
      {
        type: 'input',
        block_id: 'keywords',
        optional: true,
        label: { type: 'plain_text', text: 'Boost keywords (comma-separated)' },
        element: {
          type: 'plain_text_input',
          action_id: 'value',
          initial_value: initial((cfg.keywords ?? []).join(', ')),
          placeholder: { type: 'plain_text', text: 'event-driven, kafka, durable execution, choreography' },
          max_length: 400,
        },
      },
      {
        type: 'input',
        block_id: 'hard_skips',
        optional: true,
        label: { type: 'plain_text', text: 'Hard skips (comma-separated, score capped at 3)' },
        element: {
          type: 'plain_text_input',
          action_id: 'value',
          initial_value: initial((cfg.hard_skips ?? []).join(', ')),
          placeholder: { type: 'plain_text', text: 'hiring, looking for job, crypto airdrop' },
          max_length: 400,
        },
      },
      {
        type: 'input',
        block_id: 'frequency',
        label: { type: 'plain_text', text: 'How often should we check?' },
        element: {
          type: 'radio_buttons',
          action_id: 'value',
          initial_option: freqOption(initialFrequency),
          options: Object.keys(FREQUENCY_LABELS).map(freqOption),
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: isEdit
              ? 'Search queries are auto-built from the keywords above. To hand-edit them (or any other threshold), run `/funnel edit <name> advanced`.'
              : 'Search queries, scoring thresholds, and budget will use sensible defaults. Use `/funnel edit <name> advanced` to tune them later.',
          },
        ],
      },
    ],
  };

  return view;
}

export async function openNewFunnelSimpleModal({ client, trigger_id, funnel }) {
  await client.views.open({ trigger_id, view: buildView({ funnel }) });
}

function splitCsv(s) {
  return (s || '')
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function registerNewFunnelSimpleModal(app) {
  app.view(CALLBACK_ID, async ({ ack, view, body, client }) => {
    const meta = view.private_metadata ? JSON.parse(view.private_metadata) : {};
    const funnel_id = meta.funnel_id;
    const isEdit = !!funnel_id;

    const v = view.state.values;
    const name       = v.name.value.value.trim();
    const icp        = v.icp.value.value.trim();
    const keywords   = splitCsv(v.keywords?.value?.value);
    const hard_skips = splitCsv(v.hard_skips?.value?.value);
    const frequency  = v.frequency.value.value.selected_option.value;
    const ownerSlackId = body.user.id;

    // Name uniqueness — only fight conflicts that aren't the current funnel.
    const existing = await getFunnelByName(ownerSlackId, name);
    if (existing && existing.id !== funnel_id) {
      await ack({
        response_action: 'errors',
        errors: { name: 'You already have a funnel with this name.' },
      });
      return;
    }

    await ack();

    try {
      const relevance_prompt = assembleSimplePrompt({ icp, keywords, hard_skips });
      const search_queries = keywords.length
        ? [keywords.map((k) => `"${k}"`).join(' OR ')]
        : [];

      const payload = {
        name,
        prompt_mode: 'simple',
        simple_config: { icp, keywords, hard_skips, frequency },
        relevance_prompt,
        search_queries,
        schedule_cron: FREQUENCY_TO_CRON[frequency],
      };

      let row;
      if (isEdit) {
        row = await updateFunnel(funnel_id, payload);
        log.info('funnel_updated', { id: row.id, owner: ownerSlackId, name });
      } else {
        row = await createFunnel({
          ...payload,
          owner_slack_id: ownerSlackId,
          status: 'active',
        });
        log.info('funnel_created', { id: row.id, owner: ownerSlackId, name, frequency });
      }

      await client.chat.postMessage({
        channel: ownerSlackId,
        text: isEdit
          ? `✏️ Funnel *${name}* updated. Worker will pick up the new config within ~60s.`
          : `✅ Funnel *${name}* created. Status: \`active\`. It will check ${FREQUENCY_LABELS[frequency].toLowerCase()} once the worker is online.`,
      });
    } catch (err) {
      log.error('funnel_save_failed', { error: String(err), name, isEdit });
      await client.chat.postMessage({
        channel: ownerSlackId,
        text: `❌ Couldn't save funnel *${name}*: ${err.message}`,
      });
    }
  });
}
