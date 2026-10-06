import { type DOMElement, measureElement, useStdout } from 'ink';
import { type RefObject, useEffect, useRef } from 'react';
import {
  clearRasterArtifacts,
  createRasterCanvas,
  type RasterCanvas,
  type RasterTechnique,
  type Subject,
} from '../../../terminal-canvas/index.ts';
import { emitFrame, noteScreenErased, onFrame, screenErasures } from '../../terminal/frames';

const ESC = '\u001B';

/**
 * Forget every picture on screen — see `requestWipe`. Out of the alternate screen and straight back
 * in, which is the one thing xterm.js does that both deletes every image drawn there and clears its
 * image layer outright; then the erase and the cursor home the app's own entry to it starts with,
 * so Ink's redraw lands where its frame was.
 */
const FORGET_PICTURES = `${ESC}[?1049l${ESC}[?1049h${ESC}[2J${ESC}[H`;

let wipePending = false;

/**
 * Clear every cell on screen, have Ink put its text straight back, and have
 * every overlay repaint — once, however many ask in the same tick.
 *
 * Needed wherever a picture moves or goes away, because a terminal can keep an
 * image in the cells it covered rather than in a layer above them. xterm.js —
 * the terminal in VS Code and every editor built on it — does exactly that:
 * each cell holds a tile of the image, writing text over the cell keeps the
 * tile, and a tile whose image xterm.js has deleted is drawn as a grey
 * checkerboard placeholder. In VS Code those leftovers outlive the erases that
 * should take them — Ink's `EL 2` when it clears its frame, and an `ED 2` here
 * — though a browser build of the same xterm.js clears them; grey blocks
 * stayed wherever a picture had been, with sixel and kitty alike. So rather
 * than erase, the wipe leaves the alternate screen and comes back: xterm.js
 * deletes every image drawn on it and clears its whole image layer, which
 * leaves nothing to go grey. kitty removes an old placement itself, so this
 * runs only where `imagesInCells` says it is needed.
 *
 * Through Ink's `write`, not the raw stream: Ink erases its frame, lets the
 * write through and redraws the frame after it, so the text is back within the
 * same write. The pictures come back on the frame event that follows.
 */
const requestWipe = (write: (data: string) => void) => {
  if (wipePending) return;
  wipePending = true;
  setTimeout(() => {
    wipePending = false;
    noteScreenErased();
    write(FORGET_PICTURES);
    emitFrame();
  }, 0);
};

export interface CellRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const clipsY = (node: DOMElement) => node.style.overflow === 'hidden' || node.style.overflowY === 'hidden';
const clipsX = (node: DOMElement) => node.style.overflow === 'hidden' || node.style.overflowX === 'hidden';

/** The cells inside a box's border — what an `overflow: hidden` box lets its children show in. */
const innerRect = (node: DOMElement): CellRect => {
  const box = measureElement(node);
  const { style } = node;
  const framed = style.borderStyle !== undefined;
  const top = framed && style.borderTop !== false ? 1 : 0;
  const bottom = framed && style.borderBottom !== false ? 1 : 0;
  const left = framed && style.borderLeft !== false ? 1 : 0;
  const right = framed && style.borderRight !== false ? 1 : 0;
  return {
    x: box.x + left,
    y: box.y + top,
    width: Math.max(0, box.width - left - right),
    height: Math.max(0, box.height - top - bottom),
  };
};

/**
 * Whether all of `box` is on screen: inside the terminal and inside every ancestor that clips its
 * children.
 *
 * Ink clips text to an `overflow: hidden` box, but an image is written over the frame after it,
 * at the cells Yoga laid its placeholder out in — and Yoga lays a child out at the size it asked
 * for, clipped or not. So a placeholder pushed below a short panel still measures as its full
 * height, past the panel's edge and, on a short terminal, past the last row — where writing it
 * scrolls the whole screen up under the picture. An image that would not fit entirely is not
 * drawn at all: a cropped one cannot be had from any of the protocols without re-encoding.
 */
export const isFullyVisible = (
  node: DOMElement,
  box: CellRect,
  screen: { columns: number; rows: number },
): boolean => {
  if (box.x < 0 || box.y < 0) return false;
  if (box.x + box.width > screen.columns || box.y + box.height > screen.rows) return false;
  for (let current = node.parentNode; current; current = current.parentNode) {
    if (!clipsX(current) && !clipsY(current)) continue;
    const clip = innerRect(current);
    if (clipsY(current) && (box.y < clip.y || box.y + box.height > clip.y + clip.height)) {
      return false;
    }
    if (clipsX(current) && (box.x < clip.x || box.x + box.width > clip.x + clip.width)) {
      return false;
    }
  }
  return true;
};

/**
 * The terminal addresses cells from 1; Ink lays out from 0. The app owns the
 * top of the alternate screen, so that single offset is the whole conversion —
 * exactly the assumption `useClickable` makes to turn a mouse report into a
 * layout coordinate, and it holds here for the same reason.
 */
const VIEWPORT_ORIGIN = 1;

/**
 * How long to leave Ink to write its own frame before painting over it.
 *
 * Ink throttles its output — `maxFps` 30 by default, so ~34ms — on the leading
 * *and* trailing edge. That means a render's effects can run well before the
 * frame they belong to reaches the terminal, and an image written in between is
 * wiped by a frame that arrives after it. For an animated subject the next tick
 * hides the damage; for a still picture the rectangle just stays blank.
 *
 * So the write is scheduled rather than issued inline, and rescheduled by each
 * render that follows: one image per settled burst, always on top of the frame.
 *
 * How long to wait depends on whether another frame is coming. For a still
 * picture nothing will repair a wipe, so the wait has to cover Ink's trailing
 * edge whole. While an animation is running the next tick repairs it anyway,
 * and there the long wait costs far more than it buys: at 20fps it lands within
 * five milliseconds of the following render, which cancels the paint that was
 * about to happen — and a paint that costs 15ms of its own then pushes the tick
 * after that late as well. The picture comes out every second or third tick, in
 * uneven steps, which is precisely the stutter the clock was raised to remove.
 * A running clock is 50ms apart, well outside Ink's throttle window, so its
 * frames go out on the leading edge and there is nothing to wait for.
 */
const RENDER_SETTLE_MS = 45;
const ANIMATING_SETTLE_MS = 10;

/**
 * How many pixels a *moving* subject may be drawn at.
 *
 * A full-screen canvas is around 1.6 megapixels, and every one of them is a ray
 * traced in JavaScript and then base64 pushed down the pty. The write is the
 * expensive half and it scales with the payload: measured in Ghostty at a
 * 160x46 canvas, one frame costs 163ms of `stdout.write` at full resolution
 * against 24ms at this budget. That write is why the animation used to advance
 * in visible steps rather than move.
 *
 * The number is the knee of that curve, found by running the real app on this
 * tab and counting paints:
 *
 *   full res  →  4.7 fps        400k  →  12.6 fps
 *   200k      →  19.3 fps       100k  →  19.9 fps
 *
 * 200k buys essentially the whole 20fps clock, and going below it spends
 * resolution on a frame rate that is already there. kitty and iTerm2 scale the
 * buffer straight back into the same cell box, so the cost is sharpness and
 * nothing else. It is a ceiling, not a target — a small canvas is already under
 * it and is left alone.
 *
 * The obvious alternative is to send the same pixels compressed, which is worth
 * about nine tenths of the payload. It is not on the table: see the note in
 * encodeKittyImage — Ghostty segfaults on a compressed frame.
 *
 * Only for animation. A still picture is drawn and encoded once and then cached
 * for as long as it is on screen, so it can afford every pixel it is given, and
 * the moon is worth seeing at full resolution.
 */
const ANIMATED_PIXEL_BUDGET = 200_000;

/**
 * The pixel buffer a footprint of cells is actually drawn into.
 *
 * Exported because the Debug tab prints this number, and the whole point of
 * that tab is that what it says is what happened.
 */
export function rasterPixelSize(
  cols: number,
  rows: number,
  cellWidth: number,
  cellHeight: number,
  { animated, scalesToCellBox }: { animated: boolean; scalesToCellBox: boolean },
): { width: number; height: number } {
  const width = cols * cellWidth;
  const height = rows * cellHeight;
  // One device pixel per pixel is the ceiling; a moving subject gives some of
  // that back when the canvas is big, but only where the protocol will scale
  // the buffer to the cell box for us. Sixel would just come out smaller.
  const scale =
    animated && scalesToCellBox
      ? Math.min(1, Math.sqrt(ANIMATED_PIXEL_BUDGET / (width * height)))
      : 1;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export interface RasterOverlayOptions {
  /** The technique to paint with, or undefined for the text path. */
  technique: RasterTechnique | undefined;
  subject: Subject;
  time: number;
  /**
   * Whether the clock is actually running. Not the same as `subject.animated`:
   * a paused animation has to be treated as a still picture, because nothing
   * is coming along behind it to redraw what Ink wipes.
   */
  animating: boolean;
  /** The blank `<Box>` the picture is painted over. */
  target: RefObject<DOMElement | null>;
  cellWidth: number;
  cellHeight: number;
  /**
   * The terminal keeps images in cells (`GraphicsSupport.imagesInCells`): a
   * picture that moves or goes away wipes the screen, or leaves grey blocks.
   */
  imagesInCells?: boolean;
  /**
   * Which image this is, for a protocol that keeps one picture per id (kitty).
   * Leave it out for a lone image; give each its own when several share the
   * screen, or each paint replaces the last.
   */
  imageId?: number;
}

/**
 * Paint a raster protocol image over the region Ink left blank for it.
 *
 * Ink owns the frame: it measures image escapes as zero width and rewrites every
 * line it manages, so an image drawn once is erased by the next repaint. The fix
 * is to redraw *after* every render — hence an effect with no dependency array —
 * positioning the image absolutely, with a cursor save and restore either side
 * so Ink's own bookkeeping is undisturbed.
 *
 * Where the standalone demo pins its layout to fixed row counts so it can
 * hardcode the answer, this one measures. It has to: the tab it lives in sits
 * under a header and a tab strip that shed their frames on a short terminal, so
 * the canvas is not at the same row twice.
 */
export function useRasterOverlay(options: RasterOverlayOptions): void {
  const {
    technique,
    subject,
    time,
    animating,
    target,
    cellWidth,
    cellHeight,
    imagesInCells = false,
    imageId,
  } = options;
  const { stdout, write } = useStdout();

  // The framebuffer is large and the subject overwrites every pixel, so it is
  // kept across frames and only reallocated when the geometry changes.
  const canvasRef = useRef<RasterCanvas | undefined>(undefined);
  // The encoded image, and what it is an encoding of. A hover somewhere else in
  // the app re-renders the tree and erases the picture, so it has to be written
  // again — but it does not have to be drawn and encoded again, and for a
  // megabyte of base64 that is the difference between a redraw and a stall.
  const frameRef = useRef<{ key: string; image: string } | undefined>(undefined);
  // The paint the latest render set up, and the timer it is waiting on — held
  // here so a frame this component did not cause can schedule it too.
  const paintRef = useRef<(() => void) | undefined>(undefined);
  const pendingRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Where the picture was last painted, so a move can wipe what it left behind.
  const placedRef = useRef<string | undefined>(undefined);
  // What was last sent, where, and since which erase — so a terminal that keeps images in its cells
  // is not sent the same picture again (see the paint).
  const paintedRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!technique) {
      //? Or a frame after the switch to text would paint the old picture back
      paintRef.current = undefined;
      clearTimeout(pendingRef.current);
      return;
    }

    const paint = () => {
      const node = target.current;
      if (!node) return;

      // Measured, not passed in: what the caller asked for and what Yoga gave
      // it are the same number right up until they are not, and an image sized
      // from the wrong one spills over whatever is next to it.
      const { x, y, width: cols, height: rows } = measureElement(node);
      if (cols <= 0 || rows <= 0) return;

      //? Off screen or cut off by a clipping box: take down whatever was painted rather than
      //? write past the edge, which on the last row scrolls the screen
      const screen = { columns: stdout.columns ?? Infinity, rows: stdout.rows ?? Infinity };
      if (!isFullyVisible(node, { x, y, width: cols, height: rows }, screen)) {
        if (placedRef.current !== undefined) {
          stdout.write(clearRasterArtifacts(imageId));
          if (imagesInCells) requestWipe(write);
          placedRef.current = undefined;
          paintedRef.current = undefined;
        }
        return;
      }

      //? Moved or resized: the old cells may still hold the old picture. Wipe
      //? rather than paint — the frame after the wipe paints it here
      const placed = `${x},${y},${cols}x${rows}`;
      if (imagesInCells && placedRef.current !== undefined && placedRef.current !== placed) {
        placedRef.current = placed;
        requestWipe(write);
        return;
      }
      placedRef.current = placed;

      const { width, height } = rasterPixelSize(cols, rows, cellWidth, cellHeight, {
        animated: subject.animated,
        scalesToCellBox: technique.scalesToCellBox,
      });

      const key = `${technique.id}|${subject.id}|${time}|${width}x${height}|${imageId}`;
      if (frameRef.current?.key !== key) {
        const canvas = canvasRef.current;
        const raster =
          canvas && canvas.width === width && canvas.height === height
            ? canvas
            : createRasterCanvas(width, height);
        canvasRef.current = raster;

        subject.draw(raster, time);
        frameRef.current = { key, image: technique.encode(raster, cols, rows, imageId) };
      }

      //? On xterm.js a picture stays in its cells until they are erased — Ink writes changed lines
      //? over rather than erasing them — so it is sent again only after an erase, a move or a
      //? change. Sent again regardless, every re-render (a hover anywhere) replaced it, and VS
      //? Code flickers grey through every replacement. kitty proper replaces by id, harmlessly
      const painted = `${key}|${placed}|${screenErasures()}`;
      if (imagesInCells && paintedRef.current === painted) return;
      paintedRef.current = painted;
      stdout.write(
        `${ESC}7${ESC}[${y + VIEWPORT_ORIGIN};${x + VIEWPORT_ORIGIN}H${frameRef.current.image}${ESC}8`,
      );
    };

    // Each schedule cancels a write that a newer one has already superseded,
    // which is what collapses a burst of them — a pointer crossing the tab
    // strip, say — into the single image that burst ended on.
    paintRef.current = paint;
    clearTimeout(pendingRef.current);
    pendingRef.current = setTimeout(paint, animating ? ANIMATING_SETTLE_MS : RENDER_SETTLE_MS);
  });

  // Any frame at all, for a still picture: one drawn outside this component
  // can erase it as surely as its own. A running animation is redrawn on the
  // next tick regardless, and rescheduling it here would only push that late.
  useEffect(() => {
    if (!technique || animating) return;
    return onFrame(() => {
      const paint = paintRef.current;
      if (!paint) return;
      clearTimeout(pendingRef.current);
      pendingRef.current = setTimeout(paint, RENDER_SETTLE_MS);
    });
  }, [technique, animating]);

  useEffect(() => () => clearTimeout(pendingRef.current), []);

  // Leaving raster mode must remove the placement, or the image hangs around on
  // top of whatever is drawn next — the keyboard grid, if you switch tabs.
  useEffect(() => {
    if (!technique) return;
    return () => {
      frameRef.current = undefined;
      paintedRef.current = undefined;
      stdout.write(clearRasterArtifacts(imageId));
      if (imagesInCells && placedRef.current !== undefined) requestWipe(write);
      placedRef.current = undefined;
    };
  }, [technique, stdout, write, imageId, imagesInCells]);
}

export default useRasterOverlay;
