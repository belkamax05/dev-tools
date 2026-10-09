import { describe, expect, test } from 'bun:test';

import { getCliPackageInfo, getPackageInfo, repositoryWebUrl } from './index';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('repositoryWebUrl', () => {
  test('turns every package.json spelling into a page', () => {
    expect(repositoryWebUrl('github:vercel/next.js')).toBe('https://github.com/vercel/next.js');
    expect(repositoryWebUrl('gitlab:a/b')).toBe('https://gitlab.com/a/b');
    expect(repositoryWebUrl('facebook/react')).toBe('https://github.com/facebook/react');
    expect(repositoryWebUrl('git+https://github.com/facebook/react.git')).toBe(
      'https://github.com/facebook/react',
    );
    expect(repositoryWebUrl('git+ssh://git@github.com/a/b.git')).toBe('https://github.com/a/b');
    expect(repositoryWebUrl('git://github.com/a/b.git')).toBe('https://github.com/a/b');
    expect(repositoryWebUrl('git@github.com:a/b.git')).toBe('https://github.com/a/b');
    expect(repositoryWebUrl('https://github.com/a/b.git#main')).toBe('https://github.com/a/b');
  });

  test('gives up on what is not a web page', () => {
    expect(repositoryWebUrl('file:../local')).toBeUndefined();
  });
});

const cliOptions = {
  registry: 'https://registry.npmjs.org',
  maxAgeMs: 60000,
  cwd: '/project',
  packageManager: 'bun' as const,
};

test('CLI fallback uses project config, preferred tool, latest and prerelease tags', async () => {
  const commands: string[][] = [];
  const info = await getCliPackageInfo('@scope/pkg', cliOptions, async (command, cwd) => {
    commands.push(command);
    expect(cwd).toBe('/project');
    return { latest: '2.0.0', next: '3.0.0-beta.1', invalid: 123 };
  });
  expect(commands).toEqual([['bun', 'info', '@scope/pkg', 'dist-tags', '--json']]);
  expect(info?.latest).toBe('2.0.0');
  expect(info?.next).toBe('3.0.0-beta.1');
  expect(info?.error).toBeUndefined();
});

test('missing or malformed first CLI tries the other; explicit registry is preserved', async () => {
  const commands: string[][] = [];
  const info = await getCliPackageInfo(
    'x',
    { ...cliOptions, registry: 'https://custom.example' },
    async (command) => {
      commands.push(command);
      if (command[0] === 'bun') throw new Error('not installed');
      return { latest: '1.2.3' };
    },
  );
  expect(commands.map((command) => command[0])).toEqual(['bun', 'npm']);
  expect(commands.every((command) => command.includes('--registry=https://custom.example'))).toBe(
    true,
  );
  expect(info?.latest).toBe('1.2.3');
  let calls = 0;
  expect(
    await getCliPackageInfo('x', cliOptions, async () => {
      calls++;
      return { error: 'unauthorized' };
    }),
  ).toBeUndefined();
  expect(calls).toBe(2);
  expect(
    await getCliPackageInfo('--bad-option', cliOptions, async () => {
      throw new Error('must not run');
    }),
  ).toBeUndefined();
});

test.skipIf(!Bun.which('npm'))(
  'HTTP auth failure recovers via npm project credentials and caches per project',
  async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'pkgi-cli-'));
    const other = await mkdtemp(join(tmpdir(), 'pkgi-cli-other-'));
    let requests = 0;
    let authenticated = 0;
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        requests++;
        if (request.headers.get('authorization') !== 'Bearer pkgi-test-token')
          return new Response('unauthorized', { status: 401 });
        authenticated++;
        return Response.json({
          name: 'pkgi-cli-test',
          'dist-tags': { latest: '2.1.0', next: '3.0.0-beta.1' },
          versions: { '2.1.0': { name: 'pkgi-cli-test', version: '2.1.0' } },
        });
      },
    });
    const registry = `http://localhost:${server.port}`;
    try {
      await writeFile(
        join(cwd, '.npmrc'),
        `//localhost:${server.port}/:_authToken=pkgi-test-token\n`,
      );
      const options = { registry, cwd, packageManager: 'npm' as const, maxAgeMs: 60000 };
      const info = await getPackageInfo('pkgi-cli-test', options);
      expect(info.latest).toBe('2.1.0');
      expect(info.next).toBe('3.0.0-beta.1');
      expect(info.error).toBeUndefined();
      expect(authenticated).toBeGreaterThan(0);
      const previous = requests;
      expect((await getPackageInfo('pkgi-cli-test', options)).latest).toBe('2.1.0');
      expect(requests).toBe(previous);
      expect((await getPackageInfo('pkgi-cli-test', { ...options, force: true })).latest).toBe(
        '2.1.0',
      );
      expect(requests).toBeGreaterThan(previous);
      const unresolved = await getPackageInfo('pkgi-cli-test', { ...options, cwd: other });
      expect(unresolved.latest).toBeUndefined();
      expect(unresolved.error).toBeDefined();
    } finally {
      server.stop(true);
      await Promise.all([
        rm(cwd, { recursive: true, force: true }),
        rm(other, { recursive: true, force: true }),
      ]);
    }
  },
);
