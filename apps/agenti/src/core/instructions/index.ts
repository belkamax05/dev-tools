import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';

import type { OperationResult } from '../agents';
import { type IdeDefinition, layoutFor } from '../ides';
import type { Scope } from '../scope';

/**
 * - `native` — the IDE reads `AGENTS.md` itself
 * - `synced` — the IDE's file imports or links `AGENTS.md`
 * - `missing` — `AGENTS.md` exists, the IDE's file does not
 * - `mismatch` — the IDE's file exists but does not point at `AGENTS.md`
 * - `no-source` — there is no `AGENTS.md` to point at
 * - `none` — the IDE has no instructions file at this scope
 */
export type InstructionsStatus =
  | 'native'
  | 'synced'
  | 'missing'
  | 'mismatch'
  | 'no-source'
  | 'none';

export interface InstructionsState {
  status: InstructionsStatus;
  sourcePath: string;
  sourceExists: boolean;
  /** The IDE's file, absolute. Undefined for `native` and `none`. */
  targetPath?: string;
  mode?: 'import' | 'link';
  /** For `mismatch`/`no-source`: the IDE's file has content of its own that adopting would keep. */
  targetHasContent: boolean;
}

const OK = (message: string): OperationResult => ({ ok: true, message });
const NO = (message: string): OperationResult => ({ ok: false, message });

/** The import line an `import`-mode file starts with: `@AGENTS.md`, relative to the file. */
const importLine = (sourcePath: string, targetPath: string) =>
  `@${relative(dirname(targetPath), sourcePath)}`;

const read = (path: string) => {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return undefined;
  }
};

const sameFile = (a: string, b: string) => {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
};

/** Where one IDE's instructions stand against `AGENTS.md`. */
export const getInstructions = (scope: Scope, ide: IdeDefinition): InstructionsState => {
  const sourcePath = scope.instructionsPath;
  const sourceExists = existsSync(sourcePath);
  const target = layoutFor(ide, scope.kind)?.instructions;
  const base = { sourcePath, sourceExists, targetHasContent: false };

  if (!target) return { ...base, status: 'none' };
  if (target === 'native') return { ...base, status: 'native' };

  const targetPath = join(scope.root, target.path);
  const withTarget = { ...base, targetPath, mode: target.mode };
  const stats = (() => {
    try {
      return lstatSync(targetPath);
    } catch {
      return undefined;
    }
  })();
  const text = stats && !stats.isSymbolicLink() ? read(targetPath) : undefined;
  const targetHasContent = Boolean(text?.trim());

  if (!sourceExists) return { ...withTarget, status: 'no-source', targetHasContent };
  if (!stats) return { ...withTarget, status: 'missing' };
  if (stats.isSymbolicLink()) {
    return { ...withTarget, status: sameFile(targetPath, sourcePath) ? 'synced' : 'mismatch' };
  }
  const imports =
    target.mode === 'import' &&
    (text ?? '').split('\n').some((line) => line.trim() === importLine(sourcePath, targetPath));
  const identical = text === read(sourcePath);
  return {
    ...withTarget,
    status: imports || identical ? 'synced' : 'mismatch',
    targetHasContent,
  };
};

/**
 * Point the IDE's file at `AGENTS.md`.
 *
 * - Missing: created — an import file, or a link.
 * - An import file without the import: the import is added at the top and
 *   everything already there stays under it, since IDE-specific instructions
 *   are exactly what such a file is for.
 * - A plain file where a link belongs: replaced only with `force`, because its
 *   content would be lost — adopt it first to keep it.
 */
export const linkInstructions = (
  state: InstructionsState,
  { force = false }: { force?: boolean } = {},
): OperationResult => {
  const { targetPath, sourcePath, mode } = state;
  if (!targetPath || !mode) return NO('Nothing to link for this IDE');
  if (!state.sourceExists)
    return NO('There is no AGENTS.md yet — adopt the IDE file to create one');
  if (state.status === 'synced') return OK('Already points at AGENTS.md');

  const line = importLine(sourcePath, targetPath);
  mkdirSync(dirname(targetPath), { recursive: true });

  if (mode === 'import') {
    const existing =
      state.status === 'mismatch' && !isLink(targetPath) ? (read(targetPath) ?? '') : '';
    if (isLink(targetPath)) unlinkSync(targetPath);
    writeFileSync(targetPath, existing.trim() ? `${line}\n\n${existing}` : `${line}\n`);
    return OK(`${relative(dirname(sourcePath), targetPath)} now imports AGENTS.md`);
  }

  if (state.status === 'mismatch' && state.targetHasContent && !force) {
    return NO(`${targetPath} has content of its own — adopt it into AGENTS.md, or replace it`);
  }
  if (existsSync(targetPath) || isLink(targetPath)) unlinkSync(targetPath);
  symlinkSync(relative(dirname(targetPath), sourcePath), targetPath);
  return OK(`${relative(dirname(sourcePath), targetPath)} now links to AGENTS.md`);
};

/**
 * Make the IDE's file the start of `AGENTS.md`: for a repository that so far
 * only wrote `CLAUDE.md`. Refused when `AGENTS.md` already exists — merging two
 * instruction files is a judgement, not an operation.
 */
export const adoptInstructions = (state: InstructionsState): OperationResult => {
  const { targetPath, sourcePath } = state;
  if (!targetPath || !state.targetHasContent) return NO('The IDE file has nothing to adopt');
  if (state.sourceExists) return NO('AGENTS.md already exists — merge the two by hand');
  mkdirSync(dirname(sourcePath), { recursive: true });
  renameSync(targetPath, sourcePath);
  const result = linkInstructions({ ...state, sourceExists: true, status: 'missing' });
  return result.ok ? OK(`Moved it into AGENTS.md; ${result.message}`) : result;
};

/** Remove the IDE's pointer — only an import-only file or a link, never content. */
export const unlinkInstructions = (state: InstructionsState): OperationResult => {
  const { targetPath, sourcePath } = state;
  if (!targetPath || state.status !== 'synced') return NO('Nothing linked to remove');
  if (isLink(targetPath)) {
    unlinkSync(targetPath);
    return OK('Removed the link');
  }
  const rest = (read(targetPath) ?? '')
    .split('\n')
    .filter((line) => line.trim() !== importLine(sourcePath, targetPath))
    .join('\n')
    .trim();
  if (rest) return NO('The file has instructions of its own besides the import — edit it by hand');
  unlinkSync(targetPath);
  return OK('Removed the import file');
};

const isLink = (path: string) => {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
};

export default getInstructions;
