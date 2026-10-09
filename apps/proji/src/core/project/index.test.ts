import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { collectCommands, resolveCommand } from './index';

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'proji-'));
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      scripts: { dev: 'vite', lint: 'biome check .', 'lint:all': 'nx run-many -t lint' },
    }),
  );
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

const names = async (options: Parameters<typeof collectCommands>[0]) =>
  (await collectCommands(options)).map((command) => `${command.source}:${command.name}`);

describe('collectCommands', () => {
  test('package.json scripts alone, in file order', async () => {
    expect(await names({ root, title: 't' })).toEqual([
      'script:dev',
      'script:lint',
      'script:lint:all',
    ]);
  });

  test('an alias hides the script of the same name', async () => {
    expect(
      await names({
        root,
        title: 't',
        aliases: { lint: { script: 'lint:all' }, install: 'pkgi install' },
      }),
    ).toEqual(['alias:lint', 'alias:install', 'script:dev', 'script:lint:all']);
  });

  test('an override hides both, and comes first', async () => {
    expect(
      await names({
        root,
        title: 't',
        overrides: [{ name: 'lint', run: async () => 0 }],
        aliases: { lint: 'echo alias' },
      }),
    ).toEqual(['override:lint', 'script:dev', 'script:lint:all']);
  });

  test('a project without package.json still offers its overrides', async () => {
    expect(
      await names({ root: join(root, 'missing'), title: 't', overrides: [{ name: 'start' }] }),
    ).toEqual(['override:start']);
  });
});

describe('resolveCommand', () => {
  const commands = [
    {
      name: 'prod',
      source: 'override' as const,
      children: [{ name: 'build', source: 'override' as const, run: async () => 0 }],
    },
    { name: 'dev', source: 'script' as const, run: async () => 0 },
  ];

  test('descends into groups while the words match', () => {
    const { command, path, args } = resolveCommand(commands, ['prod', 'build', '--fast']);
    expect([command?.name, path, args]).toEqual(['build', ['prod', 'build'], ['--fast']]);
  });

  test('stops at the group when the next word is not a child', () => {
    const { command, args } = resolveCommand(commands, ['prod', 'nope']);
    expect([command?.name, args]).toEqual(['prod', ['nope']]);
  });

  test('nothing matched', () => {
    expect(resolveCommand(commands, ['nope']).command).toBeUndefined();
  });
});
