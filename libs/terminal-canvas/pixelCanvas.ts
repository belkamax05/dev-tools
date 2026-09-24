/**
 * The interfaces every rendering technique in this folder implements.
 *
 * A canvas is always constructed from a *terminal footprint* (cols x rows) so
 * that two techniques asked for the same footprint occupy exactly the same
 * rectangle on screen — only their pixel resolution differs. That is what makes
 * `demoLadder.ts` a fair comparison.
 *
 * Types only; no runtime export, so the one-default-export-per-file rule in
 * CLAUDE.md does not apply here.
 */

/**
 * Anything that can be drawn into. Split out from `PixelCanvas` because the
 * kitty/sixel path hands raw bytes to the terminal and has no text rows at all,
 * yet still needs to share the scene code.
 */
export interface PixelSurface {
  /** Addressable pixels across. */
  readonly width: number;
  /** Addressable pixels down. */
  readonly height: number;
  /**
   * Width of one pixel divided by its height, assuming a terminal cell is
   * 1 wide and 2 tall. Half-block and braille pixels are square (1.0); a
   * whole-cell pixel is half as wide as it is tall (0.5). Scene code uses
   * this to avoid rendering squashed circles.
   */
  readonly pixelAspect: number;
  clear(r?: number, g?: number, b?: number): void;
  set(x: number, y: number, r: number, g: number, b: number): void;
}

/** A surface that resolves to printable text. */
export interface PixelCanvas extends PixelSurface {
  /** Terminal columns the rendered output occupies. */
  readonly cols: number;
  /** Terminal rows the rendered output occupies. */
  readonly rows: number;
  /** ANSI string: one `\n`-separated line per terminal row, no trailing newline. */
  render(): string;
}

export type CanvasFactory = (cols: number, rows: number) => PixelCanvas;
