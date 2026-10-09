import { describe, expect, test } from 'bun:test';

import type { Converter } from '../../converters/types';
import { resolveConverter } from './index';

const converter = (name: string, from: string, to: string): Converter => ({
  name,
  from,
  to,
  description: '',
  tools: async () => [],
  convert: async () => {},
});

const CONVERTERS = [converter('md-to-pdf', '.md', '.pdf'), converter('md-to-html', '.md', '.html')];

const resolved = (args: string[]) => {
  const result = resolveConverter(args, CONVERTERS);
  return result.kind === 'converter'
    ? [result.converter.name, result.input, result.output]
    : result.kind;
};

describe('resolveConverter', () => {
  test('by name, output optional', () => {
    expect(resolved(['md-to-pdf', 'notes.md'])).toEqual(['md-to-pdf', 'notes.md', undefined]);
    expect(resolved(['md-to-pdf', 'notes.md', 'out.pdf'])).toEqual([
      'md-to-pdf',
      'notes.md',
      'out.pdf',
    ]);
  });

  test('by name without an input is a usage error', () => {
    expect(resolved(['md-to-pdf'])).toBe('unknown');
  });

  test('by the two extensions, case-insensitively', () => {
    expect(resolved(['notes.md', 'notes.pdf'])).toEqual(['md-to-pdf', 'notes.md', 'notes.pdf']);
    expect(resolved(['NOTES.MD', 'out.HTML'])).toEqual(['md-to-html', 'NOTES.MD', 'out.HTML']);
  });

  test('a pair nothing converts, or a lone file, is unknown', () => {
    expect(resolved(['notes.md', 'notes.docx'])).toBe('unknown');
    expect(resolved(['notes.md'])).toBe('unknown');
    expect(resolved([])).toBe('unknown');
  });
});
