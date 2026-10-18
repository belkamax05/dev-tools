import { lstat, readFile, readlink } from 'node:fs/promises';
import { join } from 'node:path';

import git, { failure } from '../run';
import type { FileChange } from '../status';
import { getDiff, parseDiff } from '../hunks';
import alignFileDiff from '../alignFileDiff';

/** Read the exact revisions represented by one row of the staging window. */
const fileComparison = async (root: string, change: FileChange, side: 'staged' | 'unstaged') => {
  const revision = async (spec: string, absent: boolean) => {
    if (absent) return '';
    const result = await git(['show', spec], root);
    if (!result.ok) throw new Error(failure(result, 'Could not read file revision'));
    return result.stdout;
  };
  const working = async () => {
    if (change.work === 'D') return '';
    const path = join(root, change.path);
    const info = await lstat(path);
    return info.isSymbolicLink() ? readlink(path) : readFile(path, 'utf8');
  };
  const [before, after] =
    side === 'staged'
      ? await Promise.all([
          revision(`HEAD:${change.origPath ?? change.path}`, change.index === 'A'),
          revision(`:${change.path}`, change.index === 'D'),
        ])
      : await Promise.all([
          revision(
            `:${change.work === 'R' ? (change.origPath ?? change.path) : change.path}`,
            change.untracked,
          ),
          working(),
        ]);
  const changedBefore: number[] = [];
  const changedAfter: number[] = [];
  const patch = await getDiff(root, change.path, change.untracked ? 'untracked' : side);
  const diff = parseDiff(patch);
  for (const hunk of diff.hunks) {
    const match = hunk.header.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (!match) continue;
    let oldLine = Number(match[1]);
    let newLine = Number(match[2]);
    for (const line of hunk.lines.slice(1)) {
      if (line.startsWith('-')) changedBefore.push(oldLine++);
      else if (line.startsWith('+')) changedAfter.push(newLine++);
      else if (line.startsWith(' ')) {
        oldLine++;
        newLine++;
      }
    }
  }
  return {
    before,
    after,
    changedBefore,
    changedAfter,
    rows: alignFileDiff(before, after, patch),
    binary: before.includes('\0') || after.includes('\0'),
  };
};

export default fileComparison;
