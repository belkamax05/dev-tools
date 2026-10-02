import { Text } from 'ink';

import Box from '@/dev-tools/ui/components/Box';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

/**
 * Marks a page the project's list ships, beside a list row and in a card's chip. Neutral width
 * (unlike most geometric shapes), so Ink and the terminal agree it is one cell.
 */
export const WORKSPACE_BADGE = '⌂';

/**
 * The chip laid over a workspace card's top-right corner, the short form on a narrow card.
 *
 * Absolute, so it sits on the border rather than taking a row: the parent must be an unclipped
 * box the size of the card, since a card clipping its own content would clip the chip too.
 */
export const WorkspaceChip = ({ width }: { width: number }) => {
  const colors = useColors();
  return (
    <Box position="absolute" top={0} right={0}>
      <Text bold backgroundColor={colors.highlight} color={colors.accentText}>
        {width >= 20 ? ` ${WORKSPACE_BADGE} workspace ` : ` ${WORKSPACE_BADGE} `}
      </Text>
    </Box>
  );
};

export default WorkspaceChip;
