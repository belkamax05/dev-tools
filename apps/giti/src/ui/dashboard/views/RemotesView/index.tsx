import { Text } from 'ink';

import Box from '@/dev-tools/ui/components/Box';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import type { RemoteDetail } from '../../../../types/RemoteDetail';
import type { RepoSnapshot } from '../../../../utils/getRepoSnapshot';
import ListDetail from '@/dev-tools/ui/components/ListDetail';

export interface RemotesViewProps {
  snapshot: RepoSnapshot;
}

/**
 * The remotes, and the two URLs each of them has.
 *
 * Fetch and push are listed separately even when they agree, because when they
 * *dis*agree it is nearly always deliberate — a read-only upstream with pushes
 * routed to a fork — and a list that collapses them hides the one configuration
 * anybody needs to check.
 */
export const RemotesView = ({ snapshot }: RemotesViewProps) => {
  const colors = useColors();
  const { remotes, remote: defaultRemote, upstream } = snapshot;

  const items: PickItem<RemoteDetail>[] = remotes.map((entry) => ({
    id: entry.name,
    label: entry.name,
    hint: entry.fetchUrl === entry.pushUrl ? undefined : 'split',
    value: entry,
    isCurrent: entry.name === defaultRemote,
  }));

  return (
    <ListDetail
      title={`Remotes (${remotes.length})`}
      items={items}
      emptyText="No remotes configured — this repository is local only."
      detailTitle="Remote"
      renderDetail={(item) => {
        const entry = item?.value;
        if (!entry) return null;
        const split = entry.fetchUrl !== entry.pushUrl;

        return (
          <Box flexDirection="column">
            <Text bold color={colors.accent} wrap="truncate">
              {entry.name}
            </Text>

            <Box marginTop={1} flexDirection="column">
              <Text color={colors.muted}>fetch</Text>
              <Text color={colors.text} wrap="truncate-start">
                {entry.fetchUrl || '—'}
              </Text>
            </Box>

            <Box marginTop={1} flexDirection="column">
              <Text color={colors.muted}>push</Text>
              <Text color={split ? colors.warn : colors.text} wrap="truncate-start">
                {entry.pushUrl || '—'}
              </Text>
            </Box>

            {split && (
              <Box marginTop={1}>
                <Text color={colors.warn} wrap="truncate">
                  ⚠ fetch and push point at different URLs
                </Text>
              </Box>
            )}

            {entry.name === defaultRemote && (
              <Box marginTop={1} flexDirection="column">
                <Text color={colors.ok} bold>
                  ● default remote
                </Text>
                <Text color={colors.muted} wrap="truncate">
                  {upstream
                    ? `current branch tracks ${entry.name}/${upstream}`
                    : 'current branch tracks nothing'}
                </Text>
              </Box>
            )}
          </Box>
        );
      }}
    />
  );
};

export default RemotesView;
