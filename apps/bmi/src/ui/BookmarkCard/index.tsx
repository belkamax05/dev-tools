import { Text } from 'ink';
import { useId } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';
import { renderIcon } from '../../core/icon';
import { displayTitle, type Entry } from '../../core/bookmarks';
import type { PreviewCache } from '../../core/preview';
import Favicon from '../Favicon';
import OpenGraphImage from '../OpenGraphImage';
import usePreview from '../usePreview';

export const CARD_IMAGE_COLS = 32;
export const CARD_IMAGE_ROWS = 8;
export const CARD_HEIGHT = CARD_IMAGE_ROWS + 5;

/** Mounted only for visible cards, so scrolling does not fetch the whole library. */
export const BookmarkCard = ({
  entry,
  cache,
  auto,
  width,
  selected,
  imageRows = CARD_IMAGE_ROWS,
}: {
  entry: Entry;
  cache: PreviewCache;
  auto: boolean;
  width: number;
  selected: boolean;
  imageRows?: number;
}) => {
  const colors = useColors();
  const state = usePreview(cache, entry.url, { auto, forceKey: 0 });
  const id = useId();
  // Distinct, stable kitty IDs for every mounted image and favicon, including duplicate URLs.
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const overlayId = 10000 + ((hash >>> 0) % 1000000000) * 2;
  const imageCols = Math.min(CARD_IMAGE_COLS, width - 2);
  return (
    <Box
      flexDirection="column"
      width={width}
      height={imageRows + 5}
      borderStyle="round"
      borderColor={selected ? colors.accent : colors.muted}
      overflow="hidden"
    >
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
      <Box height={2} flexShrink={0}>
        <Box width={4} height={2} flexDirection="column" marginRight={1} flexShrink={0}>
          <Favicon
            image={state.image}
            fallback={state.image ? renderIcon(state.image, 4, 2) : undefined}
            cols={4}
            rows={2}
            muted={colors.muted}
            overlayId={overlayId + 1}
          />
        </Box>
        <Box flexGrow={1} flexShrink={1} overflow="hidden">
          <Text bold color={selected ? colors.accent : colors.heading} wrap="truncate">
            {entry.title ?? state.preview?.title ?? displayTitle(entry)}
          </Text>
        </Box>
      </Box>
      <Text color={colors.muted} wrap="truncate">
        {entry.url}
      </Text>
    </Box>
  );
};

export default BookmarkCard;
