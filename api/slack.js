// Vercel serverless handler for Slack.
// Slack manifest's Request URL should be https://<your-domain>/api/slack.

import { createSlackApp } from '../src/slack/createApp.js';

const { receiver } = createSlackApp();
if (!receiver) {
  throw new Error('api/slack.js requires HTTP mode — set SLACK_SOCKET_MODE=false');
}

export default receiver.app;
