import git, { failure } from '../run';
import type { OperationResult } from '../status';

export interface Remote {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

export const getRemotes = async (root: string): Promise<Remote[]> => {
  const result = await git(['remote', '-v'], root);
  const byName = new Map<string, Remote>();
  for (const line of result.stdout.split('\n')) {
    const [name, url, kind] = line.split(/\s+/);
    if (!name || !url) continue;
    const remote = byName.get(name) ?? { name, fetchUrl: '', pushUrl: '' };
    if (kind === '(push)') remote.pushUrl = url;
    else remote.fetchUrl = url;
    byName.set(name, remote);
  }
  return [...byName.values()];
};

type Progress = (line: string) => void;

const run = async (
  args: string[],
  root: string,
  onProgress: Progress | undefined,
  success: string,
  fallback: string,
): Promise<OperationResult> => {
  const result = await git(args, root, { onProgress });
  return result.ok
    ? { ok: true, message: success }
    : { ok: false, message: failure(result, fallback) };
};

export const fetchAll = (root: string, onProgress?: Progress) =>
  run(
    ['fetch', '--all', '--prune', '--progress'],
    root,
    onProgress,
    'Fetched every remote',
    'fetch failed',
  );

//? --ff-only: a pull that would create a merge commit stops and says so,
//? rather than making a decision about history in the background
export const pullCurrent = (root: string, onProgress?: Progress) =>
  run(['pull', '--ff-only', '--progress'], root, onProgress, 'Pulled', 'pull stopped');

/**
 * Push the current branch. One with no upstream yet is pushed to `remote`
 * under its own name and set to track it — the usual first push. `force`
 * means `--force-with-lease`, which refuses if the remote moved since the
 * last fetch, never a bare `--force`.
 */
export const pushCurrent = async (
  root: string,
  {
    remote = 'origin',
    force = false,
    onProgress,
  }: { remote?: string; force?: boolean; onProgress?: Progress } = {},
): Promise<OperationResult> => {
  const branch = (await git(['symbolic-ref', '--short', '-q', 'HEAD'], root)).stdout.trim();
  if (!branch) return { ok: false, message: 'Detached HEAD — switch to a branch to push' };
  const upstream = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], root);
  const args = [
    'push',
    '--progress',
    ...(force ? ['--force-with-lease'] : []),
    ...(upstream.ok ? [] : ['--set-upstream', remote, branch]),
  ];
  return run(
    args,
    root,
    onProgress,
    upstream.ok ? `Pushed ${branch}` : `Pushed ${branch} to ${remote} and set it as upstream`,
    'push rejected',
  );
};

export default getRemotes;
