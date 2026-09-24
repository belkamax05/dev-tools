import git, { failure } from '../run';
import type { OperationResult } from '../status';

export interface Hunk {
  /** The `@@ -a,b +c,d @@ context` line. */
  header: string;
  /** Every line of the hunk, the header included. */
  lines: string[];
}

export interface FileDiff {
  /** Everything before the first hunk — `diff --git`, index, ---/+++ lines. */
  head: string[];
  hunks: Hunk[];
  /** A binary file, or one git gave no hunks for: shown, never partially staged. */
  binary: boolean;
}

/** One file's diff text into its header and hunks. */
export const parseDiff = (text: string): FileDiff => {
  const head: string[] = [];
  const hunks: Hunk[] = [];
  const lines = text.replace(/\n$/, '').split('\n');
  for (const line of lines) {
    if (line.startsWith('@@')) hunks.push({ header: line, lines: [line] });
    else if (hunks.length) hunks[hunks.length - 1]?.lines.push(line);
    else if (line) head.push(line);
  }
  return {
    head,
    hunks,
    binary: head.some(
      (line) => line.startsWith('Binary files') || line.startsWith('GIT binary patch'),
    ),
  };
};

/**
 * The diff a file shows in one of the two lists: the unstaged edits
 * (worktree against index), or the staged ones (index against HEAD). An
 * untracked file has no index entry, so its whole content is shown as added.
 */
export const getDiff = async (
  root: string,
  path: string,
  which: 'staged' | 'unstaged' | 'untracked',
): Promise<string> => {
  if (which === 'untracked') {
    //? --no-index exits 1 whenever the files differ, which here is always
    const result = await git(['diff', '--no-index', '--no-color', '--', '/dev/null', path], root);
    return result.stdout;
  }
  const result = await git(
    ['diff', '--no-color', ...(which === 'staged' ? ['--cached'] : []), '--', path],
    root,
  );
  return result.stdout;
};

/** A patch of just one hunk: the file's header lines, then that hunk. */
const hunkPatch = (diff: FileDiff, index: number): string | undefined => {
  const hunk = diff.hunks[index];
  return hunk ? `${[...diff.head, ...hunk.lines].join('\n')}\n` : undefined;
};

const applyHunk = async (
  root: string,
  diff: FileDiff,
  index: number,
  args: string[],
  verb: string,
): Promise<OperationResult> => {
  if (diff.binary) return { ok: false, message: 'A binary file is staged whole, not by hunk' };
  const patch = hunkPatch(diff, index);
  if (!patch) return { ok: false, message: 'No such hunk' };
  //? --recount: the line counts in the header are for the whole diff, and a
  //? lone hunk only applies if git works them out again
  const result = await git(['apply', '--recount', ...args, '-'], root, { input: patch });
  return result.ok
    ? { ok: true, message: `${verb} hunk ${index + 1} of ${diff.hunks.length}` }
    : { ok: false, message: failure(result, `could not ${verb.toLowerCase()} the hunk`) };
};

/** Stage one hunk of a file's unstaged diff. */
export const stageHunk = (root: string, unstaged: FileDiff, index: number) =>
  applyHunk(root, unstaged, index, ['--cached'], 'Staged');

/** Unstage one hunk of a file's staged diff. */
export const unstageHunk = (root: string, staged: FileDiff, index: number) =>
  applyHunk(root, staged, index, ['--cached', '--reverse'], 'Unstaged');

/**
 * Throw away one hunk of the unstaged changes. The patch applied in reverse
 * is returned too, so the caller can offer to put it back.
 */
export const discardHunk = async (
  root: string,
  unstaged: FileDiff,
  index: number,
): Promise<OperationResult & { patch?: string }> => {
  const result = await applyHunk(root, unstaged, index, ['--reverse'], 'Discarded');
  return result.ok ? { ...result, patch: hunkPatch(unstaged, index) } : result;
};

/** Put a discarded hunk back. */
export const reapplyPatch = async (root: string, patch: string): Promise<OperationResult> => {
  const result = await git(['apply', '--recount', '-'], root, { input: patch });
  return result.ok
    ? { ok: true, message: 'Put the hunk back' }
    : { ok: false, message: failure(result, 'could not put the hunk back') };
};

export default parseDiff;
