import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { findProjectConfig, loadProjectPorts, mergeWatched } from './index';

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'porti-project-'));
  mkdirSync(join(root, 'app', 'src'), { recursive: true });
  writeFileSync(
    join(root, 'app', 'porti.config.ts'),
    `export default { ports: [{ port: 5173, name: 'web', description: 'Vite' }, 99999, 6006] };`,
  );
  mkdirSync(join(root, 'broken'));
  writeFileSync(join(root, 'broken', 'porti.config.ts'), 'export default { name: "no ports" };');
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('project ports', () => {
  test('finds the nearest config by walking up from a subfolder', () => {
    expect(findProjectConfig(join(root, 'app', 'src'))).toBe(join(root, 'app', 'porti.config.ts'));
  });

  test('keeps the well-formed ports with their name and description', async () => {
    const result = await loadProjectPorts(join(root, 'app', 'src'), {});

    expect(result.ports).toEqual([
      { port: 5173, name: 'web', description: 'Vite' },
      { port: 6006 },
    ]);
  });

  test('reads the project the environment names, wherever porti was started', async () => {
    const result = await loadProjectPorts(root, { PORTI_PROJECT_DIR: join(root, 'app') });

    expect(result.ports.map((entry) => entry.port)).toEqual([5173, 6006]);
  });

  test('reports a config without a ports list instead of watching the defaults', async () => {
    const result = await loadProjectPorts(join(root, 'broken'), {});

    expect(result.ports).toEqual([]);
    expect(result.error).toContain('ports');
  });

  test("labels a shared port the project's way, keeping the user's own ports", () => {
    const merged = mergeWatched(
      [
        { port: 4200, name: 'Angular / Nx' },
        { port: 3000, name: 'mine' },
      ],
      [{ port: 4200, name: 'fe-web', description: 'Storefront' }],
    );

    expect(merged).toEqual([
      { port: 3000, name: 'mine' },
      { port: 4200, name: 'fe-web', description: 'Storefront' },
    ]);
  });

  test("keeps the user's name for a project port the project left unnamed", () => {
    expect(mergeWatched([{ port: 6006, name: 'mine' }], [{ port: 6006 }])).toEqual([
      { port: 6006, name: 'mine' },
    ]);
  });
});
