import { extname } from 'node:path';

import type { Converter } from '../../converters/types';

export type Resolved =
  | { kind: 'converter'; converter: Converter; input: string; output?: string }
  | { kind: 'unknown'; reason: string };

/**
 * Work out which converter a command line asks for, and its input/output arguments.
 *
 * - `<converter> <input> [output]` — by name: `md-to-pdf notes.md`
 * - `<input> <output>` — by the two extensions: `notes.md notes.pdf`
 *
 * A name always wins, so a file that happens to be called `md-to-pdf` needs `./md-to-pdf`.
 */
export const resolveConverter = (args: string[], converters: Converter[]): Resolved => {
  const [first, second, third] = args;
  if (!first) return { kind: 'unknown', reason: 'Nothing to convert.' };

  const byName = converters.find((converter) => converter.name === first);
  if (byName) {
    if (!second)
      return {
        kind: 'unknown',
        reason: `usage: convi ${byName.name} <input> [output]`,
      };
    return {
      kind: 'converter',
      converter: byName,
      input: second,
      output: third,
    };
  }

  if (!second) {
    return {
      kind: 'unknown',
      reason: `"${first}" is not a converter. Give one by name, or both files: convi <input> <output>`,
    };
  }

  const from = extname(first).toLowerCase();
  const to = extname(second).toLowerCase();
  const byExtension = converters.find(
    (converter) => converter.from === from && converter.to === to,
  );
  if (!byExtension) {
    return {
      kind: 'unknown',
      reason: `No converter from ${from || '(no extension)'} to ${to || '(no extension)'}.`,
    };
  }
  return {
    kind: 'converter',
    converter: byExtension,
    input: first,
    output: second,
  };
};
