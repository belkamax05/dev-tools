import { bestTechnique, graphicsSupport, isRasterCanvas } from '@/dev-tools/terminal-canvas';
import { parseColor } from '@/dev-tools/ui/theme';

import PixelPanel from '../PixelPanel';

const GREEN: [number, number, number] = [46, 190, 95];

/**
 * A slightly larger dot, centred over the connector without changing its row height. Green by
 * default (the completed frontier); `color` draws the same dot in another colour.
 */
export const ProgressMarker = ({ overlayId, color }: { overlayId: number; color?: string }) => {
  if (bestTechnique(graphicsSupport()).kind !== 'raster') return null;
  const [r, g, b] = (color && parseColor(color)) || GREEN;
  return (
    <PixelPanel
      id={`progress-marker:${r},${g},${b}`}
      cols={3}
      rows={1}
      overlayId={overlayId}
      draw={(surface) => {
        if (!isRasterCanvas(surface)) return;
        surface.clear(0, 0, 0, 0);
        const radius = Math.min(surface.width, surface.height) * 0.3;
        for (let y = 0; y < surface.height; y++) {
          for (let x = 0; x < surface.width; x++) {
            const distance = Math.hypot(x + 0.5 - surface.width / 2, y + 0.5 - surface.height / 2);
            const alpha = Math.round(Math.max(0, Math.min(1, radius + 0.5 - distance)) * 255);
            surface.setPixel(x, y, r, g, b, alpha);
          }
        }
      }}
    />
  );
};

export default ProgressMarker;
