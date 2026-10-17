import { expect, test } from 'bun:test';

import { createRasterCanvas, encodeKittyImage } from '@/dev-tools/terminal-canvas';

import { drawFrame } from './drawFrame';

test('the translucent fill reaches the pixel border without spilling outside its outline', () => {
  const canvas = createRasterCanvas(200, 100);
  drawFrame(canvas, {
    color: '#20c060',
    opacity: 0.2,
    cellWidth: 10,
    cellHeight: 20,
    tee: 10,
    joinTop: true,
    joinBottom: true,
  });
  const alpha = (x: number, y: number) => canvas.rgba[(y * canvas.width + x) * 4 + 3];
  expect(alpha(0, 50)).toBe(0);
  expect(alpha(4, 50)).toBe(0);
  expect(alpha(5, 50)).toBe(255);
  expect(alpha(6, 50)).toBe(255);
  expect(alpha(7, 50)).toBe(51);
  expect(alpha(100, 50)).toBe(51);
  expect(alpha(5, 10)).toBe(0);
  expect(alpha(100, 0)).toBe(0);
  expect(alpha(104, 0)).toBe(255);
  expect(alpha(104, 99)).toBe(255);
});

test('the frame protocol places graphics behind text without advancing the cursor', () => {
  const encoded = encodeKittyImage(new Uint8Array(16), 2, 2, {
    id: 123,
    cols: 1,
    rows: 1,
    zIndex: -1,
    preserveCursor: true,
  });
  expect(encoded).toContain('z=-1');
  expect(encoded).toContain('C=1');
  expect(encoded).toContain('i=123');
});
