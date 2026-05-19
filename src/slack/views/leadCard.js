// Block Kit card posted to #leads. Buttons come in Phase 4 — this is intentionally
// passive for now so we can verify the scoring loop end-to-end.

function truncate(text, max = 600) {
  if (!text) return '';
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

export function buildLeadCard({ funnel, tweet, score, suggested_angle, velocity }) {
  const headerText = `*${funnel.name}* · score *${score}/10* · <@${funnel.owner_slack_id}>`;
  const tweetText = `> ${truncate(tweet.text).replace(/\n/g, '\n> ')}`;

  const blocks = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: headerText },
    },
    {
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: `<https://twitter.com/${tweet.author}|@${tweet.author}> · velocity ${velocity.toFixed(0)} · <${tweet.url}|open tweet>` },
      ],
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: tweetText },
    },
  ];

  if (suggested_angle) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Suggested angle:* ${truncate(suggested_angle, 400)}` },
    });
  }

  blocks.push({ type: 'divider' });

  return {
    text: `New lead for ${funnel.name} (score ${score}/10): ${tweet.url}`, // fallback for notifications
    blocks,
  };
}
