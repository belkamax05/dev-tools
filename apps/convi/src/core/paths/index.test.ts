import { describe, expect, test } from 'bun:test';

import { replaceExtension, withExtension } from './index';

describe('withExtension', () => {
  test('appends the extension when there is none', () => {
    expect(withExtension('notes', '.md')).toBe('notes.md');
    expect(withExtension('docs/notes', '.md')).toBe('docs/notes.md');
  });

  test('keeps an extension the user gave, even a different one', () => {
    expect(withExtension('notes.md', '.md')).toBe('notes.md');
    expect(withExtension('notes.txt', '.md')).toBe('notes.txt');
  });
});

describe('replaceExtension', () => {
  test('swaps the extension', () => {
    expect(replaceExtension('docs/notes.md', '.pdf')).toBe('docs/notes.pdf');
  });

  test('only the last extension', () => {
    expect(replaceExtension('release.v2.md', '.pdf')).toBe('release.v2.pdf');
  });

  test('appends when there is none', () => {
    expect(replaceExtension('notes', '.pdf')).toBe('notes.pdf');
  });
});
