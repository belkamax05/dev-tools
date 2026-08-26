import { type DOMElement, measureElement } from 'ink';
import type { ReactNode, RefObject } from 'react';
import { useEffect, useState } from 'react';

import useViewport from '../../hooks/useViewport';
import { useColors } from '../../providers/TuiThemeProvider';
import Box from '../Box';

export interface PopoverProps {
  /** The element the popover hangs beneath — usually the strip that opened it. */
  anchorRef: RefObject<DOMElement | null>;
  /**
   * The box the popover is positioned inside.
   *
   * Must be the popover's own parent: Yoga lays an absolutely positioned node
   * out against its parent, so measuring against anything else puts it somewhere
   * else entirely.
   */
  containerRef: RefObject<DOMElement | null>;
  /** Fixed width, or "container" to span the box it is positioned in. */
  width?: number | 'container';
  children: ReactNode;
}

/**
 * A panel drawn over the layout instead of inside it.
 *
 * Ink has no z-index and no overlay layer, but Yoga's absolute positioning is
 * enough to build one out of three facts, all of which this component depends on:
 *
 * 1. An absolutely positioned node takes no space in its parent's flow, so
 *    opening one shifts nothing. That is the whole point — a dropdown that
 *    pushes the content down the screen is a dropdown that moves the thing you
 *    opened it to look at.
 * 2. Ink draws siblings in tree order and later writes win, so a popover only
 *    covers what it should if it is the **last child** of its container. Placed
 *    first it is painted over and vanishes completely.
 * 3. A box only occupies the cells it paints. Without a background colour the
 *    content underneath shows through wherever a row of the popover is shorter
 *    than the popover is wide.
 *
 * Coordinates come from measuring, because the strip above changes height with
 * the terminal — it loses its frame on a short one — so a hard-coded offset
 * would be right at one size and wrong at another.
 */
export const Popover = ({ anchorRef, containerRef, width, children }: PopoverProps) => {
  const colors = useColors();
  //? Kept whole rather than destructured so it can be the effect's dependency:
  //? `useViewport` memoises, so this object changes identity exactly when the
  //? terminal changes shape — which is exactly when the anchor has moved and the
  //? popover would otherwise be left at coordinates with nothing under them.
  const viewport = useViewport();
  const [placement, setPlacement] = useState<{
    left: number;
    top: number;
    containerWidth: number;
  } | null>(null);

  useEffect(() => {
    const anchor = anchorRef.current;
    const container = containerRef.current;
    if (!anchor || !container) return;

    const a = measureElement(anchor);
    const c = measureElement(container);
    //? `measureElement` walks to the layout root, so both are in the same space
    //? and the difference is the offset within the container.
    const wanted = Math.max(0, a.x - c.x);
    //? Pulled back from the right edge when it would not fit, the way every
    //? dropdown does: an anchor near the right of the strip would otherwise put
    //? half the panel past the end of the line, where it is simply not drawn.
    const fixedWidth = typeof width === 'number' ? width : c.width;
    //? Bounded by the terminal as well as the container. Whatever a box says it
    //? is, cells past the last column are not drawn.
    const room = Math.min(c.width, viewport.columns);
    const left = Math.max(0, Math.min(wanted, room - fixedWidth));

    setPlacement({ left, top: Math.max(0, a.y + a.height - c.y), containerWidth: room });
  }, [anchorRef, containerRef, width, viewport]);

  //? One frame with nothing drawn rather than a frame drawn in the wrong place:
  //? the measurement needs a completed layout, which only exists after a render.
  if (!placement) return null;

  const resolvedWidth = width === 'container' ? placement.containerWidth : width;

  return (
    <Box
      position="absolute"
      left={placement.left}
      top={placement.top}
      width={resolvedWidth}
      flexDirection="column"
      //? Paints every cell the popover covers. Without it the layout behind
      //? shows through the gaps between one row's text and the next.
      //?
      //? It paints the whole box, margins included, so a child with a margin
      //? erases that many rows of whatever is underneath. Popover children are
      //? therefore expected to have none.
      backgroundColor={colors.surface}
    >
      {children}
    </Box>
  );
};

export default Popover;
