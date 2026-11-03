import { useEffect, useMemo, useState } from 'react';

import { type Line, linksOf } from './lines';

/** The cell in the middle of a link on its line — what the arrows measure across. */
const middleOf = (lines: readonly Line[], at: { line: number; segment: number }) => {
  const line = lines[at.line] ?? [];
  const before = line
    .slice(0, at.segment)
    .map((segment) => segment.text)
    .join('');
  return Bun.stringWidth(before) + Bun.stringWidth(line[at.segment]?.text ?? '') / 2;
};

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
  /**
   * The arrows, over the page as it is drawn (a graph's boxes side by side): ←/→ the link before or
   * after on the same line, ↑/↓ the one on the nearest line above or below whose middle is closest
   * — or, when that line is out of reach, one line of scrolling toward it, so prose between links
   * is still read on the way.
   */
  const move = (direction: 'up' | 'down' | 'left' | 'right') => {
    const vertical = direction === 'up' || direction === 'down';
    const delta = direction === 'up' || direction === 'left' ? -1 : 1;
    const current = link === undefined ? undefined : links[link];
    if (!current) {
      //? Nothing focused yet: the first link in view, else scroll as before
      const inView = links.findIndex((item) => item.line >= offset && item.line < offset + rows);
      if (inView >= 0) return focusLink(inView);
      return vertical ? scrollTo(offset + delta) : undefined;
    }
    if (!vertical) return stepLink(delta);
    const nextLine = links
      .map((item) => item.line)
      .filter((line) => (delta > 0 ? line > current.line : line < current.line))
      .sort((a, b) => (a - b) * delta)[0];
    //? Reachable: in view, or the line just past its edge
    if (nextLine === undefined || nextLine < offset - 1 || nextLine > offset + rows) {
      return scrollTo(offset + delta);
    }
    const middle = middleOf(lines, current);
    let best = -1;
    let distance = Number.POSITIVE_INFINITY;
    links.forEach((item, index) => {
      if (item.line !== nextLine) return;
      const away = Math.abs(middleOf(lines, item) - middle);
      if (away < distance) {
        distance = away;
        best = index;
      }
    });
    focusLink(best);
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
    move,
    focused: focusedLink && { line: focusedLink.line, segment: focusedLink.segment },
    focusedUrl: focusedLink?.url,
    focusedAction: focusedLink?.action,
    focusedTo: focusedLink?.to,
    focusedOpen: focusedLink?.open ?? false,
  };
};

export default useLinesNav;
