import { isRasterCanvas, type PixelSurface } from '@/dev-tools/terminal-canvas';
import { parseColor } from '@/dev-tools/ui/theme';

export const drawFrame = (
  surface: PixelSurface,
  {
    color,
    opacity,
    cellWidth,
    cellHeight,
    tee,
    joinTop,
    joinBottom,
  }: {
    color: string;
    opacity: number;
    cellWidth: number;
    cellHeight: number;
    tee: number;
    joinTop: boolean;
    joinBottom: boolean;
  },
) => {
  if (!isRasterCanvas(surface)) return;
  surface.clear(0, 0, 0, 0);
  const rgb = parseColor(color) ?? [128, 128, 128];
  const left = cellWidth / 2;
  const top = cellHeight / 2;
  const right = surface.width - left;
  const bottom = surface.height - top;
  const radius = Math.min(5, cellWidth / 2);
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  for (let y = 0; y < surface.height; y++)
    for (let x = 0; x < surface.width; x++) {
      const qx = Math.abs(x + 0.5 - centerX) - (right - left) / 2 + radius;
      const qy = Math.abs(y + 0.5 - centerY) - (bottom - top) / 2 + radius;
      const distance =
        Math.hypot(Math.max(0, qx), Math.max(0, qy)) + Math.min(Math.max(qx, qy), 0) - radius;
      const stem =
        Math.abs(x + 0.5 - (tee + 0.5) * cellWidth) <= 0.75 &&
        ((joinTop && y < top) || (joinBottom && y >= bottom));
      const alpha = stem
        ? 255
        : distance <= 0
          ? Math.round(255 * (distance >= -2 ? 1 : opacity))
          : 0;
      if (alpha) surface.setPixel(x, y, rgb[0], rgb[1], rgb[2], alpha);
    }
};
