/**
 * One `KEY=value` line of a dotenv file, before its value is evaluated.
 *
 * `raw` is the text between the quotes (or the bare value, inline comment dropped), kept
 * unevaluated because what `$` and `\` mean depends on the quote style *and* on the variables
 * already set when the entry is applied — see `evaluate`.
 */
export interface DotenvEntry {
  key: string;
  raw: string;
  quote: '"' | "'" | '`' | '';
  /** 1-based line the entry starts on, for "set in .env:12". */
  line: number;
}

export interface DotenvError {
  line: number;
  message: string;
}

export interface ParsedDotenv {
  entries: DotenvEntry[];
  errors: DotenvError[];
}

const KEY = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

/** Every name a lookup can resolve: what is already set, as a plain read. */
export type Lookup = (name: string) => string | undefined;

/**
 * Parse dotenv text the way the `dotenv` package does, plus the bits people expect from a shell:
 *
 * - `# comments`, blank lines and an `export ` prefix (so a file can also be `source`d);
 * - `KEY=value`, `KEY = value` and `KEY: value`;
 * - `"double"` quotes — escapes (`\n`, `\t`, `\"`, `\$`) and `$VAR` expansion, may span lines;
 * - `'single'` and `` `backtick` `` quotes — literal, may span lines;
 * - a bare value ends at ` #` (an inline comment) and is trimmed.
 *
 * A line that is none of those is reported, not thrown: one typo in a long `.env` should cost
 * that line, not every variable after it. A later duplicate key wins, as it would in a shell.
 */
export const parseDotenv = (text: string): ParsedDotenv => {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const entries: DotenvEntry[] = [];
  const errors: DotenvError[] = [];

  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    const line = (lines[index] ?? '').trim();
    if (!line || line.startsWith('#')) continue;

    const match = /^(?:export\s+)?([^=:\s]+)\s*[=:]\s?(.*)$/.exec(line);
    if (!match) {
      errors.push({
        line: lineNumber,
        message: `not a KEY=value line: ${line.slice(0, 40)}`,
      });
      continue;
    }
    const key = match[1] ?? '';
    if (!KEY.test(key)) {
      errors.push({
        line: lineNumber,
        message: `"${key}" is not a valid variable name`,
      });
      continue;
    }
    let rest = (match[2] ?? '').trimStart();
    const quote = rest[0];

    if (quote === '"' || quote === "'" || quote === '`') {
      //? Look for the closing quote on this line first, then on the lines after it — a
      //? multi-line value (a PEM key) is the one reason anyone quotes across lines
      let body = rest.slice(1);
      let end = findClosing(body, quote);
      while (end < 0 && index + 1 < lines.length) {
        index++;
        body += `\n${lines[index] ?? ''}`;
        end = findClosing(body, quote);
      }
      if (end < 0) {
        errors.push({
          line: lineNumber,
          message: `${key}: the ${quote} quote is never closed`,
        });
        entries.push({ key, raw: body, quote, line: lineNumber });
        continue;
      }
      entries.push({ key, raw: body.slice(0, end), quote, line: lineNumber });
      continue;
    }

    //? A `#` only starts a comment after whitespace, so `URL=http://x/#anchor` survives
    const comment = rest.search(/\s#/);
    if (comment >= 0) rest = rest.slice(0, comment);
    entries.push({ key, raw: rest.trim(), quote: '', line: lineNumber });
  }

  return { entries, errors };
};

/** Index of the unescaped closing quote in `body`, or -1. Only `"` honours backslashes. */
const findClosing = (body: string, quote: string): number => {
  for (let at = 0; at < body.length; at++) {
    if (quote === '"' && body[at] === '\\') {
      at++;
      continue;
    }
    if (body[at] === quote) return at;
  }
  return -1;
};

const ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t' };

/**
 * An entry's value, given what is already set.
 *
 * Single quotes and backticks are literal. Double quotes and bare values expand `$NAME`,
 * `${NAME}`, `${NAME:-fallback}` (unset *or empty*) and `${NAME-fallback}` (unset only), with
 * `\$` for a literal dollar; double quotes also turn `\n`, `\r`, `\t` into the characters. A name
 * nothing defines expands to an empty string, as in a shell. `expand: false` keeps every `$`.
 */
export const evaluate = (entry: DotenvEntry, lookup: Lookup, { expand = true } = {}): string => {
  if (entry.quote === "'" || entry.quote === '`') return entry.raw;
  return expandText(entry.raw, lookup, {
    expand,
    escapes: entry.quote === '"',
  });
};

export const expandText = (
  text: string,
  lookup: Lookup,
  { expand = true, escapes = false }: { expand?: boolean; escapes?: boolean } = {},
): string => {
  let out = '';
  for (let at = 0; at < text.length; at++) {
    const char = text[at] ?? '';
    if (char === '\\' && at + 1 < text.length) {
      const next = text[at + 1] ?? '';
      if (next === '$') {
        out += '$';
        at++;
        continue;
      }
      if (escapes) {
        out += ESCAPES[next] ?? next;
        at++;
        continue;
      }
      out += char;
      continue;
    }
    if (char !== '$' || !expand) {
      out += char;
      continue;
    }

    const braced = text[at + 1] === '{';
    if (braced) {
      const close = matchingBrace(text, at + 1);
      if (close < 0) {
        out += char;
        continue;
      }
      const inner = text.slice(at + 2, close);
      const operator = /^([A-Za-z_][A-Za-z0-9_]*)(:?-)(.*)$/s.exec(inner);
      if (operator) {
        const [, name = '', op, fallback = ''] = operator;
        const value = lookup(name);
        const useFallback = op === ':-' ? !value : value === undefined;
        out += useFallback ? expandText(fallback, lookup, { expand }) : (value ?? '');
      } else out += lookup(inner) ?? '';
      at = close;
      continue;
    }

    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(at + 1))?.[0];
    if (!name) {
      out += char;
      continue;
    }
    out += lookup(name) ?? '';
    at += name.length;
  }
  return out;
};

/** The `}` closing the `{` at `open`, counting nested `${…}` in a fallback. */
const matchingBrace = (text: string, open: number): number => {
  let depth = 0;
  for (let at = open; at < text.length; at++) {
    if (text[at] === '{') depth++;
    else if (text[at] === '}' && --depth === 0) return at;
  }
  return -1;
};

/**
 * Dotenv text to a plain object — `dotenv.parse`. Values expand against the file's own earlier
 * keys and then `env`, so `URL=http://${HOST}` works without touching `process.env`.
 */
export const parse = (
  text: string,
  env: Record<string, string | undefined> = {},
  options: { expand?: boolean } = {},
): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const entry of parseDotenv(text).entries) {
    out[entry.key] = evaluate(entry, (name) => (name in out ? out[name] : env[name]), options);
  }
  return out;
};

/** A value written so `parseDotenv` reads it back unchanged: bare when it can be, else `"…"`. */
export const quoteValue = (value: string): string => {
  if (/^[\w@%+=:,./-]*$/.test(value)) return value;
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')}"`;
};

/** `"KEY=value"` from a command line or a prompt; undefined when it is not one. */
export const parseAssignment = (text: string): { key: string; value: string } | undefined => {
  const at = text.indexOf('=');
  if (at <= 0) return undefined;
  const key = text
    .slice(0, at)
    .trim()
    .replace(/^export\s+/, '');
  if (!KEY.test(key)) return undefined;
  return { key, value: text.slice(at + 1) };
};

export const isValidKey = (key: string) => KEY.test(key);

export default parseDotenv;
