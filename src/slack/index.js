// Local-dev entrypoint. Uses Socket Mode if SLACK_SOCKET_MODE=true,
// otherwise starts an HTTP server on PORT (mostly useful for tunneled testing).

import { log } from '../lib/log.js';
import { createSlackApp } from './createApp.js';

const { app, mode } = createSlackApp();

app.error(async (error) => {
  log.error('bolt_error', { error: String(error) });
});

(async () => {
  const port = Number(process.env.PORT ?? 3000);
  await app.start(port);
  log.info('slack_connected', { mode, port: mode === 'http' ? port : undefined });
})();
