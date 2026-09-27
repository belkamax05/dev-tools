import { describe, expect, test } from 'bun:test';
import { mkdtempSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type AgentiSettings, ideIdsFor, settingsStore, toggleRepoIde, withRepoIde } from '.';

/**
 * Point both base directories at a fresh temp dir. The state one matters as much as the config:
 * left alone, `load` would find the real ~/.local/state/agenti/state.json and read that instead.
 */
const isolate = () => {
  const dir = mkdtempSync(join(tmpdir(), 'agenti-settings-'));
  process.env.XDG_CONFIG_HOME = join(dir, 'config');
  process.env.XDG_STATE_HOME = join(dir, 'state');
  return {
    config: join(dir, 'config', 'agenti', 'config.json'),
    state: join(dir, 'state', 'agenti', 'state.json'),
  };
};

const SETTINGS: AgentiSettings = {
  theme: 'forest',
  defaultIde: 'cursor',
  repos: { '/r': { ides: ['cursor'] } },
  lastTab: 'mcp',
  logoMode: 'braille',
};

describe('settings', () => {
  test('reads the old single-IDE shape as a list of one', async () => {
    const { config } = isolate();
    await Bun.write(config, JSON.stringify({ repos: { '/r': { ide: 'cursor' } } }));
    const settings = await settingsStore.load();
    expect(settings.repos['/r']?.ides).toEqual(['cursor']);
  });

  test('toggles IDEs, keeps at least one, and makes a pick the primary', () => {
    let settings = withRepoIde(
      { theme: 'classic', defaultIde: '', repos: {}, lastTab: 'agents', logoMode: 'auto' },
      '/r',
      'cursor',
    );
    settings = toggleRepoIde(settings, '/r', 'claude-code');
    expect(ideIdsFor(settings, '/r')).toEqual(['cursor', 'claude-code']);
    settings = withRepoIde(settings, '/r', 'claude-code');
    expect(ideIdsFor(settings, '/r')).toEqual(['claude-code', 'cursor']);
    settings = toggleRepoIde(toggleRepoIde(settings, '/r', 'cursor'), '/r', 'claude-code');
    expect(ideIdsFor(settings, '/r')).toEqual(['claude-code']);
  });

  test('saves settings to config.json and what agenti remembers to state.json', async () => {
    const files = isolate();
    await settingsStore.save(SETTINGS);

    expect(await Bun.file(files.config).json()).toEqual({ theme: 'forest', logoMode: 'braille' });
    expect(await Bun.file(files.state).json()).toEqual({
      lastTab: 'mcp',
      defaultIde: 'cursor',
      repos: { '/r': { ides: ['cursor'] } },
    });
    expect(await settingsStore.load()).toEqual(SETTINGS);
  });

  test('leaves config.json alone when only state changed', async () => {
    const files = isolate();
    await settingsStore.save(SETTINGS);
    //? Backdate the file: any rewrite, even of identical bytes, would move its mtime to now.
    const past = new Date('2020-01-01T00:00:00Z');
    utimesSync(files.config, past, past);

    await settingsStore.save({ ...SETTINGS, lastTab: 'skills' });

    expect(statSync(files.config).mtime.getTime()).toBe(past.getTime());
    expect((await settingsStore.load()).lastTab).toBe('skills');
  });

  test('migrates state keys out of an old all-in-one config.json', async () => {
    const files = isolate();
    await Bun.write(files.config, JSON.stringify(SETTINGS));

    //? Before any save: read from the old file, nothing lost
    expect(await settingsStore.load()).toEqual(SETTINGS);

    await settingsStore.save(await settingsStore.load());
    expect(await Bun.file(files.config).json()).toEqual({ theme: 'forest', logoMode: 'braille' });
    expect(await settingsStore.load()).toEqual(SETTINGS);
  });
});
