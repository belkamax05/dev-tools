import getUpstreamStats from '../getUpstreamStats';
import gitExec from '../gitExec';

export interface MegaSelfState {
  /** Tracking branch as `<remote>/<branch>`, or '' when the branch tracks nothing. */
  upstream: string;
  /** Remote half of the tracking branch, or '' when there is none. */
  remote: string;
  /** Branch half of the tracking branch, or '' when there is none. */
  branch: string;
  /** Commits upstream has that this repo does not. `null` when there is no tracking branch. */
  behind: number | null;
  /** Commits this repo has that upstream does not. `null` when there is no tracking branch. */
  ahead: number | null;
}

interface GetMegaSelfStateOptions {
  /** Contact the remote first, so "behind" is a fact rather than whatever was last fetched. */
  fetch?: boolean;
  /** Passthrough flags for that fetch, so the repo's own is given what the vendored ones are. */
  forward?: string[];
}

/**
 * Where the repository itself stands against its own upstream.
 *
 * The vendored directories get this from `getVendoredState`, which cannot answer it for the repo
 * they live in: that one has no pinned commit and no recorded remote of its own, only an ordinary
 * tracking branch. A branch that tracks nothing is not an error here — plenty of work happens on
 * one — so it comes back as nulls rather than zeroes, the same way an unreachable upstream does.
 *
 * @param cwd - Any directory inside the repository
 * @param options - Whether to fetch
 * @returns The tracking branch and the distance to it
 */
const getMegaSelfState = async (
  cwd: string,
  { fetch = true, forward = [] }: GetMegaSelfStateOptions = {},
): Promise<MegaSelfState> => {
  const none = { upstream: '', remote: '', branch: '', behind: null, ahead: null };

  const tracked = await gitExec(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], cwd);
  if (tracked.exitCode !== 0) return none;

  const upstream = tracked.stdout.trim();
  const slash = upstream.indexOf('/');
  if (slash === -1) return none;

  const remote = upstream.slice(0, slash);
  const branch = upstream.slice(slash + 1);

  //? Fetching only the tracked branch rather than the whole remote: this is a status check, and
  //? updating every other branch's tracking ref is a side effect nobody asked for.
  if (fetch) await gitExec(['fetch', '--no-tags', ...forward, remote, branch], cwd);

  const { ahead, behind } = await getUpstreamStats(cwd);
  return { upstream, remote, branch, behind, ahead };
};

export default getMegaSelfState;
