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
  const block = {
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
  // Slack's `hint` shows greyed-out helper text under the field. ≤ 150 chars.
  if (opts.hint) block.hint = { type: 'plain_text', text: opts.hint };
  return block;
}

// Section heading — a `header` block sized appropriately for modal sections.
function header(text) {
  return { type: 'header', text: { type: 'plain_text', text, emoji: true } };
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
      // ── Basics ────────────────────────────────────────────────
      header('🧭 Basics'),
      input('name', 'Funnel name', {
        initial_value: f.name,
        max_length: 60,
        hint: 'Short slug, unique to you (lowercase, hyphens). e.g. defi-treasury-pain',
      }),
      {
        type: 'input',
        block_id: 'status',
        label: { type: 'plain_text', text: 'Status' },
        hint: { type: 'plain_text', text: 'Active = runs on schedule. Paused = sits idle until you re-activate.' },
        element: {
          type: 'radio_buttons',
          action_id: 'value',
          initial_option: statusOption(initialStatus),
          options: ['active', 'paused'].map(statusOption),
        },
      },

      // ── What to search ────────────────────────────────────────
      header('🔍 What to search'),
      input('search_queries', 'Twitter search queries (one per line)', {
        multiline: true,
        initial_value: (f.search_queries ?? []).join('\n'),
        placeholder: '"event-driven architecture" lang:en\n"durable execution" -hiring',
        hint: 'Each line is a full Twitter search. Use quotes for phrases, OR for alternatives, lang:en, since:DATE, etc.',
      }),

      // ── How Claude scores ─────────────────────────────────────
      header('🧠 How Claude scores it'),
      input('relevance_prompt', 'Relevance prompt', {
        multiline: true,
        initial_value: f.relevance_prompt,
        max_length: 3000,
        hint: 'Sent to Claude as a system prompt. Define the ICP, boost signals, hard skips, scoring rubric, and 1–2 example tweets with scores.',
      }),

      // ── Quality filters ───────────────────────────────────────
      header('🎚️ Quality filters'),
      input('min_score', 'Minimum score to post (1–10)', {
        initial_value: String(f.min_score ?? 7),
        hint: 'How strict to be. 6–7 is a good start. Raise it if you get too much noise; lower it if you get too few cards.',
      }),
      input('velocity_floor', 'Minimum engagement-per-hour', {
        initial_value: String(f.velocity_floor ?? 20),
        hint: '0 = let Claude judge everything. 20 = only viral-ish tweets. (likes + replies×2 + quotes×5 + retweets×3) / hoursOld.',
      }),
      input('max_age_hours', 'How far back to look (hours)', {
        initial_value: String(f.max_age_hours ?? 12),
        hint: '12 = today only. 24 = past day. 168 = past week. Older tweets need stronger engagement to pass the velocity floor.',
      }),

      // ── Run control ───────────────────────────────────────────
      header('⏱️ Run control'),
      input('max_per_digest', 'Max cards posted per run', {
        initial_value: String(f.max_per_digest ?? 5),
        hint: 'Cap on how many cards land in #leads per run. Excess qualified candidates are still saved but not posted.',
      }),
      input('interval_hours', 'Re-run every N hours', {
        initial_value: String(f.interval_hours ?? 6),
        placeholder: '6',
        hint: 'Worker checks this funnel at most every N hours. 3 = aggressive, 24 = once a day.',
      }),

      // ── Budget ────────────────────────────────────────────────
      header('💰 Budget'),
      input('budget_monthly_usd', 'Monthly spend cap ($)', {
        initial_value: String(f.budget_monthly_usd ?? 20),
        hint: 'Auto-pause this funnel if it costs more than $X this month (auto-pause ships in Phase 6 — for now just informational).',
      }),
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
      // Silent success — no DM. Verify via /funnel list or wait for the next run in #leads.
    } catch (err) {
      // Silent failure for the user. Vercel logs surface the issue.
      log.error('funnel_advanced_save_failed', { error: String(err), name: parsed.data.name, isEdit });
    }
  });
}
