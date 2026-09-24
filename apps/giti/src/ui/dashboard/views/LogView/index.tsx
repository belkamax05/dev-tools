import { Text } from 'ink';

import Box from '@/dev-tools/ui/components/Box';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import type { RepoSnapshot, SnapshotCommit } from '../../../../utils/getRepoSnapshot';
import ListDetail from '@/dev-tools/ui/components/ListDetail';

export interface LogViewProps {
  snapshot: RepoSnapshot;
}

/**
 * The refs decorating a commit, split back out of git's comma-separated `%D`.
 *
 * `HEAD -> main` arrives as one entry; it is left whole, because the arrow is
 * the only thing on the line saying which branch you are actually on.
 */
const refsOf = (commit: SnapshotCommit): string[] =>
  commit.refs
    .split(',')
    .map((ref) => ref.trim())
    .filter(Boolean);

/**
 * History, newest first, with whichever commit the cursor is on written out in
 * full beside it.
 *
 * The list rows carry the short hash and the subject because those are what you
 * scan for; the pane carries the full hash, the author and the refs because
 * those are what you want once you have found it. Splitting them that way is
 * what lets the list stay one line per commit — a log where each entry is three
 * rows is a log you scroll instead of read.
 */
export const LogView = ({ snapshot }: LogViewProps) => {
  const colors = useColors();
  const { commits, headFull } = snapshot;

  const items: PickItem<SnapshotCommit>[] = commits.map((commit) => ({
    id: commit.full,
    label: `${commit.short}  ${commit.subject}`,
    hint: commit.rel,
    value: commit,
    //? Marks HEAD wherever it is in the list, which after a checkout of an older
    //? commit is not the top row.
    isCurrent: commit.full === headFull,
  }));

  return (
    <ListDetail
      title={`Commits (${commits.length})`}
      items={items}
      emptyText="No commits yet."
      detailTitle="Commit"
      renderDetail={(item) => {
        const commit = item?.value;
        if (!commit) return null;
        const refs = refsOf(commit);

        return (
          <Box flexDirection="column">
            <Text color={colors.heading} bold wrap="truncate">
              {commit.short}
            </Text>
            <Text color={colors.muted} wrap="truncate">
              {commit.full}
            </Text>

            <Box marginTop={1} flexDirection="column">
              <Text color={colors.text}>{commit.subject}</Text>
            </Box>

            <Box marginTop={1}>
              <Text color={colors.muted}>author </Text>
              <Text color={colors.text} wrap="truncate">
                {commit.author}
              </Text>
            </Box>
            <Box>
              <Text color={colors.muted}>when{'   '}</Text>
              <Text color={colors.text}>{commit.rel}</Text>
            </Box>

            {refs.length > 0 && (
              <Box marginTop={1} flexDirection="column">
                <Text color={colors.muted}>refs</Text>
                {refs.map((ref) => (
                  <Text
                    key={ref}
                    color={ref.startsWith('HEAD') ? colors.accent : colors.highlight}
                    wrap="truncate"
                  >
                    {'  '}
                    {ref}
                  </Text>
                ))}
              </Box>
            )}

            {commit.full === headFull && (
              <Box marginTop={1}>
                <Text color={colors.ok} bold>
                  ● this is HEAD
                </Text>
              </Box>
            )}
          </Box>
        );
      }}
    />
  );
};

export default LogView;
