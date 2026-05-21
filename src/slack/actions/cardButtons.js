import { ACTION_IDS } from '../views/leadCard.js';
import { insertFeedback, getCandidateById, getFunnelById } from '../../lib/db.js';
import { log } from '../../lib/log.js';
import { openNewFunnelAdvancedModal } from '../modals/newFunnelAdvanced.js';
import { openNewFunnelSimpleModal } from '../modals/newFunnelSimple.js';

const KIND_OF = {
  [ACTION_IDS.good]:  'good',
  [ACTION_IDS.noise]: 'noise',
  [ACTION_IDS.hide]:  'hide',
  [ACTION_IDS.saved]: 'saved',
};

const KIND_LABEL = {
  good:  '👍 marked good',
  noise: '👎 marked noise',
  saved: '📌 saved',
  hide:  '🙈 hidden',
};

async function handleFeedback({ kind, body, ack, client, respond }) {
  await ack();
  const candidate_id  = body.actions[0].value;
  const user_slack_id = body.user.id;
  const channel       = body.channel?.id;
  const message_ts    = body.message?.ts;

  try {
    await insertFeedback({ candidate_id, user_slack_id, kind });
  } catch (err) {
    log.error('feedback_insert_failed', { kind, candidate_id, error: String(err) });
  }

  // 🙈 Hide: actually remove the message from the channel. Feedback stays in DB.
  if (kind === 'hide' && channel && message_ts) {
    try {
      await client.chat.delete({ channel, ts: message_ts });
      // No follow-up ephemeral — the user's signal of success is the card vanishing.
      return;
    } catch (err) {
      log.warn('hide_delete_failed', { candidate_id, error: String(err) });
      await respond({ response_type: 'ephemeral', replace_original: false,
        text: `Couldn't delete the card (${err.message}). Feedback was still saved.` });
      return;
    }
  }

  // 📌 Saved: open a thread on the parent card so the user can drop notes / DM drafts.
  if (kind === 'saved' && channel && message_ts) {
    try {
      const cand = await getCandidateById(candidate_id);
      const tweetLink = cand?.tweet_url ? ` <${cand.tweet_url}|tweet>` : '';
      await client.chat.postMessage({
        channel,
        thread_ts: message_ts,
        text: `📌 Saved by <@${user_slack_id}> — drop notes or a draft reply here.${tweetLink}`,
      });
    } catch (err) {
      log.warn('saved_thread_failed', { candidate_id, error: String(err) });
    }
  }

  await respond({ response_type: 'ephemeral', replace_original: false, text: `${KIND_LABEL[kind]}.` });
}

async function handleEditFunnel({ ack, body, client, respond }) {
  await ack();
  const funnel_id = body.actions[0].value;
  try {
    const funnel = await getFunnelById(funnel_id);
    if (!funnel) {
      await respond({ response_type: 'ephemeral', replace_original: false,
        text: `Couldn't find this card's funnel. It may have been deleted.` });
      return;
    }
    const opener = funnel.prompt_mode === 'advanced'
      ? openNewFunnelAdvancedModal
      : openNewFunnelSimpleModal;
    await opener({ client, trigger_id: body.trigger_id, funnel });
  } catch (err) {
    log.error('edit_funnel_open_failed', { funnel_id, error: String(err) });
    await respond({ response_type: 'ephemeral', replace_original: false,
      text: `Couldn't open the funnel edit modal: ${err.message}` });
  }
}

export function registerCardButtonHandlers(app) {
  // 🔗 Open is a URL button — Slack opens the tweet automatically. Ack quietly.
  app.action(ACTION_IDS.open, async ({ ack }) => { await ack(); });

  for (const action_id of [ACTION_IDS.good, ACTION_IDS.noise, ACTION_IDS.hide, ACTION_IDS.saved]) {
    app.action(action_id, async (ctx) => {
      await handleFeedback({ kind: KIND_OF[action_id], ...ctx });
    });
  }

  app.action(ACTION_IDS.edit_funnel, handleEditFunnel);
}
