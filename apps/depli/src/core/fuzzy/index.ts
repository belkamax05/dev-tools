/**
 * Fuzzy match for branch names: the query's characters in order, not necessarily adjacent
 * (`r2616` finds `release-26.16`). Higher is better; undefined is no match. Consecutive runs, a
 * hit right after a separator (`/ - _ .`) and a hit at the start score more, so `fix/36962` ranks
 * the branch that has it as a segment above one that merely contains the letters.
 */
export const fuzzyScore = (text: string, query: string): number | undefined => {
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase().replace(/\s+/g, '');
  if (!needle) return 0;
  if (haystack.includes(needle)) return 1_000 - haystack.indexOf(needle) - haystack.length / 100;
  let score = 0;
  let at = -1;
  let run = 0;
  for (const char of needle) {
    const next = haystack.indexOf(char, at + 1);
    if (next < 0) return undefined;
    run = next === at + 1 ? run + 1 : 0;
    score += 1 + run * 3 + (next === 0 || '/-_.'.includes(haystack[next - 1] ?? '') ? 5 : 0);
    at = next;
  }
  return score - haystack.length / 100;
};

/** `items` matching `query`, best first; all of them, in order, for an empty query. */
export const fuzzyFilter = <T>(items: T[], query: string, text: (item: T) => string): T[] => {
  if (!query.trim()) return items;
  return items
    .map((item) => ({ item, score: fuzzyScore(text(item), query) }))
    .filter((entry): entry is { item: T; score: number } => entry.score !== undefined)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item);
};
