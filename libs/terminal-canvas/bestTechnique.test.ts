import { afterEach, describe, expect, test } from 'bun:test';
import type { GraphicsSupport } from './detectGraphicsSupport.ts';
import { autoTechnique, bestTechnique, setPreferredTechnique } from './techniques.ts';

const support = (over: Partial<GraphicsSupport>): GraphicsSupport => ({
  kitty: false,
  sixel: false,
  iterm2: false,
  truecolor: true,
  imagesInCells: false,
  cellWidth: 10,
  cellHeight: 20,
  cellSizeSource: 'assumed',
  terminal: 'test',
  method: 'env',
  ...over,
});

describe('bestTechnique', () => {
  afterEach(() => {
    delete process.env.DEV_TOOLS_GRAPHICS;
    setPreferredTechnique(undefined);
  });

  test('kitty where a kitty terminal offers it', () => {
    expect(bestTechnique(support({ kitty: true, sixel: true })).id).toBe('kitty');
  });

  test('kitty on xterm.js too, when it answers the kitty query', () => {
    expect(bestTechnique(support({ kitty: true, sixel: true, imagesInCells: true })).id).toBe('kitty');
  });

  test('half-blocks without any raster protocol', () => {
    expect(bestTechnique(support({})).id).toBe('halfblock');
  });

  test('DEV_TOOLS_GRAPHICS picks one by hand', () => {
    process.env.DEV_TOOLS_GRAPHICS = 'kitty';
    expect(bestTechnique(support({ kitty: true, sixel: true, imagesInCells: true })).id).toBe('kitty');
    process.env.DEV_TOOLS_GRAPHICS = 'halfblock';
    expect(bestTechnique(support({ kitty: true, sixel: true })).id).toBe('halfblock');
  });

  test('…but cannot force a protocol the terminal does not speak', () => {
    process.env.DEV_TOOLS_GRAPHICS = 'iterm2';
    expect(bestTechnique(support({ kitty: true })).id).toBe('kitty');
  });

  test("an app's setting picks one, and DEV_TOOLS_GRAPHICS still wins over it", () => {
    const vscode = support({ kitty: true, sixel: true, imagesInCells: true });
    setPreferredTechnique('sixel');
    expect(bestTechnique(vscode).id).toBe('sixel');
    expect(autoTechnique(vscode).id).toBe('kitty');
    process.env.DEV_TOOLS_GRAPHICS = 'halfblock';
    expect(bestTechnique(vscode).id).toBe('halfblock');
  });
});
