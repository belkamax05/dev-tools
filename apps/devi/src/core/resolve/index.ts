import type { AppEntry } from '../apps';

/**
 * Split an alias's target the way a shell would split a simple command line: on whitespace, with
 * single or double quotes keeping a word together — `porti kill 3000`, `pkgi note react "pinned"`.
 */
export const splitWords = (text: string): string[] => {
  const words: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let inWord = false;
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      inWord = true;
    } else if (/\s/.test(char)) {
      if (inWord) words.push(current);
      current = '';
      inWord = false;
    } else {
      current += char;
      inWord = true;
    }
  }
  if (inWord) words.push(current);
  return words;
};

export type Resolution =
  | { kind: 'app'; app: AppEntry; args: string[]; via: string[] }
  | { kind: 'unknown'; name: string }
  | { kind: 'loop'; chain: string[] };

/** How many aliases may point at one another before the chain is taken to be a loop. */
const MAX_DEPTH = 8;

/**
 * Turn `dev-tools <word> [args...]` into an app and its arguments.
 *
 * In order: an app's own name, then the user's aliases, then the aliases apps declare. An alias's
 * target is a command line — an app (or another alias) plus arguments of its own — and whatever
 * followed the alias on the command line is appended, so `kp = porti kill` makes `dev-tools kp
 * 3000` run `porti kill 3000`. App names always win: an alias cannot hide an app, which keeps
 * `dev-tools porti` meaning porti on every machine whatever its config says.
 */
export const resolveCommand = (
  argv: string[],
  apps: AppEntry[],
  userAliases: Record<string, string>,
): Resolution => {
  const builtIn = new Map<string, string>();
  for (const app of apps) {
    for (const alias of app.aliases) builtIn.set(alias.name, [app.name, ...alias.args].join(' '));
  }

  let [word, ...args] = argv;
  const via: string[] = [];
  for (let depth = 0; depth <= MAX_DEPTH && word !== undefined; depth += 1) {
    const app = apps.find((candidate) => candidate.name === word);
    if (app) return { kind: 'app', app, args, via };
    const target = userAliases[word] ?? builtIn.get(word);
    if (target === undefined) return { kind: 'unknown', name: word };
    if (via.includes(word)) return { kind: 'loop', chain: [...via, word] };
    via.push(word);
    const [next, ...prefix] = splitWords(target);
    word = next;
    args = [...prefix, ...args];
  }
  return { kind: 'loop', chain: via };
};

/** Every alias in force, each with what it runs and where it comes from — for `alias list`. */
export const listAliases = (
  apps: AppEntry[],
  userAliases: Record<string, string>,
): { alias: string; target: string; source: 'user' | string; shadowed: boolean }[] => {
  const names = new Set(apps.map((app) => app.name));
  const rows = Object.entries(userAliases).map(([alias, target]) => ({
    alias,
    target,
    source: 'user' as string,
    shadowed: names.has(alias),
  }));
  for (const app of apps) {
    for (const alias of app.aliases) {
      rows.push({
        alias: alias.name,
        target: [app.name, ...alias.args].join(' '),
        source: app.name,
        //? A user alias of the same name takes precedence over the app's
        shadowed: alias.name in userAliases || names.has(alias.name),
      });
    }
  }
  return rows.sort((a, b) => a.alias.localeCompare(b.alias));
};
