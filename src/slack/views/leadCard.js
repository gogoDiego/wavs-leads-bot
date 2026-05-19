// Block Kit card posted to #leads. The action buttons all carry candidate.id
// in their `value`, so action handlers can look the row up without parsing
// the message body.

function truncate(text, max = 600) {
  if (!text) return '';
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

export const ACTION_IDS = {
  open:  'card_open',
  good:  'card_good',
  noise: 'card_noise',
  hide:  'card_hide',
  saved: 'card_saved',
};

export function buildLeadCard({ funnel, candidateId, tweet, score, suggested_angle, velocity }) {
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

  if (suggested_angle) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Suggested angle:* ${truncate(suggested_angle, 400)}` },
    });
  }

  blocks.push({
    type: 'actions',
    block_id: `card_actions_${candidateId}`,
    elements: [
      { type: 'button', action_id: ACTION_IDS.open,  url: tweet.url, text: { type: 'plain_text', text: '🔗 Open',  emoji: true }, value: candidateId },
      { type: 'button', action_id: ACTION_IDS.good,  style: 'primary', text: { type: 'plain_text', text: '👍 Good', emoji: true }, value: candidateId },
      { type: 'button', action_id: ACTION_IDS.noise, style: 'danger',  text: { type: 'plain_text', text: '👎 Noise', emoji: true }, value: candidateId },
      { type: 'button', action_id: ACTION_IDS.saved, text: { type: 'plain_text', text: '📌 Saved', emoji: true }, value: candidateId },
      { type: 'button', action_id: ACTION_IDS.hide,  text: { type: 'plain_text', text: '🙈 Hide',  emoji: true }, value: candidateId },
    ],
  });

  return {
    text: `New lead for ${funnel.name} (score ${score}/10): ${tweet.url}`,
    blocks,
  };
}
