import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  addCommand,
  detectPackageManager,
  readManifest,
  removeCommand,
  setVersionCommand,
  shellQuote,
} from './index';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pkgi-manifest-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const write = (path: string, value: unknown) => {
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value));
};

describe('readManifest', () => {
  test('lists each section and finds hoisted installs in a parent node_modules', async () => {
    write('app/package.json', {
      dependencies: { react: '^19.0.0', shared: 'workspace:*' },
      devDependencies: { vitest: '4.1.0' },
    });
    write('node_modules/react/package.json', { version: '19.2.1' });
    const manifest = await readManifest(join(root, 'app'));
    expect(manifest.dependencies).toEqual([
      { name: 'react', range: '^19.0.0', type: 'dependencies', local: false, installed: '19.2.1' },
      {
        name: 'shared',
        range: 'workspace:*',
        type: 'dependencies',
        local: true,
        installed: undefined,
      },
      {
        name: 'vitest',
        range: '4.1.0',
        type: 'devDependencies',
        local: false,
        installed: undefined,
      },
    ]);
  });

  test('a folder without package.json says so rather than throwing', async () => {
    expect(await readManifest(root)).toMatchObject({ exists: false, dependencies: [] });
  });
});

describe('detectPackageManager', () => {
  test('the nearest lockfile wins, up to the workspace root', async () => {
    write('bun.lock', '');
    write('apps/web/package.json', {});
    expect((await detectPackageManager(join(root, 'apps/web'))).name).toBe('bun');
  });

  test('a forced one wins over the lockfile', async () => {
    write('yarn.lock', '');
    expect((await detectPackageManager(root, 'pnpm')).name).toBe('pnpm');
  });
});

describe('commands', () => {
  test('an update keeps the range style and the section', () => {
    expect(setVersionCommand('bun', 'react', '19.3.0', 'dependencies', '^19.1.0')).toEqual([
      'bun',
      'add',
      'react@^19.3.0',
    ]);
    expect(setVersionCommand('npm', 'vitest', '4.2.0', 'devDependencies', '4.1.0')).toEqual([
      'npm',
      'install',
      'vitest@4.2.0',
      '--save-dev',
      '--save-exact',
    ]);
    expect(setVersionCommand('pnpm', 'x', '2.0.0', 'peerDependencies', '~1.0.0')).toEqual([
      'pnpm',
      'add',
      'x@~2.0.0',
      '--save-peer',
    ]);
  });

  test('add and remove', () => {
    expect(addCommand('yarn', '@types/node', undefined, 'devDependencies')).toEqual([
      'yarn',
      'add',
      '@types/node',
      '--dev',
    ]);
    expect(removeCommand('bun', ['a', 'b'])).toEqual(['bun', 'remove', 'a', 'b']);
  });

  test('shellQuote leaves plain words alone and quotes the rest', () => {
    expect(shellQuote(['bun', 'add', 'react@^19.3.0'])).toBe('bun add react@^19.3.0');
    expect(shellQuote(['cd', "/tmp/it's here"])).toBe(`cd '/tmp/it'\\''s here'`);
  });
});
