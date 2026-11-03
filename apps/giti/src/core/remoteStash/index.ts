import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

import git, { failure } from '../run';
import { getChanges, type OperationResult } from '../status';

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

/** One file a stash carries, and which of its three parts hold a change to it. */
export interface StashFile {
  path: string;
  /** git's letter for the file across the whole stash: `M`, `A`, `D` (`A` for untracked). */
  status: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
}

/** A stash commit's parts: what it was taken on, its index, its work tree, its untracked files. */
const stashParts = async (root: string, hash: string) => {
  const [, base = '', index = '', untracked = ''] = (
    await git(['rev-list', '--parents', '-n', '1', hash], root)
  ).stdout
    .trim()
    .split(' ');
  return { base, index, work: hash, untracked };
};

/** `diff-tree --name-status -z` between two commits, as path → status letter. */
const changedBetween = async (root: string, from: string, to: string) => {
  const fields = (
    await git(['diff-tree', '-r', '-z', '--no-renames', '--name-status', from, to], root)
  ).stdout.split('\0');
  const changed = new Map<string, string>();
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const [status = '', path = ''] = [fields[i], fields[i + 1]];
    if (path) changed.set(path, status);
  }
  return changed;
};

/** Every file a stash carries, by path, with what each part of it holds. */
export const getRemoteStashFiles = async (root: string, hash: string): Promise<StashFile[]> => {
  const parts = await stashParts(root, hash);
  const [overall, staged, unstaged] = await Promise.all([
    changedBetween(root, parts.base, parts.work),
    changedBetween(root, parts.base, parts.index),
    changedBetween(root, parts.index, parts.work),
  ]);
  const untracked = parts.untracked
    ? (await git(['ls-tree', '-r', '-z', '--name-only', parts.untracked], root)).stdout
        .split('\0')
        .filter(Boolean)
    : [];
  const paths = [...new Set([...overall.keys(), ...staged.keys(), ...unstaged.keys(), ...untracked])];
  return paths.sort().map((path) => ({
    path,
    status: overall.get(path) ?? staged.get(path) ?? (untracked.includes(path) ? 'A' : 'M'),
    staged: staged.has(path),
    unstaged: unstaged.has(path),
    untracked: untracked.includes(path),
  }));
};

/** A stash's whole patch, untracked files included, for the preview. */
export const getRemoteStashDiff = async (root: string, hash: string) =>
  (await git(['stash', 'show', '-p', '--include-untracked', '--no-color', hash], root)).stdout;

//? Paths as they are, never globs: a file named `*.ts` must not pull in every other one
const LITERAL = { GIT_LITERAL_PATHSPECS: '1' };

/**
 * One file of a stash: its staged diff and its unstaged one, each under a line saying which —
 * the split it arrives in — or the whole of it when it is untracked.
 */
export const getRemoteStashFileDiff = async (root: string, hash: string, file: StashFile) => {
  const parts = await stashParts(root, hash);
  const diff = async (from: string, to: string) =>
    (await git(['diff', '--no-color', from, to, '--', file.path], root, { env: LITERAL })).stdout;
  if (file.untracked) {
    const empty = (await git(['hash-object', '-t', 'tree', '--stdin'], root, { input: '' })).stdout;
    return diff(empty.trim(), parts.untracked);
  }
  const [staged, unstaged] = await Promise.all([
    file.staged ? diff(parts.base, parts.index) : '',
    file.unstaged ? diff(parts.index, parts.work) : '',
  ]);
  return [staged && `### staged — arrives staged\n${staged}`, unstaged && `### unstaged\n${unstaged}`]
    .filter(Boolean)
    .join('\n');
};

/**
 * The files that typed paths name — a file itself, or everything under a folder (`.` for all).
 * Paths are repository-relative, as `resolveRepoPaths` returns them.
 */
export const matchChangedPaths = <T extends { path: string }>(files: T[], typed: string[]) =>
  files.filter((file) =>
    typed.some(
      (path) =>
        path === '.' || file.path === path || file.path.startsWith(`${path.replace(/\/$/, '')}/`),
    ),
  );

/**
 * Scratch index files inside .git, so a crash leaves nothing in the work tree to commit. `run`
 * gets the base path and they are removed after it, however it ends.
 */
const withScratch = async <T>(root: string, run: (scratch: string) => Promise<T>) => {
  const scratch = resolve(
    root,
    (await git(['rev-parse', '--git-path', `giti-stash-${process.pid}`], root)).stdout.trim(),
  );
  try {
    return await run(scratch);
  } finally {
    for (const part of ['index', 'work', 'untracked']) rmSync(`${scratch}-${part}`, { force: true });
  }
};

/**
 * `from` read into the scratch index `file`, with `diffArgs`' patch of `paths` applied on top —
 * as a tree. The diff is git's own (real index, work tree or two commits, as `diffArgs` say); only
 * the apply goes to the scratch index.
 */
const layer = async (
  root: string,
  file: string,
  from: string,
  diffArgs: string[],
  paths: string[],
) => {
  const scratch = { GIT_INDEX_FILE: file };
  await git(['read-tree', from], root, { env: scratch });
  if (paths.length) {
    //? --binary/--full-index carry binary files; --no-renames keeps both sides of a rename
    const patch = await git(
      ['diff', ...diffArgs, '--binary', '--full-index', '--no-renames', '--no-color', '--', ...paths],
      root,
      { env: LITERAL },
    );
    if (!patch.ok) throw new Error(failure(patch, 'could not read the changes'));
    if (patch.stdout) {
      const applied = await git(['apply', '--cached', '-'], root, {
        input: patch.stdout,
        env: scratch,
      });
      if (!applied.ok) throw new Error(failure(applied, 'could not write the stash'));
    }
  }
  const tree = await git(['write-tree'], root, { env: scratch });
  if (!tree.ok) throw new Error(failure(tree, 'could not write the stash'));
  return tree.stdout.trim();
};

const commitTree = async (root: string, tree: string, message: string, parents: string[]) => {
  const result = await git(
    ['commit-tree', tree, ...parents.flatMap((parent) => ['-p', parent]), '-m', message],
    root,
  );
  if (!result.ok) throw new Error(failure(result, 'could not write the stash'));
  return result.stdout.trim();
};

/**
 * Build a `git stash -u` commit of the chosen files **without touching the work tree or the
 * index**.
 *
 * `git stash push -u -- <paths>` would empty those files from the work tree, which sharing has no
 * reason to do, and `git stash create` takes neither paths nor untracked files. So the three trees
 * are written by hand into scratch index files, and only the chosen paths ever reach them:
 *
 * - index: HEAD, plus what is staged for those paths (`diff --cached | apply --cached`);
 * - work tree: that, plus their unstaged changes (`diff | apply --cached`);
 * - untracked: the chosen untracked files, on their own — as `git stash -u` keeps them.
 *
 * Every other file is HEAD's in all three, so applying the stash brings in the chosen files only,
 * staged where they were staged. `paths` are repository-relative, as `git status` prints them;
 * leaving them out stashes every change.
 *
 * Returns the stash commit's hash, or nothing when there is nothing to stash.
 *
 * @throws on a chosen file in conflict, or a repository with no commit yet
 */
export const createStashCommit = async (root: string, name: string, paths?: string[]) => {
  const head = await git(['rev-parse', '--verify', '--quiet', 'HEAD'], root);
  if (!head.ok) throw new Error('Nothing committed yet — a stash is taken against a commit');
  const branch =
    (await git(['symbolic-ref', '--quiet', '--short', 'HEAD'], root)).stdout.trim() ||
    '(no branch)';
  const headLine = (await git(['log', '-1', '--format=%h %s', 'HEAD'], root)).stdout.trim();

  const wanted = paths && new Set(paths);
  const chosen = (await getChanges(root)).filter((change) => !wanted || wanted.has(change.path));
  if (!chosen.length) return;
  const conflicted = chosen.filter((change) => change.conflicted).map((change) => change.path);
  if (conflicted.length) throw new Error(`Resolve the conflicts first: ${conflicted.join(', ')}`);
  //? A rename's old path goes too, or the stash would add the new file and keep the old one
  const tracked = chosen
    .filter((change) => !change.untracked)
    .flatMap((change) => (change.origPath ? [change.path, change.origPath] : [change.path]));
  const untracked = chosen.filter((change) => change.untracked).map((change) => change.path);

  return withScratch(root, async (scratch) => {
    const indexTree = await layer(root, `${scratch}-index`, 'HEAD', ['--cached', 'HEAD'], tracked);
    const workTree = await layer(root, `${scratch}-work`, indexTree, [], tracked);

    let untrackedTree = '';
    if (untracked.length) {
      const env = { GIT_INDEX_FILE: `${scratch}-untracked`, ...LITERAL };
      const add = await git(
        ['add', '--force', '--pathspec-from-file=-', '--pathspec-file-nul'],
        root,
        { input: `${untracked.join('\0')}\0`, env },
      );
      if (!add.ok) throw new Error(failure(add, 'could not read the untracked files'));
      untrackedTree = (await git(['write-tree'], root, { env })).stdout.trim();
    }

    const headHash = head.stdout.trim();
    const indexCommit = await commitTree(root, indexTree, `index on ${branch}: ${headLine}`, [
      headHash,
    ]);
    const parents = [headHash, indexCommit];
    if (untrackedTree)
      parents.push(
        await commitTree(root, untrackedTree, `untracked files on ${branch}: ${headLine}`, []),
      );
    //? git's own subject, so `git stash show` and the listing's branch column both read it
    return commitTree(root, workTree, `On ${branch}: ${name}`, parents);
  });
};

/**
 * A copy of stash `hash` holding only `paths` — what a partial apply applies. Built the way
 * `createStashCommit` builds one, from the stash's own parts instead of the work tree: the base
 * plus the chosen paths' staged diff, then their unstaged diff, then the chosen untracked files.
 * Every other file is the base's, so `git stash apply` of the copy leaves it alone, and staged
 * still arrives staged. Local only — nothing is pushed.
 *
 * @throws when none of `paths` is in the stash
 */
export const narrowStashCommit = async (root: string, hash: string, paths: string[]) => {
  const parts = await stashParts(root, hash);
  const files = await getRemoteStashFiles(root, hash);
  const chosen = files.filter((file) => paths.includes(file.path));
  if (!chosen.length) throw new Error('None of those files is in the stash');
  const tracked = chosen.filter((file) => !file.untracked).map((file) => file.path);
  const untracked = chosen.filter((file) => file.untracked).map((file) => file.path);
  const subject = (await git(['log', '-1', '--format=%s', hash], root)).stdout.trim();

  return withScratch(root, async (scratch) => {
    const indexTree = await layer(
      root,
      `${scratch}-index`,
      parts.base,
      [parts.base, parts.index],
      tracked,
    );
    const workTree = await layer(
      root,
      `${scratch}-work`,
      indexTree,
      [parts.index, parts.work],
      tracked,
    );
    const indexCommit = await commitTree(root, indexTree, 'index (narrowed)', [parts.base]);
    const parentList = [parts.base, indexCommit];
    if (untracked.length) {
      //? `ls-tree` lines are `update-index --index-info` lines: the chosen entries, copied over
      const env = { GIT_INDEX_FILE: `${scratch}-untracked` };
      const entries = (
        await git(['ls-tree', '-r', '-z', parts.untracked, '--', ...untracked], root, {
          env: LITERAL,
        })
      ).stdout;
      await git(['read-tree', '--empty'], root, { env });
      const copied = await git(['update-index', '-z', '--index-info'], root, {
        input: entries,
        env,
      });
      if (!copied.ok) throw new Error(failure(copied, 'could not read the untracked files'));
      const tree = (await git(['write-tree'], root, { env })).stdout.trim();
      parentList.push(await commitTree(root, tree, 'untracked files (narrowed)', []));
    }
    return commitTree(root, workTree, subject, parentList);
  });
};

/**
 * Stash the chosen files (every change when `paths` is left out) and push them to `remote` as
 * `name`. The work tree and the index are left as they were.
 *
 * Without `force` an existing stash of that name is not replaced: the new commit is unrelated to
 * it, so the push is a non-fast-forward and the remote refuses it.
 */
export const saveRemoteStash = async (
  root: string,
  remote: string,
  name: string,
  { force = false, paths }: { force?: boolean; paths?: string[] } = {},
): Promise<OperationResult & { hash?: string }> => {
  const invalid = await checkStashName(root, name);
  if (invalid) return { ok: false, message: invalid };
  if (paths && !paths.length) return { ok: false, message: 'No files chosen to stash' };
  const hash = await createStashCommit(root, name, paths);
  if (!hash)
    return {
      ok: false,
      message: paths ? 'None of those files has changes' : 'Nothing to stash — the working tree is clean',
    };
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
 *
 * `paths` applies only those of its files (`narrowStashCommit`); the rest of the stash is left out.
 */
export const applyRemoteStash = async (
  root: string,
  remote: string,
  name: string,
  { index = true, paths }: { index?: boolean; paths?: string[] } = {},
): Promise<OperationResult> => {
  if (paths && !paths.length) return { ok: false, message: 'No files chosen to apply' };
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
  const fetchedHash = (await git(['rev-parse', local], root)).stdout.trim();
  let hash = fetchedHash;
  if (paths) {
    try {
      hash = await narrowStashCommit(root, fetchedHash, paths);
    } catch (error) {
      return { ok: false, message: (error as Error).message };
    }
  }
  const what = paths ? `${paths.length} file(s) of stash ${name}` : `stash ${name}`;
  if (index) {
    const withIndex = await git(['stash', 'apply', '--index', hash], root);
    if (withIndex.ok) return { ok: true, message: `Applied ${what}` };
    //? git checks this before writing anything, so a plain apply starts from the same tree
    if (!/Conflicts in index|try without --index/i.test(withIndex.stderr + withIndex.stdout))
      return { ok: false, message: failure(withIndex, 'apply stopped') };
  }
  const plain = await git(['stash', 'apply', hash], root);
  return plain.ok
    ? {
        ok: true,
        message: index
          ? `Applied ${what} — staged changes could not be restored, so all are unstaged`
          : `Applied ${what}`,
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
