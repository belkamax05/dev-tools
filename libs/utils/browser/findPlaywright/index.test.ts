import { expect, test } from 'bun:test';

import { findPlaywright } from '.';

const resolver = (found: Record<string, string>) => (name: string) => {
  const path = found[name];
  if (!path) throw new Error(`Cannot find ${name}`);
  return path;
};

test('playwright first, then playwright-core', () => {
  expect(
    findPlaywright(
      '/p',
      resolver({ 'playwright-core': '/p/node_modules/playwright-core/index.mjs' }),
    ),
  ).toBe('/p/node_modules/playwright-core/index.mjs');
  expect(
    findPlaywright(
      '/p',
      resolver({
        playwright: '/p/node_modules/playwright/index.mjs',
        'playwright-core': '/p/node_modules/playwright-core/index.mjs',
      }),
    ),
  ).toBe('/p/node_modules/playwright/index.mjs');
});

test('nothing, or only an auto-install cache hit, is undefined', () => {
  expect(findPlaywright('/p', resolver({}))).toBeUndefined();
  expect(
    findPlaywright(
      '/tmp',
      resolver({ playwright: '/home/u/.bun/install/cache/playwright/index.mjs' }),
    ),
  ).toBeUndefined();
});
