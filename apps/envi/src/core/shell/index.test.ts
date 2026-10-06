import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { configStore } from '../../config/settings';
import { resolveEnv } from '../resolve';
import { APPLIED_VAR, formatExport, formatHookExport, readApplied, shellBase } from './index';

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'envi-shell-'));
  mkdirSync(join(dir, '.git'));
  writeFileSync(join(dir, '.env'), `A=one\nQUOTE="it's \\"x\\" $5"\nB=new\n`);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const config = { ...configStore.defaults, vars: {} };

/** Run shell code in sh and print the named variables. */
const runSh = (code: string, names: string[], env: Record<string, string>) =>
  spawnSync(
    'sh',
    [
      '-c',
      `${code}\n${names.map((name) => `printf '%s=%s|' ${name} "\${${name}-<unset>}"`).join('\n')}`,
    ],
    {
      env,
      encoding: 'utf8',
    },
  ).stdout;

describe('shell export', () => {
  test('sh output survives quotes and dollars when evaluated', async () => {
    const resolution = await resolveEnv({ cwd: dir, env: {}, config });
    const out = runSh(formatExport(resolution, 'sh'), ['A', 'QUOTE'], {});
    expect(out).toBe(`A=one|QUOTE=it's "x" $5|`);
  });

  test('the hook applies, records, and undoes its own changes on leaving', async () => {
    const shell = { B: 'mine', PATH: process.env.PATH ?? '' };
    const inside = await resolveEnv({
      cwd: dir,
      env: shell,
      config: { ...config, override: true },
    });
    const code = formatHookExport(inside, 'sh', shell, '1');

    const applied = runSh(code, ['A', 'B', APPLIED_VAR], shell);
    expect(applied).toContain('A=one|B=new|');
    const record = JSON.parse(applied.split(`${APPLIED_VAR}=`)[1]?.replace(/\|$/, '') ?? '{}');
    expect(record).toEqual({ A: null, QUOTE: null, B: 'mine' });

    //? Now "cd" somewhere envi sets nothing: the shell env carries the hook's record
    const now = { ...shell, A: 'one', B: 'new', QUOTE: 'q', [APPLIED_VAR]: JSON.stringify(record) };
    expect(shellBase(now)).toEqual(shell);
    const outside = await resolveEnv({ cwd: tmpdir(), env: now, config, noProject: true });
    const restored = runSh(formatHookExport(outside, 'sh', now, '1'), ['A', 'B', APPLIED_VAR], now);
    expect(restored).toBe(`A=<unset>|B=mine|${APPLIED_VAR}=<unset>|`);
  });

  test('readApplied ignores junk', () => {
    expect(readApplied({ [APPLIED_VAR]: 'not json' })).toEqual({});
    expect(readApplied({ [APPLIED_VAR]: '{"A":1,"B":null}' })).toEqual({ B: null });
  });
});
