import { expect, test } from 'bun:test';

import { flagValue, parseFlags, parseLeadingFlags } from '.';

test('flags anywhere, values optional, -- ends them', () => {
  expect(parseFlags(['in.ansi', '--title=A b', '--scale=1', 'out.png', '--quiet'])).toEqual({
    flags: { title: 'A b', scale: '1', quiet: 'true' },
    positionals: ['in.ansi', 'out.png'],
  });
  expect(parseFlags(['a', '--', '--not-a-flag'])).toEqual({
    flags: {},
    positionals: ['a', '--not-a-flag'],
  });
});

test('leading flags stop at the command, whose own flags are left alone', () => {
  expect(parseLeadingFlags(['--scale=1', 'ls', '-la', '--color=always'])).toEqual({
    flags: { scale: '1' },
    rest: ['ls', '-la', '--color=always'],
  });
  expect(parseLeadingFlags(['--title=x', '--', '--version'])).toEqual({
    flags: { title: 'x' },
    rest: ['--version'],
  });
  expect(parseLeadingFlags(['--title=x'])).toEqual({ flags: { title: 'x' }, rest: [] });
});

test('flagValue: the first --name=value, empty values kept, prefixes not confused', () => {
  const args = ['open', '--tag=docs', '--tags=a,b', '--title=', '--tag=second'];
  expect(flagValue(args, 'tag')).toBe('docs');
  expect(flagValue(args, 'tags')).toBe('a,b');
  expect(flagValue(args, 'title')).toBe('');
  expect(flagValue(args, 'missing')).toBeUndefined();
});
