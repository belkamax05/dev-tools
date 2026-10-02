import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadWorkspaceList, workspaceListPath } from '.';

const list = (url: string) => JSON.stringify({ bookmarks: [url], groups: [] });

describe('the workspace list', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'bmi-workspace-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('without a file anywhere, points at config/ and lists nothing', async () => {
    const path = await workspaceListPath({ BMI_WORKSPACE_ROOT: root });
    expect(path).toBe(join(root, 'config', 'bookmarks.config.json'));
    const result = await loadWorkspaceList(path);
    expect(result.exists).toBe(false);
    expect(result.list).toEqual({ bookmarks: [], groups: [] });
  });

  test('reads config/bookmarks.config.json when the root has none', async () => {
    mkdirSync(join(root, 'config'));
    writeFileSync(join(root, 'config', 'bookmarks.config.json'), list('config.example'));
    const result = await loadWorkspaceList(await workspaceListPath({ BMI_WORKSPACE_ROOT: root }));
    expect(result.exists).toBe(true);
    expect(result.list.bookmarks[0]?.url).toBe('https://config.example/');
  });

  test('the root file wins, and is the only one read', async () => {
    mkdirSync(join(root, 'config'));
    writeFileSync(join(root, 'config', 'bookmarks.config.json'), list('config.example'));
    writeFileSync(join(root, 'bookmarks.config.json'), list('root.example'));
    const result = await loadWorkspaceList(await workspaceListPath({ BMI_WORKSPACE_ROOT: root }));
    expect(result.path).toBe(join(root, 'bookmarks.config.json'));
    expect(result.list.bookmarks.map((page) => page.url)).toEqual(['https://root.example/']);
  });

  test('BMI_WORKSPACE_FILE names the file outright', async () => {
    const file = join(root, 'elsewhere.json');
    expect(await workspaceListPath({ BMI_WORKSPACE_ROOT: root, BMI_WORKSPACE_FILE: file })).toBe(
      file,
    );
  });

  test('an unreadable file is reported, not thrown', async () => {
    writeFileSync(join(root, 'bookmarks.config.json'), '{ nope');
    const result = await loadWorkspaceList(await workspaceListPath({ BMI_WORKSPACE_ROOT: root }));
    expect(result.exists).toBe(true);
    expect(result.error).toBeString();
  });
});
