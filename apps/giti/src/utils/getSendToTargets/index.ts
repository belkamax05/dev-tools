import type { Branch } from '../../core/branches';

/** A branch `giti send-to` can force HEAD over — on the remote already, or only local so far. */
export interface SendToTarget {
  /** The branch name on the remote, without the `<remote>/` prefix. */
  name: string;
  /** The remote has it — a force push replaces it, rather than creating it. */
  onRemote: boolean;
  subject: string;
  when: string;
  timestamp: number;
}

/**
 * The remote `send-to` pushes to: the one the current branch tracks, else `remote.pushdefault`,
 * else `origin`, else whichever remote there is.
 *
 * The tracked one is matched against the real remote names rather than cut at the first `/`, since
 * a remote may be called `team/fork`.
 */
export const pickSendToRemote = (
  upstream: string,
  remotes: string[],
  pushDefault = '',
): string | undefined =>
  remotes.find((remote) => upstream.startsWith(`${remote}/`)) ??
  (remotes.includes(pushDefault) ? pushDefault : undefined) ??
  (remotes.includes('origin') ? 'origin' : remotes[0]);

/**
 * Every branch `send-to` offers for `remote`: what the remote has, plus local branches it does not
 * have yet, newest first — never the checked-out branch, which a plain `send` already covers.
 *
 * Pure, over `getBranches`'s listing, so the screen and its tests share one answer.
 */
const getSendToTargets = (branches: Branch[], current: string, remote: string): SendToTarget[] => {
  const byName = new Map<string, SendToTarget>();
  const prefix = `${remote}/`;
  for (const branch of branches) {
    if (branch.isRemote && !branch.name.startsWith(prefix)) continue;
    const name = branch.isRemote ? branch.name.slice(prefix.length) : branch.name;
    if (!name || name === current) continue;
    const known = byName.get(name);
    //? The remote's copy is the one a force push replaces, so its tip is the one worth showing
    if (known && (known.onRemote || !branch.isRemote)) continue;
    byName.set(name, {
      name,
      onRemote: branch.isRemote,
      subject: branch.subject,
      when: branch.when,
      timestamp: branch.timestamp,
    });
  }
  return [...byName.values()].sort((a, b) => b.timestamp - a.timestamp);
};

export default getSendToTargets;
