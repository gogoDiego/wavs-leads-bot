import { createFunnel, getFunnelByName } from '../../lib/db.js';
import { assembleSimplePrompt } from '../../lib/prompt.js';
import { log } from '../../lib/log.js';

const CALLBACK_ID = 'new_funnel_simple';

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

function buildView() {
  return {
    type: 'modal',
    callback_id: CALLBACK_ID,
    title:  { type: 'plain_text', text: 'New funnel' },
    submit: { type: 'plain_text', text: 'Create' },
    close:  { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'name',
        label: { type: 'plain_text', text: 'Funnel name' },
        element: {
          type: 'plain_text_input',
          action_id: 'value',
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
          initial_option: {
            text: { type: 'plain_text', text: FREQUENCY_LABELS.every_3h },
            value: 'every_3h',
          },
          options: Object.entries(FREQUENCY_LABELS).map(([value, label]) => ({
            text: { type: 'plain_text', text: label },
            value,
          })),
        },
      },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: 'Search queries, scoring thresholds, and budget will use sensible defaults. Use `/funnel edit` (advanced mode) to tune them later.' },
        ],
      },
    ],
  };
}

export async function openNewFunnelSimpleModal({ client, trigger_id }) {
  await client.views.open({ trigger_id, view: buildView() });
}

function splitCsv(s) {
  return (s || '')
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function registerNewFunnelSimpleModal(app) {
  app.view(CALLBACK_ID, async ({ ack, view, body, client }) => {
    const v = view.state.values;
    const name       = v.name.value.value.trim();
    const icp        = v.icp.value.value.trim();
    const keywords   = splitCsv(v.keywords?.value?.value);
    const hard_skips = splitCsv(v.hard_skips?.value?.value);
    const frequency  = v.frequency.value.value.selected_option.value;
    const ownerSlackId = body.user.id;

    const existing = await getFunnelByName(ownerSlackId, name);
    if (existing) {
      await ack({
        response_action: 'errors',
        errors: { name: 'You already have a funnel with this name.' },
      });
      return;
    }

    await ack();

    try {
      const relevance_prompt = assembleSimplePrompt({ icp, keywords, hard_skips });

      // Default search query = keywords OR'd together. Owner can refine in advanced mode.
      const search_queries = keywords.length
        ? [keywords.map((k) => `"${k}"`).join(' OR ')]
        : [];

      const row = await createFunnel({
        owner_slack_id: ownerSlackId,
        name,
        status: 'active',
        search_queries,
        prompt_mode: 'simple',
        simple_config: { icp, keywords, hard_skips, frequency },
        relevance_prompt,
        schedule_cron: FREQUENCY_TO_CRON[frequency],
      });

      log.info('funnel_created', { id: row.id, owner: ownerSlackId, name, frequency });

      await client.chat.postMessage({
        channel: ownerSlackId,
        text: `✅ Funnel *${name}* created. Status: \`active\`. It will check ${FREQUENCY_LABELS[frequency].toLowerCase()} once the worker is online (Phase 3).`,
      });
    } catch (err) {
      log.error('funnel_create_failed', { error: String(err), name });
      await client.chat.postMessage({
        channel: ownerSlackId,
        text: `❌ Couldn't create funnel *${name}*: ${err.message}`,
      });
    }
  });
}
