import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import git, { failure } from '../run';
import type { OperationResult } from '../status';

/**
 * Every ref the repository holds, read at the plumbing level — what is under `.git`, rather than
 * what the porcelain chooses to show.
 *
 * The root refs (`HEAD`, `ORIG_HEAD`, `FETCH_HEAD`…) and everything under `refs/`, each read the
 * same way and grouped by the namespace its own name puts it in — nothing here knows what wrote
 * a ref. On request, what each remote advertises too (`ls-remote`), set against the local ref the
 * remote's fetch refspecs would put it in.
 */

/** Where a ref is written: a file of its own, a line of `packed-refs`, both, or a reftable. */
export type RefStorage = 'loose' | 'packed' | 'loose+packed' | 'reftable' | 'remote';

export interface RefEntry {
  /** Unique per row: the full ref name, or `<remote>:<ref>` for an advertised one. */
  id: string;
  /** The full name — `refs/heads/main`, `HEAD`. */
  name: string;
  /** The name inside its namespace — `main` for `refs/heads/main`. */
  short: string;
  /**
   * The namespace its name puts it in — `refs/<first segment>`, or empty for a root ref — or, for
   * an advertised one, `<remote>:` — what the browser groups by.
   */
  group: string;
  /** The object it points at; empty for a symbolic ref that points at nothing yet. */
  hash: string;
  /** `commit`, `tag`, `tree`, `blob` — or `missing` when it is not in the local object store. */
  type: string;
  /** What an annotated tag points at, peeled. */
  peeled?: string;
  peeledType?: string;
  /** The ref a symbolic ref names — `refs/heads/main` for `HEAD`. */
  symref?: string;
  upstream?: string;
  /** "ahead 1, behind 2", "gone". */
  track?: string;
  push?: string;
  /** The branch checked out (in this worktree). */
  isHead?: boolean;
  /** Another worktree that has it checked out. */
  worktree?: string;
  storage: RefStorage;
  subject: string;
  /** Author for a commit, tagger for a tag. */
  author: string;
  /** "3 hours ago". */
  when: string;
  timestamp: number;
  /** Advertised only: the remote it was listed from. */
  remote?: string;
  /** Advertised only: how it compares with what was fetched. */
  fetched?: 'same' | 'differs' | 'not fetched';
  /** Advertised only: the local ref it was compared with. */
  localRef?: string;
}

const SEP = '\u001f';

/**
 * The namespace a ref's name puts it in, and its name inside it: `refs/a/b/c` is `b/c` in
 * `refs/a`; a root ref (`HEAD`) has no namespace. Read off the name alone.
 */
export const splitRefName = (name: string): { group: string; short: string } => {
  if (!name.startsWith('refs/')) return { group: '', short: name };
  const slash = name.indexOf('/', 'refs/'.length);
  return slash < 0
    ? { group: 'refs', short: name.slice('refs/'.length) }
    : { group: name.slice(0, slash), short: name.slice(slash + 1) };
};

interface RefStore {
  format: 'files' | 'reftable';
  gitDir: string;
  commonDir: string;
  packed: Set<string>;
}

const readStore = async (cwd: string): Promise<RefStore> => {
  const [format, dirs] = await Promise.all([
    git(['rev-parse', '--show-ref-format'], cwd),
    git(['rev-parse', '--absolute-git-dir', '--git-common-dir'], cwd),
  ]);
  const [gitDir = '', common = ''] = dirs.stdout.trim().split('\n');
  const commonDir = common.startsWith('/') ? common : join(cwd, common);
  const packed = new Set<string>();
  //? An older git without --show-ref-format prints the flag back; only reftable says so
  if (format.stdout.trim() === 'reftable') return { format: 'reftable', gitDir, commonDir, packed };
  const packedFile = join(commonDir, 'packed-refs');
  if (existsSync(packedFile))
    for (const line of readFileSync(packedFile, 'utf-8').split('\n')) {
      //? `# pack-refs with:` header, `^<hash>` peeled lines — neither names a ref
      if (!line || line.startsWith('#') || line.startsWith('^')) continue;
      const name = line.slice(line.indexOf(' ') + 1);
      if (name) packed.add(name);
    }
  return { format: 'files', gitDir, commonDir, packed };
};

const storageOf = (store: RefStore, name: string): RefStorage => {
  if (store.format === 'reftable') return 'reftable';
  //? Per-worktree refs (HEAD, refs/bisect, refs/worktree) live in the worktree's own git dir
  const loose = existsSync(join(store.gitDir, name)) || existsSync(join(store.commonDir, name));
  const packed = store.packed.has(name);
  return loose && packed ? 'loose+packed' : packed ? 'packed' : 'loose';
};

const FORMAT = [
  '%(refname)',
  '%(objectname)',
  '%(objecttype)',
  '%(symref)',
  '%(upstream:short)',
  '%(upstream:track,nobracket)',
  '%(push:short)',
  '%(*objectname)',
  '%(*objecttype)',
  '%(creatordate:unix)',
  '%(creatordate:relative)',
  '%(authorname)%(taggername)',
  '%(HEAD)',
  '%(worktreepath)',
  '%(contents:subject)',
].join(SEP);

const parseRefLine = (line: string, store: RefStore): RefEntry => {
  const [
    name = '',
    hash = '',
    type = '',
    symref = '',
    upstream = '',
    track = '',
    push = '',
    peeled = '',
    peeledType = '',
    unix = '0',
    when = '',
    author = '',
    head = '',
    worktree = '',
    subject = '',
  ] = line.split(SEP);
  const { group, short } = splitRefName(name);
  return {
    id: name,
    name,
    short,
    group,
    hash,
    type,
    peeled: peeled || undefined,
    peeledType: peeledType || undefined,
    symref: symref || undefined,
    upstream: upstream || undefined,
    track: track || undefined,
    push: push || undefined,
    isHead: head === '*',
    worktree: worktree || undefined,
    storage: storageOf(store, name),
    subject,
    author,
    when,
    timestamp: Number(unix) || 0,
  };
};

/** Every local ref, root refs included: root refs first, then namespace by namespace, by name. */
export const getRefs = async (cwd: string): Promise<RefEntry[]> => {
  const store = await readStore(cwd);
  //? --include-root-refs (git 2.46) adds HEAD, ORIG_HEAD, FETCH_HEAD…; older gits refuse the flag
  let result = await git(['for-each-ref', '--include-root-refs', `--format=${FORMAT}`], cwd);
  if (!result.ok) result = await git(['for-each-ref', `--format=${FORMAT}`], cwd);
  if (!result.ok) throw new Error(result.stderr || 'git for-each-ref failed');
  const refs = result.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => parseRefLine(line, store));
  if (!refs.some((ref) => ref.name === 'HEAD')) {
    //? Without root refs from for-each-ref, HEAD at least: what everything else is read against
    const head = await git(['for-each-ref', `--format=${FORMAT}`, 'HEAD'], cwd);
    const symref = (await git(['symbolic-ref', '-q', 'HEAD'], cwd)).stdout.trim();
    const hash = (await git(['rev-parse', '-q', '--verify', 'HEAD'], cwd)).stdout.trim();
    if (head.stdout.trim()) refs.unshift(parseRefLine(head.stdout.trim(), store));
    else
      refs.unshift({
        id: 'HEAD',
        name: 'HEAD',
        short: 'HEAD',
        group: '',
        hash,
        type: hash ? 'commit' : '',
        symref: symref || undefined,
        storage: storageOf(store, 'HEAD'),
        subject: '',
        author: '',
        when: '',
        timestamp: 0,
      });
  }
  return refs.sort(
    (a, b) =>
      a.group.localeCompare(b.group) ||
      //? HEAD first among the root refs: what everything else is read against
      Number(b.name === 'HEAD') - Number(a.name === 'HEAD') ||
      a.name.localeCompare(b.name),
  );
};

/**
 * The local ref a remote's `name` is fetched into, by the remote's own fetch refspecs
 * (`remote.<name>.fetch`, e.g. `+refs/heads/*:refs/remotes/origin/*`) — the first that matches.
 * Tags fall back to their own name, as git's tag following stores them.
 */
export const localRefFor = (refspecs: string[], name: string) => {
  for (const spec of refspecs) {
    //? `^refs/x` is a negative refspec and `refs/x` without a colon fetches into nothing
    if (spec.startsWith('^') || !spec.includes(':')) continue;
    const [src = '', dst = ''] = spec.replace(/^\+/, '').split(':');
    if (!dst) continue;
    const star = src.indexOf('*');
    if (star < 0) {
      if (src === name) return dst;
      continue;
    }
    const head = src.slice(0, star);
    const tail = src.slice(star + 1);
    if (name.length >= head.length + tail.length && name.startsWith(head) && name.endsWith(tail))
      return dst.replace('*', name.slice(head.length, name.length - tail.length));
  }
  if (name.startsWith('refs/tags/')) return name;
  return undefined;
};

/** `remote`'s fetch refspecs, as configured. */
export const getFetchRefspecs = async (cwd: string, remote: string) =>
  (await git(['config', '--get-all', `remote.${remote}.fetch`], cwd)).stdout
    .split('\n')
    .filter(Boolean);

/** Which of `hashes` the local object store has, and as what type. */
const objectTypes = async (cwd: string, hashes: string[]) => {
  const types = new Map<string, string>();
  if (!hashes.length) return types;
  const result = await git(['cat-file', '--batch-check=%(objectname) %(objecttype)'], cwd, {
    input: `${hashes.join('\n')}\n`,
  });
  for (const line of result.stdout.split('\n')) {
    const [hash = '', type = ''] = line.split(' ');
    if (hash) types.set(hash, type === 'missing' || !type ? 'missing' : type);
  }
  return types;
};

/**
 * What `remote` advertises (`git ls-remote --symref`), each set against the local ref it would be
 * fetched into. Reaches the network.
 *
 * @throws when the remote cannot be reached — an empty list would read as "the remote has nothing"
 */
export const getAdvertisedRefs = async (
  cwd: string,
  remote: string,
  local: RefEntry[],
): Promise<RefEntry[]> => {
  const result = await git(['ls-remote', '--symref', remote], cwd);
  if (!result.ok)
    throw new Error(`${remote}: ${result.stderr.split('\n')[0] || 'ls-remote failed'}`);
  const symrefs = new Map<string, string>();
  const rows: { hash: string; name: string }[] = [];
  for (const line of result.stdout.split('\n')) {
    if (!line) continue;
    const [left = '', name = ''] = line.split('\t');
    if (left.startsWith('ref: ')) symrefs.set(name, left.slice('ref: '.length));
    //? `refs/tags/v1^{}` is the peeled line of an annotated tag — folded into its tag below
    else if (!name.endsWith('^{}')) rows.push({ hash: left, name });
  }
  const peeledOf = new Map(
    result.stdout
      .split('\n')
      .filter((line) => line.endsWith('^{}'))
      .map((line) => {
        const [hash = '', name = ''] = line.split('\t');
        return [name.slice(0, -3), hash] as const;
      }),
  );
  const [types, refspecs] = await Promise.all([
    objectTypes(cwd, [...new Set(rows.map((row) => row.hash))]),
    getFetchRefspecs(cwd, remote),
  ]);
  const byName = new Map(local.map((ref) => [ref.name, ref]));
  return rows.map(({ hash, name }) => {
    //? HEAD is never in a refspec; `git remote set-head` keeps it as refs/remotes/<remote>/HEAD
    const localRef = name === 'HEAD' ? `refs/remotes/${remote}/HEAD` : localRefFor(refspecs, name);
    const fetched = localRef ? byName.get(localRef) : undefined;
    const type = types.get(hash) ?? 'missing';
    return {
      id: `${remote}:${name}`,
      name,
      short: `${remote}: ${name.replace(/^refs\//, '')}`,
      group: `${remote}:`,
      hash,
      type,
      peeled: peeledOf.get(name),
      symref: symrefs.get(name),
      storage: 'remote',
      subject: '',
      author: '',
      when: '',
      timestamp: 0,
      remote,
      localRef,
      fetched: !fetched
        ? 'not fetched'
        : fetched.hash === hash || fetched.peeled === hash
          ? 'same'
          : 'differs',
    };
  });
};

/** The configured remotes, by name. */
export const getRemoteNames = async (cwd: string) =>
  (await git(['remote'], cwd)).stdout.split('\n').filter(Boolean);

//? Past this a preview stops being something to read and starts costing the terminal its frames
const MAX_LINES = 3000;

const capped = (text: string, what: string) => {
  const lines = text.replace(/\n$/, '').split('\n');
  return lines.length <= MAX_LINES
    ? lines.join('\n')
    : `${lines.slice(0, MAX_LINES).join('\n')}\n… ${lines.length - MAX_LINES} more lines of ${what} cut`;
};

export interface RefDetail {
  /** Label/value rows — everything known about the ref and its object. */
  info: [string, string][];
  /** `git cat-file -p` of the object (and of what an annotated tag points at). */
  raw: string;
  /** The ref's reflog, newest first, or a line saying it has none. */
  reflog: string;
  /** What the object holds — a commit's patch (a merge's against each parent), a tree's listing. */
  preview: string;
}

/** Everything about one ref, for the browser's detail pane. */
export const getRefDetail = async (cwd: string, ref: RefEntry): Promise<RefDetail> => {
  const info: [string, string][] = [
    ['name', ref.name],
    ['namespace', ref.group || '(root)'],
    ['storage', ref.storage],
  ];
  if (ref.symref) info.push(['symbolic →', ref.symref]);
  info.push(['object', ref.hash || '(none — unborn)'], ['type', ref.type || '—']);
  if (ref.peeled)
    info.push(['peeled', `${ref.peeled}${ref.peeledType ? ` (${ref.peeledType})` : ''}`]);
  if (ref.isHead) info.push(['checked out', 'here']);
  if (ref.worktree) info.push(['worktree', ref.worktree]);
  if (ref.upstream) info.push(['upstream', `${ref.upstream}${ref.track ? ` · ${ref.track}` : ''}`]);
  if (ref.push && ref.push !== ref.upstream) info.push(['push to', ref.push]);
  if (ref.remote) {
    info.push(['remote', ref.remote]);
    info.push(['fetched as', ref.localRef ?? '(no fetch refspec matches)']);
    info.push(['compared', ref.fetched ?? '—']);
  }
  if (ref.author) info.push(['author', ref.author]);
  if (ref.when) info.push(['date', ref.when]);
  if (ref.subject) info.push(['subject', ref.subject]);

  if (!ref.hash || ref.type === 'missing') {
    const why = ref.hash
      ? `${ref.hash} is not in the local object store — fetch it to read it.`
      : 'Points at nothing yet.';
    return { info, raw: why, reflog: await readReflog(cwd, ref), preview: why };
  }

  const target = ref.peeled && ref.peeledType === 'commit' ? ref.peeled : ref.hash;
  const [raw, peeledRaw, reflog, parentsOut, containing] = await Promise.all([
    git(['cat-file', '-p', ref.hash], cwd),
    ref.peeled ? git(['cat-file', '-p', ref.peeled], cwd) : undefined,
    readReflog(cwd, ref),
    git(['rev-list', '--parents', '-n', '1', target], cwd),
    ref.remote
      ? undefined
      : git(['branch', '--all', '--contains', target, '--format=%(refname:short)'], cwd),
  ]);
  const parents = parentsOut.stdout.trim().split(' ').slice(1).filter(Boolean);
  const subjects = parents.length
    ? (await git(['log', '--no-walk=unsorted', '--format=%s', ...parents], cwd)).stdout.split('\n')
    : [];
  for (const [index, parent] of parents.entries())
    info.push([`parent ^${index + 1}`, `${parent} · ${subjects[index] ?? ''}`]);
  if (parents.length > 1) info.push(['shape', `merge (${parents.length} parents)`]);
  const branches = containing?.stdout.split('\n').filter(Boolean) ?? [];
  if (branches.length)
    info.push([
      'in branches',
      branches.length > 8
        ? `${branches.slice(0, 8).join(', ')} +${branches.length - 8}`
        : branches.join(', '),
    ]);

  let rawText = capped(raw.stdout, 'the object');
  if (peeledRaw)
    rawText += `\n\n── peeled ${ref.peeled} ──\n${capped(peeledRaw.stdout, 'the peeled object')}`;

  return {
    info,
    raw: rawText,
    reflog,
    preview: await readPreview(cwd, target, parents),
  };
};

const readReflog = async (cwd: string, ref: RefEntry) => {
  if (ref.remote) return 'Remote refs have no reflog here.';
  const result = await git(
    //? No --date: it would turn `<ref>@{0}` into `<ref>@{2 hours ago}`
    ['reflog', 'show', '-n', '200', '--format=%h %gd  %gs  (%cr)', ref.name, '--'],
    cwd,
  );
  const text = result.stdout.trim();
  return result.ok && text ? text : `No reflog for ${ref.name}.`;
};

const readPreview = async (cwd: string, hash: string, parents: string[]): Promise<string> => {
  const type = (await git(['cat-file', '-t', hash], cwd)).stdout.trim();
  if (type === 'tree')
    return capped((await git(['ls-tree', '-r', '-l', hash], cwd)).stdout, 'the tree');
  if (type === 'blob') return capped((await git(['cat-file', '-p', hash], cwd)).stdout, 'the blob');
  if (type !== 'commit') return `A ${type || 'missing'} object — see Object for its contents.`;
  if (parents.length >= 2) {
    //? A merge read as one diff hides what each side brought: the change against ^1, then every
    //? further parent's own change — whatever made the commit, each part reads on its own
    const [main, ...others] = await Promise.all([
      git(
        ['show', '--format=fuller', '--stat', '--patch', '--diff-merges=first-parent', hash],
        cwd,
      ),
      ...parents
        .slice(1)
        .map((_, index) =>
          git(['show', '--format=%h %s', '--stat', '--patch', `${hash}^${index + 2}`], cwd),
        ),
    ]);
    const parts = [
      `── against ^1 ──\n${main.stdout.trim()}`,
      ...others.map(
        (part, index) => `── ^${index + 2}: its own change ──\n${part.stdout.trim() || '(empty)'}`,
      ),
    ];
    return capped(parts.join('\n\n'), 'the commit');
  }
  const show = await git(
    ['show', '--format=fuller', '--stat', '--patch', '--diff-merges=first-parent', hash],
    cwd,
  );
  return capped(show.stdout, 'the commit');
};

/** The top of the work tree, for a caller that ran in a subfolder. */
export const getTopLevel = async (cwd: string) => {
  const result = await git(['rev-parse', '--show-toplevel'], cwd);
  if (!result.ok) throw new Error(result.stderr || 'not a git repository');
  return result.stdout.trim();
};

/** What a deleted ref was — enough to write it back. */
export interface DeletedRef {
  name: string;
  hash: string;
  symref?: string;
  /** Deleted on this remote rather than locally. */
  remote?: string;
}

/**
 * Delete one ref: locally with `update-ref -d` (guarded by the hash it was read at, so a ref that
 * moved since is left alone) or `symbolic-ref --delete`; an advertised one on its remote with
 * `push --delete`. Returns what it was, for `restoreRef`, whenever it can be put back.
 */
export const deleteRef = async (
  cwd: string,
  ref: RefEntry,
): Promise<OperationResult & { restore?: DeletedRef }> => {
  if (ref.remote) {
    const result = await git(['push', ref.remote, '--delete', ref.name], cwd);
    if (!result.ok) return { ok: false, message: failure(result, `Could not delete ${ref.name}`) };
    //? Only an object this repository has can be pushed back
    const restorable = ref.type !== 'missing' && !ref.symref;
    return {
      ok: true,
      message: `Deleted ${ref.name} on ${ref.remote}${restorable ? '' : ' — not restorable from here'}`,
      restore: restorable ? { name: ref.name, hash: ref.hash, remote: ref.remote } : undefined,
    };
  }
  //? git itself cannot run without HEAD, nor sensibly lose the branch it has checked out
  if (ref.name === 'HEAD') return { ok: false, message: 'HEAD cannot be deleted' };
  if (ref.isHead) return { ok: false, message: `${ref.short} is checked out — switch away first` };
  const result = ref.symref
    ? await git(['symbolic-ref', '--delete', ref.name], cwd)
    : await git(['update-ref', '--no-deref', '-d', ref.name, ref.hash], cwd);
  if (!result.ok) return { ok: false, message: failure(result, `Could not delete ${ref.name}`) };
  return {
    ok: true,
    message: `Deleted ${ref.name}`,
    restore: { name: ref.name, hash: ref.hash, symref: ref.symref },
  };
};

/** Write a deleted ref back where it was. Its reflog went with it and does not come back. */
export const restoreRef = async (cwd: string, deleted: DeletedRef): Promise<OperationResult> => {
  const result = deleted.remote
    ? await git(['push', deleted.remote, `${deleted.hash}:${deleted.name}`], cwd)
    : deleted.symref
      ? await git(['symbolic-ref', deleted.name, deleted.symref], cwd)
      : //? The empty old value: create only — never overwrite a ref made in the meantime
        await git(['update-ref', deleted.name, deleted.hash, ''], cwd);
  return result.ok
    ? {
        ok: true,
        message: `Restored ${deleted.name}${deleted.remote ? ` on ${deleted.remote}` : ''}`,
      }
    : { ok: false, message: failure(result, `Could not restore ${deleted.name}`) };
};
