// Creates the Bolt app in either Socket Mode (local dev) or HTTP mode (Vercel).
// All handlers are registered identically; only the transport differs.

import pkg from '@slack/bolt';
const { App, LogLevel, ExpressReceiver } = pkg;

import { env } from '../lib/env.js';
import { registerFunnelCommand } from './commands/funnel.js';
import { registerNewFunnelSimpleModal } from './modals/newFunnelSimple.js';
import { registerNewFunnelAdvancedModal } from './modals/newFunnelAdvanced.js';
import { registerCardButtonHandlers } from './actions/cardButtons.js';

function registerHandlers(app) {
  registerFunnelCommand(app);
  registerNewFunnelSimpleModal(app);
  registerNewFunnelAdvancedModal(app);
  registerCardButtonHandlers(app);
}

export function createSlackApp() {
  const logLevel = env.LOG_LEVEL === 'debug' ? LogLevel.DEBUG : LogLevel.INFO;

  if (env.SLACK_SOCKET_MODE === 'true') {
    if (!env.SLACK_APP_TOKEN) {
      throw new Error('SLACK_SOCKET_MODE=true requires SLACK_APP_TOKEN');
    }
    const app = new App({
      token: env.SLACK_BOT_TOKEN,
      appToken: env.SLACK_APP_TOKEN,
      signingSecret: env.SLACK_SIGNING_SECRET,
      socketMode: true,
      logLevel,
    });
    registerHandlers(app);
    return { app, receiver: null, mode: 'socket' };
  }

  const receiver = new ExpressReceiver({
    signingSecret: env.SLACK_SIGNING_SECRET,
    // Required for serverless: ack happens via the HTTP response, not via the
    // Bolt context's ack() promise resolving.
    processBeforeResponse: true,
    endpoints: '/api/slack',
  });
  const app = new App({
    token: env.SLACK_BOT_TOKEN,
    receiver,
    processBeforeResponse: true,
    logLevel,
  });
  registerHandlers(app);
  return { app, receiver, mode: 'http' };
}
