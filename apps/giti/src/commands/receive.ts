import type { CommandRun } from '../types/CommandRun';
import runTransferCommand from '../utils/runTransferCommand';

const run: CommandRun = (args) => runTransferCommand('receive', args);

export const meta = {
  name: 'receive',
  description:
    'Pull this repository, then every subrepo, submodule and subtree in it — takes all git pull flags and [<remote> [<branch>]]; a screen with incoming commits and strategy when none are given (--yes skips it, --no-self)',
};

export default run;
