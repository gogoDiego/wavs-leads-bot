import { openNewFunnelSimpleModal } from '../modals/newFunnelSimple.js';

const STUB = (sub) =>
  `\`${sub}\` is coming in a later phase. Right now only \`/funnel new\` is wired.`;

export function registerFunnelCommand(app) {
  app.command('/funnel', async ({ command, ack, client, respond }) => {
    await ack();

    const [sub, ...rest] = (command.text || '').trim().split(/\s+/);
    const arg = rest.join(' ').trim();

    try {
      switch (sub) {
        case 'new':
        case '':
        case undefined:
          await openNewFunnelSimpleModal({ client, trigger_id: command.trigger_id });
          return;

        case 'list':
        case 'show':
        case 'edit':
        case 'pause':
        case 'delete':
        case 'stats':
        case 'fork':
          await respond({ response_type: 'ephemeral', text: STUB(sub) });
          return;

        default:
          await respond({
            response_type: 'ephemeral',
            text: `Unknown subcommand: \`${sub}\`. Try \`/funnel new\`.`,
          });
      }
    } catch (err) {
      await respond({
        response_type: 'ephemeral',
        text: `Something broke handling \`/funnel ${sub} ${arg}\`: ${err.message}`,
      });
    }
  });
}
