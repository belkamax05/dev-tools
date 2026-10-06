import { describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getCommandEntries from '.';

/**
 * A command tree standing in for `src/commands`, so these tests keep describing discovery rather
 * than whichever commands happen to exist today.
 */
const fixtureDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'giti-commands-'));
  await writeFile(
    join(dir, 'zebra.ts'),
    "export const meta = { name: 'zebra', description: 'Last alphabetically' };\nexport default () => {};\n",
  );
  await writeFile(join(dir, 'bare.ts'), 'export default () => {};\n');
  await mkdir(join(dir, 'nested'));
  await writeFile(
    join(dir, 'nested', 'deep.ts'),
    "export const meta = { name: 'nested/deep', description: 'Nested one' };\nexport default () => {};\n",
  );
  await writeFile(join(dir, 'helper.test.ts'), 'export default () => {};\n');
  return dir;
};

describe('getCommandEntries', () => {
  test('finds nested command modules, not just the top level', async () => {
    const names = (await getCommandEntries(await fixtureDir())).map((entry) => entry.name);
    expect(names).toEqual(['bare', 'nested/deep', 'zebra']);
  });

  test('a nested command keeps the slash-separated name the CLI resolves onto a file', async () => {
    const dir = await fixtureDir();
    const entry = (await getCommandEntries(dir)).find((found) => found.name === 'nested/deep');
    expect(entry?.key).toBe('deep');
    expect(entry?.path).toBe(join(dir, 'nested', 'deep.ts'));
  });

  test('reads the description a command exports, so the picker has one to show', async () => {
    const entries = await getCommandEntries(await fixtureDir());
    expect(entries.find((entry) => entry.name === 'zebra')?.meta?.description).toBe(
      'Last alphabetically',
    );
  });

  test('a command without meta still shows up rather than being skipped', async () => {
    const entry = (await getCommandEntries(await fixtureDir())).find(
      (found) => found.name === 'bare',
    );
    expect(entry).toBeDefined();
    expect(entry?.meta).toBeUndefined();
  });

  test('test files sitting beside commands are not offered as commands', async () => {
    const names = (await getCommandEntries(await fixtureDir())).map((entry) => entry.name);
    expect(names).not.toContain('helper.test');
  });

  test('defaults to this CLI’s own commands, so the picker needs no wiring', async () => {
    const names = (await getCommandEntries()).map((entry) => entry.name);
    expect(names).toContain('status');
    expect(names).toContain('hash');
  });
});
