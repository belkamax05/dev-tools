import type { PixelSurface } from './pixelCanvas.ts';

/**
 * DDA line with colour interpolated between the endpoints.
 *
 * DDA rather than Bresenham because interpolating a colour along the run is the
 * whole point here — depth shading on a wireframe — and Bresenham's integer
 * error term gives no natural parameter to interpolate against.
 */
export interface LinePoint {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
}

export function drawLine(surface: PixelSurface, a: LinePoint, b: LinePoint): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)));

  if (steps === 0) {
    surface.set(Math.round(a.x), Math.round(a.y), a.r, a.g, a.b);
    return;
  }

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    surface.set(
      Math.round(a.x + dx * t),
      Math.round(a.y + dy * t),
      Math.round(a.r + (b.r - a.r) * t),
      Math.round(a.g + (b.g - a.g) * t),
      Math.round(a.b + (b.b - a.b) * t),
    );
  }
}

export default drawLine;
