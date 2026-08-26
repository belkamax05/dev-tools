import { type DOMElement, measureElement } from 'ink';
import { useEffect, useRef, useState } from 'react';

import {
  onMouseEvent,
  POINTER_POP,
  pointerPush,
  supportsPointerShape,
  type TerminalMouseEvent,
} from '../../terminal/mouse';

export interface ClickableOptions {
  onClick?: (event: TerminalMouseEvent) => void;
  onClickOutside?: (event: TerminalMouseEvent) => void;
  onWheel?: (event: TerminalMouseEvent) => void;
  /** Pointer shape to show while hovering, where the terminal supports it. */
  pointer?: string;
  isActive?: boolean;
}

export interface ClickableState {
  /** True while the pointer is over this element. Drive your own highlight. */
  isHovered: boolean;
}

/**
 * The terminal reports 1-based cells; Ink lays out from 0. An app that has
 * entered the alternate screen renders at its top, so that single offset is the
 * whole conversion — there is no scrollback or `<Static>` block above the live
 * region to account for. `runTuiApp` homes the cursor for exactly this reason.
 */
const VIEWPORT_ORIGIN = 1;

/** Only one element can own the pointer shape at a time. */
let pointerOwner: symbol | null = null;

/**
 * Make a `<Box>` respond to the mouse.
 *
 * Ink has no mouse layer, but it does expose layout geometry, so hit-testing is
 * just "measure the element, compare against the reported cell". Measuring
 * happens per event rather than being cached because the layout moves with the
 * terminal size, and a handful of `measureElement` calls per mouse move is far
 * cheaper than getting a stale rectangle wrong.
 *
 * @example
 * const ref = useRef<DOMElement>(null);
 * const { isHovered } = useClickable(ref, { onClick: () => setTab(id) });
 * return <Box ref={ref} borderColor={isHovered ? 'cyan' : 'gray'} />;
 */
export const useClickable = (
  ref: React.RefObject<DOMElement | null>,
  { onClick, onClickOutside, onWheel, pointer = 'pointer', isActive = true }: ClickableOptions = {},
): ClickableState => {
  const [isHovered, setIsHovered] = useState(false);

  //? Kept in refs so the subscription never needs re-establishing — a mouse
  //? move arrives per cell crossed, and resubscribing on every render would
  //? drop events.
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;
  const onClickOutsideRef = useRef(onClickOutside);
  onClickOutsideRef.current = onClickOutside;
  const onWheelRef = useRef(onWheel);
  onWheelRef.current = onWheel;
  const hoveredRef = useRef(false);

  useEffect(() => {
    if (!isActive) return;
    const id = Symbol('clickable');
    const canSetPointer = supportsPointerShape();

    const releasePointer = () => {
      if (canSetPointer && pointerOwner === id) {
        pointerOwner = null;
        process.stdout.write(POINTER_POP);
      }
    };

    const unsubscribe = onMouseEvent((event) => {
      const node = ref.current;
      if (!node) return;

      const { x, y, width, height } = measureElement(node);
      const column = event.column - VIEWPORT_ORIGIN;
      const row = event.row - VIEWPORT_ORIGIN;
      const isInside = column >= x && column < x + width && row >= y && row < y + height;

      if (isInside !== hoveredRef.current) {
        hoveredRef.current = isInside;
        setIsHovered(isInside);

        if (canSetPointer) {
          if (isInside && pointerOwner === null) {
            pointerOwner = id;
            process.stdout.write(pointerPush(pointer));
          } else if (!isInside) {
            releasePointer();
          }
        }
      }

      //? Fire on release: a press followed by a release inside the same element
      //? is a click, and releasing is what a person expects to commit the action.
      if (event.type === 'release' && event.button !== 'none') {
        if (isInside) onClickRef.current?.(event);
        else onClickOutsideRef.current?.(event);
      } else if (event.type === 'wheel' && isInside) {
        onWheelRef.current?.(event);
      }
    });

    return () => {
      unsubscribe();
      releasePointer();
      hoveredRef.current = false;
    };
  }, [ref, isActive, pointer]);

  return { isHovered };
};

export default useClickable;
