import type { CommandRun } from '../types/CommandRun';
import runTransferCommand from '../utils/runTransferCommand';

//? giti's pull is the whole tree's pull: the repository and every subrepo, submodule and subtree
//? in it, with every flag `git pull` takes — `giti receive` under the name people type first.
//? `git pull` itself (the alias would shadow a built-in) is untouched.
const run: CommandRun = (args) => runTransferCommand('receive', args);

export const meta = {
  name: 'pull',
  //? `git pull` stays git's own; the alias would be ignored — `git receive` is the alias
  gitAlias: false,
  description:
    'Same as giti receive — pull the whole tree (this repository and everything vendored in it)',
};

export default run;
