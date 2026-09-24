import drawLine, { type LinePoint } from '../drawLine.ts';
import type { PixelSurface } from '../pixelCanvas.ts';

/**
 * A rotating wireframe globe with an inclined orbit and a starfield.
 *
 * Line art rather than a shaded surface, which is what braille is genuinely
 * best at: eight dots per cell buys resolution, and a wireframe needs
 * resolution far more than it needs colour.
 *
 * Draw this into a braille canvas with dithering off and a near-zero threshold,
 * or the dim depth-shaded lines break up into stipple.
 */
const LATITUDES = 7;
const LONGITUDES = 12;
const SEGMENTS = 40;
const STAR_COUNT = 90;

interface Projected extends LinePoint {
  /** Depth in 0..1, 0 nearest the camera. Used to cull nothing, only to shade. */
  depth: number;
}

/** Deterministic starfield, so the background does not shimmer between frames. */
const STARS = Array.from({ length: STAR_COUNT }, (_, i) => {
  // Cheap hash; any low-discrepancy sequence would do.
  const a = Math.sin(i * 12.9898) * 43758.5453;
  const b = Math.sin(i * 78.233) * 12345.6789;
  return { u: a - Math.floor(a), v: b - Math.floor(b), twinkle: (i % 7) / 7 };
});

function makeProjector(surface: PixelSurface, time: number) {
  const cx = surface.width / 2;
  const cy = surface.height / 2;
  const scale = Math.min(surface.width, surface.height) * 0.4;

  const spin = time * 0.6;
  const cosSpin = Math.cos(spin);
  const sinSpin = Math.sin(spin);
  const tilt = 0.38 + 0.14 * Math.sin(time * 0.37);
  const cosTilt = Math.cos(tilt);
  const sinTilt = Math.sin(tilt);

  return (x: number, y: number, z: number, near: LinePoint, far: LinePoint): Projected => {
    // Yaw, then pitch.
    const x1 = x * cosSpin - z * sinSpin;
    const z1 = x * sinSpin + z * cosSpin;
    const y2 = y * cosTilt - z1 * sinTilt;
    const z2 = y * sinTilt + z1 * cosTilt;

    // Weak perspective: enough to sell the rotation, no clipping to worry about.
    const persp = 2.9 / (2.9 + z2);
    const depth = Math.max(0, Math.min(1, (z2 + 1) / 2));

    return {
      x: cx + x1 * persp * scale,
      y: cy - y2 * persp * scale,
      depth,
      r: Math.round(near.r + (far.r - near.r) * depth),
      g: Math.round(near.g + (far.g - near.g) * depth),
      b: Math.round(near.b + (far.b - near.b) * depth),
    };
  };
}

const GLOBE_NEAR: LinePoint = { x: 0, y: 0, r: 140, g: 245, b: 255 };
const GLOBE_FAR: LinePoint = { x: 0, y: 0, r: 32, g: 58, b: 120 };
const ORBIT_NEAR: LinePoint = { x: 0, y: 0, r: 255, g: 176, b: 74 };
const ORBIT_FAR: LinePoint = { x: 0, y: 0, r: 96, g: 48, b: 24 };

function drawGlobe(surface: PixelSurface, time: number): void {
  const project = makeProjector(surface, time);

  // Latitude rings.
  for (let i = 1; i <= LATITUDES; i++) {
    const theta = (Math.PI * i) / (LATITUDES + 1);
    const y = Math.cos(theta);
    const radius = Math.sin(theta);
    let previous: Projected | undefined;
    for (let j = 0; j <= SEGMENTS; j++) {
      const phi = (2 * Math.PI * j) / SEGMENTS;
      const point = project(
        radius * Math.cos(phi),
        y,
        radius * Math.sin(phi),
        GLOBE_NEAR,
        GLOBE_FAR,
      );
      if (previous) drawLine(surface, previous, point);
      previous = point;
    }
  }

  // Longitude arcs.
  for (let i = 0; i < LONGITUDES; i++) {
    const phi = (2 * Math.PI * i) / LONGITUDES;
    let previous: Projected | undefined;
    for (let j = 0; j <= SEGMENTS; j++) {
      const theta = (Math.PI * j) / SEGMENTS;
      const point = project(
        Math.sin(theta) * Math.cos(phi),
        Math.cos(theta),
        Math.sin(theta) * Math.sin(phi),
        GLOBE_NEAR,
        GLOBE_FAR,
      );
      if (previous) drawLine(surface, previous, point);
      previous = point;
    }
  }

  // Inclined orbit plus the body travelling along it.
  const incline = 0.55;
  const orbitRadius = 1.55;
  const orbitPoint = (angle: number) =>
    project(
      orbitRadius * Math.cos(angle),
      orbitRadius * Math.sin(angle) * Math.sin(incline),
      orbitRadius * Math.sin(angle) * Math.cos(incline),
      ORBIT_NEAR,
      ORBIT_FAR,
    );

  let previous: Projected | undefined;
  for (let j = 0; j <= SEGMENTS * 2; j++) {
    const point = orbitPoint((2 * Math.PI * j) / (SEGMENTS * 2));
    if (previous) drawLine(surface, previous, point);
    previous = point;
  }

  const body = orbitPoint(time * 1.4);
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (dx * dx + dy * dy > 4) continue;
      surface.set(Math.round(body.x) + dx, Math.round(body.y) + dy, 255, 240, 200);
    }
  }
}

function drawStars(surface: PixelSurface, time: number): void {
  for (const star of STARS) {
    const brightness = 60 + 90 * (0.5 + 0.5 * Math.sin(time * 1.3 + star.twinkle * 6.28));
    surface.set(
      Math.floor(star.u * surface.width),
      Math.floor(star.v * surface.height),
      Math.round(brightness * 0.7),
      Math.round(brightness * 0.8),
      Math.round(brightness),
    );
  }
}

export interface GlobeSceneOptions {
  /** Seconds. Drives the spin, the orbiting body, and the twinkle. */
  time?: number;
}

export function renderGlobeScene(surface: PixelSurface, options: GlobeSceneOptions = {}): void {
  const { time = 0 } = options;
  surface.clear(0, 0, 0);
  drawStars(surface, time);
  drawGlobe(surface, time);
}

export default renderGlobeScene;
