import { z } from 'zod';

import { createFunnel, getFunnelByName, updateFunnel } from '../../lib/db.js';
import { log } from '../../lib/log.js';

const CALLBACK_ID = 'funnel_advanced';

// All number inputs come back as strings; zod coerces + bounds them.
const submitSchema = z.object({
  name:               z.string().min(1).max(60),
  search_queries:     z.array(z.string().min(1)).min(1, 'At least one search query is required.'),
  relevance_prompt:   z.string().min(20),
  min_score:          z.coerce.number().int().min(1).max(10),
  velocity_floor:     z.coerce.number().int().min(0),
  max_age_hours:      z.coerce.number().int().min(1).max(168),
  max_per_digest:     z.coerce.number().int().min(1).max(20),
  budget_monthly_usd: z.coerce.number().min(0),
  interval_hours:     z.coerce.number().int().min(1).max(168),
  status:             z.enum(['active', 'paused']),
});

function statusOption(value) {
  const label = value === 'active' ? '🟢 active' : '⏸️ paused';
  return { text: { type: 'plain_text', text: label }, value };
}

function input(block_id, label, opts = {}) {
  return {
    type: 'input',
    block_id,
    optional: !!opts.optional,
    label: { type: 'plain_text', text: label },
    element: {
      type: 'plain_text_input',
      action_id: 'value',
      multiline: !!opts.multiline,
      initial_value: opts.initial_value ?? undefined,
      placeholder: opts.placeholder ? { type: 'plain_text', text: opts.placeholder } : undefined,
      max_length: opts.max_length,
    },
  };
}

function buildView({ funnel } = {}) {
  const isEdit = !!funnel;
  const f = funnel ?? {};
  const initialStatus = f.status ?? 'active';

  return {
    type: 'modal',
    callback_id: CALLBACK_ID,
    private_metadata: isEdit ? JSON.stringify({ funnel_id: funnel.id }) : '',
    title:  { type: 'plain_text', text: isEdit ? 'Edit funnel (advanced)' : 'New funnel (advanced)' },
    submit: { type: 'plain_text', text: 'Save' },
    close:  { type: 'plain_text', text: 'Cancel' },
    blocks: [
      input('name', 'Funnel name', {
        initial_value: f.name,
        max_length: 60,
      }),
      input('search_queries', 'Search queries (one per line)', {
        multiline: true,
        initial_value: (f.search_queries ?? []).join('\n'),
        placeholder: '"event-driven architecture"\n"durable execution" lang:en\n"distributed tracing" -hiring',
      }),
      input('relevance_prompt', 'Relevance prompt (sent to Claude as system prompt)', {
        multiline: true,
        initial_value: f.relevance_prompt,
        max_length: 3000,
      }),
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: '*Scoring thresholds*' },
          { type: 'mrkdwn', text: '*Schedule + budget*' },
        ],
      },
      input('min_score',      'min_score (1-10)',          { initial_value: String(f.min_score      ?? 7) }),
      input('velocity_floor', 'velocity_floor (eng/hour)', { initial_value: String(f.velocity_floor ?? 20) }),
      input('max_age_hours',  'max_age_hours',             { initial_value: String(f.max_age_hours  ?? 12) }),
      input('max_per_digest', 'max_per_digest',            { initial_value: String(f.max_per_digest ?? 5) }),
      input('interval_hours', 'interval_hours (how often to rerun)', {
        initial_value: String(f.interval_hours ?? 6),
        placeholder: '6',
      }),
      input('budget_monthly_usd', 'budget_monthly_usd', { initial_value: String(f.budget_monthly_usd ?? 20) }),
      {
        type: 'input',
        block_id: 'status',
        label: { type: 'plain_text', text: 'Status' },
        element: {
          type: 'radio_buttons',
          action_id: 'value',
          initial_option: statusOption(initialStatus),
          options: ['active', 'paused'].map(statusOption),
        },
      },
    ],
  };
}

export async function openNewFunnelAdvancedModal({ client, trigger_id, funnel }) {
  await client.views.open({ trigger_id, view: buildView({ funnel }) });
}

function splitLines(s) {
  return (s || '')
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);
}

export function registerNewFunnelAdvancedModal(app) {
  app.view(CALLBACK_ID, async ({ ack, view, body, client }) => {
    const meta = view.private_metadata ? JSON.parse(view.private_metadata) : {};
    const funnel_id = meta.funnel_id;
    const isEdit = !!funnel_id;

    const v = view.state.values;
    const raw = {
      name:               v.name.value.value?.trim(),
      search_queries:     splitLines(v.search_queries.value.value),
      relevance_prompt:   v.relevance_prompt.value.value?.trim(),
      min_score:          v.min_score.value.value,
      velocity_floor:     v.velocity_floor.value.value,
      max_age_hours:      v.max_age_hours.value.value,
      max_per_digest:     v.max_per_digest.value.value,
      interval_hours:     v.interval_hours.value.value,
      budget_monthly_usd: v.budget_monthly_usd.value.value,
      status:             v.status.value.selected_option.value,
    };

    const parsed = submitSchema.safeParse(raw);
    if (!parsed.success) {
      const errors = {};
      for (const issue of parsed.error.issues) {
        const block = issue.path[0];
        if (block && !errors[block]) errors[block] = issue.message;
      }
      await ack({ response_action: 'errors', errors });
      return;
    }

    const ownerSlackId = body.user.id;
    const existing = await getFunnelByName(ownerSlackId, parsed.data.name);
    if (existing && existing.id !== funnel_id) {
      await ack({
        response_action: 'errors',
        errors: { name: 'You already have a funnel with this name.' },
      });
      return;
    }

    await ack();

    const payload = { ...parsed.data, prompt_mode: 'advanced' };

    try {
      let row;
      if (isEdit) {
        row = await updateFunnel(funnel_id, payload);
        log.info('funnel_updated_advanced', { id: row.id, owner: ownerSlackId, name: row.name });
      } else {
        row = await createFunnel({ ...payload, owner_slack_id: ownerSlackId });
        log.info('funnel_created_advanced', { id: row.id, owner: ownerSlackId, name: row.name });
      }
      await client.chat.postMessage({
        channel: ownerSlackId,
        text: isEdit
          ? `✏️ Funnel *${row.name}* updated (advanced). Worker will pick up the new config within ~60s.`
          : `✅ Funnel *${row.name}* created in advanced mode.`,
      });
    } catch (err) {
      log.error('funnel_advanced_save_failed', { error: String(err), name: parsed.data.name, isEdit });
      await client.chat.postMessage({
        channel: ownerSlackId,
        text: `❌ Couldn't save funnel *${parsed.data.name}*: ${err.message}`,
      });
    }
  });
}
