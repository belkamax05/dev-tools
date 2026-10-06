import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** The source-of-truth folder every IDE's agent folder is linked from. */
export const AGENTS_DIR = '.agents';

const gitToplevel = (cwd: string): string | undefined => {
  const result = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel'], {
    cwd,
    stdout: 'pipe',
    stderr: 'ignore',
  });
  if (result.exitCode !== 0) return undefined;
  return result.stdout.toString().trim() || undefined;
};

/**
 * The repository agenti works on, from wherever it was started.
 *
 * The nearest directory holding `.agents`, looking up from `cwd` but never past
 * the git root — so running it from `src/deep/folder` of a repo acts on the
 * repo, and a package inside a monorepo that keeps its own `.agents` is its own
 * root. Without an `.agents` anywhere, the git root (where one would be
 * created); outside git entirely, `cwd` itself.
 */
export const findRepoRoot = (cwd: string = process.cwd()): string => {
  const start = resolve(cwd);
  const top = gitToplevel(start);

  let dir = start;
  while (true) {
    if (existsSync(join(dir, AGENTS_DIR))) return dir;
    if (dir === top) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return top ?? start;
};

export default findRepoRoot;
