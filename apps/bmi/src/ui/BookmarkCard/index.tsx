import { Text } from 'ink';

import Box from '@/dev-tools/ui/components/Box';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';
import { displayTitle, type Entry, isFromWorkspace } from '../../core/bookmarks';
import { renderIcon } from '../../core/icon';
import type { PreviewCache } from '../../core/preview';
import Favicon from '../Favicon';
import OpenGraphImage from '../OpenGraphImage';
import usePreview from '../usePreview';
import useOverlayId from '../useOverlayId';
import WorkspaceChip from '../WorkspaceChip';

export const CARD_IMAGE_COLS = 32;
export const CARD_IMAGE_ROWS = 8;
/** The favicon's size, and so the height of the title-and-URL block beside it. */
const ICON_COLS = 4;
const ICON_ROWS = 2;
/** Rows a card spends on everything but its image: the border, and the favicon block. */
export const CARD_CHROME_ROWS = ICON_ROWS + 2;
export const CARD_HEIGHT = CARD_IMAGE_ROWS + CARD_CHROME_ROWS;

/**
 * Mounted only for visible cards, so scrolling does not fetch the whole library.
 *
 * `showImage` off drops the preview image area entirely, leaving the favicon, title and URL — a
 * card as tall as its chrome.
 */
export const BookmarkCard = ({
  entry,
  cache,
  auto,
  width,
  selected,
  imageRows = CARD_IMAGE_ROWS,
  showImage = true,
}: {
  entry: Entry;
  cache: PreviewCache;
  auto: boolean;
  width: number;
  selected: boolean;
  imageRows?: number;
  showImage?: boolean;
}) => {
  const colors = useColors();
  const state = usePreview(cache, entry.url, { auto, forceKey: 0 });
  const overlayId = useOverlayId();
  const imageCols = Math.min(CARD_IMAGE_COLS, width - 2);
  const height = (showImage ? imageRows : 0) + CARD_CHROME_ROWS;
  //? A workspace page keeps its own outline colour until selected, and its chip even then
  const fromWorkspace = isFromWorkspace(entry);
  return (
    //? The card clips its image, so the chip lives in an unclipped wrapper and is laid over the
    //? border's corner from there
    <Box width={width} height={height}>
      <Box
        flexDirection="column"
        width={width}
        height={height}
        borderStyle="round"
        borderColor={selected ? colors.accent : fromWorkspace ? colors.highlight : colors.muted}
        overflow="hidden"
      >
        {showImage && (
          <Box height={imageRows} justifyContent="center" alignItems="center" flexShrink={0}>
            {state.preview?.image ? (
              <OpenGraphImage
                key={state.preview.image}
                url={state.preview.image}
                cols={imageCols}
                rows={imageRows}
                overlayId={overlayId}
                fixed
              />
            ) : (
              <Text color={colors.muted}>
                {state.isFetching ? 'Fetching preview…' : 'No preview image'}
              </Text>
            )}
          </Box>
        )}
        <Box height={ICON_ROWS} flexShrink={0}>
          <Box
            width={ICON_COLS}
            height={ICON_ROWS}
            flexDirection="column"
            marginRight={1}
            flexShrink={0}
          >
            <Favicon
              image={state.image}
              fallback={state.image ? renderIcon(state.image, ICON_COLS, ICON_ROWS) : undefined}
              cols={ICON_COLS}
              rows={ICON_ROWS}
              muted={colors.muted}
              overlayId={overlayId + 1}
            />
          </Box>
          <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
            <Text bold color={selected ? colors.accent : colors.heading} wrap="truncate">
              {entry.title ?? state.preview?.title ?? displayTitle(entry)}
            </Text>
            <Text color={colors.muted} wrap="truncate">
              {entry.url}
            </Text>
          </Box>
        </Box>
      </Box>
      {fromWorkspace && <WorkspaceChip width={width} />}
    </Box>
  );
};

export default BookmarkCard;
