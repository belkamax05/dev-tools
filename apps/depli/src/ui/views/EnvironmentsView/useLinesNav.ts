import { useEffect, useMemo, useState } from 'react';

import { type Line, linksOf } from './lines';

/**
 * Keyboard state for a `LinesPanel`: the window's first line, and the link or fold Tab is on — moving
 * the window to keep that link in view.
 */
export const useLinesNav = (lines: readonly Line[], resetKey?: string) => {
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState(1);
  const [link, setLink] = useState<number>();
  const links = useMemo(() => linksOf(lines), [lines]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new subject starts at the top
  useEffect(() => {
    setOffset(0);
    setLink(undefined);
  }, [resetKey]);

  const maxOffset = Math.max(0, lines.length - rows);
  const scrollTo = (next: number) => setOffset(Math.max(0, Math.min(maxOffset, next)));
  const focusLink = (index: number) => {
    const target = links[index];
    if (!target) return;
    setLink(index);
    if (target.line < offset) setOffset(target.line);
    else if (target.line >= offset + rows) setOffset(target.line - rows + 1);
  };
  /** The next (or previous) link, wrapping — from the first one in view when none is focused. */
  const stepLink = (delta: number) => {
    if (!links.length) return;
    if (link === undefined || !links[link]) {
      const inView = links.findIndex((item) => item.line >= offset);
      return focusLink(delta > 0 ? Math.max(0, inView) : Math.max(0, inView - 1));
    }
    focusLink((link + delta + links.length) % links.length);
  };
  const focusedLink = link === undefined ? undefined : links[link];
  return {
    offset: Math.min(offset, maxOffset),
    setOffset: scrollTo,
    rows,
    setRows,
    scrollBy: (delta: number) => scrollTo(offset + delta),
    page: (delta: number) => scrollTo(offset + delta * Math.max(1, rows - 1)),
    top: () => scrollTo(0),
    bottom: () => scrollTo(maxOffset),
    stepLink,
    focused: focusedLink && { line: focusedLink.line, segment: focusedLink.segment },
    focusedUrl: focusedLink?.url,
    focusedAction: focusedLink?.action,
    focusedTo: focusedLink?.to,
    focusedOpen: focusedLink?.open ?? false,
  };
};

export default useLinesNav;
