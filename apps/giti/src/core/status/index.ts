import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import git, { failure, type RunResult } from '../run';

export interface OperationResult {
  ok: boolean;
  message: string;
}

const ok = (message: string): OperationResult => ({ ok: true, message });
const no = (message: string): OperationResult => ({ ok: false, message });

/**
 * One path with changes, as `git status` sees it.
 *
 * `index` and `work` are git's two status letters (staged, unstaged). A path
 * can be both — staged once, then edited again — and then appears in both
 * lists of the Status view.
 */
export interface FileChange {
  path: string;
  /** For a rename or copy, the path it came from. */
  origPath?: string;
  index: string;
  work: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  /** Both sides changed it in a merge, rebase or cherry-pick; it needs resolving. */
  conflicted: boolean;
}

const CONFLICT = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

/** `git status --porcelain -z` into changes. NUL-separated, so no path quoting to undo. */
export const parseStatus = (raw: string): FileChange[] => {
  const parts = raw.split('\0');
  const changes: FileChange[] = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i] ?? '';
    if (entry.length < 4) continue;
    const index = entry[0] ?? ' ';
    const work = entry[1] ?? ' ';
    const path = entry.slice(3);
    //? A rename or copy carries its source as the next NUL-separated field
    const origPath = index === 'R' || index === 'C' ? parts[++i] : undefined;
    const code = `${index}${work}`;
    const untracked = code === '??';
    const conflicted = CONFLICT.has(code);
    changes.push({
      path,
      origPath,
      index,
      work,
      untracked,
      conflicted,
      staged: !untracked && !conflicted && index !== ' ',
      unstaged: untracked || (!conflicted && work !== ' '),
    });
  }
  return changes;
};

export const getChanges = async (root: string): Promise<FileChange[]> => {
  const result = await git(['status', '--porcelain', '-z', '--untracked-files=all'], root);
  return result.ok ? parseStatus(result.stdout) : [];
};

const describe = (paths: string[]) => (paths.length === 1 ? paths[0] : `${paths.length} files`);

export const stage = async (root: string, paths: string[]): Promise<OperationResult> => {
  if (!paths.length) return no('Nothing to stage');
  //? -A so a deleted file is staged as a deletion rather than refused
  const result = await git(['add', '-A', '--', ...paths], root);
  return result.ok ? ok(`Staged ${describe(paths)}`) : no(failure(result, 'git add failed'));
};

export const stageAll = async (root: string): Promise<OperationResult> => {
  const result = await git(['add', '-A'], root);
  return result.ok ? ok('Staged everything') : no(failure(result, 'git add failed'));
};

const hasHead = async (root: string) =>
  (await git(['rev-parse', '--verify', '-q', 'HEAD'], root)).ok;

export const unstage = async (root: string, paths: string[]): Promise<OperationResult> => {
  if (!paths.length) return no('Nothing to unstage');
  //? Before the first commit there is no HEAD to restore the index from, and
  //? "unstage" means taking the paths out of the index altogether
  const result: RunResult = (await hasHead(root))
    ? await git(['restore', '--staged', '--', ...paths], root)
    : await git(['rm', '--cached', '-r', '-q', '--', ...paths], root);
  return result.ok ? ok(`Unstaged ${describe(paths)}`) : no(failure(result, 'unstage failed'));
};

// ---------------------------------------------------------------------------
// Discard, with an undo
// ---------------------------------------------------------------------------

export interface UndoRecord {
  dir: string;
  label: string;
}

const gitDir = async (root: string) => {
  const result = await git(['rev-parse', '--absolute-git-dir'], root);
  return result.stdout.trim();
};

/**
 * Throw away unstaged changes to `paths` — edits to tracked files, and
 * untracked files entirely — after saving them where `undoDiscard` can put
 * them back: a binary patch of the edits and copies of the untracked files,
 * under `.git/giti-undo/`. Staged changes are not touched.
 */
export const discard = async (
  root: string,
  changes: FileChange[],
): Promise<OperationResult & { undo?: UndoRecord }> => {
  const tracked = changes
    .filter((change) => !change.untracked && change.unstaged)
    .map((c) => c.path);
  const untracked = changes.filter((change) => change.untracked).map((c) => c.path);
  if (!tracked.length && !untracked.length) return no('Nothing unstaged to discard');

  const dir = join(await gitDir(root), 'giti-undo', `${Date.now()}`);
  mkdirSync(dir, { recursive: true });

  if (tracked.length) {
    const patch = await git(['diff', '--binary', '--', ...tracked], root);
    if (!patch.ok) return no(failure(patch, 'could not save the changes before discarding'));
    writeFileSync(join(dir, 'changes.patch'), patch.stdout);
    const restored = await git(['restore', '--worktree', '--', ...tracked], root);
    if (!restored.ok) return no(failure(restored, 'git restore failed'));
  }
  for (const path of untracked) {
    const from = join(root, path);
    const to = join(dir, 'untracked', path);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to, { recursive: true });
    rmSync(from, { recursive: true, force: true });
  }

  const label = describe([...tracked, ...untracked]);
  return { ...ok(`Discarded ${label}`), undo: { dir, label: label ?? 'changes' } };
};

/** Put back what `discard` threw away. */
export const undoDiscard = async (root: string, undo: UndoRecord): Promise<OperationResult> => {
  const patch = join(undo.dir, 'changes.patch');
  if (existsSync(patch) && readFileSync(patch, 'utf-8').trim()) {
    const applied = await git(['apply', '--binary', patch], root);
    if (!applied.ok) return no(failure(applied, 'could not re-apply the discarded changes'));
  }
  const untracked = join(undo.dir, 'untracked');
  if (existsSync(untracked)) {
    for (const name of readdirSync(untracked)) {
      cpSync(join(untracked, name), join(root, name), { recursive: true });
    }
  }
  rmSync(undo.dir, { recursive: true, force: true });
  return ok(`Restored ${undo.label}`);
};

export default getChanges;
