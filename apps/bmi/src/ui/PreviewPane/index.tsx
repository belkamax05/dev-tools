import { Text } from 'ink';

import Box from '@/dev-tools/ui/components/Box';
import LinkRow from '@/dev-tools/ui/components/LinkRow';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';
import openUrl from '@/dev-tools/utils/system/openUrl';

import { hostOf } from '../../core/bookmarks';
import { ICON_COLS, ICON_ROWS, type PreviewState } from '../usePreview';

const age = (since: number) => {
  const minutes = Math.round((Date.now() - since) / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
};

export interface PreviewPaneProps {
  url: string;
  state: PreviewState;
  /** False when previews are fetched only on request — says how to get one. */
  auto: boolean;
}

/**
 * What the page says about itself, the way a chat app unfurls a link: the favicon, the site's
 * name, the Open Graph title and description. The `og:image` is linked rather than drawn — it is
 * a JPEG more often than not, and there is nothing here to decode one.
 */
export const PreviewPane = ({ url, state, auto }: PreviewPaneProps) => {
  const colors = useColors();
  const { preview, icon, isFetching } = state;
  const redirectedTo =
    preview?.finalUrl && hostOf(preview.finalUrl) !== hostOf(url) ? hostOf(preview.finalUrl) : '';

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row">
        <Box
          flexDirection="column"
          width={ICON_COLS}
          height={ICON_ROWS}
          flexShrink={0}
          marginRight={2}
        >
          {icon
            ? icon.map((line, row) => (
                // One Text per row, keyed on its row — a line of pixels has no other identity
                <Text key={`icon-${row}`} wrap="truncate">
                  {line}
                </Text>
              ))
            : Array.from({ length: ICON_ROWS }, (_, row) => (
                <Text key={`icon-${row}`} color={colors.muted}>
                  {row === 1 ? '  ····  ' : ' '}
                </Text>
              ))}
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
        <Box marginTop={1}>
          <LinkRow
            label="image"
            value={preview.image}
            onOpen={() => openUrl(preview.image ?? '')}
          />
        </Box>
      )}
    </Box>
  );
};

export default PreviewPane;
