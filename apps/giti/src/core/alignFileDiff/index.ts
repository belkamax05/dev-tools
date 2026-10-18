import { parseDiff } from '../hunks';

export interface AlignedDiffRow {
  before?: number;
  after?: number;
  changed: boolean;
}

/** Pair Git's context and replacement blocks, padding insertions/deletions on the other side. */
const alignFileDiff = (before: string, after: string, patch: string) => {
  const count = (text: string) => (text ? text.replace(/\n$/, '').split('\n').length : 0);
  const rows: AlignedDiffRow[] = [];
  let left = 0;
  let right = 0;
  const context = (oldEnd: number, newEnd: number) => {
    while (left < oldEnd || right < newEnd)
      rows.push({
        before: left < oldEnd ? ++left : undefined,
        after: right < newEnd ? ++right : undefined,
        changed: false,
      });
  };
  for (const hunk of parseDiff(patch).hunks) {
    const match = hunk.header.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (!match) continue;
    context(
      Number(match[1]) - (match[2] === '0' ? 0 : 1),
      Number(match[3]) - (match[4] === '0' ? 0 : 1),
    );
    let removed = 0;
    let added = 0;
    const flush = () => {
      for (let i = 0; i < Math.max(removed, added); i++)
        rows.push({
          before: i < removed ? ++left : undefined,
          after: i < added ? ++right : undefined,
          changed: true,
        });
      removed = 0;
      added = 0;
    };
    for (const line of hunk.lines.slice(1)) {
      if (line.startsWith('-')) removed++;
      else if (line.startsWith('+')) added++;
      else if (line.startsWith(' ')) {
        flush();
        rows.push({ before: ++left, after: ++right, changed: false });
      }
    }
    flush();
  }
  context(count(before), count(after));
  return rows;
};

export default alignFileDiff;
