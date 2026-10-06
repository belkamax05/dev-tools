/**
 * The arithmetic a theme editor needs: read a colour as a person typed it,
 * nudge it, and say whether two of them can be read on top of each other.
 *
 * A palette value is either `#rrggbb` (or the `#rgb` shorthand) or one of the
 * ANSI names Ink's `color` prop understands. Names are kept as names — they are
 * what make `classic` follow the terminal's own palette — and are only turned
 * into numbers where numbers are unavoidable: a picture, a contrast ratio, a
 * nudge. For those the xterm defaults stand in for whatever the terminal's
 * palette really says, which no query reliably reports.
 */

export type Rgb = readonly [number, number, number];

/** xterm's default palette, under the names chalk (and so Ink) accepts. */
export const ANSI_COLORS: Readonly<Record<string, Rgb>> = {
  black: [0, 0, 0],
  red: [205, 0, 0],
  green: [0, 205, 0],
  yellow: [205, 205, 0],
  blue: [0, 0, 238],
  magenta: [205, 0, 205],
  cyan: [0, 205, 205],
  white: [229, 229, 229],
  gray: [127, 127, 127],
  grey: [127, 127, 127],
  blackBright: [127, 127, 127],
  redBright: [255, 0, 0],
  greenBright: [0, 255, 0],
  yellowBright: [255, 255, 0],
  blueBright: [92, 92, 255],
  magentaBright: [255, 0, 255],
  cyanBright: [0, 255, 255],
  whiteBright: [255, 255, 255],
};

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** The value as a palette entry — `#rrggbb` in lower case, or a known name — or undefined. */
export const normalizeColor = (value: string): string | undefined => {
  const trimmed = value.trim();
  if (trimmed in ANSI_COLORS) return trimmed;
  const match = HEX.exec(trimmed);
  if (!match) return undefined;
  const digits = (match[1] as string).toLowerCase();
  const full =
    digits.length === 3
      ? digits
          .split('')
          .map((digit) => digit + digit)
          .join('')
      : digits;
  return `#${full}`;
};

export const isColorValue = (value: unknown): value is string =>
  typeof value === 'string' && normalizeColor(value) !== undefined;

/** Red, green and blue, 0–255 — the xterm default for a name. */
export const parseColor = (value: string): Rgb | undefined => {
  const normalized = normalizeColor(value);
  if (!normalized) return undefined;
  if (!normalized.startsWith('#')) return ANSI_COLORS[normalized];
  const n = Number.parseInt(normalized.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

export const toHex = ([r, g, b]: Rgb): string =>
  `#${[r, g, b].map((channel) => clampByte(channel).toString(16).padStart(2, '0')).join('')}`;

/** `a` moved `t` of the way to `b`. */
export const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

type Hsl = [number, number, number];

const toHsl = ([r, g, b]: Rgb): Hsl => {
  const [rf, gf, bf] = [r / 255, g / 255, b / 255];
  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === rf ? (gf - bf) / d + (gf < bf ? 6 : 0) : max === gf ? (bf - rf) / d + 2 : (rf - gf) / d + 4;
  return [h * 60, s, l];
};

const fromHsl = ([h, s, l]: Hsl): Rgb => {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = l - c / 2;
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
};

/**
 * Lighter (positive) or darker by `delta` of the full lightness range, as hex.
 *
 * A name comes back as hex: once a person has nudged it, it is no longer "the
 * terminal's cyan", it is the colour they are looking at.
 */
export const shiftLightness = (value: string, delta: number): string | undefined => {
  const rgb = parseColor(value);
  if (!rgb) return undefined;
  const [h, s, l] = toHsl(rgb);
  return toHex(fromHsl([h, s, Math.max(0, Math.min(1, l + delta))]));
};

/** Round the colour wheel by `degrees`, as hex. A grey has no hue and comes back unchanged. */
export const rotateHue = (value: string, degrees: number): string | undefined => {
  const rgb = parseColor(value);
  if (!rgb) return undefined;
  const [h, s, l] = toHsl(rgb);
  return toHex(fromHsl([h + degrees, s, l]));
};

const luminance = ([r, g, b]: Rgb): number => {
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
};

/**
 * WCAG's contrast ratio, 1–21. 4.5 is the floor for body text, which is the
 * line a theme editor draws: below it a palette still renders, it just stops
 * being readable.
 */
export const contrastRatio = (foreground: string, background: string): number | undefined => {
  const a = parseColor(foreground);
  const b = parseColor(background);
  if (!a || !b) return undefined;
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

/** How far apart two colours look, roughly — redmean distance, 0 to ~765. */
export const colorDistance = (a: string, b: string): number => {
  const x = parseColor(a);
  const y = parseColor(b);
  if (!x || !y) return Number.POSITIVE_INFINITY;
  const rMean = (x[0] + y[0]) / 2;
  const [dr, dg, db] = [x[0] - y[0], x[1] - y[1], x[2] - y[2]];
  return Math.sqrt((2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db);
};

export const colorMath = {
  ANSI_COLORS,
  colorDistance,
  contrastRatio,
  isColorValue,
  mix,
  normalizeColor,
  parseColor,
  rotateHue,
  shiftLightness,
  toHex,
} as const;

export default colorMath;
