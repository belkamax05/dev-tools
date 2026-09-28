import { describe, expect, test } from 'bun:test';

import type { AppEntry } from '../apps';
import { listAliases, resolveCommand, splitWords } from './index';

const app = (
  name: string,
  aliases: string[] = [],
  withArgs: Record<string, string> = {},
): AppEntry => ({
  name,
  description: '',
  aliases: [
    ...aliases.map((alias) => ({ name: alias, args: [] })),
    ...Object.entries(withArgs).map(([alias, args]) => ({ name: alias, args: args.split(' ') })),
  ],
  runPath: `/apps/${name}/src/run.ts`,
});

const APPS = [
  app('porti', ['port', 'ports']),
  app('pkgi', ['pkg']),
  app('giti', ['git']),
  app('agenti', ['agent'], { mcp: 'mcp', skill: 'skills' }),
];

const resolved = (argv: string[], user: Record<string, string> = {}) => {
  const result = resolveCommand(argv, APPS, user);
  return result.kind === 'app' ? [result.app.name, ...result.args] : result;
};

describe('resolveCommand', () => {
  test('an app by name, arguments passed through untouched', () => {
    expect(resolved(['porti', 'kill', '3000', '--force'])).toEqual([
      'porti',
      'kill',
      '3000',
      '--force',
    ]);
  });

  test("an app's own alias", () => {
    expect(resolved(['port', 'list'])).toEqual(['porti', 'list']);
  });

  test("an app's alias for a subcommand puts its arguments first", () => {
    expect(resolved(['mcp', '--user'])).toEqual(['agenti', 'mcp', '--user']);
    expect(resolved(['skill'])).toEqual(['agenti', 'skills']);
  });

  test('a user alias with arguments of its own, then the ones typed after it', () => {
    expect(resolved(['kp', '3000'], { kp: 'porti kill' })).toEqual(['porti', 'kill', '3000']);
  });

  test('a user alias may point at another alias', () => {
    expect(resolved(['k3'], { kp: 'port kill', k3: 'kp 3000' })).toEqual(['porti', 'kill', '3000']);
  });

  test('a user alias overrides an app alias, but never an app name', () => {
    expect(resolved(['git'], { git: 'pkgi' })).toEqual(['pkgi']);
    expect(resolved(['porti'], { porti: 'pkgi' })).toEqual(['porti']);
  });

  test('unknown words and loops are reported, not followed forever', () => {
    expect(resolveCommand(['nope'], APPS, {})).toEqual({ kind: 'unknown', name: 'nope' });
    expect(resolveCommand(['a'], APPS, { a: 'b', b: 'a' }).kind).toBe('loop');
  });
});

describe('splitWords', () => {
  test('whitespace separates, quotes keep a word together', () => {
    expect(splitWords(`pkgi note react "pinned for SSR"  x`)).toEqual([
      'pkgi',
      'note',
      'react',
      'pinned for SSR',
      'x',
    ]);
    expect(splitWords(`a '' b`)).toEqual(['a', '', 'b']);
  });
});

describe('listAliases', () => {
  test('marks an app alias hidden by a user alias of the same name', () => {
    const rows = listAliases(APPS, { git: 'pkgi' });
    expect(rows.find((row) => row.alias === 'git' && row.source === 'giti')?.shadowed).toBe(true);
    expect(rows.find((row) => row.alias === 'git' && row.source === 'user')?.shadowed).toBe(false);
  });
});
