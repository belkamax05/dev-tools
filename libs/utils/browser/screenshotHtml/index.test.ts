import { expect, test } from 'bun:test';

import { pickRenderer } from '.';

const chrome = { name: 'google-chrome', bin: '/usr/bin/google-chrome' };
const PW = '/p/node_modules/playwright/index.mjs';

test('auto prefers an installed Chromium, then Playwright', () => {
  expect(pickRenderer('auto', { browsers: [chrome], playwright: PW })).toBe('chrome');
  expect(pickRenderer('auto', { browsers: [], playwright: PW })).toBe('playwright');
});

test('an explicit renderer is used when installed', () => {
  expect(pickRenderer('playwright', { browsers: [chrome], playwright: PW })).toBe('playwright');
  expect(pickRenderer('chrome', { browsers: [chrome], playwright: undefined })).toBe('chrome');
});

test('nothing installed, or not the one asked for, throws with how to get one', () => {
  expect(() => pickRenderer('auto', { browsers: [], playwright: undefined })).toThrow(
    /No browser to render with/,
  );
  expect(() => pickRenderer('playwright', { browsers: [chrome], playwright: undefined })).toThrow(
    /bun add -d playwright/,
  );
  expect(() => pickRenderer('chrome', { browsers: [], playwright: PW })).toThrow(/Chromium-family/);
});
