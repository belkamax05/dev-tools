import { Text } from 'ink';

import useAnimationClock from '@/dev-tools/ui/hooks/useAnimationClock';

const FRAMES = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
const FPS = 12;

/**
 * One braille spinner frame followed by a space, for a line that says something is still running
 * (fetching, pulling, pushing).
 *
 * A `Text`, not `@inkjs/ui`'s `Spinner`: that one is a `Box`, which cannot sit inside the line of
 * text it belongs to. Its own component so the clock's ticks re-render this glyph alone rather
 * than the whole view around it — mount it only while the work is in flight.
 */
export const SpinnerGlyph = ({ color }: { color?: string }) => {
  const time = useAnimationClock(true, FPS);
  return <Text color={color}>{`${FRAMES[Math.floor(time * FPS) % FRAMES.length]} `}</Text>;
};

export default SpinnerGlyph;
