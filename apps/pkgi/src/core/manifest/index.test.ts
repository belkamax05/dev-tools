import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  addCommand,
  auditCommand,
  clearCacheCommand,
  detectPackageManager,
  findLockfile,
  installCommand,
  parsePackageManagerField,
  readManifest,
  removeCommand,
  runScriptCommand,
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

  test('packageManager outranks a lockfile beside it, and carries its version and root', async () => {
    write('package-lock.json', '');
    write('package.json', { packageManager: 'bun@1.4.2' });
    write('apps/web/package.json', {});
    expect(await detectPackageManager(join(root, 'apps/web'))).toMatchObject({
      name: 'bun',
      version: '1.4.2',
      root,
    });
  });

  test('parsePackageManagerField drops the integrity hash and ignores unknown managers', () => {
    expect(parsePackageManagerField('pnpm@9.1.0+sha512.abc')).toEqual({
      name: 'pnpm',
      version: '9.1.0',
    });
    expect(parsePackageManagerField('deno@2.0.0')).toBeUndefined();
    expect(parsePackageManagerField(undefined)).toBeUndefined();
  });

  test('findLockfile only sees the given manager’s lockfile', () => {
    write('yarn.lock', '');
    expect(findLockfile(root, 'bun')).toBeUndefined();
    write('bun.lockb', '');
    expect(findLockfile(root, 'bun')).toBe(join(root, 'bun.lockb'));
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

  test('install: plain, or frozen to the lockfile in each manager’s own words', () => {
    expect(installCommand('bun')).toEqual(['bun', 'install']);
    expect(installCommand('bun', { frozen: true })).toEqual([
      'bun',
      'install',
      '--frozen-lockfile',
    ]);
    expect(installCommand('npm', { frozen: true })).toEqual(['npm', 'ci']);
    expect(installCommand('pnpm', { frozen: true })).toEqual([
      'pnpm',
      'install',
      '--frozen-lockfile',
    ]);
    expect(installCommand('yarn', { frozen: true, version: '1.22.22' })).toEqual([
      'yarn',
      'install',
      '--frozen-lockfile',
    ]);
    expect(installCommand('yarn', { frozen: true, version: '4.5.0' })).toEqual([
      'yarn',
      'install',
      '--immutable',
    ]);
    write('.yarnrc.yml', '');
    expect(installCommand('yarn', { frozen: true, dir: root })).toEqual([
      'yarn',
      'install',
      '--immutable',
    ]);
  });

  test('shellQuote leaves plain words alone and quotes the rest', () => {
    expect(shellQuote(['bun', 'add', 'react@^19.3.0'])).toBe('bun add react@^19.3.0');
    expect(shellQuote(['cd', "/tmp/it's here"])).toBe(`cd '/tmp/it'\\''s here'`);
  });
});

describe('script, audit and cache commands', () => {
  test('runScriptCommand passes arguments through, behind -- for npm alone', () => {
    expect(runScriptCommand('bun', 'test', ['--coverage'])).toEqual(['bun', 'run', 'test', '--coverage']);
    expect(runScriptCommand('npm', 'test', ['--coverage'])).toEqual([
      'npm',
      'run',
      'test',
      '--',
      '--coverage',
    ]);
    expect(runScriptCommand('npm', 'build')).toEqual(['npm', 'run', 'build']);
  });

  test('auditCommand moves under `yarn npm` for Yarn Berry', () => {
    expect(auditCommand('pnpm')).toEqual(['pnpm', 'audit']);
    expect(auditCommand('yarn', { version: '1.22.22' })).toEqual(['yarn', 'audit']);
    expect(auditCommand('yarn', { version: '4.5.0' })).toEqual(['yarn', 'npm', 'audit']);
  });

  test('clearCacheCommand per manager', () => {
    expect(clearCacheCommand('bun')).toEqual(['bun', 'pm', 'cache', 'rm']);
    expect(clearCacheCommand('npm')).toEqual(['npm', 'cache', 'clean', '--force']);
    expect(clearCacheCommand('pnpm')).toEqual(['pnpm', 'store', 'prune']);
  });
});
