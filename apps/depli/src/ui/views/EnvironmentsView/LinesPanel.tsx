import { type DOMElement, measureElement, Text } from 'ink';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import Scrollbar from '@/dev-tools/ui/components/Scrollbar';
import useClickable from '@/dev-tools/ui/hooks/useClickable';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';
import { onFrame } from '@/dev-tools/ui/terminal/frames';

import type { Line, Segment } from './lines';

/**
 * A link (underlined; a click opens it), a page of the view (bold; a click goes there) or a fold
 * (a click toggles it) — lit under the pointer or the keyboard's focus.
 */
const LinkSegment = ({
  segment,
  focused,
  onOpen,
  onAction,
  onGo,
}: {
  segment: Segment;
  focused: boolean;
  onOpen: (url: string) => void;
  onAction: (action: string, open: boolean) => void;
  onGo?: (to: string) => void;
}) => {
  const colors = useColors();
  const ref = useRef<DOMElement>(null);
  const { isHovered } = useClickable(ref, {
    onClick: () =>
      segment.action
        ? onAction(segment.action, Boolean(segment.open))
        : segment.to && onGo
          ? onGo(segment.to)
          : segment.url && onOpen(segment.url),
  });
  const lit = isHovered || focused;
  const page = Boolean(segment.to && onGo);
  return (
    <Box ref={ref} flexShrink={0} backgroundColor={lit ? colors.accent : undefined}>
      <Text
        color={lit ? colors.accentText : colors[segment.role ?? 'accent']}
        bold={segment.bold || page}
        underline={!lit && !segment.action && !page}
      >
        {segment.text}
      </Text>
    </Box>
  );
};

export interface LinesPanelProps {
  lines: Line[];
  /** The first line shown — the caller owns it, so keys and Tab can move it. */
  offset: number;
  onOffset: (offset: number) => void;
  /** Told how many lines fit, whenever that changes — for paging. */
  onRows?: (rows: number) => void;
  /** The link the keyboard is on. */
  focused?: { line: number; segment: number };
  onOpen: (url: string) => void;
  /** A fold's line was clicked. */
  onAction?: (action: string, open: boolean) => void;
  /** A page of the view was clicked; unset, those segments open their `url` like any link. */
  onGo?: (to: string) => void;
  isActive?: boolean;
}

/**
 * Lines of text and links, windowed: only the lines in view are drawn, so a hidden link is never
 * hit-tested and thousands of runs cost what one screen does. The wheel and the shared scrollbar
 * move the window; every link is clickable.
 */
export const LinesPanel = ({
  lines,
  offset,
  onOffset,
  onRows,
  focused,
  onOpen,
  onAction = () => {},
  onGo,
  isActive = true,
}: LinesPanelProps) => {
  const colors = useColors();
  const viewport = useRef<DOMElement>(null);
  const [rows, setRows] = useState(1);
  const measure = useCallback(() => {
    if (!viewport.current) return;
    const next = Math.max(1, Math.floor(measureElement(viewport.current).height));
    setRows((was) => (was === next ? was : next));
  }, []);
  useLayoutEffect(measure);
  useEffect(() => onFrame(measure), [measure]);
  useEffect(() => onRows?.(rows), [rows, onRows]);

  const maxOffset = Math.max(0, lines.length - rows);
  const top = Math.max(0, Math.min(offset, maxOffset));
  const scrollTo = (next: number) => onOffset(Math.max(0, Math.min(maxOffset, next)));
  useClickable(viewport, {
    onWheel: (event) => scrollTo(top + (event.wheel === 'up' ? -3 : 3)),
    isActive,
  });

  return (
    <Box flexDirection="row" flexGrow={1} flexBasis={0} minHeight={0} overflow="hidden">
      <Box ref={viewport} flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden">
        {lines.slice(top, top + rows).map((line, index) => {
          const at = top + index;
          return (
            <Box key={index} flexDirection="row" flexShrink={0} height={1} overflow="hidden">
              {line.length === 0 ? (
                <Text> </Text>
              ) : (
                line.map((segment, part) =>
                  (segment.url || segment.action || (segment.to && onGo)) && isActive ? (
                    <LinkSegment
                      key={part}
                      segment={segment}
                      focused={focused?.line === at && focused.segment === part}
                      onOpen={onOpen}
                      onAction={onAction}
                      onGo={onGo}
                    />
                  ) : (
                    <Box key={part} flexShrink={0}>
                      <Text
                        color={colors[segment.role ?? 'text']}
                        bold={segment.bold}
                        wrap="truncate"
                      >
                        {segment.text}
                      </Text>
                    </Box>
                  ),
                )
              )}
            </Box>
          );
        })}
      </Box>
      <Scrollbar
        offset={top}
        maxOffset={maxOffset}
        rows={rows}
        total={lines.length}
        onChange={scrollTo}
        isActive={isActive}
      />
    </Box>
  );
};

export default LinesPanel;
