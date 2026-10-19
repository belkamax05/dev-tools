import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { configStore, stateStore, toTabId } from '../../config/settings';
import { parse } from '../parse';
import { type Location, renameAt, toFileLine, toSettingText, transferVar } from '.';

//? The real stores, pointed at a throwaway home through XDG — never the user's own files
let home: string;
const saved = { config: process.env.XDG_CONFIG_HOME, state: process.env.XDG_STATE_HOME };

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'envi-locations-'));
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

const file = (name: string, text: string): Location => {
  const path = join(home, name);
  writeFileSync(path, text);
  return { kind: 'file', path, label: name };
};

describe('raw values between places', () => {
  test('a file value reads back the same once in your vars', () => {
    expect(toSettingText({ text: '${HOST}:80', quote: '' })).toBe('${HOST}:80');
    expect(toSettingText({ text: 'a$b', quote: "'" })).toBe('a\\$b');
    expect(toSettingText({ text: 'x\\ny\\$z', quote: '"' })).toBe('x\ny\\$z');
  });

  test('a setting text becomes a line the file reads back the same', () => {
    const lookup = { HOST: 'h' };
    for (const text of ['plain', '${HOST}:80', 'with space #not', 'two\nlines', 'q"uote\\x']) {
      const line = toFileLine('K', { text, quote: '' });
      expect(parse(line, lookup).K).toBe(expectSetting(text, lookup));
    }
  });
});

/** What your vars make of `text` — an unquoted value without escapes. */
const expectSetting = (text: string, lookup: Record<string, string>) =>
  text.replace(/\$\{(\w+)\}/g, (_, name: string) => lookup[name] ?? '');

describe('transferVar', () => {
  test('moves a line between files, quotes and references kept', async () => {
    const from = file('a.env', 'A=1\nURL="http://${HOST}"\n');
    const to = file('b.env', 'B=2\n');
    const config = await configStore.load();
    expect(await transferVar(from, to, 'URL', config)).toBeUndefined();
    expect(readFileSync(join(home, 'a.env'), 'utf8')).toBe('A=1\n');
    expect(readFileSync(join(home, 'b.env'), 'utf8')).toBe('B=2\nURL="http://${HOST}"\n');
  });

  test('moves from a file into your vars, and copies into machine vars', async () => {
    const from = file('c.env', 'TOKEN=abc\n');
    const config = await configStore.load();
    const next = await transferVar(from, { kind: 'config' }, 'TOKEN', config);
    expect(next?.vars.TOKEN).toBe('abc');
    expect(readFileSync(join(home, 'c.env'), 'utf8')).toBe('');
    expect(
      await transferVar({ kind: 'config' }, { kind: 'state' }, 'TOKEN', next ?? config, { keep: true }),
    ).toBeUndefined();
    expect((await stateStore.load()).vars.TOKEN).toBe('abc');
  });

  test('renames in place', async () => {
    const at = file('d.env', 'OLD=v\n');
    await renameAt(at, 'OLD', 'NEW', await configStore.load());
    expect(readFileSync(join(home, 'd.env'), 'utf8')).toBe('NEW=v\n');
  });
});

describe('tabs', () => {
  test('the merged tabs land on their heirs', () => {
    expect(toTabId('resolved')).toBe('values');
    expect(toTabId('vars')).toBe('locations');
    expect(toTabId('settings')).toBe('settings');
    expect(toTabId('nope')).toBeUndefined();
  });
});
