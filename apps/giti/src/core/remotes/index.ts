import { join } from 'node:path';

import sysPaths from '../../config/sysPaths';
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

/** One line of `giti mega/pull`'s output, without colour codes or clack's frame and spinner glyphs. */
const plainLine = (line: string) =>
  line
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI is the point
    .replace(/\u001B\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/^[\s│┌└◇◆●○■▲◒◐◓◑✔✖ℹ\uFE0F]+/u, '')
    .trim();

/**
 * Pull the repository and every subrepo, submodule and subtree in it, by running `giti mega/pull`
 * in a child process — its body prints through clack, which would draw straight over the
 * dashboard if run in this one. Piped, it prints one line per step instead of redrawing, and each
 * of those is handed to `onProgress`; the last one is its tally, which becomes the message.
 */
export const pullMega = async (root: string, onProgress?: Progress): Promise<OperationResult> => {
  const giti = join(sysPaths.rootDir, '..', '..', 'bin', 'giti');
  const child = Bun.spawn([process.execPath, giti, 'mega/pull'], {
    cwd: root,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', NO_COLOR: '1' },
  });
  const lines: string[] = [];
  const read = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) {
      for (const raw of decoder.decode(chunk, { stream: true }).split(/[\r\n]+/)) {
        const line = plainLine(raw);
        if (!line) continue;
        lines.push(line);
        onProgress?.(line);
      }
    }
  };
  await Promise.all([read(child.stdout), read(child.stderr)]);
  const exitCode = await child.exited;
  const last = lines.at(-1) ?? '';
  //? mega/pull does not exit non-zero when an entry is left alone — its tally says so instead
  const ok = exitCode === 0 && !/left alone|failed/i.test(last);
  return { ok, message: last || (ok ? 'Pulled' : 'mega pull failed') };
};

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

/**
 * Everything `git remote remove` deletes, captured first so it can be put back exactly — the
 * dashboard's rule is that a destructive action either asks or can be undone, and this one does
 * both. Removing a remote takes more than its URL with it: every `remote.<name>.*` setting
 * (extra fetch refspecs, a push URL), its remote-tracking refs, and the upstream of every local
 * branch that tracked it.
 */
export interface RemovedRemote {
  name: string;
  /** Its `remote.<name>.*` entries in file order — `fetch` may appear more than once. */
  config: [key: string, value: string][];
  /** `branch.<b>.remote`/`.merge`/`.pushRemote` entries that pointed at it. */
  branches: [key: string, value: string][];
  /** Its remote-tracking refs; `symref` set for a symbolic one like `<name>/HEAD`. */
  refs: { ref: string; sha: string; symref: string }[];
}

/** Local config entries whose key matches `pattern`, value intact even with spaces or newlines. */
const configEntries = async (root: string, pattern: string): Promise<[string, string][]> => {
  const result = await git(['config', '--local', '-z', '--get-regexp', pattern], root);
  //? `-z`: each entry is "key\nvalue\0", the one output format with no ambiguity about where a
  //? value ends. No match at all is exit code 1, which here just means "nothing to capture".
  return result.stdout
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const newline = entry.indexOf('\n');
      return newline === -1 ? [entry, ''] : [entry.slice(0, newline), entry.slice(newline + 1)];
    });
};

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Remove a remote, returning what it took with it so `restoreRemote` can undo the removal.
 */
export const removeRemote = async (
  root: string,
  name: string,
): Promise<OperationResult & { undo?: RemovedRemote }> => {
  const [config, branchConfig, refList] = await Promise.all([
    configEntries(root, `^remote\\.${escapeRegex(name)}\\.`),
    configEntries(root, '^branch\\..*\\.(remote|merge|pushremote)$'),
    git(
      ['for-each-ref', '--format=%(refname)%00%(objectname)%00%(symref)', `refs/remotes/${name}/`],
      root,
    ),
  ]);

  //? A branch's `merge` only means something next to its `remote`, so it is kept for exactly the
  //? branches whose remote is this one; `pushRemote` is kept wherever it names this remote.
  const tracking = new Set(
    branchConfig
      .filter(([key, value]) => key.endsWith('.remote') && value === name)
      .map(([key]) => key.slice(0, -'.remote'.length)),
  );
  const branches = branchConfig.filter(
    ([key, value]) =>
      (key.endsWith('.pushremote') && value === name) ||
      tracking.has(key.slice(0, key.lastIndexOf('.'))),
  );

  const refs = refList.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [ref = '', sha = '', symref = ''] = line.split('\0');
      return { ref, sha, symref };
    });

  const result = await git(['remote', 'remove', name], root);
  if (!result.ok) return { ok: false, message: failure(result, `could not remove ${name}`) };

  const tracked = tracking.size;
  return {
    ok: true,
    message: `Removed remote ${name}${tracked ? ` — ${tracked} branch${tracked === 1 ? '' : 'es'} no longer track it` : ''}`,
    undo: { name, config, branches, refs },
  };
};

/**
 * Put a removed remote back as it was: its settings, the branches that tracked it, its refs.
 * Written straight to config rather than through `git remote add`, which would add a default
 * fetch refspec on top of the captured ones.
 */
export const restoreRemote = async (
  root: string,
  removed: RemovedRemote,
): Promise<OperationResult> => {
  const steps: string[][] = [
    ...removed.config.map(([key, value]) => ['config', '--local', '--add', key, value]),
    ...removed.branches.map(([key, value]) => ['config', '--local', key, value]),
    //? Plain refs before symbolic ones: `<name>/HEAD` points at a branch that has to exist first.
    ...removed.refs.filter((r) => !r.symref).map((r) => ['update-ref', r.ref, r.sha]),
    ...removed.refs.filter((r) => r.symref).map((r) => ['symbolic-ref', r.ref, r.symref]),
  ];
  for (const args of steps) {
    const result = await git(args, root);
    if (!result.ok) {
      return { ok: false, message: failure(result, `could not restore ${removed.name}`) };
    }
  }
  return { ok: true, message: `Restored remote ${removed.name}` };
};

export default getRemotes;
