import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

import git, { failure } from '../run';
import type { OperationResult } from '../status';

/**
 * Stashes shared through a remote, for handing work in progress to a teammate.
 *
 * Each one is a real git stash commit — the same three-parent shape `git stash -u` writes (HEAD,
 * the index, the untracked files) — pushed to `refs/stashes/<name>`. Not a branch, so it is in
 * nobody's branch list, the hosting UI or CI's branch discovery; not a patch file, so binary files,
 * deletions, untracked files and what was staged all travel, and applying merges against the
 * commit it was taken on rather than failing on context that has since moved.
 */

/** Where stashes live on the remote. */
export const REMOTE_PREFIX = 'refs/stashes/';
/** Where the last listing of `remote`'s stashes is kept locally — beside `refs/giti/<kind>/*`. */
const localPrefix = (remote: string) => `refs/giti/stashes/${remote}/`;

export interface RemoteStash {
  name: string;
  hash: string;
  /** The branch it was taken on, from git's own "On <branch>: …" subject. */
  branch: string;
  author: string;
  /** "3 hours ago". */
  when: string;
  /** Seconds since the epoch — the listing's order. */
  timestamp: number;
}

const SEP = '\u001f';

/** The top of the work tree — every path below is relative to it, whatever folder giti ran in. */
export const getTopLevel = async (cwd: string) => {
  const result = await git(['rev-parse', '--show-toplevel'], cwd);
  if (!result.ok) throw new Error(failure(result, 'not a git repository'));
  return result.stdout.trim();
};

/**
 * The remote stashes go to: `remote.pushDefault`, else `origin`, else the only remote there is.
 *
 * @throws when there is no remote to share through, or several and none of them is the default
 */
export const resolveStashRemote = async (cwd: string, named?: string) => {
  const remotes = (await git(['remote'], cwd)).stdout.split('\n').filter(Boolean);
  if (named) {
    if (!remotes.includes(named)) throw new Error(`${named} is not a remote`);
    return named;
  }
  const pushDefault = (await git(['config', 'remote.pushDefault'], cwd)).stdout.trim();
  if (pushDefault && remotes.includes(pushDefault)) return pushDefault;
  if (remotes.includes('origin')) return 'origin';
  if (remotes.length === 1 && remotes[0]) return remotes[0];
  throw new Error(
    remotes.length
      ? `Several remotes and no origin — pick one with --remote=<name> (${remotes.join(', ')})`
      : 'No remote to share stashes through — add one with giti remotes add',
  );
};

/** Why `name` cannot be a stash name, or nothing when it can. */
export const checkStashName = async (cwd: string, name: string) => {
  if (!name.trim()) return 'A stash needs a name';
  if (/\s/.test(name)) return 'No spaces — use - or / instead';
  const result = await git(['check-ref-format', `${REMOTE_PREFIX}${name}`], cwd);
  return result.ok ? undefined : `${name} is not a valid name (see git check-ref-format)`;
};

/** A stash's name as typed, or as its listed ref: `refs/stashes/` is dropped either way. */
export const normalizeStashName = (name: string) => name.trim().replace(/^refs\/stashes\//, '');

/**
 * Read `remote`'s stashes into `refs/giti/stashes/<remote>/*`, dropping any it no longer has.
 *
 * @throws when the remote cannot be reached — an empty list would read as "no stashes"
 */
export const fetchRemoteStashes = async (root: string, remote: string) => {
  const result = await git(
    [
      'fetch',
      '--quiet',
      '--prune',
      '--no-tags',
      '--no-write-fetch-head',
      remote,
      `+${REMOTE_PREFIX}*:${localPrefix(remote)}*`,
    ],
    root,
  );
  if (!result.ok) throw new Error(failure(result, `could not read stashes from ${remote}`));
};

/** The stashes as last fetched from `remote`, most recent first. */
export const listFetchedStashes = async (root: string, remote: string): Promise<RemoteStash[]> => {
  const prefix = localPrefix(remote);
  const result = await git(
    [
      'for-each-ref',
      '--sort=-committerdate',
      `--format=${['%(refname)', '%(objectname)', '%(subject)', '%(authorname)', '%(committerdate:relative)', '%(committerdate:unix)'].join(SEP)}`,
      prefix,
    ],
    root,
  );
  return result.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [ref = '', hash = '', subject = '', author = '', when = '', timestamp = '0'] =
        line.split(SEP);
      return {
        name: ref.slice(prefix.length),
        hash,
        branch: subject.match(/^On ([^:]+):/)?.[1] ?? '',
        author,
        when,
        timestamp: Number(timestamp),
      };
    });
};

/** Fetch, then list: `remote`'s stashes as they are now, most recent first. */
export const getRemoteStashes = async (root: string, remote: string) => {
  await fetchRemoteStashes(root, remote);
  return listFetchedStashes(root, remote);
};

/** One `git status`-style line per file a stash carries: `M\tsrc/a.ts`, `A\tnew.txt`. */
export const getRemoteStashFiles = async (root: string, hash: string) => {
  const result = await git(
    ['stash', 'show', '--name-status', '--include-untracked', '--no-renames', hash],
    root,
  );
  return result.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status = '', ...path] = line.split('\t');
      return { status, path: path.join('\t') };
    });
};

/** A stash's whole patch, untracked files included, for the preview. */
export const getRemoteStashDiff = async (root: string, hash: string) =>
  (await git(['stash', 'show', '-p', '--include-untracked', '--no-color', hash], root)).stdout;

/**
 * Build a `git stash -u` commit of the work tree **without touching it**.
 *
 * `git stash create` would do this for tracked files but has no `--include-untracked`, and
 * `git stash push -u` empties the work tree, which sharing has no reason to do. So the three trees
 * are written by hand into scratch index files, the real index left as it is:
 *
 * - index: the index as it stands (`write-tree`);
 * - work tree: that index with every tracked file brought up to its work-tree content (`add -u`);
 * - untracked: the files `git status` calls untracked, `.gitignore`d ones left out — on their own.
 *
 * Returns the stash commit's hash, or nothing when there is nothing to stash.
 *
 * @throws on a conflicted index (git cannot write it as a tree) or a repository with no commit yet
 */
export const createStashCommit = async (root: string, name: string) => {
  const head = await git(['rev-parse', '--verify', '--quiet', 'HEAD'], root);
  if (!head.ok) throw new Error('Nothing committed yet — a stash is taken against a commit');
  const branch =
    (await git(['symbolic-ref', '--quiet', '--short', 'HEAD'], root)).stdout.trim() ||
    '(no branch)';
  const headLine = (await git(['log', '-1', '--format=%h %s', 'HEAD'], root)).stdout.trim();

  const indexTree = await git(['write-tree'], root);
  if (!indexTree.ok) throw new Error('Resolve the conflicts first — the index cannot be stashed');

  //? Scratch index files inside .git, so a crash leaves nothing in the work tree to commit
  const scratch = resolve(
    root,
    (await git(['rev-parse', '--git-path', `giti-stash-${process.pid}`], root)).stdout.trim(),
  );
  const withIndex = (file: string) => ({ env: { GIT_INDEX_FILE: file } });
  try {
    const workIndex = `${scratch}-work`;
    await git(['read-tree', indexTree.stdout.trim()], root, withIndex(workIndex));
    const added = await git(['add', '-u', '--', ':/'], root, withIndex(workIndex));
    if (!added.ok) throw new Error(failure(added, 'could not read the work tree'));
    const workTree = (await git(['write-tree'], root, withIndex(workIndex))).stdout.trim();

    const untracked = (
      await git(['ls-files', '-z', '--others', '--exclude-standard', '--full-name', ':/'], root)
    ).stdout;
    let untrackedTree = '';
    if (untracked) {
      const untrackedIndex = `${scratch}-untracked`;
      const add = await git(
        ['add', '--force', '--pathspec-from-file=-', '--pathspec-file-nul'],
        root,
        { input: untracked, ...withIndex(untrackedIndex) },
      );
      if (!add.ok) throw new Error(failure(add, 'could not read the untracked files'));
      untrackedTree = (await git(['write-tree'], root, withIndex(untrackedIndex))).stdout.trim();
    }

    const headTree = (await git(['rev-parse', 'HEAD^{tree}'], root)).stdout.trim();
    if (!untrackedTree && workTree === headTree && indexTree.stdout.trim() === headTree) return;

    const commitTree = async (tree: string, message: string, parents: string[]) => {
      const result = await git(
        ['commit-tree', tree, ...parents.flatMap((parent) => ['-p', parent]), '-m', message],
        root,
      );
      if (!result.ok) throw new Error(failure(result, 'could not write the stash'));
      return result.stdout.trim();
    };
    const headHash = head.stdout.trim();
    const indexCommit = await commitTree(indexTree.stdout.trim(), `index on ${branch}: ${headLine}`, [
      headHash,
    ]);
    const parents = [headHash, indexCommit];
    if (untrackedTree)
      parents.push(await commitTree(untrackedTree, `untracked files on ${branch}: ${headLine}`, []));
    //? git's own subject, so `git stash show` and the listing's branch column both read it
    return commitTree(workTree, `On ${branch}: ${name}`, parents);
  } finally {
    rmSync(`${scratch}-work`, { force: true });
    rmSync(`${scratch}-untracked`, { force: true });
  }
};

/**
 * Stash the work tree and push it to `remote` as `name`. The work tree is left as it was.
 *
 * Without `force` an existing stash of that name is not replaced: the new commit is unrelated to
 * it, so the push is a non-fast-forward and the remote refuses it.
 */
export const saveRemoteStash = async (
  root: string,
  remote: string,
  name: string,
  { force = false } = {},
): Promise<OperationResult & { hash?: string }> => {
  const invalid = await checkStashName(root, name);
  if (invalid) return { ok: false, message: invalid };
  const hash = await createStashCommit(root, name);
  if (!hash) return { ok: false, message: 'Nothing to stash — the working tree is clean' };
  const result = await git(
    ['push', '--quiet', remote, `${force ? '+' : ''}${hash}:${REMOTE_PREFIX}${name}`],
    root,
  );
  if (!result.ok) {
    return {
      ok: false,
      message: /rejected|already exists|non-fast-forward/i.test(result.stderr)
        ? `${remote} already has a stash named ${name} — pick another name, or --force to replace it`
        : failure(result, 'could not push the stash'),
    };
  }
  await git(['update-ref', `${localPrefix(remote)}${name}`, hash], root);
  return { ok: true, message: `Saved stash ${name} to ${remote}`, hash };
};

/**
 * Fetch `name` from `remote` and apply it. The stash stays on the remote for the next person.
 *
 * `index` puts staged changes back as staged; when git cannot (the index has moved too far for
 * them to apply cleanly) it says so before changing anything, and the stash is applied again with
 * everything unstaged rather than not at all.
 */
export const applyRemoteStash = async (
  root: string,
  remote: string,
  name: string,
  { index = true } = {},
): Promise<OperationResult> => {
  const local = `${localPrefix(remote)}${name}`;
  const fetched = await git(
    ['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', remote, `+${REMOTE_PREFIX}${name}:${local}`],
    root,
  );
  if (!fetched.ok) {
    return {
      ok: false,
      message: /couldn't find remote ref/i.test(fetched.stderr)
        ? `${remote} has no stash named ${name} — giti stash list shows them`
        : failure(fetched, 'could not fetch the stash'),
    };
  }
  const hash = (await git(['rev-parse', local], root)).stdout.trim();
  if (index) {
    const withIndex = await git(['stash', 'apply', '--index', hash], root);
    if (withIndex.ok) return { ok: true, message: `Applied stash ${name}` };
    //? git checks this before writing anything, so a plain apply starts from the same tree
    if (!/Conflicts in index|try without --index/i.test(withIndex.stderr + withIndex.stdout))
      return { ok: false, message: failure(withIndex, 'apply stopped') };
  }
  const plain = await git(['stash', 'apply', hash], root);
  return plain.ok
    ? {
        ok: true,
        message: index
          ? `Applied stash ${name} — staged changes could not be restored, so all are unstaged`
          : `Applied stash ${name}`,
      }
    : { ok: false, message: failure(plain, 'apply stopped') };
};

/** Delete `name` from `remote`, and the local copy of it. */
export const removeRemoteStash = async (
  root: string,
  remote: string,
  name: string,
): Promise<OperationResult> => {
  const result = await git(['push', '--quiet', remote, `:${REMOTE_PREFIX}${name}`], root);
  //? A remote deleting a ref it never had only warns, exit 0 — that is still "no such stash"
  if (!result.ok || /non-existent ref/i.test(result.stderr)) {
    await git(['update-ref', '-d', `${localPrefix(remote)}${name}`], root);
    return {
      ok: false,
      message: /unable to delete|does not exist|non-existent ref/i.test(result.stderr)
        ? `${remote} has no stash named ${name}`
        : failure(result, 'could not remove the stash'),
    };
  }
  await git(['update-ref', '-d', `${localPrefix(remote)}${name}`], root);
  return { ok: true, message: `Removed stash ${name} from ${remote}` };
};

export default getRemoteStashes;
