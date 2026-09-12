import type { Vendored } from '../vendored';
import type { VendoredArgs } from '../vendoredArgs';
import { ownValue } from '../vendoredArgs';
import gitExec from '../gitExec';

/**
 * Work out which remote and branch a subtree command should talk to.
 *
 * ! `git subtree` is the one mechanism here that records no upstream at all — not the URL, not the
 * ! branch. Every `subtree pull`/`push` has to be told again. This recovers what it can: an
 * ! explicit `--remote=`/`--branch=`, else a git remote named after the directory, else nothing,
 * ! and the branch falls back to whatever the remote calls its default.
 *
 * @param vendored - Subtree entry from `getSubtrees`
 * @param args - Split command arguments; `--remote=` and `--branch=` are read from giti's own half
 * @param cwd - Any directory inside the repository
 * @returns Remote and branch, or null when no remote could be determined
 */
const resolveSubtreeUpstream = async (vendored: Vendored, args: VendoredArgs, cwd: string) => {
  const remote = ownValue(args, 'remote') || vendored.remote;
  if (!remote) return null;

  const branch =
    ownValue(args, 'branch') || vendored.branch || (await resolveDefaultBranch(remote, cwd));
  return branch ? { remote, branch } : null;
};

/** Ask the remote what it calls its default branch, rather than guessing "master" or "main". */
const resolveDefaultBranch = async (remote: string, cwd: string) => {
  const result = await gitExec(['ls-remote', '--symref', remote, 'HEAD'], cwd);
  if (result.exitCode !== 0) return '';
  return result.stdout.match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD$/m)?.[1] ?? '';
};

export default resolveSubtreeUpstream;
