import gitExec from '../gitExec';

/**
 * Whether git can run `subrepo` as a subcommand.
 *
 * This, and not `brew list git-subrepo`, is the presence check: git-subrepo is a git *subcommand*,
 * so the only thing that matters is that git finds it on PATH. A manual clone into `~/.gitsubrepo`
 * counts as installed just as much as a brew formula does, and the check keeps working if the
 * package manager ever changes. `version` is one of the few subrepo commands that does not need to
 * run inside a repository, so this is safe to call from anywhere.
 *
 * @returns `true` when `git subrepo version` succeeds
 */
const isSubrepoUsable = async () =>
  (await gitExec(['subrepo', 'version'], process.cwd())).exitCode === 0;

export default isSubrepoUsable;
