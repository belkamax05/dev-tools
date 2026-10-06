import { join } from 'node:path';
import type { CommandRun } from '../types/CommandRun';
import getWorkingDir from '../utils/getWorkingDir';
import gitExec from '../utils/gitExec';

/**
 * Directory the raw git command should run in.
 *
 * When giti is reached through a `!` alias (`git giti git add .`), git has already chdir'd to
 * the repository top-level and put the caller's subdirectory in `GIT_PREFIX`. Re-joining it
 * keeps relative pathspecs pointing at the folder the user actually typed the command in;
 * without it, `add .` from a subfolder would stage the whole repository.
 */
const invocationDir = () => join(getWorkingDir(), process.env.GIT_PREFIX ?? '');

//? A pure pass-through: no parsing, no flag rewriting, no pretty printing. `stream` inherits
//? stdio so pagers, prompts, editors and colour detection behave exactly as they do when git is
//? called directly, and the exit code is forwarded so scripts can still branch on it.
//? Git ignores aliases that shadow built-in commands, so the `status` / `commit` / `push`
//? aliases in .gitconfig-commands never intercept the child process here.
const run: CommandRun = async (args) => {
  const result = await gitExec(args, invocationDir(), { stream: true });
  if (result.exitCode !== 0) process.exit(result.exitCode ?? 1);
};

export const meta = {
  name: 'git',
  description: 'Run a raw git command, bypassing the giti wrappers — e.g. `giti git status`',
};

export default run;
