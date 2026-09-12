import { Text } from 'ink';

import Box from '@/dev-tools/ui/components/Box';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import type { RepoSnapshot } from '../../../../utils/getRepoSnapshot';
import type { Vendored } from '../../../../utils/vendored';
import ListDetail from '../../components/ListDetail';

export interface VendoredViewProps {
  snapshot: RepoSnapshot;
}

/** What each mechanism records, and therefore what this view can show for it. */
const KIND_NOTE: Record<Vendored['kind'], string> = {
  subrepo: 'Declared by a .gitrepo file in the working tree.',
  submodule: 'Declared by a gitlink in the index.',
  subtree: 'Read from commit trailers — history, which cannot un-say itself.',
};

/**
 * The directories vendored in from somewhere else.
 *
 * Deliberately offline: `getRepoSnapshot` never fetches, so this says where each
 * copy is *pinned*, not whether upstream has moved on. Answering the second
 * question means contacting a remote per directory, which is not something
 * opening a dashboard should do — `giti subrepo` and friends are where that
 * belongs.
 */
export const VendoredView = ({ snapshot }: VendoredViewProps) => {
  const colors = useColors();
  const { vendored } = snapshot;

  const items: PickItem<Vendored>[] = vendored.map((entry) => ({
    id: `${entry.kind}:${entry.dir}`,
    label: entry.dir,
    hint: entry.kind,
    value: entry,
  }));

  return (
    <ListDetail
      title={`Vendored (${vendored.length})`}
      items={items}
      emptyText="No subrepos or subtrees in this repository."
      detailTitle="Vendored directory"
      renderDetail={(item) => {
        const entry = item?.value;
        if (!entry) return null;

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
      }}
    />
  );
};

export default VendoredView;
