import { expect, test } from 'bun:test';

import { decodePng } from '@/dev-tools/terminal-canvas';

import { fitImage } from './fitImage';

test('tall artwork keeps its aspect ratio and gets transparent padding', () => {
  const image = { width: 2, height: 4, rgba: new Uint8Array(2 * 4 * 4).fill(255) };
  const fitted = fitImage(image, 8, 8);
  const alpha = (x: number, y: number) => fitted.rgba[(y * fitted.width + x) * 4 + 3];
  expect(alpha(0, 4)).toBe(0);
  expect(alpha(1, 4)).toBe(0);
  expect(alpha(2, 4)).toBe(255);
  expect(alpha(5, 4)).toBe(255);
  expect(alpha(6, 4)).toBe(0);
});

test('the bundled GitHub logo has a transparent background', async () => {
  const image = decodePng(await Bun.file(new URL('./assets/github.png', import.meta.url)).bytes());
  expect(image.rgba[3]).toBe(0);
  expect(Array.from(image.rgba).filter((_, at) => at % 4 === 3)).toContain(255);
});
