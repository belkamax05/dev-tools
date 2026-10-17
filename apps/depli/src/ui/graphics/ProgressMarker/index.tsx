import { bestTechnique, graphicsSupport, isRasterCanvas } from '@/dev-tools/terminal-canvas';

import PixelPanel from '../PixelPanel';

/** A slightly larger dot, centred over the connector without changing its row height. */
export const ProgressMarker = ({ overlayId }: { overlayId: number }) => {
  if (bestTechnique(graphicsSupport()).kind !== 'raster') return null;
  return (
    <PixelPanel
      id="progress-marker"
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
            surface.setPixel(x, y, 46, 190, 95, alpha);
          }
        }
      }}
    />
  );
};

export default ProgressMarker;
