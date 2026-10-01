import gitExec from '../gitExec';

//? Tried in order when the remote never told us its default — the names projects actually use
const FALLBACKS = ['main', 'master', 'develop'];

const refExists = async (cwd: string, ref: string) =>
  (await gitExec(['rev-parse', '--verify', '-q', ref], cwd)).exitCode === 0;

/**
 * The branch the repository treats as its trunk, without a network round trip.
 *
 * Reads `refs/remotes/<remote>/HEAD`, which `git clone` sets (and `git remote set-head -a`
 * refreshes). A repo without one falls back to the first of `main`/`master`/`develop` that exists
 * locally or on the remote. Empty when none does — the caller decides what that means.
 */
const getDefaultBranch = async (cwd: string, remote = 'origin') => {
  const head = await gitExec(['symbolic-ref', '-q', '--short', `refs/remotes/${remote}/HEAD`], cwd);
  const pointed = head.exitCode === 0 ? head.stdout.trim() : '';
  if (pointed.startsWith(`${remote}/`)) return pointed.slice(remote.length + 1);

  for (const name of FALLBACKS) {
    if (await refExists(cwd, `refs/heads/${name}`)) return name;
    if (await refExists(cwd, `refs/remotes/${remote}/${name}`)) return name;
  }
  return '';
};

export default getDefaultBranch;
