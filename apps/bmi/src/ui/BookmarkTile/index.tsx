import { Text } from 'ink';

import Box from '@/dev-tools/ui/components/Box';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';
import { displayTitle, type Entry, hostOf, isFromWorkspace } from '../../core/bookmarks';
import { renderIcon } from '../../core/icon';
import type { PreviewCache } from '../../core/preview';
import { CARD_HEIGHT, CARD_IMAGE_COLS } from '../BookmarkCard';
import Favicon from '../Favicon';
import usePreview from '../usePreview';
import useOverlayId from '../useOverlayId';
import WorkspaceChip from '../WorkspaceChip';

const ICON_COLS = 4;
const ICON_ROWS = 2;
/** Half a card's height: the border, the favicon, the title and the host. */
export const TILE_HEIGHT = Math.floor(CARD_HEIGHT / 2);
/**
 * The narrowest a tile gets, about a third of a card. It is a minimum, not a size: the grid fits
 * as many as the row holds and shares out what is left, so tiles stretch to fill each row.
 */
export const TILE_MIN_COLS = Math.ceil((CARD_IMAGE_COLS + 2) / 3);

/** A launcher-style tile: the favicon over the title and host, centred, no preview image. */
export const BookmarkTile = ({
  entry,
  cache,
  auto,
  width,
  selected,
}: {
  entry: Entry;
  cache: PreviewCache;
  auto: boolean;
  width: number;
  selected: boolean;
}) => {
  const colors = useColors();
  const state = usePreview(cache, entry.url, { auto, forceKey: 0 });
  const overlayId = useOverlayId();
  const fromWorkspace = isFromWorkspace(entry);
  return (
    <Box width={width} height={TILE_HEIGHT}>
      <Box
        flexDirection="column"
        alignItems="center"
        width={width}
        height={TILE_HEIGHT}
        borderStyle="round"
        borderColor={selected ? colors.accent : fromWorkspace ? colors.highlight : colors.muted}
        overflow="hidden"
      >
        <Box width={ICON_COLS} height={ICON_ROWS} flexDirection="column" flexShrink={0}>
          <Favicon
            image={state.image}
            fallback={state.image ? renderIcon(state.image, ICON_COLS, ICON_ROWS) : undefined}
            cols={ICON_COLS}
            rows={ICON_ROWS}
            muted={colors.muted}
            //? Only the favicon is drawn; `overlayId` itself is the card's preview image's
            overlayId={overlayId + 1}
          />
        </Box>
        <Text bold color={selected ? colors.accent : colors.heading} wrap="truncate">
          {entry.title ?? state.preview?.title ?? displayTitle(entry)}
        </Text>
        <Text color={colors.muted} wrap="truncate">
          {hostOf(entry.url)}
        </Text>
      </Box>
      {fromWorkspace && <WorkspaceChip width={width} />}
    </Box>
  );
};

export default BookmarkTile;
