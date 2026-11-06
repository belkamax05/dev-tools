import { ANSI_COLORS, toHex } from '../../../theme/colorMath';
import { ESC } from '..';

export interface Style {
  /** CSS colour, or undefined for the terminal's default. */
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  inverse?: boolean;
}

/** A picture a program put on screen (kitty graphics, say), at the cell where it was drawn. */
export interface InlineImage {
  /** Where it loads from, usually a `data:` URL. */
  src: string;
  /** Its own size in pixels. */
  width: number;
  height: number;
  /** The cells it was asked to be scaled into, when it was. */
  cols?: number;
  rows?: number;
}

export interface Span {
  text: string;
  style: Style;
  /** Set on a span that is a picture, not text; its `text` is then empty. */
  image?: InlineImage;
}

/** One screen line, as runs of equally styled text. */
export type Line = Span[];

/** The 16 base colours as `#rrggbb`, indexed like SGR 30–37 then 90–97. */
export type AnsiPalette = readonly string[];

const BASE_NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];

/** xterm's defaults (`colorMath.ANSI_COLORS`), for a terminal whose own palette is unknown. */
export const XTERM_PALETTE: AnsiPalette = [
  ...BASE_NAMES.map((name) => toHex(ANSI_COLORS[name] ?? [0, 0, 0])),
  ...BASE_NAMES.map((name) => toHex(ANSI_COLORS[`${name}Bright`] ?? [0, 0, 0])),
];

/** An xterm 256-colour index: the 16 base colours, the 6×6×6 cube, then 24 greys. */
export const color256 = (n: number, palette: AnsiPalette = XTERM_PALETTE) => {
  if (n < 16) return palette[n];
  if (n < 232) {
    const level = (v: number) => (v ? 55 + v * 40 : 0);
    const i = n - 16;
    return toHex([level(Math.floor(i / 36)), level(Math.floor(i / 6) % 6), level(i % 6)]);
  }
  const grey = 8 + (n - 232) * 10;
  return toHex([grey, grey, grey]);
};

/** Apply one SGR sequence's parameters to `style`, returning the new style. */
export const applySgr = (style: Style, params: number[], palette: AnsiPalette = XTERM_PALETTE) => {
  const next = { ...style };
  for (let i = 0; i < params.length; i++) {
    const code = params[i] ?? 0;
    if (code === 0) for (const key of Object.keys(next)) delete next[key as keyof Style];
    else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 7) next.inverse = true;
    else if (code === 9) next.strike = true;
    else if (code === 21 || code === 22) next.bold = next.dim = false;
    else if (code === 23) next.italic = false;
    else if (code === 24) next.underline = false;
    else if (code === 27) next.inverse = false;
    else if (code === 29) next.strike = false;
    else if (code >= 30 && code <= 37) next.fg = palette[code - 30];
    else if (code >= 90 && code <= 97) next.fg = palette[code - 82];
    else if (code >= 40 && code <= 47) next.bg = palette[code - 40];
    else if (code >= 100 && code <= 107) next.bg = palette[code - 92];
    else if (code === 39) next.fg = undefined;
    else if (code === 49) next.bg = undefined;
    else if (code === 38 || code === 48) {
      //? 38;5;n (256 colours) or 38;2;r;g;b (true colour); 48 the same for the background
      const key = code === 38 ? 'fg' : 'bg';
      if (params[i + 1] === 5) {
        next[key] = color256(params[i + 2] ?? 0, palette);
        i += 2;
      } else if (params[i + 1] === 2) {
        next[key] = toHex([params[i + 2] ?? 0, params[i + 3] ?? 0, params[i + 4] ?? 0]);
        i += 4;
      }
    }
  }
  return next;
};

interface Cell {
  char: string;
  style: Style;
  image?: InlineImage;
}

const sameStyle = (a: Style, b: Style) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof Style>;
  for (const key of keys) if ((a[key] || undefined) !== (b[key] || undefined)) return false;
  return true;
};

const toSpans = (cells: Cell[]): Line => {
  const spans: Line = [];
  for (const { char, style, image } of cells) {
    const last = spans[spans.length - 1];
    if (image) spans.push({ text: '', style, image });
    else if (last && !last.image && sameStyle(last.style, style)) last.text += char;
    else spans.push({ text: char, style });
  }
  return spans;
};

//? A CSI sequence (its parameters and final byte captured), an OSC ended by BEL or ST (or left
//? open), a string sequence - APC `ESC _`, DCS `ESC P`, PM `ESC ^`, SOS `ESC X` - (its kind and
//? body captured, so a kitty image's base64 never lands on screen as text), or any other
//? two-byte escape
const ESCAPE = String.raw`${ESC}\[([0-9;?]*)([@-~])|${ESC}\][^\x07${ESC}]*(?:\x07|${ESC}\\)?|${ESC}([_P^X])([^\x07${ESC}]*)(?:\x07|${ESC}\\)?|${ESC}[@-Z\\-_]`;
const ESCAPES = new RegExp(ESCAPE, 'g');
//? …or one of the controls a line is rewritten by
const TOKENS = new RegExp(String.raw`${ESCAPE}|\r\n|[\r\n\t\b]`, 'g');

/** The text with every escape sequence (colours, cursor moves, titles, links) removed. */
export const stripAnsi = (text: string) => text.replace(ESCAPES, '');

export interface ParseAnsiOptions {
  /** What the 16 base colours (and so 256-colour indexes 0–15) are drawn as; xterm's by default. */
  palette?: AnsiPalette;
  /**
   * Each APC string's body (`ESC _ <body> ESC \`), e.g. kitty graphics' `G…`. An image it
   * returns is placed at the cursor; without the hook, or when it returns nothing, the string is
   * dropped like every other escape.
   */
  onApc?: (body: string) => InlineImage | undefined;
}

/**
 * Turn a captured terminal stream into the lines it leaves on screen. Each line is a small
 * terminal of its own: `\r`, `ESC[G` and backspace move the cursor, text overwrites from there,
 * `ESC[K` / `ESC[2K` / `ESC[J` erase — so a spinner's redraws collapse into its last frame instead
 * of one endless line. Colours and attributes (16, 256 and true colour) carry across lines, as
 * they do in a terminal. Other escapes (cursor hiding, titles, links) are dropped.
 */
export const parseAnsi = (
  input: string,
  { palette = XTERM_PALETTE, onApc }: ParseAnsiOptions = {},
) => {
  const lines: Line[] = [];
  let cells: Cell[] = [];
  let cursor = 0;
  let style: Style = {};

  const write = (text: string) => {
    for (const char of text) {
      cells[cursor] = { char, style };
      cursor++;
    }
  };
  const pad = () => {
    for (let i = 0; i < cursor; i++) cells[i] ??= { char: ' ', style: {} };
  };
  const newline = () => {
    pad();
    lines.push(toSpans(cells));
    cells = [];
    cursor = 0;
  };

  let last = 0;
  for (const match of input.matchAll(TOKENS)) {
    write(input.slice(last, match.index));
    last = match.index + match[0].length;
    const [token, params, final, stringKind, stringBody] = match;
    if (stringKind === '_') {
      const image = onApc?.(stringBody ?? '');
      if (image) {
        cells[cursor] = { char: '', style, image };
        cursor++;
      }
    } else if (token === '\n' || token === '\r\n') newline();
    else if (token === '\r') cursor = 0;
    else if (token === '\b') cursor = Math.max(0, cursor - 1);
    else if (token === '\t') write(' '.repeat(8 - (cursor % 8)));
    else if (final === 'm') {
      const codes = (params || '0').split(';').map((p) => Number(p) || 0);
      style = applySgr(style, codes, palette);
    } else if (final === 'G') cursor = Math.max(0, (Number(params) || 1) - 1);
    else if (final === 'K' || final === 'J') {
      //? 0 (default): cursor to end; 1: start to cursor; 2: the whole line
      const mode = Number(params) || 0;
      if (mode === 0) cells.length = Math.min(cells.length, cursor);
      else if (mode === 1) for (let i = 0; i <= cursor; i++) cells[i] = { char: ' ', style: {} };
      else cells = [];
    }
  }
  write(input.slice(last));
  pad();
  if (cells.length) lines.push(toSpans(cells));
  return lines;
};

export default parseAnsi;
