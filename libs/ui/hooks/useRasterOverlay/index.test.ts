import { describe, expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import { Box, type DOMElement, render } from 'ink';
import { createElement, useRef, useState } from 'react';

import { noteScreenErased } from '../../terminal/frames';
import { isFullyVisible, useRasterOverlay } from '.';

/** Just enough of an Ink node for `measureElement`: a Yoga box, a style, a parent. */
const node = (
  box: { left: number; top: number; width: number; height: number },
  style: Record<string, unknown> = {},
  parentNode?: DOMElement,
) =>
  ({
    style,
    parentNode,
    yogaNode: {
      getComputedLeft: () => box.left,
      getComputedTop: () => box.top,
      getComputedWidth: () => box.width,
      getComputedHeight: () => box.height,
    },
  }) as unknown as DOMElement;

const screen = { columns: 100, rows: 30 };

describe('isFullyVisible', () => {
  //? A framed, clipping panel at (10, 5), 40 × 12: its inside is rows 6–15
  const panel = node({ left: 10, top: 5, width: 40, height: 12 }, { overflow: 'hidden', borderStyle: 'round' });
  const image = node({ left: 2, top: 2, width: 20, height: 6 }, {}, panel);

  test('an image inside its panel is drawn', () => {
    expect(isFullyVisible(image, { x: 12, y: 7, width: 20, height: 6 }, screen)).toBe(true);
  });

  test('one reaching past the bottom of a clipping panel is not', () => {
    expect(isFullyVisible(image, { x: 12, y: 12, width: 20, height: 6 }, screen)).toBe(false);
  });

  test('the border is not room for it', () => {
    //? Rows 6–16 would touch the bottom border on row 16
    expect(isFullyVisible(image, { x: 12, y: 6, width: 20, height: 11 }, screen)).toBe(false);
  });

  test('past the last row of the terminal is never drawn, clipping or not', () => {
    const loose = node({ left: 0, top: 25, width: 20, height: 8 });
    expect(isFullyVisible(loose, { x: 0, y: 25, width: 20, height: 8 }, screen)).toBe(false);
  });

  test('a box that does not clip does not limit it', () => {
    const open = node({ left: 0, top: 0, width: 5, height: 2 });
    const inside = node({ left: 0, top: 0, width: 20, height: 8 }, {}, open);
    expect(isFullyVisible(inside, { x: 0, y: 0, width: 20, height: 8 }, screen)).toBe(true);
  });
});

describe('painting on a terminal that keeps images in its cells', () => {
  const IMAGE = '<IMAGE>';
  const technique = {
    id: 'fake-sixel',
    label: 'fake',
    note: '',
    kind: 'raster' as const,
    supported: () => true,
    scalesToCellBox: false,
    encode: () => IMAGE,
  };
  const subject = { id: 'card', label: 'card', note: '', animated: false, draw: () => {} };
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  /** Render a picture over `renders` re-renders that change nothing about it; what was sent? */
  const sends = async (imagesInCells: boolean, { erase = false } = {}) => {
    let bump: (next: number) => void = () => {};
    const Card = () => {
      const ref = useRef(null);
      const [, setTick] = useState(0);
      bump = setTick;
      useRasterOverlay({
        technique,
        subject,
        time: 0,
        animating: false,
        target: ref,
        cellWidth: 10,
        cellHeight: 20,
        imagesInCells,
        imageId: 1,
      });
      return createElement(Box, { ref, width: 10, height: 4 });
    };
    const stdout = Object.assign(new PassThrough(), { columns: 80, rows: 24, isTTY: true });
    let written = '';
    stdout.on('data', (chunk: Buffer) => {
      written += chunk.toString();
    });
    const app = render(createElement(Card), {
      stdout: stdout as unknown as NodeJS.WriteStream,
      patchConsole: false,
    });
    for (let tick = 1; tick <= 12; tick += 1) {
      if (erase && tick === 8) noteScreenErased();
      bump(tick);
      await wait(70);
    }
    app.unmount();
    return written.split(IMAGE).length - 1;
  };

  test('is sent once, not on every re-render — a hover must not replace it', async () => {
    expect(await sends(true)).toBe(1);
  });

  test('is sent again once the screen has been erased', async () => {
    expect(await sends(true, { erase: true })).toBe(2);
  });

  test('a kitty terminal, which replaces by id, is still sent it every time', async () => {
    expect(await sends(false)).toBeGreaterThan(5);
  });

  test('a picture that moves is cleared by leaving the alternate screen and coming back', async () => {
    let bump: (next: number) => void = () => {};
    const Card = () => {
      const ref = useRef(null);
      const [tick, setTick] = useState(0);
      bump = setTick;
      useRasterOverlay({
        technique,
        subject,
        time: 0,
        animating: false,
        target: ref,
        cellWidth: 10,
        cellHeight: 20,
        imagesInCells: true,
        imageId: 1,
      });
      return createElement(
        Box,
        { flexDirection: 'column', marginTop: tick >= 3 ? 2 : 0 },
        createElement(Box, { ref, width: 10, height: 4 }),
      );
    };
    const stdout = Object.assign(new PassThrough(), { columns: 80, rows: 24, isTTY: true });
    let written = '';
    stdout.on('data', (chunk: Buffer) => {
      written += chunk.toString();
    });
    const app = render(createElement(Card), {
      stdout: stdout as unknown as NodeJS.WriteStream,
      patchConsole: false,
    });
    for (let tick = 1; tick <= 6; tick += 1) {
      bump(tick);
      await wait(120);
    }
    app.unmount();
    const forget = '\u001B[?1049l\u001B[?1049h\u001B[2J\u001B[H';
    expect(written).toContain(forget);
    //? …and the picture is drawn again after it, at its new place
    expect(written.slice(written.indexOf(forget))).toContain(IMAGE);
  });
});
