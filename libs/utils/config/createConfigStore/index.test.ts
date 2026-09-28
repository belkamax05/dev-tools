import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
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

  test('state lives under XDG_STATE_HOME, never next to the config', async () => {
    const stateHome = mkdtempSync(join(tmpdir(), 'dev-tools-state-'));
    const before = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = stateHome;
    try {
      const state = createConfigStore({
        appName: 'test-app',
        kind: 'state',
        defaults: { tab: 'a' },
      });

      //? The point of the split: config may be a stow-linked dotfile, and state that rewrites
      //? itself every run must not land beside it.
      expect(state.path).toBe(join(stateHome, 'test-app', 'state.json'));
      expect(state.path.startsWith(home)).toBe(false);

      await state.save({ tab: 'b' });
      expect(await state.load()).toEqual({ tab: 'b' });
      expect(await Bun.file(store.path).exists()).toBe(false);
    } finally {
      if (before === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = before;
      rmSync(stateHome, { recursive: true, force: true });
    }
  });

  test('clear removes a plain file and its emptied directory; a missing file is no error', async () => {
    const store = createConfigStore({ appName: 'clear-app', defaults: DEFAULTS });
    expect(await store.clear()).toBe('missing');
    await store.save({ ...DEFAULTS, rows: 3 });
    expect(await store.inspect()).toEqual({ path: store.path, exists: true, linked: false });
    expect(await store.clear()).toBe('removed');
    expect(existsSync(store.path)).toBe(false);
    expect(existsSync(store.directory)).toBe(false);
    expect(await store.load()).toEqual(DEFAULTS);
  });

  test('clear resets a stow-linked file through the link instead of deleting it', async () => {
    const dotfiles = join(home, 'dotfiles', 'config.json');
    mkdirSync(join(home, 'dotfiles'));
    await Bun.write(dotfiles, '{"theme":"forest","compact":true,"rows":3}\n');
    const store = createConfigStore({ appName: 'linked-app', defaults: DEFAULTS });
    mkdirSync(store.directory, { recursive: true });
    symlinkSync(dotfiles, store.path);

    expect((await store.inspect()).linked).toBe(true);
    expect(await store.clear()).toBe('reset');
    expect(lstatSync(store.path).isSymbolicLink()).toBe(true);
    expect(JSON.parse(readFileSync(dotfiles, 'utf8'))).toEqual(DEFAULTS);
  });

  test('an explicit path puts the store anywhere, and clears it the same way', async () => {
    const path = join(home, 'project', '.app', 'state.json');
    const store = createConfigStore({ appName: 'any', path, defaults: { notes: {} } });
    expect(store.path).toBe(path);
    await store.save({ notes: { a: 1 } });
    expect(existsSync(path)).toBe(true);
    expect(await store.clear()).toBe('removed');
    expect(existsSync(path)).toBe(false);
  });
});
