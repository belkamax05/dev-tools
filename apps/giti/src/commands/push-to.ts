import type { CommandRun } from '../types/CommandRun';
import runSendTo from '../utils/runSendTo';

//? `send-to` under the name people type first, as `push` is `send`
const run: CommandRun = (args) => runSendTo(args);

export const meta = {
  name: 'push-to',
  description: 'Same as giti send-to — force-push HEAD into another branch of the remote',
};

export default run;
