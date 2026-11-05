import { expect, test } from 'bun:test';

import { findBrowsers } from '.';

const deps = (onPath: Record<string, string>, files: string[] = Object.values(onPath)) => ({
  which: (command: string) => onPath[command] ?? null,
  exists: (path: string) => files.includes(path),
  realpath: (path: string) => path.replace('-stable', ''),
  env: {},
});

test('PATH commands, in preference order', () => {
  expect(
    findBrowsers(
      deps({ chromium: '/usr/bin/chromium', 'google-chrome': '/usr/bin/google-chrome' }),
    ),
  ).toEqual([
    { name: 'google-chrome', bin: '/usr/bin/google-chrome' },
    { name: 'chromium', bin: '/usr/bin/chromium' },
  ]);
});

test('$CHROME_PATH first, and one executable is listed once', () => {
  const found = findBrowsers({
    ...deps({ 'google-chrome': '/nix/chrome', 'google-chrome-stable': '/nix/chrome-stable' }, [
      '/nix/chrome',
      '/nix/chrome-stable',
      '/opt/custom',
    ]),
    env: { CHROME_PATH: '/opt/custom' },
  });
  expect(found).toEqual([
    { name: '$CHROME_PATH', bin: '/opt/custom' },
    { name: 'google-chrome', bin: '/nix/chrome' },
  ]);
});

test('a $CHROME_PATH that does not exist is skipped', () => {
  expect(findBrowsers({ ...deps({}), env: { CHROME_PATH: '/missing' } })).toEqual([]);
});
