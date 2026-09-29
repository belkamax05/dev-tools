import { describe, expect, test } from 'bun:test';

import {
  parseBunLock,
  parseNpmLock,
  parsePnpmLock,
  parseYarnLock,
  registryTarballUrl,
} from './index';

const SHA = 'sha512-AAAA';

describe('registryTarballUrl', () => {
  test('a scoped name keeps its scope in the path, not in the file name', () => {
    expect(registryTarballUrl('@types/bun', '1.3.14')).toBe(
      'https://registry.npmjs.org/@types/bun/-/bun-1.3.14.tgz',
    );
    expect(registryTarballUrl('ink', '7.1.1', 'https://npm.example/')).toBe(
      'https://npm.example/ink/-/ink-7.1.1.tgz',
    );
  });
});

describe('parseBunLock', () => {
  const lock = `{
    "lockfileVersion": 1,
    "workspaces": { "": { "name": "root" }, "apps/web": { "name": "web" }, },
    "packages": {
      "ink": ["ink@7.1.1", "", {}, "${SHA}"],
      "web": ["web@workspace:apps/web"],
      "@types/bun": ["@types/bun@1.3.14", "", {}, "${SHA}"],
      "x/ink": ["ink@7.1.1", "", {}, "${SHA}"],
      "gitdep": ["gitdep@github:a/b#abc", {}, "abc"],
    },
  }`;

  test('registry packages once each, workspaces by path, anything else reported', () => {
    const contents = parseBunLock(lock);
    expect(contents.workspaces).toEqual(['', 'apps/web']);
    expect(contents.tarballs.map((t) => t.url)).toEqual([
      'https://registry.npmjs.org/@types/bun/-/bun-1.3.14.tgz',
      'https://registry.npmjs.org/ink/-/ink-7.1.1.tgz',
    ]);
    expect(contents.unsupported).toEqual(['gitdep: gitdep@github:a/b#abc']);
  });
});

describe('parseNpmLock', () => {
  const lock = JSON.stringify({
    lockfileVersion: 3,
    packages: {
      '': { name: 'root' },
      'packages/a': { name: 'a' },
      'node_modules/a': { resolved: 'packages/a', link: true },
      'node_modules/react': {
        version: '19.2.8',
        resolved: 'https://registry.npmjs.org/react/-/react-19.2.8.tgz',
        integrity: SHA,
      },
      'node_modules/x/node_modules/@scope/y': {
        version: '1.0.0',
        resolved: 'https://registry.npmjs.org/@scope/y/-/y-1.0.0.tgz',
        integrity: SHA,
      },
      'node_modules/g': { version: '1.0.0', resolved: 'git+ssh://git@github.com/a/g.git#abc' },
    },
  });

  test('resolved + integrity for each package, workspaces from the non-node_modules keys', () => {
    const contents = parseNpmLock(lock);
    expect(contents.workspaces).toEqual(['', 'packages/a']);
    expect(contents.tarballs.map((t) => [t.name, t.url])).toEqual([
      ['@scope/y', 'https://registry.npmjs.org/@scope/y/-/y-1.0.0.tgz'],
      ['react', 'https://registry.npmjs.org/react/-/react-19.2.8.tgz'],
    ]);
    expect(contents.unsupported).toEqual(['node_modules/g: git+ssh://git@github.com/a/g.git#abc']);
  });

  test('a v1 lockfile says how to fix it', () => {
    expect(() => parseNpmLock('{"lockfileVersion":1,"dependencies":{}}')).toThrow(/npm 7\+/);
  });
});

describe('parsePnpmLock', () => {
  test('v9 keys, peer suffixes dropped, importers as workspaces', () => {
    const contents = parsePnpmLock(`lockfileVersion: '9.0'
importers:
  .:
    dependencies: {}
  packages/a:
    dependencies: {}
packages:
  '@types/bun@1.3.14':
    resolution: {integrity: ${SHA}}
  ink@7.1.1(react@19.2.8):
    resolution: {integrity: ${SHA}}
  local@file:../local:
    resolution: {directory: ../local, type: directory}
`);
    expect(contents.workspaces).toEqual(['', 'packages/a']);
    expect(contents.tarballs.map((t) => t.url)).toEqual([
      'https://registry.npmjs.org/@types/bun/-/bun-1.3.14.tgz',
      'https://registry.npmjs.org/ink/-/ink-7.1.1.tgz',
    ]);
    expect(contents.unsupported).toHaveLength(1);
  });

  test('v6 keys start with a slash', () => {
    const contents = parsePnpmLock(`lockfileVersion: '6.0'
packages:
  /ink@7.1.1:
    resolution: {integrity: ${SHA}}
`);
    expect(contents.tarballs.map((t) => t.name)).toEqual(['ink']);
  });
});

describe('parseYarnLock', () => {
  test('classic blocks: resolved without its #sha1, integrity', () => {
    const contents = parseYarnLock(
      `# yarn lockfile v1


"@types/bun@^1.3.0", "@types/bun@^1.3.14":
  version "1.3.14"
  resolved "https://registry.yarnpkg.com/@types/bun/-/bun-1.3.14.tgz#deadbeef"
  integrity ${SHA}

ink@^7:
  version "7.1.1"
  resolved "https://registry.yarnpkg.com/ink/-/ink-7.1.1.tgz#cafe"
  integrity ${SHA}
`,
      ['', 'packages/a'],
    );
    expect(contents.tarballs.map((t) => [t.name, t.version, t.url])).toEqual([
      ['@types/bun', '1.3.14', 'https://registry.yarnpkg.com/@types/bun/-/bun-1.3.14.tgz'],
      ['ink', '7.1.1', 'https://registry.yarnpkg.com/ink/-/ink-7.1.1.tgz'],
    ]);
    expect(contents.workspaces).toEqual(['', 'packages/a']);
  });

  test('Yarn Berry is refused with the reason', () => {
    expect(() => parseYarnLock('__metadata:\n  version: 8\n')).toThrow(/Berry/);
  });
});
