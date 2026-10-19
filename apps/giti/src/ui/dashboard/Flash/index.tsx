import { type DOMElement, Text } from 'ink';
import { type RefObject, useCallback, useEffect, useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import Popover from '@/dev-tools/ui/components/Popover';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

/** How long a flash stays up. */
const FLASH_MS = 2000;

export interface FlashMessage {
  text: string;
  /** Which element it hangs under — the caller's names for its anchors. */
  at: string;
  /** Bumped on every show, so the same text shown twice restarts its timer. */
  id: number;
}

/**
 * A short confirmation that something just happened — "Copied to clipboard", "Switched to main" —
 * shown beside what it is about and gone by itself after a moment. One at a time: a new one
 * replaces the last.
 */
export const useFlash = () => {
  const [flash, setFlash] = useState<FlashMessage>();
  const show = useCallback(
    (text: string, at: string) => setFlash((was) => ({ text, at, id: (was?.id ?? 0) + 1 })),
    [],
  );
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(undefined), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash]);
  return { flash, show };
};

/**
 * The flash itself: a bordered line hanging under `anchorRef`, over the layout rather than in it,
 * so nothing below moves while it is up.
 *
 * @param containerRef - The popover's own parent, as `Popover` needs
 */
export const FlashPopover = ({
  text,
  anchorRef,
  containerRef,
}: {
  text: string;
  anchorRef: RefObject<DOMElement | null>;
  containerRef: RefObject<DOMElement | null>;
}) => {
  const colors = useColors();
  return (
    <Popover anchorRef={anchorRef} containerRef={containerRef} width={Bun.stringWidth(text) + 4}>
      <Box borderStyle="round" borderColor={colors.ok} paddingX={1}>
        <Text color={colors.ok}>{text}</Text>
      </Box>
    </Popover>
  );
};

export default FlashPopover;
