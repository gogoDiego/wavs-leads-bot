import { ACTION_IDS } from '../views/leadCard.js';
import { insertFeedback, getCandidateById, getFunnelById } from '../../lib/db.js';
import { log } from '../../lib/log.js';
import { openNewFunnelAdvancedModal } from '../modals/newFunnelAdvanced.js';

const KIND_OF = {
  [ACTION_IDS.hide]:  'hide',
  [ACTION_IDS.saved]: 'saved',
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
  // If the delete fails (rare — bot owns its own messages), it's logged silently.
  if (kind === 'hide' && channel && message_ts) {
    try {
      await client.chat.delete({ channel, ts: message_ts });
    } catch (err) {
      log.warn('hide_delete_failed', { candidate_id, error: String(err) });
    }
    return;
  }

  // 📌 Saved: open a thread reply on the card so the user can drop notes / DM drafts.
  // The thread reply IS the public confirmation — no separate ephemeral needed.
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

  // 👍 / 👎: feedback row is recorded silently. /funnel stats shows the totals.
  // No ephemeral confirmation per user preference (zero "only visible to you" noise).
}

async function handleEditFunnel({ ack, body, client }) {
  await ack();
  const funnel_id = body.actions[0].value;
  try {
    const funnel = await getFunnelById(funnel_id);
    if (!funnel) {
      log.warn('edit_funnel_not_found', { funnel_id });
      return;
    }
    // Always open advanced — the button is a quick-edit for thresholds
    // (velocity_floor, min_score, etc.), not just the ICP/keywords.
    // Use `/funnel edit <name>` if you want the simple modal instead.
    await openNewFunnelAdvancedModal({ client, trigger_id: body.trigger_id, funnel });
  } catch (err) {
    // Silent for user — they'll see the modal didn't open and retry.
    log.error('edit_funnel_open_failed', { funnel_id, error: String(err) });
  }
}

export function registerCardButtonHandlers(app) {
  // 🔗 Open is a URL button — Slack opens the tweet automatically. Ack quietly.
  app.action(ACTION_IDS.open, async ({ ack }) => { await ack(); });

  for (const action_id of [ACTION_IDS.hide, ACTION_IDS.saved]) {
    app.action(action_id, async (ctx) => {
      await handleFeedback({ kind: KIND_OF[action_id], ...ctx });
    });
  }

  app.action(ACTION_IDS.edit_funnel, handleEditFunnel);
}
