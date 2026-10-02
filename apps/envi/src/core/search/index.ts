/**
 * Whether a variable matches a search typed in one box — names and values together.
 *
 * Words are ANDed and case-insensitive; each one may hit the name *or* the value, so `node prod`
 * finds `NODE_ENV=production`. `k:` / `key:` limits a word to names and `v:` / `value:` to values
 * (`v:/nix/store`). A secret's value is searched although it is drawn masked — you are looking
 * for something you already know.
 */
export const matchesSearch = (key: string, value: string, query: string): boolean => {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const name = key.toLowerCase();
  const text = value.toLowerCase();
  return words.every((word) => {
    const scoped = /^(k|key|v|value):(.*)$/.exec(word);
    if (scoped) {
      const [, scope = '', needle = ''] = scoped;
      return scope.startsWith('k') ? name.includes(needle) : text.includes(needle);
    }
    return name.includes(word) || text.includes(word);
  });
};

/** Which part a plain search hit — for showing "matched in value" beside a row. */
export const matchedIn = (
  key: string,
  value: string,
  query: string,
): 'key' | 'value' | undefined => {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return undefined;
  const name = key.toLowerCase();
  return words.every((word) => name.includes(word.replace(/^(k|key):/, ''))) ? 'key' : 'value';
};

export default matchesSearch;
