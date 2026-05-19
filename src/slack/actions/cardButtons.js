import { ACTION_IDS } from '../views/leadCard.js';
import { insertFeedback, getCandidateById } from '../../lib/db.js';
import { log } from '../../lib/log.js';

const KIND_OF = {
  [ACTION_IDS.good]:  'good',
  [ACTION_IDS.noise]: 'noise',
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
    await respond({ response_type: 'ephemeral', replace_original: false, text: `Couldn't save your reaction: ${err.message}` });
    return;
  }

  // 📌 saved: open a thread on the parent card so the user can drop notes / DM drafts.
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

  const label = { good: '👍 marked good', noise: '👎 marked noise', hide: '🙈 hidden', saved: '📌 saved' }[kind];
  await respond({ response_type: 'ephemeral', replace_original: false, text: `${label}.` });
}

export function registerCardButtonHandlers(app) {
  // 🔗 Open is a URL button — Slack opens the tweet automatically.
  // We still ack so Slack doesn't log an unhandled-action warning.
  app.action(ACTION_IDS.open, async ({ ack }) => { await ack(); });

  for (const action_id of [ACTION_IDS.good, ACTION_IDS.noise, ACTION_IDS.hide, ACTION_IDS.saved]) {
    app.action(action_id, async (ctx) => {
      await handleFeedback({ kind: KIND_OF[action_id], ...ctx });
    });
  }
}
