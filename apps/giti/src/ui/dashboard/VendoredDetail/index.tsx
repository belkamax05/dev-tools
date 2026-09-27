import { Text } from 'ink';

import Box from '@/dev-tools/ui/components/Box';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import type { Vendored } from '../../../utils/vendored';

/** What each mechanism records, and therefore what can be shown for it. */
const KIND_NOTE: Record<Vendored['kind'], string> = {
  subrepo: 'Declared by a .gitrepo file in the working tree.',
  submodule: 'Declared by a gitlink in the index.',
  subtree: 'Read from commit trailers — history, which cannot un-say itself.',
};

/**
 * One vendored directory: where it lives, which mechanism brought it in, and where it is pinned.
 *
 * Offline, like the snapshot it comes from — this says where the copy is *pinned*, not whether
 * upstream moved on; the Remotes tab's fetch is what answers that, as a count on its Pull.
 */
export const VendoredDetail = ({ entry }: { entry: Vendored }) => {
  const colors = useColors();
  return (
    <Box flexDirection="column">
      <Text bold color={colors.accent} wrap="truncate">
        {entry.dir}
      </Text>
      <Text color={colors.muted} wrap="truncate-start">
        {entry.path}
      </Text>

      <Box marginTop={1}>
        <Text color={colors.muted}>kind{'   '}</Text>
        <Text color={colors.highlight} bold>
          {entry.kind}
        </Text>
      </Box>
      <Box>
        <Text color={colors.muted}>branch </Text>
        <Text color={entry.branch ? colors.text : colors.muted}>
          {entry.branch || 'not recorded'}
        </Text>
      </Box>
      <Box>
        <Text color={colors.muted}>pinned </Text>
        <Text color={entry.commit ? colors.heading : colors.muted} wrap="truncate">
          {entry.commit ? entry.commit.slice(0, 12) : 'unknown'}
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text color={colors.muted}>remote</Text>
        <Text color={entry.remote ? colors.text : colors.warn} wrap="truncate-start">
          {entry.remote || 'not recorded by this mechanism'}
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color={colors.muted} wrap="truncate">
          {KIND_NOTE[entry.kind]}
        </Text>
      </Box>
    </Box>
  );
};

export default VendoredDetail;
