import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ideIdsFor, settingsStore, toggleRepoIde, withRepoIde } from '.';

describe('settings', () => {
  test('reads the old single-IDE shape as a list of one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agenti-settings-'));
    process.env.XDG_CONFIG_HOME = dir;
    await Bun.write(
      `${dir}/agenti/config.json`,
      JSON.stringify({ repos: { '/r': { ide: 'cursor' } } }),
    );
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
});
