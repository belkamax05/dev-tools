/**
 * Just enough semver for a dependency list: parse, compare, and say how big a jump is.
 *
 * Not a range solver — pkgi never decides what satisfies `^1.2.0`; the package manager does
 * that. It only needs to order versions and label the distance between two of them.
 */

export interface Version {
  major: number;
  minor: number;
  patch: number;
  prerelease: string;
}

export type UpdateKind = 'major' | 'minor' | 'patch' | 'prerelease' | 'none';

/** The version inside a range or spec: `^1.2.3` → `1.2.3`, `v2` → `2`, `workspace:*` → ''. */
export const cleanVersion = (value: string): string => {
  const match = value.match(/\d+(\.\d+)?(\.\d+)?(-[0-9A-Za-z.-]+)?/);
  return match ? match[0] : '';
};

export const parseVersion = (value: string): Version | undefined => {
  const clean = cleanVersion(value);
  if (!clean) return undefined;
  const [core = '', ...pre] = clean.split('-');
  const [major = 0, minor = 0, patch = 0] = core.split('.').map((part) => Number(part) || 0);
  return { major, minor, patch, prerelease: pre.join('-') };
};

export const isPrerelease = (value: string): boolean => Boolean(parseVersion(value)?.prerelease);

/** Prerelease identifiers compared the semver way: numbers numerically, below any word. */
const comparePrerelease = (a: string, b: string): number => {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const left = a.split('.');
  const right = b.split('.');
  for (let at = 0; at < Math.max(left.length, right.length); at += 1) {
    const l = left[at];
    const r = right[at];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const ln = /^\d+$/.test(l);
    const rn = /^\d+$/.test(r);
    if (ln && rn && Number(l) !== Number(r)) return Number(l) - Number(r);
    if (ln !== rn) return ln ? -1 : 1;
    if (l !== r) return l < r ? -1 : 1;
  }
  return 0;
};

/** Negative when `a` is older than `b`. Unparseable versions sort first. */
export const compareVersions = (a: string, b: string): number => {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return left ? 1 : right ? -1 : 0;
  return (
    left.major - right.major ||
    left.minor - right.minor ||
    left.patch - right.patch ||
    comparePrerelease(left.prerelease, right.prerelease)
  );
};

/** How far `current` is behind `target` — `none` when it is not behind at all. */
export const updateKind = (current: string, target: string | undefined): UpdateKind => {
  if (!target) return 'none';
  const from = parseVersion(current);
  const to = parseVersion(target);
  if (!from || !to || compareVersions(current, target) >= 0) return 'none';
  if (to.prerelease) return 'prerelease';
  if (to.major !== from.major) return 'major';
  if (to.minor !== from.minor) return 'minor';
  return 'patch';
};

/** How many majors apart — a jump of several is worth drawing louder than one. */
export const majorDistance = (current: string, target: string): number =>
  Math.max(0, (parseVersion(target)?.major ?? 0) - (parseVersion(current)?.major ?? 0));

/**
 * The prefix a range was written with, so an update writes the new version the same way:
 * `^` and `~` are kept, and an exact pin stays exact.
 */
export const rangePrefix = (range: string): '^' | '~' | '' | undefined => {
  const trimmed = range.trim();
  if (trimmed.startsWith('^')) return '^';
  if (trimmed.startsWith('~')) return '~';
  if (/^\d/.test(trimmed)) return '';
  //? `*`, `latest`, `>=1`, `workspace:`, `file:`, git URLs — nothing to preserve
  return undefined;
};

/**
 * Whether a declared version is something other than a plain registry range for the package's own
 * name — a workspace or file link, a git URL, or an `npm:other-name@x` alias. None of these can be
 * compared with the registry's `latest` for the declared name.
 */
export const isLocalSpec = (range: string): boolean =>
  /^(workspace:|file:|link:|portal:|npm:|git\+|git:|github:|https?:)/.test(range) ||
  range.includes('/');
