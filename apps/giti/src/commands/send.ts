import type { CommandRun } from '../types/CommandRun';
import runTransferCommand from '../utils/runTransferCommand';

const run: CommandRun = (args) => runTransferCommand('send', args);

export const meta = {
  name: 'send',
  description:
    'Push every subrepo, submodule and subtree upstream, then this repository — takes all git push flags and [<remote> [<branch>]]; a screen to pick flags when none are given (--yes skips it, --no-self)',
};

export default run;
