import { useEffect, useRef, type RefObject } from 'react';
import { type DOMElement, measureElement, useStdout } from 'ink';
import {
  clearRasterArtifacts,
  createRasterCanvas,
  type RasterCanvas,
  type RasterTechnique,
  type Subject,
} from '../../../terminal-canvas/index.ts';

const ESC = '\u001B';

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
  const { technique, subject, time, animating, target, cellWidth, cellHeight } = options;
  const { stdout } = useStdout();

  // The framebuffer is large and the subject overwrites every pixel, so it is
  // kept across frames and only reallocated when the geometry changes.
  const canvasRef = useRef<RasterCanvas | undefined>(undefined);
  // The encoded image, and what it is an encoding of. A hover somewhere else in
  // the app re-renders the tree and erases the picture, so it has to be written
  // again — but it does not have to be drawn and encoded again, and for a
  // megabyte of base64 that is the difference between a redraw and a stall.
  const frameRef = useRef<{ key: string; image: string } | undefined>(undefined);

  useEffect(() => {
    if (!technique) return;

    const paint = () => {
      const node = target.current;
      if (!node) return;

      // Measured, not passed in: what the caller asked for and what Yoga gave
      // it are the same number right up until they are not, and an image sized
      // from the wrong one spills over whatever is next to it.
      const { x, y, width: cols, height: rows } = measureElement(node);
      if (cols <= 0 || rows <= 0) return;

      const { width, height } = rasterPixelSize(cols, rows, cellWidth, cellHeight, {
        animated: subject.animated,
        scalesToCellBox: technique.scalesToCellBox,
      });

      const key = `${technique.id}|${subject.id}|${time}|${width}x${height}`;
      if (frameRef.current?.key !== key) {
        const canvas = canvasRef.current;
        const raster =
          canvas && canvas.width === width && canvas.height === height
            ? canvas
            : createRasterCanvas(width, height);
        canvasRef.current = raster;

        subject.draw(raster, time);
        frameRef.current = { key, image: technique.encode(raster, cols, rows) };
      }

      stdout.write(
        `${ESC}7${ESC}[${y + VIEWPORT_ORIGIN};${x + VIEWPORT_ORIGIN}H${frameRef.current.image}${ESC}8`,
      );
    };

    // The cleanup cancels a write that a newer render has already superseded,
    // which is what collapses a burst of them — a pointer crossing the tab
    // strip, say — into the single image that burst ended on.
    const pending = setTimeout(paint, animating ? ANIMATING_SETTLE_MS : RENDER_SETTLE_MS);
    return () => clearTimeout(pending);
  });

  // Leaving raster mode must remove the placement, or the image hangs around on
  // top of whatever is drawn next — the keyboard grid, if you switch tabs.
  useEffect(() => {
    if (!technique) return;
    return () => {
      frameRef.current = undefined;
      stdout.write(clearRasterArtifacts());
    };
  }, [technique, stdout]);
}

export default useRasterOverlay;
