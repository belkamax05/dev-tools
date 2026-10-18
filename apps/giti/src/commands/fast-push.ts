import type { CommandRun } from '../types/CommandRun';
import runTransferCommand from '../utils/runTransferCommand';

//? The whole tree's push without hooks or questions. A branch with no upstream yet is pushed to
//? origin and set to track it, as `git push -u origin HEAD` did here before
const run: CommandRun = (args) => runTransferCommand('send', ['--yes', '--no-verify', ...args]);

export const meta = {
  name: 'fast-push',
  description:
    'send without hooks or questions (--no-verify) — a new branch goes to origin and tracks it',
};

export default run;
