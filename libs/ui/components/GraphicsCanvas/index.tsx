import { type DOMElement, Text } from 'ink';
import React, { type Ref, useMemo } from 'react';
import {
  renderSubjectPanel,
  renderTechniqueComparison,
  type Subject,
  type Technique,
} from '../../../terminal-canvas/index.ts';
import { Box } from '../Box';

interface GraphicsCanvasProps {
  technique: Technique;
  subject: Subject;
  /** Seconds into the animation. A static subject ignores it. */
  time: number;
  cols: number;
  rows: number;
  /** Draw every text technique side by side instead of the chosen one. */
  compare?: boolean;
  /**
   * Needed by `useRasterOverlay`, which has to know where on the screen this
   * rectangle ended up before it can write an image into it.
   */
  ref?: Ref<DOMElement>;
}

/**
 * The drawing region.
 *
 * A text technique renders the picture as characters. A raster protocol renders
 * the same rectangle full of spaces and lets `useRasterOverlay` paint over it —
 * the blank rows still have to exist, both to reserve the space and to give the
 * overlay something to measure.
 */
export const GraphicsCanvas: React.FC<GraphicsCanvasProps> = ({
  technique,
  subject,
  time,
  cols,
  rows,
  compare = false,
  ref,
}) => {
  const lines = useMemo(
    () =>
      compare
        ? renderTechniqueComparison(subject, time, cols, rows)
        : renderSubjectPanel(technique, subject, time, cols, rows),
    [compare, technique, subject, time, cols, rows],
  );

  return (
    <Box ref={ref} flexDirection="column" width={cols} height={rows} flexShrink={0}>
      {lines.map((line, y) => (
        // One Text per row: a single multi-line Text collapses to one line
        // under wrap="truncate", because cli-truncate treats it as one string.
        // The row number is the identity here — there is nothing else a line
        // of pixels could be keyed on.
        <Text key={`row-${y}`} wrap="truncate">
          {line}
        </Text>
      ))}
    </Box>
  );
};

export default GraphicsCanvas;
