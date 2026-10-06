import { existsSync } from 'node:fs';
import { join } from 'node:path';

import git, { failure } from '../run';
import type { OperationResult } from '../status';

export type OperationKind = 'rebase' | 'merge' | 'cherry-pick' | 'revert';

export interface OperationState {
  kind: OperationKind;
  /** Whether `--skip` means anything for it (a rebase and a cherry-pick). */
  canSkip: boolean;
}

/**
 * The multi-step operation the repository is in the middle of, if any —
 * read from the markers git leaves in its directory, which is exactly how git
 * itself knows.
 */
export const getOperation = async (root: string): Promise<OperationState | undefined> => {
  const dir = (await git(['rev-parse', '--absolute-git-dir'], root)).stdout.trim();
  if (!dir) return undefined;
  const has = (name: string) => existsSync(join(dir, name));
  if (has('rebase-merge') || has('rebase-apply')) return { kind: 'rebase', canSkip: true };
  if (has('MERGE_HEAD')) return { kind: 'merge', canSkip: false };
  if (has('CHERRY_PICK_HEAD')) return { kind: 'cherry-pick', canSkip: true };
  if (has('REVERT_HEAD')) return { kind: 'revert', canSkip: true };
  return undefined;
};

//? GIT_EDITOR=true accepts git's own message for the next step; an editor
//? opened under the TUI would never be seen and hang it
const NO_EDITOR = { GIT_EDITOR: 'true' };

export const continueOperation = async (
  root: string,
  op: OperationState,
): Promise<OperationResult> => {
  const result = await git([op.kind, '--continue'], root, { env: NO_EDITOR });
  return result.ok
    ? { ok: true, message: `Continued the ${op.kind}` }
    : { ok: false, message: failure(result, `could not continue the ${op.kind}`) };
};

export const abortOperation = async (
  root: string,
  op: OperationState,
): Promise<OperationResult> => {
  const result = await git([op.kind, '--abort'], root);
  return result.ok
    ? { ok: true, message: `Aborted the ${op.kind}` }
    : { ok: false, message: failure(result, `could not abort the ${op.kind}`) };
};

export const skipOperation = async (root: string, op: OperationState): Promise<OperationResult> => {
  if (!op.canSkip) return { ok: false, message: `A ${op.kind} has no skip` };
  const result = await git([op.kind, '--skip'], root, { env: NO_EDITOR });
  return result.ok
    ? { ok: true, message: 'Skipped this step' }
    : { ok: false, message: failure(result, 'could not skip') };
};

/**
 * Resolve a conflicted file: take one side whole (`ours` / `theirs`), or —
 * after editing it by hand — just mark it resolved.
 */
export const resolveFile = async (
  root: string,
  path: string,
  side: 'ours' | 'theirs' | 'mark',
): Promise<OperationResult> => {
  if (side !== 'mark') {
    const taken = await git(['checkout', `--${side}`, '--', path], root);
    if (!taken.ok) return { ok: false, message: failure(taken, `could not take ${side}`) };
  }
  const added = await git(['add', '--', path], root);
  return added.ok
    ? {
        ok: true,
        message: side === 'mark' ? `Marked ${path} resolved` : `Took ${side} for ${path}`,
      }
    : { ok: false, message: failure(added, 'could not mark it resolved') };
};

export default getOperation;
