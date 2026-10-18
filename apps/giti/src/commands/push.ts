import type { CommandRun } from '../types/CommandRun';
import runTransferCommand from '../utils/runTransferCommand';

//? giti's push is the whole tree's push: the repository and every subrepo, submodule and subtree
//? in it, with every flag `git push` takes — `giti send` under the name people type first.
//? `git push` itself (the alias would shadow a built-in) is untouched.
const run: CommandRun = (args) => runTransferCommand('send', args);

export const meta = {
  name: 'push',
  //? `git push` stays git's own; the alias would be ignored — `git send` is the alias
  gitAlias: false,
  description: 'Same as giti send — push the whole tree (this repository and everything vendored in it)',
};

export default run;
