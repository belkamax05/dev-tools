import type { CommandRun } from '../types/CommandRun';
import runSendTo from '../utils/runSendTo';

const run: CommandRun = (args) => runSendTo(args);

export const meta = {
  name: 'send-to',
  description:
    'Force-push HEAD into another branch of the remote, replacing it, after a y — no branch opens a picker; the current branch falls back to send (--remote=, --yes, git push flags)',
};

export default run;
