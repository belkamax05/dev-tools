import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { configStore, stateStore } from '.';

//? The real stores, pointed at a throwaway home through XDG — never the user's own files
let home: string;
const saved = { config: process.env.XDG_CONFIG_HOME, state: process.env.XDG_STATE_HOME };

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'envi-settings-'));
  process.env.XDG_CONFIG_HOME = join(home, 'config');
  process.env.XDG_STATE_HOME = join(home, 'state');
  mkdirSync(join(home, 'config', 'envi'), { recursive: true });
  mkdirSync(join(home, 'state', 'envi'), { recursive: true });
});

afterAll(() => {
  process.env.XDG_CONFIG_HOME = saved.config;
  process.env.XDG_STATE_HOME = saved.state;
  rmSync(home, { recursive: true, force: true });
});

const writeConfig = (raw: object) => writeFileSync(configStore.path, JSON.stringify(raw));

describe('setTarget', () => {
  test('defaults to .env.user', () => {
    expect(configStore.defaults.setTarget).toBe('.env.user');
  });

  test('keeps a known target and falls back to .env.user for anything else', async () => {
    writeConfig({ setTarget: 'state' });
    expect((await configStore.load()).setTarget).toBe('state');
    writeConfig({ setTarget: 'nowhere' });
    expect((await configStore.load()).setTarget).toBe('.env.user');
  });
});

describe('machine vars', () => {
  test('the state file keeps only well-named string vars, a number as text', async () => {
    writeFileSync(
      stateStore.path,
      JSON.stringify({ tab: 'vars', vars: { GOOD: 'x', N: 3, 'bad key': 'y' } }),
    );
    expect((await stateStore.load()).vars).toEqual({ GOOD: 'x', N: '3' });
  });
});
