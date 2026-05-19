import pkg from '@slack/bolt';
const { App, LogLevel } = pkg;

import { env } from '../lib/env.js';
import { log } from '../lib/log.js';
import { registerFunnelCommand } from './commands/funnel.js';
import { registerNewFunnelSimpleModal } from './modals/newFunnelSimple.js';
import { registerCardButtonHandlers } from './actions/cardButtons.js';

const app = new App({
  token: env.SLACK_BOT_TOKEN,
  appToken: env.SLACK_APP_TOKEN,
  signingSecret: env.SLACK_SIGNING_SECRET,
  socketMode: true,
  logLevel: env.LOG_LEVEL === 'debug' ? LogLevel.DEBUG : LogLevel.INFO,
});

registerFunnelCommand(app);
registerNewFunnelSimpleModal(app);
registerCardButtonHandlers(app);

app.error(async (error) => {
  log.error('bolt_error', { error: String(error) });
});

(async () => {
  await app.start();
  log.info('slack_connected', { mode: 'socket' });
})();
