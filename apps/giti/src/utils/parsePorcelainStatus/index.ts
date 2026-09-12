interface PorcelainEntry {
  index: string;
  work: string;
  path: string;
  origPath: string | undefined;
}

interface PorcelainStatus {
  staged: PorcelainEntry[];
  modified: PorcelainEntry[];
  untracked: PorcelainEntry[];
  conflicted: PorcelainEntry[];
}

const parsePorcelainStatus = (raw: string): PorcelainStatus => {
  const staged: PorcelainEntry[] = [];
  const modified: PorcelainEntry[] = [];
  const untracked: PorcelainEntry[] = [];
  const conflicted: PorcelainEntry[] = [];

  for (const line of raw.split('\n').filter(Boolean)) {
    const x = line[0] ?? ' ';
    const y = line[1] ?? ' ';
    const rawPath = line.slice(3);
    const [path, origPath] = rawPath.includes(' -> ')
      ? (rawPath.split(' -> ').reverse() as [string, string])
      : [rawPath, undefined];

    const entry: PorcelainEntry = { index: x, work: y, path, origPath };

    if (x === '?' && y === '?') {
      untracked.push(entry);
      continue;
    }
    //? Conflict markers: both sides modified/deleted/added (UU, AA, DD, AU, UA, DU, UD)
    if (
      x !== ' ' &&
      y !== ' ' &&
      x !== '?' &&
      (x === 'U' || y === 'U' || (x === y && 'AD'.includes(x)))
    ) {
      conflicted.push(entry);
      continue;
    }
    if (x !== ' ' && x !== '?') staged.push(entry);
    if (y !== ' ' && y !== '?') modified.push(entry);
  }

  return { staged, modified, untracked, conflicted };
};

export default parsePorcelainStatus;
