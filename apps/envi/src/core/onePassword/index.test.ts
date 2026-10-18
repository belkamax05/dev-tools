import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { config as applyEnv, loadEnv } from '../../index';
import { configStore, type EnviConfig } from '../../config/settings';
import { resolveEnv } from '../resolve';
import { isOpRef, readOpRefs } from './index';

let dir: string;
let log: string;
const savedPath = process.env.PATH;

const settings = (vars: Record<string, string>): EnviConfig => ({
  ...configStore.defaults,
  files: ['.env'],
  vars,
});

//? A stand-in `op`: `op read --no-newline op://v/<item>/f` prints `secret-<item>`, fails for
//? `missing`, and logs every call so a test can tell what 1Password was asked for
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'envi-op-'));
  log = join(dir, 'calls.log');
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  mkdirSync(join(dir, '.git'));
  writeFileSync(
    join(bin, 'op'),
    `#!/bin/sh
echo "$3" >> "${log}"
item=$(echo "$3" | cut -d/ -f4)
if [ "$item" = missing ]; then echo '[ERROR] 2026/10/18 12:00:00 "missing" isn'"'"'t an item' >&2; exit 1; fi
printf 'secret-%s' "$item"
`,
  );
  chmodSync(join(bin, 'op'), 0o755);
  writeFileSync(join(dir, '.env'), 'FILE_TOKEN=op://v/file/f\nPLAIN=value\n');
  process.env.PATH = `${bin}:${savedPath}`;
});

afterAll(() => {
  process.env.PATH = savedPath;
  rmSync(dir, { recursive: true, force: true });
});

const calls = async () =>
  (
    await Bun.file(log)
      .text()
      .catch(() => '')
  )
    .split('\n')
    .filter(Boolean);

describe('isOpRef', () => {
  test('a whole op:// value only', () => {
    expect(isOpRef('op://vault/item/field')).toBe(true);
    expect(isOpRef('  op://vault/item/field ')).toBe(true);
    expect(isOpRef('token op://x')).toBe(false);
    expect(isOpRef('plain')).toBe(false);
    expect(isOpRef(undefined)).toBe(false);
  });
});

describe('readOpRefs', () => {
  test('reads references, leaves plain values, reports failures', async () => {
    const { secrets, failures } = await readOpRefs({
      A: 'op://v/a/f',
      B: 'plain',
      C: 'op://v/missing/f',
    });
    expect(secrets).toEqual({ A: 'secret-a' });
    expect(failures).toEqual([
      { key: 'C', ref: 'op://v/missing/f', error: '"missing" isn\'t an item' },
    ]);
  });
});

describe('resolveEnv secrets', () => {
  test('off by default: the reference is the value', async () => {
    const resolution = await resolveEnv({
      cwd: dir,
      env: {},
      config: settings({ USER_TOKEN: 'op://v/user/f' }),
    });
    expect(resolution.env.USER_TOKEN).toBe('op://v/user/f');
    expect(resolution.env.FILE_TOKEN).toBe('op://v/file/f');
    expect(resolution.secretErrors).toEqual([]);
  });

  test('only the keys asked for are read — from your vars and env files alike', async () => {
    const before = (await calls()).length;
    const resolution = await resolveEnv({
      cwd: dir,
      env: {},
      config: settings({ USER_TOKEN: 'op://v/user/f', OTHER: 'op://v/other/f' }),
      secrets: ['USER_TOKEN', 'FILE_TOKEN', 'PLAIN'],
    });
    expect(resolution.env.USER_TOKEN).toBe('secret-user');
    expect(resolution.env.FILE_TOKEN).toBe('secret-file');
    expect(resolution.env.PLAIN).toBe('value');
    expect(resolution.env.OTHER).toBe('op://v/other/f');
    expect(resolution.vars.find((entry) => entry.key === 'USER_TOKEN')?.ref).toBe(
      'op://v/user/f',
    );
    expect((await calls()).slice(before)).not.toContain('op://v/other/f');
  });
});

describe('config / loadEnv with only', () => {
  test('applies just those, resolved; an unreadable one stays unset', async () => {
    const target: Record<string, string | undefined> = {};
    const resolution = await applyEnv({
      cwd: dir,
      target,
      config: settings({ USER_TOKEN: 'op://v/user/f', BAD: 'op://v/missing/f', OTHER: 'x' }),
      only: ['USER_TOKEN', 'BAD', 'PLAIN'],
    });
    expect(target).toEqual({ USER_TOKEN: 'secret-user', PLAIN: 'value' });
    expect(resolution.secretErrors.map((failure) => failure.key)).toEqual(['BAD']);
  });

  test('a shell holding the reference itself gets the secret', async () => {
    const target: Record<string, string | undefined> = { USER_TOKEN: 'op://v/user/f' };
    await applyEnv({
      cwd: dir,
      target,
      config: settings({ USER_TOKEN: 'op://v/user/f' }),
      only: ['USER_TOKEN'],
    });
    expect(target.USER_TOKEN).toBe('secret-user');
  });

  test('loadEnv returns plain values as they are', async () => {
    expect(
      await loadEnv({ cwd: dir, env: {}, config: settings({}), only: ['PLAIN', 'FILE_TOKEN'] }),
    ).toEqual({ PLAIN: 'value', FILE_TOKEN: 'secret-file' });
  });
});
