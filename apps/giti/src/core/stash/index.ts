import git, { failure } from '../run';
import type { OperationResult } from '../status';

export interface StashEntry {
  /** `stash@{0}`. */
  ref: string;
  message: string;
  when: string;
}

const SEP = '\u001f';

export const getStashes = async (root: string): Promise<StashEntry[]> => {
  const result = await git(['stash', 'list', `--format=%gd${SEP}%gs${SEP}%cr`], root);
  return result.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [ref = '', message = '', when = ''] = line.split(SEP);
      return { ref, message, when };
    });
};

export const getStashDiff = async (root: string, ref: string) =>
  (await git(['stash', 'show', '-p', '--include-untracked', '--no-color', ref], root)).stdout;

const act = async (
  args: string[],
  root: string,
  success: string,
  fallback: string,
): Promise<OperationResult> => {
  const result = await git(args, root);
  return result.ok
    ? { ok: true, message: success }
    : { ok: false, message: failure(result, fallback) };
};

/** Stash everything — staged, unstaged and untracked — under a message. */
export const pushStash = async (root: string, message: string): Promise<OperationResult> => {
  const result = await git(
    ['stash', 'push', '--include-untracked', ...(message.trim() ? ['-m', message.trim()] : [])],
    root,
  );
  //? Exit 0 with nothing done is how git says there was nothing to stash
  if (result.ok && /No local changes/i.test(result.stdout + result.stderr)) {
    return { ok: false, message: 'Nothing to stash — the working tree is clean' };
  }
  return result.ok
    ? { ok: true, message: 'Stashed your changes' }
    : { ok: false, message: failure(result, 'could not stash') };
};

export const applyStash = (root: string, ref: string) =>
  act(['stash', 'apply', ref], root, `Applied ${ref}`, 'apply stopped');
export const popStash = (root: string, ref: string) =>
  act(['stash', 'pop', ref], root, `Popped ${ref}`, 'pop stopped');
/**
 * Drop a stash, returning its commit so `restoreStash` can bring it back — a
 * dropped stash is only unreachable, not gone, until git collects it.
 */
export const dropStash = async (
  root: string,
  entry: StashEntry,
): Promise<OperationResult & { hash?: string }> => {
  const hash = (await git(['rev-parse', entry.ref], root)).stdout.trim();
  const result = await act(
    ['stash', 'drop', entry.ref],
    root,
    `Dropped ${entry.ref}`,
    'could not drop it',
  );
  return result.ok ? { ...result, hash } : result;
};

export const restoreStash = (root: string, hash: string, message: string) =>
  act(
    ['stash', 'store', '-m', message, hash],
    root,
    'Put the stash back',
    'could not restore the stash',
  );

export default getStashes;
