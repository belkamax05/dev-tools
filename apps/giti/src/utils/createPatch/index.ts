import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import GitError from '../../types/GitError';

/**
 * Creates a patch file capturing all tracked changes (staged + unstaged) relative to HEAD.
 * Untracked files are never included — stage them first with `git add` if needed.
 *
 * Design: uses `git diff HEAD` which captures both staged and unstaged modifications
 * to tracked files. This is intentional — the staging state is a personal workflow
 * concern and is not preserved by `git apply` anyway. The receiving developer
 * re-stages what they need after applying.
 *
 * IMPORTANT: deliberately avoids gitExec here because gitExec calls stdout.trimEnd(),
 * which strips trailing newlines that are structurally part of a unified diff.
 * A trimmed patch makes `git apply` report "corrupt patch at line N".
 * spawnSync with encoding:'buffer' gives us the raw bytes git wrote.
 *
 * @param cwd - Working directory (git repo root)
 * @param outputPath - Absolute path to write the .patch file
 */
const createPatch = async (cwd: string, outputPath: string): Promise<void> => {
  const result = spawnSync('git', ['diff', 'HEAD'], {
    cwd,
    env: process.env,
    encoding: 'buffer',
  });

  if (result.status !== 0) {
    throw new GitError({
      stdout: result.stdout?.toString() ?? '',
      stderr: result.stderr?.toString() ?? '',
      exitCode: result.status,
    });
  }

  writeFileSync(outputPath, result.stdout);
};

export default createPatch;
