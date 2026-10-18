import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
