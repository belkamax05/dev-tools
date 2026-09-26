import { describe, expect, test } from 'bun:test';

import {
  createBrailleCanvas,
  createRasterCanvas,
  decodePng,
  type GraphicsSupport,
} from '@/dev-tools/terminal-canvas';

import { IDES, logoPath } from '../../core/ides';
import { loadLogo, resolveLogoTechnique } from '.';

const support = (kitty: boolean): GraphicsSupport => ({
  kitty,
  sixel: false,
  iterm2: false,
  truecolor: true,
  cellWidth: 10,
  cellHeight: 20,
  cellSizeSource: 'assumed',
  terminal: 'test',
  method: 'env',
});

describe('IDE logos', () => {
  test.each(
    IDES.map((ide) => [ide.id, ide] as const),
  )('%s has a 512px transparent PNG', async (_id, ide) => {
    const image = decodePng(new Uint8Array(await Bun.file(logoPath(ide)).arrayBuffer()));
    expect([image.width, image.height]).toEqual([512, 512]);
    //? The corners are background on every logo, so they must be see-through —
    //? an opaque one would draw a box around the mark under kitty
    expect(image.rgba[3]).toBe(0);
    expect(image.rgba[image.rgba.length - 1]).toBe(0);
  });

  test('keep their transparency on a raster canvas, and draw something in braille', async () => {
    const ide = IDES.find((candidate) => candidate.id === 'cursor');
    const subject = ide && (await loadLogo(ide));
    if (!subject) throw new Error('no cursor logo');

    const raster = createRasterCanvas(64, 64);
    subject.draw(raster, 0);
    expect(raster.rgba[3]).toBe(0); // corner stays transparent
    //? Cursor's mark is black; it has to come out tinted, or a dark terminal
    //? shows nothing. (Not the centre pixel: the mark is a hexagon with a cut-out.)
    const opaque = [...new Array(64 * 64).keys()].find((p) => (raster.rgba[p * 4 + 3] ?? 0) > 200);
    expect(opaque).toBeDefined();
    expect(raster.rgba[(opaque ?? 0) * 4]).toBeGreaterThan(150);

    const braille = createBrailleCanvas(8, 4);
    braille.clear(0, 0, 0);
    subject.draw(braille, 0);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI colour codes
    expect(braille.render().replace(/\u001B\[[0-9;]*m|⠀|\s/g, '')).not.toBe('');
  });

  test('auto picks kitty, then braille, then ascii', () => {
    const lang = process.env.LANG;
    const lcAll = process.env.LC_ALL;
    try {
      process.env.LC_ALL = '';
      process.env.LANG = 'en_US.UTF-8';
      expect(resolveLogoTechnique('auto', support(true)).id).toBe('kitty');
      expect(resolveLogoTechnique('auto', support(false)).id).toBe('braille');
      process.env.LANG = 'C';
      expect(resolveLogoTechnique('auto', support(false)).id).toBe('ascii');
      expect(resolveLogoTechnique('kitty', support(false)).id).toBe('kitty');
    } finally {
      process.env.LANG = lang;
      process.env.LC_ALL = lcAll;
    }
  });
});
