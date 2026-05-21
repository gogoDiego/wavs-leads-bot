// AI-assisted funnel creation (Variant B):
//   1. User describes who they're looking for (intent).
//   2. Claude generates queries + keywords + skips + 3 sample 9/10 tweets.
//   3. User previews, optionally edits or regenerates, then saves.
//
// Implementation: two modal views chained via Slack's response_action: 'update'.
// Generation happens after ack via Vercel's waitUntil so we don't blow the 3s
// ack budget, then views.update swaps in the preview when Claude returns.

import { waitUntil } from '@vercel/functions';

import { createFunnel, getFunnelByName } from '../../lib/db.js';
import { assembleSimplePrompt } from '../../lib/prompt.js';
import { generateFunnel } from '../../lib/funnelGenerator.js';
import { log } from '../../lib/log.js';

const INTENT_CALLBACK     = 'funnel_ai_intent';
const PREVIEW_CALLBACK    = 'funnel_ai_preview';
const REGENERATE_ACTION   = 'funnel_ai_regenerate';

const FREQUENCY_TO_HOURS = {
  every_3h:  3,
  every_6h:  6,
  every_12h: 12,
  daily:     24,
  manual:    0,
};

const FREQUENCY_LABELS = {
  every_3h:  'Every 3 hours',
  every_6h:  'Every 6 hours',
  every_12h: 'Every 12 hours',
  daily:     'Once a day',
  manual:    'Manual only (only when I run /funnel run)',
};

function freqOption(value) {
  return { text: { type: 'plain_text', text: FREQUENCY_LABELS[value] }, value };
}

// ── View 1: ask for intent ───────────────────────────────────────────────
function buildIntentView() {
  return {
    type: 'modal',
    callback_id: INTENT_CALLBACK,
    title:  { type: 'plain_text', text: 'AI-build a funnel' },
    submit: { type: 'plain_text', text: 'Generate' },
    close:  { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '*Describe the kind of leads you want.* Claude will generate the search query, keywords, hard skips, and 3 example tweets it would rate 9/10.' },
      },
      {
        type: 'input',
        block_id: 'name',
        label: { type: 'plain_text', text: 'Funnel name' },
        hint:  { type: 'plain_text', text: 'Short slug, unique to you. e.g. solana-treasury-pain' },
        element: { type: 'plain_text_input', action_id: 'value', max_length: 60 },
      },
      {
        type: 'input',
        block_id: 'intent',
        label: { type: 'plain_text', text: 'Who are you trying to find?' },
        hint:  { type: 'plain_text', text: '2–4 sentences. Describe the person, their pain, what they typically say. The richer the description, the better the generation.' },
        element: { type: 'plain_text_input', action_id: 'value', multiline: true, max_length: 1500 },
      },
      {
        type: 'input',
        block_id: 'frequency',
        label: { type: 'plain_text', text: 'How often should we check?' },
        element: {
          type: 'radio_buttons',
          action_id: 'value',
          initial_option: freqOption('every_6h'),
          options: Object.keys(FREQUENCY_LABELS).map(freqOption),
        },
      },
    ],
  };
}

// ── Holding view shown while Claude is generating ────────────────────────
function buildGeneratingView() {
  return {
    type: 'modal',
    callback_id: 'funnel_ai_generating',
    title:  { type: 'plain_text', text: 'Generating…' },
    close:  { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '🤖 Asking Claude to build your funnel…\n\nGenerating search queries, keywords, hard skips, and 3 example tweets. Should take ~5 seconds.' },
      },
    ],
  };
}

// ── View 2: preview generated content + save ─────────────────────────────
function buildPreviewView({ name, intent, frequency, generated }) {
  const examples = generated.example_tweets.length > 0
    ? generated.example_tweets.map((t, i) =>
        `*${i + 1}.* @${t.author}: "${t.text}"`,
      ).join('\n\n')
    : '_(none generated)_';

  return {
    type: 'modal',
    callback_id: PREVIEW_CALLBACK,
    private_metadata: JSON.stringify({ name, intent, frequency }),
    title:  { type: 'plain_text', text: 'Preview & save' },
    submit: { type: 'plain_text', text: 'Save funnel' },
    close:  { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${name}*\n${generated.icp}` },
      },
      { type: 'divider' },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '*Sample tweets Claude would score 9/10*\n_(illustrative — AI-generated, not real tweets)_' },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: examples },
      },
      { type: 'divider' },
      {
        type: 'input',
        block_id: 'search_queries',
        label: { type: 'plain_text', text: 'Search queries' },
        hint:  { type: 'plain_text', text: 'One per line. Each is a separate Twitter search.' },
        element: {
          type: 'plain_text_input',
          action_id: 'value',
          multiline: true,
          initial_value: generated.search_queries.join('\n'),
        },
      },
      {
        type: 'input',
        block_id: 'keywords',
        label: { type: 'plain_text', text: 'Boost keywords (comma-separated)' },
        element: {
          type: 'plain_text_input',
          action_id: 'value',
          initial_value: generated.keywords.join(', '),
        },
      },
      {
        type: 'input',
        block_id: 'hard_skips',
        label: { type: 'plain_text', text: 'Hard skips (comma-separated)' },
        element: {
          type: 'plain_text_input',
          action_id: 'value',
          initial_value: generated.hard_skips.join(', '),
        },
      },
      {
        type: 'actions',
        block_id: 'regenerate_block',
        elements: [
          {
            type: 'button',
            action_id: REGENERATE_ACTION,
            text:  { type: 'plain_text', text: '🔄 Try a different angle (regenerate)', emoji: true },
            value: 'regenerate',
          },
        ],
      },
    ],
  };
}

function buildErrorView({ message }) {
  return {
    type: 'modal',
    title: { type: 'plain_text', text: 'Generation failed' },
    close: { type: 'plain_text', text: 'Close' },
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `❌ ${message}\n\nTry rephrasing your intent with more detail, or use \`/funnel new\` for the manual flow.` },
      },
    ],
  };
}

function splitCsv(s) {
  return (s || '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
}

export async function openNewFunnelAiModal({ client, trigger_id }) {
  await client.views.open({ trigger_id, view: buildIntentView() });
}

export function registerNewFunnelAiModal(app) {
  // ── Step 1 submit: validate, swap to "Generating…", fire async generation
  app.view(INTENT_CALLBACK, async ({ ack, view, body, client }) => {
    const v = view.state.values;
    const name      = v.name.value.value.trim();
    const intent    = v.intent.value.value.trim();
    const frequency = v.frequency.value.selected_option.value;
    const ownerSlackId = body.user.id;

    const existing = await getFunnelByName(ownerSlackId, name);
    if (existing) {
      await ack({
        response_action: 'errors',
        errors: { name: 'You already have a funnel with this name.' },
      });
      return;
    }

    // Ack within 3s by swapping the modal to "Generating…".
    await ack({ response_action: 'update', view: buildGeneratingView() });

    waitUntil((async () => {
      try {
        const generated = await generateFunnel({ intent });
        await client.views.update({
          view_id: body.view.id,
          view: buildPreviewView({ name, intent, frequency, generated }),
        });
      } catch (err) {
        log.error('funnel_ai_generate_failed', { error: String(err), intent: intent.slice(0, 100) });
        await client.views.update({
          view_id: body.view.id,
          view: buildErrorView({ message: err.message }),
        });
      }
    })());
  });

  // ── Regenerate button: swap to "Generating…", re-call Claude
  app.action(REGENERATE_ACTION, async ({ ack, body, client }) => {
    await ack();
    const meta = JSON.parse(body.view.private_metadata || '{}');

    await client.views.update({
      view_id: body.view.id,
      view: buildGeneratingView(),
    });

    waitUntil((async () => {
      try {
        const generated = await generateFunnel({ intent: meta.intent });
        await client.views.update({
          view_id: body.view.id,
          view: buildPreviewView({ ...meta, generated }),
        });
      } catch (err) {
        log.error('funnel_ai_regenerate_failed', { error: String(err) });
        await client.views.update({
          view_id: body.view.id,
          view: buildErrorView({ message: err.message }),
        });
      }
    })());
  });

  // ── Step 2 submit: save the funnel using existing simple-mode shape
  app.view(PREVIEW_CALLBACK, async ({ ack, view, body }) => {
    const meta = JSON.parse(view.private_metadata || '{}');
    const v = view.state.values;
    const search_queries = (v.search_queries.value.value || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const keywords       = splitCsv(v.keywords.value.value);
    const hard_skips     = splitCsv(v.hard_skips.value.value);

    if (!search_queries.length) {
      await ack({
        response_action: 'errors',
        errors: { search_queries: 'At least one search query is required.' },
      });
      return;
    }

    const ownerSlackId = body.user.id;
    const existing = await getFunnelByName(ownerSlackId, meta.name);
    if (existing) {
      await ack({
        response_action: 'errors',
        errors: { search_queries: 'You already have a funnel with this name. (Race condition — refresh and try again.)' },
      });
      return;
    }

    await ack();

    try {
      const relevance_prompt = assembleSimplePrompt({ icp: meta.intent, keywords, hard_skips });
      const row = await createFunnel({
        owner_slack_id: ownerSlackId,
        name:           meta.name,
        status:         'active',
        search_queries,
        prompt_mode:    'simple',
        simple_config:  { icp: meta.intent, keywords, hard_skips, frequency: meta.frequency },
        relevance_prompt,
        interval_hours: FREQUENCY_TO_HOURS[meta.frequency],
      });
      log.info('funnel_created_ai', { id: row.id, owner: ownerSlackId, name: meta.name, frequency: meta.frequency });
    } catch (err) {
      // Silent for the user per the no-DMs/no-ephemerals policy. Vercel logs surface it.
      log.error('funnel_ai_save_failed', { error: String(err), name: meta.name });
    }
  });
}
