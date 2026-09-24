import git, { failure } from '../run';
import type { OperationResult } from '../status';

/** Whether HEAD is already on a remote branch — amending it then rewrites shared history. */
export const isHeadPushed = async (root: string): Promise<boolean> => {
  const result = await git(['branch', '-r', '--contains', 'HEAD'], root);
  return result.ok && result.stdout.trim().length > 0;
};

export const stagedCount = async (root: string): Promise<number> => {
  const result = await git(['diff', '--cached', '--name-only', '-z'], root);
  return result.stdout.split('\0').filter(Boolean).length;
};

/**
 * Commit what is staged. With `amend`, fold it into HEAD instead — keeping
 * HEAD's message when no new one is given.
 */
export const commit = async (
  root: string,
  message: string,
  { amend = false }: { amend?: boolean } = {},
): Promise<OperationResult> => {
  const text = message.trim();
  if (!amend && !text) return { ok: false, message: 'A commit needs a message' };
  if (!amend && (await stagedCount(root)) === 0) return { ok: false, message: 'Nothing is staged' };
  const args = ['commit', ...(amend ? ['--amend'] : []), ...(text ? ['-m', text] : ['--no-edit'])];
  const result = await git(args, root);
  if (!result.ok) return { ok: false, message: failure(result, 'git commit failed') };
  const subject = (await git(['log', '-1', '--format=%h %s'], root)).stdout.trim();
  return { ok: true, message: `${amend ? 'Amended' : 'Committed'} ${subject}` };
};

export default commit;
