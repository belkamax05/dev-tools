import { expect, test } from 'bun:test';

import { graphicsSupport } from '@/dev-tools/terminal-canvas';

import { supportsJobFrame } from '.';

test('VSCode-derived terminals keep the text frame even when Kitty graphics are available', () => {
  const previous = process.env.DEV_TOOLS_GRAPHICS;
  process.env.DEV_TOOLS_GRAPHICS = 'kitty';
  try {
    const support = { ...graphicsSupport(), kitty: true };
    for (const terminal of ['vscode', 'Devin', 'Antigravity']) {
      expect(supportsJobFrame({ ...support, terminal, imagesInCells: true })).toBe(false);
    }
    expect(supportsJobFrame({ ...support, terminal: 'kitty', imagesInCells: false })).toBe(true);
  } finally {
    if (previous === undefined) delete process.env.DEV_TOOLS_GRAPHICS;
    else process.env.DEV_TOOLS_GRAPHICS = previous;
  }
});
