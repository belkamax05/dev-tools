import { Text } from 'ink';

import { bestTechnique, graphicsSupport, isRasterCanvas } from '@/dev-tools/terminal-canvas';
import useAnimationClock from '@/dev-tools/ui/hooks/useAnimationClock';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import PixelPanel from '../PixelPanel';

export type TriggerBadge = 'blocked' | 'readonly' | 'next' | 'checking' | 'running';
export const TRIGGER_ICON: Record<TriggerBadge, string> = {
  blocked: '⊘',
  readonly: '👁',
  next: '➜',
  checking: '…',
  running: '◐',
};
const frames = ['◐', '◓', '◑', '◒'];

/** Larger provider-status glyphs; only a running job keeps the animation clock active. */
export const StatusIcon = ({ status, overlayId }: { status: TriggerBadge; overlayId: number }) => {
  const colors = useColors();
  const running = status === 'running';
  const time = useAnimationClock(running, 10);
  const color =
    status === 'blocked'
      ? colors.warn
      : status === 'next' || running
        ? colors.accent
        : colors.muted;
  if (bestTechnique(graphicsSupport()).kind !== 'raster') {
    return (
      <Text color={color}>
        {running ? frames[Math.floor(time * 8) % frames.length] : TRIGGER_ICON[status]}
      </Text>
    );
  }
  return (
    <PixelPanel
      id={`status:${status}`}
      cols={3}
      rows={1}
      overlayId={overlayId}
      time={time}
      animated={running}
      draw={(surface, at) => {
        if (!isRasterCanvas(surface)) return;
        surface.clear(0, 0, 0, 0);
        const rgb =
          status === 'blocked'
            ? [235, 165, 52]
            : status === 'next' || running
              ? [76, 173, 238]
              : [170, 178, 190];
        const radius = Math.min(surface.width, surface.height) * 0.42;
        const stroke = 0.15;
        for (let y = 0; y < surface.height; y++)
          for (let x = 0; x < surface.width; x++) {
            const nx = (x + 0.5 - surface.width / 2) / radius;
            const ny = (y + 0.5 - surface.height / 2) / radius;
            const distance = Math.hypot(nx, ny);
            let filled = false;
            if (status === 'blocked')
              filled =
                Math.abs(distance - 0.8) < stroke || (Math.abs(nx + ny) < stroke && distance < 0.8);
            if (status === 'readonly')
              filled =
                (Math.abs((ny * ny) / 0.28 + nx * nx - 0.8) < 0.2 && Math.abs(nx) < 0.95) ||
                distance < 0.23;
            if (status === 'next')
              filled =
                (Math.abs(ny) < stroke && nx > -0.8 && nx < 0.8) ||
                (Math.abs(Math.abs(ny) - (0.8 - nx)) < stroke && nx > 0 && nx < 0.85);
            if (status === 'checking')
              filled = [-0.6, 0, 0.6].some((cx) => Math.hypot(nx - cx, ny) < 0.17);
            if (running)
              filled =
                Math.abs(distance - 0.72) < stroke &&
                (Math.atan2(ny, nx) - at * Math.PI * 2 + Math.PI * 20) % (Math.PI * 2) <
                  Math.PI * 1.5;
            if (filled) surface.setPixel(x, y, rgb[0]!, rgb[1]!, rgb[2]!, 255);
          }
      }}
    />
  );
};

export default StatusIcon;
