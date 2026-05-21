// Block Kit messages posted to #leads:
//   - buildRunSummaryMessage(): the parent message per run (carries funnel
//     metadata + stats + Edit funnel button). Lives in the channel.
//   - buildLeadCard(): one card per qualified tweet, posted as a thread
//     reply under the parent. Feedback buttons.

function truncate(text, max = 600) {
  if (!text) return '';
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

export const ACTION_IDS = {
  open:        'card_open',
  hide:        'card_hide',
  saved:       'card_saved',
  edit_funnel: 'card_edit_funnel',
};

// Pick the most readable list of "what this funnel is searching for".
// Prefer simple-mode keywords (short, human-readable). Fall back to truncated
// raw search queries for advanced-mode funnels.
function tagsForFunnel(funnel) {
  const kw = funnel.simple_config?.keywords;
  if (Array.isArray(kw) && kw.length > 0) {
    return kw.slice(0, 10);
  }
  const queries = funnel.search_queries ?? [];
  return queries.map((q) => (q.length > 50 ? q.slice(0, 47) + '…' : q)).slice(0, 5);
}

// Slack `<!date^...>` auto-formats to the viewer's timezone. We always pass
// epoch seconds. Fallback text shown if Slack can't render (very old clients).
function slackTime(date) {
  const epoch = Math.floor(date.getTime() / 1000);
  return `<!date^${epoch}^{time}|${date.toISOString()}>`;
}

function describeTiming(funnel, runAt = new Date()) {
  if (!funnel.interval_hours) {
    return `⏱️ ran ${slackTime(runAt)} · manual only (no auto-run)`;
  }
  const nextRun = new Date(runAt.getTime() + funnel.interval_hours * 3_600_000);
  return `⏱️ ran ${slackTime(runAt)} · every ${funnel.interval_hours}h · next ${slackTime(nextRun)}`;
}

export function buildRunSummaryMessage({ funnel, qualified, summary }) {
  const topScore = qualified.length ? qualified[0].score : null;
  const cost     = Number(summary.cost_usd || 0).toFixed(3);

  const header = qualified.length > 0
    ? `🤖 *${funnel.name}* — *${qualified.length}* lead${qualified.length === 1 ? '' : 's'} (top score ${topScore}/10)`
    : `🤖 *${funnel.name}* — no qualified leads this run`;

  const stats = `fetched *${summary.fetched}* · passed velocity *${summary.passed_velocity}* · scored *${summary.scored}* · posted *${qualified.length}* · cost *$${cost}*`;

  const tags = tagsForFunnel(funnel);
  const tagsLine = tags.length > 0
    ? `🔍 ${tags.map((t) => `\`${t}\``).join(' ')}`
    : null;

  const blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: header } },
  ];
  if (tagsLine) {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: tagsLine }] });
  }
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: stats }] });
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: describeTiming(funnel) }] });
  blocks.push({
    type: 'actions',
    block_id: `run_actions_${funnel.id}`,
    elements: [
      {
        type: 'button',
        action_id: ACTION_IDS.edit_funnel,
        text: { type: 'plain_text', text: '✏️ Edit funnel', emoji: true },
        value: funnel.id,
      },
    ],
  });

  return {
    text: `${funnel.name}: ${qualified.length} leads (cost $${cost})`,
    blocks,
  };
}

export function buildLeadCard({ funnel, candidateId, tweet, score, velocity }) {
  const headerText = `*${funnel.name}* · score *${score}/10* · <@${funnel.owner_slack_id}>`;
  const tweetText = `> ${truncate(tweet.text).replace(/\n/g, '\n> ')}`;

  const blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: headerText } },
    {
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: `<https://twitter.com/${tweet.author}|@${tweet.author}> · velocity ${velocity.toFixed(0)}` },
      ],
    },
    { type: 'section', text: { type: 'mrkdwn', text: tweetText } },
  ];

  blocks.push({
    type: 'actions',
    block_id: `card_actions_${candidateId}`,
    elements: [
      { type: 'button', action_id: ACTION_IDS.open,  url: tweet.url, text: { type: 'plain_text', text: '🔗 Open',  emoji: true }, value: candidateId },
      { type: 'button', action_id: ACTION_IDS.saved, text: { type: 'plain_text', text: '📌 Saved', emoji: true }, value: candidateId },
      { type: 'button', action_id: ACTION_IDS.hide,  text: { type: 'plain_text', text: '🙈 Hide',  emoji: true }, value: candidateId },
    ],
  });

  return {
    text: `New lead for ${funnel.name} (score ${score}/10): ${tweet.url}`,
    blocks,
  };
}
