import { isRasterCanvas, type PixelSurface, type Subject } from '../../../terminal-canvas/index.ts';
import { type ColorRole, mix, type Palette, parseColor, type Rgb } from '../../theme';

/** The roles drawn as discs, left to right; `surface` is the card and `accentText` sits on `accent`. */
export const DISC_ROLES: readonly ColorRole[] = [
  'accent',
  'highlight',
  'heading',
  'text',
  'muted',
  'ok',
  'warn',
  'error',
];

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/** Composite `color` at `alpha` over whatever is at (x, y), keeping the buffer's own alpha. */
const blend = (surface: PixelSurface, x: number, y: number, color: Rgb, alpha: number) => {
  if (alpha <= 0 || x < 0 || y < 0 || x >= surface.width || y >= surface.height) return;
  if (!isRasterCanvas(surface)) {
    if (alpha >= 0.5) surface.set(x, y, color[0], color[1], color[2]);
    return;
  }
  const i = (y * surface.width + x) * 4;
  const { rgba } = surface;
  const under: Rgb = [rgba[i] as number, rgba[i + 1] as number, rgba[i + 2] as number];
  const [r, g, b] = mix(under, color, alpha);
  surface.setPixel(x, y, r, g, b, Math.max(rgba[i + 3] as number, Math.round(alpha * 255)));
};

/** A shaded disc with a soft shadow under it — a drop of paint, lit from the top left. */
const drawDisc = (
  surface: PixelSurface,
  cx: number,
  cy: number,
  radius: number,
  color: Rgb,
  ring?: Rgb,
) => {
  const shadowOffset = radius * 0.12;
  const reach = radius * 1.35;
  const x0 = Math.floor(cx - reach);
  const x1 = Math.ceil(cx + reach);
  const y0 = Math.floor(cy - reach);
  const y1 = Math.ceil(cy + reach + shadowOffset);

  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const shadowDistance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy - shadowOffset);
      const shadow = clamp01(1 - (shadowDistance - radius) / (radius * 0.3)) * 0.35;
      if (shadowDistance > radius - 1) blend(surface, x, y, BLACK, shadow);
    }
  }

  const ringWidth = ring ? Math.max(2, radius * 0.12) : 0;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = (x + 0.5 - cx) / radius;
      const dy = (y + 0.5 - cy) / radius;
      const distance = Math.hypot(dx, dy) * radius;
      if (ring) {
        const outer = clamp01(radius + ringWidth - distance + 0.5);
        if (distance > radius - 0.5) blend(surface, x, y, ring, outer);
      }
      const coverage = clamp01(radius - distance + 0.5);
      if (coverage <= 0) continue;
      //? A highlight up and to the left, and the rim falling off into shade: enough to read as
      //? a round thing rather than a flat dot, not so much that the colour itself shifts
      const gloss = clamp01(1 - Math.hypot(dx + 0.38, dy + 0.42) / 0.9) ** 2 * 0.45;
      const rim = clamp01(Math.hypot(dx, dy)) ** 6 * 0.22;
      blend(surface, x, y, mix(mix(color, WHITE, gloss), BLACK, rim), coverage);
    }
  }
};

/** The card: a rounded rectangle in the palette's surface, transparent outside its corners. */
const drawCard = (surface: PixelSurface, color: Rgb, border?: Rgb) => {
  const { width, height } = surface;
  const radius = Math.min(width, height) * 0.22;
  if (isRasterCanvas(surface)) surface.clear(0, 0, 0, 0);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const qx = Math.max(radius - x - 0.5, x + 0.5 - (width - radius), 0);
      const qy = Math.max(radius - y - 0.5, y + 0.5 - (height - radius), 0);
      const outside = Math.hypot(qx, qy) - radius;
      blend(surface, x, y, color, clamp01(0.5 - outside));
      if (border) blend(surface, x, y, border, clamp01(1 - Math.abs(outside + 1.5) / 1.5));
    }
  }
};

const rgbOf = (value: string): Rgb => parseColor(value) ?? [128, 128, 128];

/**
 * A palette as a picture: its colours as overlapping discs on a card of its own surface, with
 * the accent text as a dot on the accent — so a theme is judged by the colours together, the
 * way it will be seen, and not one hex code at a time.
 *
 * `focus` lifts one role out of the row: bigger, on top, and ringed in the palette's text
 * colour — the role an editor cursor is on.
 */
export const paletteSubject = (colors: Palette, focus?: ColorRole): Subject => ({
  id: `palette:${DISC_ROLES.map((role) => colors[role]).join(',')}:${colors.accentText}:${colors.surface}:${focus ?? ''}`,
  label: 'Palette',
  note: 'theme colours · static',
  animated: false,
  draw: (surface) => {
    const { width, height } = surface;
    const text = rgbOf(colors.text);
    drawCard(surface, rgbOf(colors.surface), focus === 'surface' ? text : undefined);

    const count = DISC_ROLES.length;
    const overlap = 0.78;
    const diameter = Math.min(height * 0.66, (width * 0.9) / (1 + (count - 1) * overlap));
    const step = diameter * overlap;
    const firstX = (width - (diameter + (count - 1) * step)) / 2 + diameter / 2;
    const cy = height / 2;
    const focused = focus === 'accentText' ? 'accent' : focus;

    const discAt = (index: number) => {
      const role = DISC_ROLES[index] as ColorRole;
      const lifted = role === focused;
      const radius = (diameter / 2) * (lifted ? 1.22 : 1);
      const cx = firstX + index * step;
      drawDisc(surface, cx, cy, radius, rgbOf(colors[role]), lifted ? text : undefined);
      if (role === 'accent') {
        const dot = radius * (focus === 'accentText' ? 0.42 : 0.3);
        drawDisc(surface, cx, cy, dot, rgbOf(colors.accentText));
      }
    };

    //? The lifted disc last, so it sits on top of both neighbours
    for (let index = 0; index < count; index += 1) {
      if (DISC_ROLES[index] !== focused) discAt(index);
    }
    const lifted = DISC_ROLES.indexOf(focused as ColorRole);
    if (lifted !== -1) discAt(lifted);
  },
});

export default paletteSubject;
