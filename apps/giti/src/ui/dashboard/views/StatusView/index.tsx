import { Text } from 'ink';

import Box from '@/dev-tools/ui/components/Box';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import type { RepoSnapshot, SnapshotFile } from '../../../../utils/getRepoSnapshot';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import { STATUS_LABEL, statusColor } from '../../fileStatus';

/** Which column of the porcelain pair describes a file in a given section. */
interface Section {
  key: string;
  title: string;
  files: SnapshotFile[];
  /** True to read the index column — what is staged — rather than the worktree one. */
  useIndex: boolean;
}

export interface StatusViewProps {
  snapshot: RepoSnapshot;
}

/** The letter that describes a file in the section it was listed under. */
const codeFor = (file: SnapshotFile, useIndex: boolean) => (useIndex ? file.index : file.work);

/**
 * The working tree, file by file.
 *
 * Grouped the way `git status` groups it, because that grouping is the thing a
 * reader is actually asking about — "what would a commit take" is a different
 * question from "what have I touched", and a flat list of paths answers neither.
 * Headers keep the groups apart while one cursor and one scroll window still
 * serve the lot; see `PickList`.
 */
export const StatusView = ({ snapshot }: StatusViewProps) => {
  const colors = useColors();
  const { staged, modified, untracked, conflicted } = snapshot;

  const sections: Section[] = [
    { key: 'conflicted', title: 'Conflicted', files: conflicted, useIndex: false },
    { key: 'staged', title: 'Staged', files: staged, useIndex: true },
    { key: 'modified', title: 'Modified', files: modified, useIndex: false },
    { key: 'untracked', title: 'Untracked', files: untracked, useIndex: false },
  ];

  const items: PickItem<{ file: SnapshotFile; section: Section }>[] = [];
  for (const section of sections) {
    if (section.files.length === 0) continue;
    items.push({
      id: `header-${section.key}`,
      label: `${section.title} (${section.files.length})`,
      isHeader: true,
    });
    for (const file of section.files) {
      items.push({
        //? The section is part of the id: a file modified *and* staged appears
        //? in two sections, and two rows sharing a key is a React error and a
        //? cursor that jumps between them.
        id: `${section.key}:${file.path}`,
        label: file.path,
        hint: codeFor(file, section.useIndex),
        value: { file, section },
      });
    }
  }

  const changeCount = staged.length + modified.length + untracked.length + conflicted.length;

  return (
    <ListDetail
      title={`Files (${changeCount})`}
      items={items}
      emptyText="Working tree clean — nothing to commit."
      detailTitle="File"
      renderDetail={(item) => {
        const value = item?.value;
        if (!value) {
          return (
            <Text color={colors.ok} wrap="truncate">
              Working tree clean.
            </Text>
          );
        }

        const { file, section } = value;
        const code = codeFor(file, section.useIndex);

        return (
          <Box flexDirection="column">
            <Text color={colors.muted}>path</Text>
            <Text color={colors.text}>{file.path}</Text>

            {file.origPath !== undefined && (
              <>
                <Box marginTop={1}>
                  <Text color={colors.muted}>renamed from</Text>
                </Box>
                <Text color={colors.highlight}>{file.origPath}</Text>
              </>
            )}

            <Box marginTop={1}>
              <Text color={colors.muted}>section </Text>
              <Text color={colors.text}>{section.title}</Text>
            </Box>
            <Box>
              <Text color={colors.muted}>state{'   '}</Text>
              <Text color={statusColor(code, colors)} bold>
                {code} {STATUS_LABEL[code] ?? 'unknown'}
              </Text>
            </Box>

            {/* Both porcelain columns, spelled out. Which of the two a file is
                listed under is exactly the staged/unstaged distinction, and it
                is the one thing the single letter in the list cannot say. */}
            <Box marginTop={1}>
              <Text color={colors.muted}>index{'  '}</Text>
              <Text color={statusColor(file.index, colors)}>
                {file.index === ' '
                  ? '· unchanged'
                  : `${file.index} ${STATUS_LABEL[file.index] ?? ''}`}
              </Text>
            </Box>
            <Box>
              <Text color={colors.muted}>tree{'   '}</Text>
              <Text color={statusColor(file.work, colors)}>
                {file.work === ' '
                  ? '· unchanged'
                  : `${file.work} ${STATUS_LABEL[file.work] ?? ''}`}
              </Text>
            </Box>
          </Box>
        );
      }}
    />
  );
};

export default StatusView;
