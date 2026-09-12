import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import createConfigStore from './index';

interface Settings {
  theme: string;
  compact: boolean;
  rows: number;
}

const DEFAULTS: Settings = { theme: 'classic', compact: false, rows: 12 };

let home: string;
let previous: string | undefined;

beforeEach(() => {
  previous = process.env.XDG_CONFIG_HOME;
  home = mkdtempSync(join(tmpdir(), 'dev-tools-config-'));
  process.env.XDG_CONFIG_HOME = home;
});

afterEach(() => {
  if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = previous;
  rmSync(home, { recursive: true, force: true });
});

const store = createConfigStore<Settings>({ appName: 'test-app', defaults: DEFAULTS });

describe('createConfigStore', () => {
  test('follows XDG_CONFIG_HOME set after the module loaded', () => {
    //? The store is built once at import; the environment is not. A path
    //? captured eagerly would point at the real home and this test would write
    //? to the user's own config directory.
    expect(store.path.startsWith(home)).toBe(true);
    expect(store.path.endsWith(join('test-app', 'config.json'))).toBe(true);
  });

  test('a first run gets the defaults rather than throwing', async () => {
    expect(await store.load()).toEqual(DEFAULTS);
  });

  test('round-trips what was saved', async () => {
    await store.save({ theme: 'ember', compact: true, rows: 30 });
    expect(await store.load()).toEqual({ theme: 'ember', compact: true, rows: 30 });
  });

  test('creates the directory on the first save', async () => {
    await store.save(DEFAULTS);
    expect(await Bun.file(store.path).exists()).toBe(true);
  });

  test('a hand-edited file keeps the keys it got right', async () => {
    await Bun.write(store.path, '{"theme":"grape","compact":"yes","rows":40}\n');
    //? `compact` is the wrong type and falls back; the other two are honoured.
    expect(await store.load()).toEqual({ theme: 'grape', compact: false, rows: 40 });
  });

  test('a corrupt file is a first run, not a crash', async () => {
    await Bun.write(store.path, 'not json at all');
    expect(await store.load()).toEqual(DEFAULTS);
  });

  test('a file that parses to a non-object is also a first run', async () => {
    await Bun.write(store.path, '"just a string"');
    expect(await store.load()).toEqual(DEFAULTS);
  });

  test('an unknown key in the file is dropped, not carried through', async () => {
    await Bun.write(store.path, '{"theme":"mono","legacyThing":true}\n');
    expect(await store.load()).toEqual({ ...DEFAULTS, theme: 'mono' });
  });

  test('a custom coerce can validate rather than only type-check', async () => {
    const validated = createConfigStore<Settings>({
      appName: 'test-app',
      defaults: DEFAULTS,
      fileName: 'validated.json',
      coerce: (raw, defaults) => ({
        theme: raw.theme === 'ember' || raw.theme === 'classic' ? raw.theme : defaults.theme,
        compact: typeof raw.compact === 'boolean' ? raw.compact : defaults.compact,
        rows: typeof raw.rows === 'number' ? raw.rows : defaults.rows,
      }),
    });

    await Bun.write(validated.path, '{"theme":"a-theme-this-build-removed"}\n');
    expect((await validated.load()).theme).toBe('classic');
  });
});
