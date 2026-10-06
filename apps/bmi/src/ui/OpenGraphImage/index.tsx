import { type DOMElement, Text } from 'ink';
import { useMemo, useRef } from 'react';

import {
  bestTechnique,
  decodePng,
  drawImage,
  fitFootprint,
  graphicsSupport,
  type DecodedImage,
  type RasterTechnique,
  type Subject,
} from '@/dev-tools/terminal-canvas';
import Box from '@/dev-tools/ui/components/Box';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';
import GraphicsCanvas from '@/dev-tools/ui/components/GraphicsCanvas';
import useLoader from '@/dev-tools/ui/hooks/useLoader';
import useRasterOverlay from '@/dev-tools/ui/hooks/useRasterOverlay';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 4_000_000;
export const MAX_COLS = 48;
export const MAX_ROWS = 16;

/** Read a response without letting a large social card consume the TUI's memory. */
const readImage = async (response: Response): Promise<Uint8Array> => {
  const advertised = Number(response.headers.get('content-length'));
  if (Number.isFinite(advertised) && advertised > MAX_IMAGE_BYTES)
    throw new Error('image is too large');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('empty image');
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    length += value.length;
    if (length > MAX_IMAGE_BYTES) {
      reader.cancel().catch(() => {});
      throw new Error('image is too large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
};

/**
 * Normalise any image Bun can decode to PNG, then use terminal-canvas's RGBA
 * decoder. PNG skips conversion; JPEG, WebP, and AVIF use Bun's codecs.
 */
const decodeImage = async (bytes: Uint8Array): Promise<DecodedImage> => {
  try {
    return decodePng(bytes);
  } catch {
    const png = await new Bun.Image(bytes).png();
    return decodePng(new Uint8Array(await png.bytes()));
  }
};

const loadImage = async (url: string): Promise<DecodedImage | undefined> => {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(8000),
    headers: { accept: 'image/png,image/*;q=0.8' },
  });
  if (!response.ok) return undefined;
  const image = await decodeImage(await readImage(response));
  return image.width * image.height <= MAX_IMAGE_PIXELS ? image : undefined;
};

/**
 * A page's social card, below its URL. It is requested only when a real raster
 * protocol is available; unsuitable images leave the URL usable.
 */
export const OpenGraphImage = ({
  url,
  cols = MAX_COLS,
  rows = MAX_ROWS,
  overlayId = 9002,
  fixed = false,
}: {
  url: string;
  cols?: number;
  rows?: number;
  overlayId?: number;
  fixed?: boolean;
}) => {
  const colors = useColors();
  const ref = useRef<DOMElement>(null);
  const support = graphicsSupport();
  const selected = bestTechnique(support);
  const raster = selected.kind === 'raster' ? (selected as RasterTechnique) : undefined;
  const { data: image, isLoading } = useLoader(
    () => (raster || fixed ? loadImage(url) : undefined),
    [url, raster, fixed],
  );
  const subject = useMemo<Subject>(
    () => ({
      id: `og:${url}`,
      label: 'Open Graph image',
      note: '',
      animated: false,
      draw: (surface) => {
        if (image) drawImage(surface, image);
      },
    }),
    [url, image],
  );
  const footprint = image ? fitFootprint(cols, rows, image.width / image.height) : undefined;

  useRasterOverlay({
    technique: raster && image ? raster : undefined,
    subject,
    time: 0,
    animating: false,
    target: ref,
    cellWidth: support.cellWidth,
    cellHeight: support.cellHeight,
    imagesInCells: support.imagesInCells,
    // The favicon uses 9001; both images can be visible at once.
    imageId: overlayId,
  });

  if (fixed) {
    return (
      <Box width={cols} height={rows} justifyContent="center" alignItems="center" overflow="hidden">
        {image && footprint ? (
          <GraphicsCanvas
            ref={ref}
            technique={selected}
            subject={subject}
            time={0}
            cols={footprint.cols}
            rows={footprint.rows}
          />
        ) : (
          <Text color={colors.muted}>{isLoading ? 'Loading image…' : 'Image unavailable'}</Text>
        )}
      </Box>
    );
  }

  return raster && image && footprint ? (
    <GraphicsCanvas
      ref={ref}
      technique={raster}
      subject={subject}
      time={0}
      cols={footprint.cols}
      rows={footprint.rows}
    />
  ) : null;
};

export default OpenGraphImage;
