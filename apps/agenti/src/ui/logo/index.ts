import {
  decodePng,
  type DecodedImage,
  drawImage,
  findTechnique,
  flattenImage,
  type GraphicsSupport,
  isRasterCanvas,
  type Subject,
  type Technique,
} from '@/dev-tools/terminal-canvas';

import { type IdeDefinition, logoPath } from '../../core/ides';

/** What a monochrome (black) mark is recoloured to: light enough for a dark terminal. */
const MONO_TINT: readonly [number, number, number] = [210, 210, 210];

/**
 * What the text techniques flatten transparency onto. Black, because a braille
 * or ASCII glyph is drawn only where a pixel is bright — so a transparent area
 * flattened to black is simply left blank, whatever the terminal's own
 * background is.
 */
const TEXT_BACKGROUND: readonly [number, number, number] = [0, 0, 0];

const tint = (image: DecodedImage, [r, g, b]: readonly [number, number, number]): DecodedImage => {
  const rgba = new Uint8Array(image.rgba);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
  }
  return { ...image, rgba };
};

const cache = new Map<string, Promise<Subject | undefined>>();

/**
 * An IDE's logo as a `terminal-canvas` subject, or undefined when the file is
 * missing or unreadable (the pane then just shows no logo).
 *
 * Two copies of the pixels: the original, alpha intact, for a raster protocol
 * that composites it over the terminal itself; and one flattened onto black for
 * the text techniques, which have no alpha. Decoded once per IDE.
 */
export const loadLogo = (ide: IdeDefinition): Promise<Subject | undefined> => {
  const cached = cache.get(ide.id);
  if (cached) return cached;

  const loading = Bun.file(logoPath(ide))
    .arrayBuffer()
    .then((bytes) => {
      const decoded = decodePng(new Uint8Array(bytes));
      const source = ide.monochromeLogo ? tint(decoded, MONO_TINT) : decoded;
      const flattened = flattenImage(source, TEXT_BACKGROUND);
      return {
        id: `logo:${ide.id}`,
        label: `${ide.name} logo`,
        note: `${decoded.width}x${decoded.height} PNG`,
        animated: false,
        //? Flat-coloured marks, not photos: braille draws line art undithered,
        //? which keeps a mid-tone like Claude's orange a solid shape instead of
        //? a scatter of dots
        lineArt: true,
        aspect: decoded.width / decoded.height,
        draw: (surface) => {
          if (isRasterCanvas(surface)) {
            //? The canvas is reused between frames; clearing to transparent is
            //? what keeps the previous IDE's logo from showing through
            surface.clear(0, 0, 0, 0);
            drawImage(surface, source);
          } else {
            drawImage(surface, flattened);
          }
        },
      } satisfies Subject;
    })
    .catch(() => undefined);

  cache.set(ide.id, loading);
  return loading;
};

/** The order `g` steps through on the IDE tab — `auto` first, which is the default. */
export const LOGO_MODES = ['auto', 'kitty', 'braille', 'ascii'] as const;
export type LogoMode = (typeof LOGO_MODES)[number];

/** Whether the locale promises UTF-8, without which braille comes out as mojibake. */
const hasUtf8 = () =>
  /utf-?8/i.test(process.env.LC_ALL || process.env.LC_CTYPE || process.env.LANG || '');

/**
 * The technique a mode resolves to on this terminal.
 *
 * `auto` is the ladder asked for: real pixels over the kitty protocol when the
 * terminal says it speaks it, braille when it can at least draw Unicode, ASCII
 * when even that is in doubt. An explicit `kitty` is honoured even where the
 * probe said no — the probe can be fooled by a multiplexer that swallows the
 * reply, and forcing it is how to find out.
 */
export const resolveLogoTechnique = (mode: LogoMode, support: GraphicsSupport): Technique => {
  const id = mode !== 'auto' ? mode : support.kitty ? 'kitty' : hasUtf8() ? 'braille' : 'ascii';
  return findTechnique(id) ?? (findTechnique('ascii') as Technique);
};
