import { displayTitle, type Entry, type Group, hostOf } from '../bookmarks';

export interface SearchHit {
  entry: Entry;
  score: number;
}

/** How much a match in each field is worth: a title beats a word buried in a description. */
const WEIGHTS = {
  title: 3,
  tags: 2.5,
  group: 2,
  url: 1.5,
  description: 1,
} as const;

type Field = keyof typeof WEIGHTS;

/**
 * Where a scattered match counts. Short names only: across a sentence of description or a whole
 * URL, three letters in order turn up by chance — "rev" is somewhere in "the runtime every app".
 */
const FUZZY: Record<Field, boolean> = {
  title: true,
  tags: true,
  group: true,
  url: false,
  description: false,
};

const isBoundary = (text: string, at: number) =>
  at === 0 || /[\s/._\-:#?&=]/.test(text[at - 1] ?? '');

/**
 * How well one query word matches one piece of text, or undefined for not at all.
 *
 * A substring is always worth more than a scattered match, and one at the start of a word more
 * than one in the middle. Failing that, and only where `fuzzy` allows it, the letters may appear
 * in order with gaps — `jrbrd` finds "jira board" — as fzf does. A scattered match has to start at
 * the start of a word, and one spread wider than a few cells per letter is noise and is refused.
 */
export const scoreText = (token: string, text: string, fuzzy = true): number | undefined => {
  if (!token) return 0;
  const haystack = text.toLowerCase();
  const at = haystack.indexOf(token);
  if (at >= 0) {
    return (
      100 +
      (isBoundary(haystack, at) ? 25 : 0) +
      (token.length === haystack.length ? 25 : 0) -
      Math.min(at, 20) * 0.5
    );
  }

  if (!fuzzy) return undefined;
  let score = 0;
  let from = 0;
  let previous = -2;
  let first = -1;
  for (const char of token) {
    const found = haystack.indexOf(char, from);
    if (found < 0) return undefined;
    if (first < 0) {
      if (!isBoundary(haystack, found)) return undefined;
      first = found;
    }
    score += found === previous + 1 ? 6 : isBoundary(haystack, found) ? 4 : 1;
    previous = found;
    from = found + 1;
  }
  const spread = previous - first + 1;
  if (spread > token.length * 4 + 4) return undefined;
  return Math.min(90, score * (token.length / spread) * 3);
};

const fieldsOf = (entry: Entry, group: Group | undefined): Record<Field, string[]> => ({
  title: [displayTitle(entry)],
  tags: [...entry.tags, ...(group?.tags ?? [])],
  group: entry.group ? [entry.group] : [],
  url: [hostOf(entry.url), entry.url.replace(/^[a-z]+:\/\//i, '')],
  description: [entry.description ?? '', group?.description ?? ''],
});

/**
 * Score an entry against every word of a query; undefined unless every word matches somewhere.
 *
 * `#word` is a tag filter rather than a search word: it keeps the pages tagged with something
 * starting with `word` (their group's tags count) and adds nothing to the ranking.
 */
export const scoreEntry = (entry: Entry, query: string, group?: Group): number | undefined => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const fields = fieldsOf(entry, group);
  let total = 0;
  for (const word of words) {
    if (word.startsWith('#') && word.length > 1) {
      const tag = word.slice(1);
      if (!fields.tags.some((candidate) => candidate.startsWith(tag))) return undefined;
      continue;
    }
    let best: number | undefined;
    for (const field of Object.keys(WEIGHTS) as Field[]) {
      for (const value of fields[field]) {
        if (!value) continue;
        const score = scoreText(word, value, FUZZY[field]);
        if (score !== undefined && (best === undefined || score * WEIGHTS[field] > best)) {
          best = score * WEIGHTS[field];
        }
      }
    }
    if (best === undefined) return undefined;
    total += best;
  }
  return total;
};

/** The entries matching `query`, best first; every entry, in list order, for an empty one. */
export const search = (entries: Entry[], groups: Group[], query: string): SearchHit[] => {
  const byKey = new Map(groups.map((group) => [group.key, group]));
  if (!query.trim()) return entries.map((entry) => ({ entry, score: 0 }));
  const hits: SearchHit[] = [];
  for (const entry of entries) {
    const score = scoreEntry(entry, query, byKey.get(entry.group?.toLowerCase() ?? ''));
    if (score !== undefined) hits.push({ entry, score });
  }
  return hits.sort(
    (a, b) => b.score - a.score || displayTitle(a.entry).localeCompare(displayTitle(b.entry)),
  );
};

export default search;
