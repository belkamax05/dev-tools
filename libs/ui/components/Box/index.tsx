import { type BoxProps, type DOMElement, Box as InkBox } from 'ink';
import type { ReactNode, Ref } from 'react';

import { useColors } from '../../providers/TuiThemeProvider';

export interface ThemedBoxProps extends BoxProps {
  ref?: Ref<DOMElement>;
  children?: ReactNode;
}

/**
 * Ink's `Box`, with the theme's background behind its border.
 *
 * Ink fills a box's *content* area with its `backgroundColor` and hands that
 * colour to every `Text` below through a context, so text and the gaps between
 * it inherit the page background without anything being passed down by hand.
 * Borders are the one thing that does not take part: `renderBackground`
 * subtracts the border ring from the area it fills, and `renderBorder` then
 * writes the border characters with a foreground colour and no background —
 * which replaces those cells and punches a one-cell hole in the page through
 * every frame in the app.
 *
 * `borderBackgroundColor` is Ink's answer to that, and it is a style prop with
 * no context behind it. Rather than repeat it at the thirty-odd places that
 * draw a border, this component supplies it: swapping the import is the whole
 * change at each call site, and a box drawn tomorrow gets it for nothing.
 *
 * The order is what you would expect. A box that paints itself paints its own
 * border ring to match; otherwise the page shows through, which for a
 * transparent theme means Ink writes no background at all.
 */
export const Box = ({ ref, ...props }: ThemedBoxProps) => {
  const { page } = useColors();

  return (
    <InkBox
      ref={ref}
      {...props}
      borderBackgroundColor={
        props.borderStyle === undefined
          ? props.borderBackgroundColor
          : (props.borderBackgroundColor ?? props.backgroundColor ?? page)
      }
    />
  );
};

export default Box;
