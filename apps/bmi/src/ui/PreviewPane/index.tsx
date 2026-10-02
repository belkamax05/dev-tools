import { type DOMElement, measureElement, Text } from 'ink';
import { useEffect, useRef, useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import LinkRow from '@/dev-tools/ui/components/LinkRow';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';
import openUrl from '@/dev-tools/utils/system/openUrl';

import { hostOf } from '../../core/bookmarks';
import Favicon from '../Favicon';
import OpenGraphImage, { MAX_COLS, MAX_ROWS } from '../OpenGraphImage';
import { ICON_COLS, ICON_ROWS, type PreviewState } from '../usePreview';

const age = (since: number) => {
  const minutes = Math.round((Date.now() - since) / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
};

/** Below this the card is a smudge: the link above it is the better use of the rows. */
const MIN_IMAGE_ROWS = 3;
const MIN_IMAGE_COLS = 8;

/**
 * The social card, at the size the pane has left for it.
 *
 * Measured, not assumed: what is above it — the info rows, a repository's panel, a wrapped
 * description — takes a different number of rows on every page and every terminal. The slot grows
 * into whatever is left and shrinks to nothing on a short pane, and the picture is drawn to fit the
 * slot, so it never reaches past the pane's frame. (A picture that did would be written over the
 * rows below it and, on the last row, scroll the screen.)
 */
const ImageSlot = ({ url }: { url: string }) => {
  const ref = useRef<DOMElement>(null);
  const [size, setSize] = useState<{ cols: number; rows: number }>();
  //? Every render: the space changes with the content above, not with anything passed in
  useEffect(() => {
    if (!ref.current) return;
    const { width, height } = measureElement(ref.current);
    setSize((previous) =>
      previous?.cols === width && previous.rows === height
        ? previous
        : { cols: width, rows: height },
    );
  });
  const fits = size && size.rows >= MIN_IMAGE_ROWS && size.cols >= MIN_IMAGE_COLS;
  return (
    <Box ref={ref} flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
      {fits && (
        <OpenGraphImage
          url={url}
          cols={Math.min(size.cols, MAX_COLS)}
          rows={Math.min(size.rows, MAX_ROWS)}
        />
      )}
    </Box>
  );
};

export interface PreviewPaneProps {
  url: string;
  state: PreviewState;
  /** False when previews are fetched only on request — says how to get one. */
  auto: boolean;
}

/**
 * What the page says about itself, the way a chat app unfurls a link: the favicon, the site's
 * name, the Open Graph title and description. The `og:image` URL is always
 * linked; PNG cards are also rendered when a raster terminal protocol is available.
 */
export const PreviewPane = ({ url, state, auto }: PreviewPaneProps) => {
  const colors = useColors();
  const { preview, image, icon, isFetching } = state;
  const redirectedTo =
    preview?.finalUrl && hostOf(preview.finalUrl) !== hostOf(url) ? hostOf(preview.finalUrl) : '';

  return (
    <Box flexDirection="column" marginTop={1} flexGrow={1} flexShrink={1} overflow="hidden">
      <Box flexDirection="row" flexShrink={0}>
        <Box
          flexDirection="column"
          width={ICON_COLS}
          height={ICON_ROWS}
          flexShrink={0}
          marginRight={2}
        >
          <Favicon
            image={image}
            fallback={icon}
            cols={ICON_COLS}
            rows={ICON_ROWS}
            muted={colors.muted}
          />
        </Box>
        <Box flexDirection="column" flexGrow={1} overflow="hidden">
          <Text color={colors.muted} wrap="truncate">
            {preview?.siteName ?? hostOf(preview?.finalUrl ?? url)}
          </Text>
          <Text bold color={colors.heading} wrap="truncate">
            {preview?.title ?? (isFetching ? 'Fetching preview…' : '')}
          </Text>
          <Text color={preview?.error ? colors.warn : colors.muted} wrap="truncate">
            {isFetching
              ? 'reading the page…'
              : preview
                ? `${preview.error ? `${preview.error} · ` : ''}${redirectedTo ? `redirected to ${redirectedTo} (a login?) · ` : ''}fetched ${age(preview.fetchedAt)}`
                : auto
                  ? 'no preview yet'
                  : 'no preview yet — [f] fetches it'}
          </Text>
        </Box>
      </Box>
      {preview?.description && (
        <Box marginTop={1}>
          <Text color={colors.text} wrap="wrap">
            {preview.description}
          </Text>
        </Box>
      )}
      {preview?.image && (
        <Box flexDirection="column" marginTop={1} flexGrow={1} flexShrink={1} overflow="hidden">
          <Box flexShrink={0}>
            <LinkRow
              label="image"
              value={preview.image}
              onOpen={() => openUrl(preview.image ?? '')}
            />
          </Box>
          <ImageSlot url={preview.image} />
        </Box>
      )}
    </Box>
  );
};

export default PreviewPane;
