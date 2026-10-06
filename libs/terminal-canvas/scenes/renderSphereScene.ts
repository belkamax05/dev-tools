import type { PixelSurface } from '../pixelCanvas.ts';

/**
 * One scene, drawn into any canvas, so the techniques can be compared on equal
 * terms. Deliberately built from three things that stress different axes:
 *
 *   - a smooth background gradient  -> exposes colour depth (banding on ansi16)
 *   - a high-frequency checker      -> exposes spatial resolution
 *   - a specular highlight + rim    -> exposes both at once
 *
 * Analytic ray/sphere intersection, no marching: this runs per-pixel every
 * frame and needs to stay cheap enough for 30fps on a full-screen canvas.
 */
export interface SphereSceneOptions {
  /** Seconds. Drives sphere spin and light orbit. */
  time?: number;
  /** Field of view scale; larger fills more of the frame. Default 1. */
  zoom?: number;
}

export function renderSphereScene(canvas: PixelSurface, options: SphereSceneOptions = {}): void {
  const { time = 0, zoom = 1 } = options;
  const { width: W, height: H, pixelAspect } = canvas;
  const aspect = (W * pixelAspect) / H;

  const camZ = -3.2;
  const radius = 1;
  const radiusSq = radius * radius;
  const c = camZ * camZ - radiusSq;

  // Both lights need a negative z component to fall on the camera-facing
  // hemisphere: the camera sits at -z looking towards +z, so the visible
  // normals all point back at it. The key swings side to side while staying in
  // front; the fill comes from the opposite side, cool and dim, so the shaded
  // half never goes fully black.
  const kx = Math.sin(time * 0.9) * 0.8;
  const kz = -0.55;
  const keyLen = Math.sqrt(kx * kx + 0.45 * 0.45 + kz * kz);
  const klx = kx / keyLen;
  const kly = 0.45 / keyLen;
  const klz = kz / keyLen;

  const fillLen = Math.sqrt(0.55 * 0.55 + 0.35 * 0.35 + 0.45 * 0.45);
  const flx = -0.55 / fillLen;
  const fly = -0.35 / fillLen;
  const flz = -0.45 / fillLen;

  const spin = time * 0.55;
  const cosSpin = Math.cos(spin);
  const sinSpin = Math.sin(spin);

  // The checker's two axes only ever appear divided by pi, so fold the division
  // into the constant rather than doing it a couple of million times a frame.
  const uScale = 8 / Math.PI;
  const vScale = 6 / Math.PI;

  for (let y = 0; y < H; y++) {
    const v = 1 - ((y + 0.5) / H) * 2;
    const dy = v * 0.62 * zoom;
    const dySq = dy * dy;

    const vSq = v * v;
    const tBg = (v + 1) * 0.5;
    const rBgBase = 10 + 26 * tBg;
    const gBgBase = 12 + 30 * tBg;
    const bBgBase = 24 + 62 * tBg;

    for (let x = 0; x < W; x++) {
      const u = (((x + 0.5) / W) * 2 - 1) * aspect;

      // Ray from camera through this pixel.
      const dx = u * 0.62 * zoom;
      const invLen = 1 / Math.sqrt(dx * dx + dySq + 1);
      const rx = dx * invLen;
      const ry = dy * invLen;
      const rz = invLen;

      // |o + t*d|^2 = r^2 with o = (0, 0, camZ).
      const b = 2 * (camZ * rz);
      const disc = b * b - 4 * c;

      let r = 0;
      let g = 0;
      let bl = 0;

      if (disc < 0) {
        // Background: vertical gradient with a soft vignette.
        const vig = 1 - 0.35 * Math.min(1, (u * u + vSq) * 0.4);
        r = rBgBase * vig;
        g = gBgBase * vig;
        bl = bBgBase * vig;
      } else {
        const t = (-b - Math.sqrt(disc)) / 2;
        const nx = (rx * t) / radius;
        const ny = (ry * t) / radius;
        const nz = (camZ + rz * t) / radius;

        // Un-spin the normal to get texture coordinates fixed to the surface,
        // which is what makes the checker rotate with the sphere.
        const lx = nx * cosSpin - nz * sinSpin;
        const lz = nx * sinSpin + nz * cosSpin;
        const su = Math.atan2(lz, lx);
        const sv = Math.acos(ny < -1 ? -1 : ny > 1 ? 1 : ny);
        const checker = (Math.floor(su * uScale) + Math.floor(sv * vScale)) & 1;

        const ar = checker ? 244 : 52;
        const ag = checker ? 118 : 64;
        const ab = checker ? 62 : 150;

        const kFacing = nx * klx + ny * kly + nz * klz;
        const kDot = kFacing > 0 ? kFacing : 0;
        const fFacing = nx * flx + ny * fly + nz * flz;
        const fDot = fFacing > 0 ? fFacing : 0;

        // Blinn-Phong against the key light only.
        const hxv = klx - rx;
        const hyv = kly - ry;
        const hzv = klz - rz;
        const hLen = Math.sqrt(hxv * hxv + hyv * hyv + hzv * hzv) || 1;
        const hDot0 = (nx * hxv + ny * hyv + nz * hzv) / hLen;
        // `** 48` by squaring: 48 = 32 + 16, so six multiplies and one more,
        // against a Math.pow call that has to go via exp/log.
        const h = hDot0 > 0 ? hDot0 : 0;
        const h2 = h * h;
        const h4 = h2 * h2;
        const h8 = h4 * h4;
        const h16 = h8 * h8;
        const spec = kFacing > 0 ? h16 * h16 * h16 : 0;

        // Fresnel-ish rim so the silhouette stays readable at low resolution.
        const towards = nx * rx + ny * ry + nz * rz;
        const edge = towards < 0 ? 1 + towards : 1;
        const rim = edge * edge * edge;

        r = ar * (0.16 + 1.05 * kDot) + ar * 0.3 * fDot + 255 * spec + 60 * rim;
        g = ag * (0.16 + 1.05 * kDot) + ag * 0.36 * fDot + 245 * spec + 85 * rim;
        bl = ab * (0.16 + 1.05 * kDot) + ab * 0.55 * fDot + 235 * spec + 165 * rim;
      }

      canvas.set(
        x,
        y,
        r < 0 ? 0 : r > 255 ? 255 : Math.round(r),
        g < 0 ? 0 : g > 255 ? 255 : Math.round(g),
        bl < 0 ? 0 : bl > 255 ? 255 : Math.round(bl),
      );
    }
  }
}

export default renderSphereScene;
