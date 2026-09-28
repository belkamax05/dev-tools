import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_SETTINGS,
  folderStatePath,
  loadFolderContext,
  readFolderState,
  writeFolderState,
} from './index';

let dir: string;
let previous: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pkgi-settings-'));
  previous = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = join(dir, '.state');
});

afterEach(() => {
  if (previous === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = previous;
  rmSync(dir, { recursive: true, force: true });
});

describe('folder context', () => {
  test('without pkgi.config.ts: defaults, and state outside the folder', async () => {
    const context = await loadFolderContext(dir);
    expect(context.settings).toEqual(DEFAULT_SETTINGS);
    expect(context.project.path).toBeUndefined();
    expect(context.statePath.startsWith(join(dir, '.state', 'pkgi', 'folders'))).toBe(true);
  });

  test('pkgi.config.ts overrides defaults and can move the state file; state overrides both', async () => {
    writeFileSync(
      join(dir, 'pkgi.config.ts'),
      `export default { showUnstable: true, installAs: 'dev', stateFile: '.pkgi/state.json', comparePaths: ['../a'], bogus: 1 };`,
    );
    const first = await loadFolderContext(dir);
    expect(first.settings.showUnstable).toBe(true);
    expect(first.settings.installAs).toBe('dev');
    expect(first.project.config.comparePaths).toEqual(['../a']);
    expect(first.statePath).toBe(join(dir, '.pkgi', 'state.json'));

    await writeFolderState(first.statePath, { ...first.state, settings: { installAs: 'prod' } });
    const second = await loadFolderContext(dir);
    expect(second.settings.installAs).toBe('prod');
    expect(second.settings.showUnstable).toBe(true);
  });

  test('a config that throws is reported, not fatal', async () => {
    writeFileSync(join(dir, 'pkgi.config.ts'), `throw new Error('nope');`);
    const context = await loadFolderContext(dir);
    expect(context.project.error).toContain('nope');
    expect(context.settings).toEqual(DEFAULT_SETTINGS);
  });
});

describe('folder state', () => {
  test('notes round-trip, and a bare-string note written by hand is accepted', async () => {
    const path = folderStatePath(dir, {});
    writeFileSync(join(dir, 'hand.json'), JSON.stringify({ notes: { react: 'pinned for SSR' } }));
    expect((await readFolderState(join(dir, 'hand.json'), dir)).notes.react?.note).toBe(
      'pinned for SSR',
    );

    const state = await readFolderState(path, dir);
    state.notes.zod = { note: 'v4 migration pending', updatedAt: 'now' };
    await writeFolderState(path, state);
    expect((await readFolderState(path, dir)).notes.zod?.note).toBe('v4 migration pending');
  });

  test('two folders with the same name never share a state file', () => {
    expect(folderStatePath('/a/app', {})).not.toBe(folderStatePath('/b/app', {}));
  });
});
