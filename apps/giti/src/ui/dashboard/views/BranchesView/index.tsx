import { Text } from 'ink';

import Box from '@/dev-tools/ui/components/Box';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import type { RepoSnapshot } from '../../../../utils/getRepoSnapshot';
import ListDetail from '../../components/ListDetail';

interface BranchRow {
  name: string;
  isLocal: boolean;
  isCurrent: boolean;
  /** Already contained in HEAD, so deleting it would lose nothing. */
  isMerged: boolean;
  /** The local branch this one tracks, or '' when it tracks nothing. */
  tracks: string;
}

export interface BranchesViewProps {
  snapshot: RepoSnapshot;
}

/**
 * Every branch this repository knows about, local and remote.
 *
 * "Merged" is the column worth having and the one `git branch` makes you ask for
 * separately: a branch already contained in HEAD is one you can delete without
 * thinking about it, and that is the only question anybody opens a branch list
 * to answer twice.
 */
export const BranchesView = ({ snapshot }: BranchesViewProps) => {
  const colors = useColors();
  const { branch, localBranches, remoteBranches, mergedBranches, upstream, remote } = snapshot;

  const merged = new Set(mergedBranches);

  const rows: BranchRow[] = [
    ...localBranches.map((name) => ({
      name,
      isLocal: true,
      isCurrent: name === branch,
      //? The branch you are on is always "merged" into itself, which is true and
      //? useless — and dangerous to draw as deletable.
      isMerged: merged.has(name) && name !== branch,
      tracks: name === branch ? upstream : '',
    })),
    ...remoteBranches.map((name) => ({
      name,
      isLocal: false,
      isCurrent: false,
      isMerged: false,
      tracks: '',
    })),
  ];

  const items: PickItem<BranchRow>[] = [];
  const locals = rows.filter((row) => row.isLocal);
  const remotesRows = rows.filter((row) => !row.isLocal);

  if (locals.length > 0) {
    items.push({ id: 'header-local', label: `Local (${locals.length})`, isHeader: true });
    for (const row of locals) {
      items.push({
        id: `local:${row.name}`,
        label: row.name,
        hint: row.isCurrent ? 'current' : row.isMerged ? 'merged' : undefined,
        value: row,
        isCurrent: row.isCurrent,
      });
    }
  }

  if (remotesRows.length > 0) {
    items.push({ id: 'header-remote', label: `Remote (${remotesRows.length})`, isHeader: true });
    for (const row of remotesRows) {
      items.push({ id: `remote:${row.name}`, label: row.name, value: row });
    }
  }

  return (
    <ListDetail
      title={`Branches (${rows.length})`}
      items={items}
      emptyText="No branches — this repository has no commits yet."
      detailTitle="Branch"
      renderDetail={(item) => {
        const row = item?.value;
        if (!row) return null;

        return (
          <Box flexDirection="column">
            <Text
              bold
              color={row.isCurrent ? colors.accent : row.isLocal ? colors.text : colors.highlight}
              wrap="truncate"
            >
              {row.name}
            </Text>

            <Box marginTop={1}>
              <Text color={colors.muted}>kind{'    '}</Text>
              <Text color={colors.text}>{row.isLocal ? 'local' : 'remote-tracking'}</Text>
            </Box>

            {row.isCurrent && (
              <>
                <Box>
                  <Text color={colors.muted}>state{'   '}</Text>
                  <Text color={colors.ok} bold>
                    checked out
                  </Text>
                </Box>
                <Box>
                  {/* "tracking" is already the eight cells every other label
                      here is padded to, so its value needs no leading space. */}
                  <Text color={colors.muted}>tracking</Text>
                  <Text color={row.tracks ? colors.text : colors.warn}>
                    {row.tracks ? `${remote || 'origin'}/${row.tracks}` : 'nothing'}
                  </Text>
                </Box>
                <Box>
                  <Text color={colors.muted}>ahead{'   '}</Text>
                  <Text color={snapshot.ahead > 0 ? colors.ok : colors.muted}>
                    {snapshot.ahead}
                  </Text>
                  <Text color={colors.muted}>{'   behind '}</Text>
                  <Text color={snapshot.behind > 0 ? colors.warn : colors.muted}>
                    {snapshot.behind}
                  </Text>
                </Box>
              </>
            )}

            {row.isLocal && !row.isCurrent && (
              <Box>
                <Text color={colors.muted}>merged{'  '}</Text>
                <Text color={row.isMerged ? colors.highlight : colors.muted}>
                  {row.isMerged ? 'yes — contained in HEAD' : 'no'}
                </Text>
              </Box>
            )}

            {row.isMerged && (
              <Box marginTop={1} flexDirection="column">
                <Text color={colors.muted}>Already in HEAD, so deleting it loses nothing:</Text>
                <Text color={colors.highlight}>giti cleanup</Text>
              </Box>
            )}
          </Box>
        );
      }}
    />
  );
};

export default BranchesView;
