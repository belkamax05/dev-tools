//? Characters a POSIX shell reads literally in an unquoted word (`^` for semver ranges)
const SAFE = /^[\w@%+=:,./^~-]+$/;

/** Single-quoted for a POSIX shell, whatever it contains: `it's` → `'it'\''s'`. */
export const singleQuote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`;

/** One argument, quoted only when a shell would otherwise split or expand it. */
export const quoteArg = (arg: string) => (SAFE.test(arg) ? arg : singleQuote(arg));

/** An argv as one shell line — to show a command, or to run several with `sh -c`. */
export const shellQuote = (argv: string[]) => argv.map(quoteArg).join(' ');

export default shellQuote;
