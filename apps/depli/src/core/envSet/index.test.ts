import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Project } from '../registry';
import { saveEnv } from '.';

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'depli-envset-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

//? A stand-in for `dfs env set`: writes its KEY=VALUE arguments to a file in the project folder
const project = (envSet: string[]): Project => ({
  dir,
  config: { envSet },
  providers: [],
  problems: [],
});
const recorder = ['sh', '-c', 'printf "%s\\n" "$@" > saved.env && echo "Set them in saved.env"', 'sh'];

describe('saveEnv', () => {
  test('stores an op reference but uses its resolved secret immediately', async () => {
    const previousPath = process.env.PATH;
    writeFileSync(join(dir, 'op'), '#!/bin/sh\nprintf resolved-token', { mode: 0o755 });
    process.env.PATH = `${dir}:${previousPath ?? ''}`;
    try {
      const env: Record<string, string | undefined> = {};
      const ref = 'op://depli-envset-test/jenkins/token';
      await saveEnv(project(recorder), env, { CI_USER: 'me', CI_TOKEN: ref });
      expect(readFileSync(join(dir, 'saved.env'), 'utf8')).toBe(`CI_USER=me\nCI_TOKEN=${ref}\n`);
      expect(env).toEqual({ CI_USER: 'me', CI_TOKEN: 'resolved-token' });
    } finally {
      process.env.PATH = previousPath;
    }
  });

  test('a failed op read leaves the current credentials intact and does not save', async () => {
    const previousPath = process.env.PATH;
    writeFileSync(join(dir, 'op'), '#!/bin/sh\necho "vault locked" >&2\nexit 1', { mode: 0o755 });
    process.env.PATH = `${dir}:${previousPath ?? ''}`;
    try {
      const env = { CI_TOKEN: 'old-token' };
      const before = 'CI_TOKEN=old-token\n';
      writeFileSync(join(dir, 'saved.env'), before);
      await expect(saveEnv(project(recorder), env, {
        CI_TOKEN: 'op://depli-envset-test/locked/token',
      })).rejects.toThrow('CI_TOKEN: vault locked');
      expect(env.CI_TOKEN).toBe('old-token');
      expect(readFileSync(join(dir, 'saved.env'), 'utf8')).toBe(before);
    } finally {
      process.env.PATH = previousPath;
    }
  });

  test('runs the project’s command from its folder and applies the values to this run', async () => {
    const env: Record<string, string | undefined> = { OTHER: 'kept' };
    const said = await saveEnv(project(recorder), env, { CI_USER: 'me', CI_TOKEN: 'a b' });
    expect(said).toBe('Set them in saved.env');
    expect(readFileSync(join(dir, 'saved.env'), 'utf8')).toBe('CI_USER=me\nCI_TOKEN=a b\n');
    expect(env).toEqual({ OTHER: 'kept', CI_USER: 'me', CI_TOKEN: 'a b' });
  });

  test('a failing command rejects with its error, and nothing is applied', async () => {
    const env: Record<string, string | undefined> = {};
    const failing = ['sh', '-c', 'echo "no such place" >&2; exit 3'];
    await expect(saveEnv(project(failing), env, { CI_USER: 'me' })).rejects.toThrow('no such place');
    expect(env).toEqual({});
  });
});
