import { describe, expect, test } from 'bun:test';

import { isGenerated, parseCanonical, render, sourceName, targetName, toCanonical } from '.';

const rule =
  '---\ndescription: Testing: how\npaths:\n  - "src/**/*.test.ts"\nowner: qa\n---\nWrite tests.\n';

describe('formats', () => {
  test('reads globs under any of the three names, and keeps unknown keys', () => {
    const parsed = parseCanonical(rule);
    expect(parsed.globs).toEqual(['src/**/*.test.ts']);
    expect(parsed.description).toBe('Testing: how');
    expect(parsed.extra).toEqual({ owner: 'qa' });
    expect(parseCanonical('---\napplyTo: "a/**,b/**"\n---\nx').globs).toEqual(['a/**', 'b/**']);
  });

  test('renders each IDE format with its own front matter and the generated marker', () => {
    const mdc = render('cursor-mdc', rule, '.agents/rules/testing.md');
    expect(mdc).toContain('description: "Testing: how"');
    expect(mdc).toContain('globs: src/**/*.test.ts');
    expect(mdc).toContain('alwaysApply: false');
    expect(isGenerated(mdc)).toBe(true);
    expect(render('copilot-instructions', rule, 'x')).toContain('applyTo: "src/**/*.test.ts"');
    expect(render('copilot-instructions', 'plain', 'x')).toContain('applyTo: "**"');
    expect(render('copilot-prompt', rule, 'x')).not.toContain('applyTo');
  });

  test('round-trips a rendered rule back to canonical without the marker', () => {
    const back = toCanonical(render('cursor-mdc', rule, 'x'));
    expect(isGenerated(back)).toBe(false);
    expect(parseCanonical(back).globs).toEqual(['src/**/*.test.ts']);
    expect(back).toContain('Write tests.');
  });

  test('renames files both ways', () => {
    expect(targetName('cursor-mdc', 'a.md')).toBe('a.mdc');
    expect(targetName('copilot-instructions', 'a.md')).toBe('a.instructions.md');
    expect(targetName('copilot-prompt', 'a.md')).toBe('a.prompt.md');
    expect(targetName('cursor-mdc', 'image.png')).toBe('image.png');
    expect(sourceName('copilot-prompt', 'a.prompt.md')).toBe('a.md');
    expect(sourceName('cursor-mdc', 'readme.txt')).toBeUndefined();
  });
});
