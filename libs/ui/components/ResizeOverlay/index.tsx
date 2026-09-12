import { Text } from 'ink';

import useViewport from '../../hooks/useViewport';
import { useColors, useTuiTheme } from '../../providers/TuiThemeProvider';
import { hiddenLabels } from '../../theme';
import Box from '../Box';

export interface ResizeOverlayProps {
  /** The app box the readout centres itself in, in cells. */
  width: number;
  height: number;
}

/**
 * The terminal's size, over the content, while it is being resized.
 *
 * btop puts the new size in the middle of the screen as the window is dragged.
 * This does the same, and adds what the size is costing: an app sheds captions
 * and frames as it runs out of rows, and a resize is exactly the moment that is
 * worth knowing — otherwise chrome quietly vanishes with no reason given.
 *
 * Drawn `position="absolute"`, so it sits over the frame without displacing a
 * single row of it. A readout that pushed the layout around while measuring the
 * layout would be reporting on itself.
 */
export const ResizeOverlay = ({ width, height }: ResizeOverlayProps) => {
  const colors = useColors();
  const theme = useTuiTheme();
  const { columns, rows, shows } = useViewport();

  const size = `${columns} × ${rows}`;
  const hidden = hiddenLabels(theme.display, shows);
  const note = hidden.length > 0 ? `hidden: ${hidden.join(' · ')}` : null;

  //? Border 2 and paddingX 1 either side; the box is as wide as its longest line.
  const inner = Math.max(size.length, note?.length ?? 0);
  const boxWidth = inner + 4;
  const boxHeight = note ? 4 : 3;

  //? A readout that does not fit is worse than none: it would wrap, and Ink would
  //? push the frame past the bottom of a terminal that is already too short.
  if (boxWidth > width || boxHeight > height) return null;

  const short = rows < (theme.breakpoints.rows.regular ?? 0);

  return (
    <Box
      position="absolute"
      left={Math.floor((width - boxWidth) / 2)}
      top={Math.floor((height - boxHeight) / 2)}
      flexDirection="column"
      alignItems="center"
      borderStyle="round"
      borderColor={short ? colors.warn : colors.accent}
      backgroundColor={colors.surface}
      paddingX={1}
    >
      <Text bold color={short ? colors.warn : colors.accent}>
        {size}
      </Text>
      {note && <Text color={colors.muted}>{note}</Text>}
    </Box>
  );
};

export default ResizeOverlay;
