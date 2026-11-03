import { Text, useInput } from 'ink';
import { useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import useLoader from '@/dev-tools/ui/hooks/useLoader';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import PatchLines, { PATCH_SCROLL_HINT } from '../PatchLines';

export interface ChecklistFile {
  path: string;
  /** What is drawn; the path when left out (a rename's `old → new`). */
  label?: string;
  /** How the file stands — "staged + unstaged", "new, untracked". */
  hint: string;
  /** For a file that cannot be picked as it is (a conflict). */
  hintColor?: string;
  /** Changes whenever the file's diff would — what the preview reloads on. */
  version?: string;
}

export interface FileChecklistProps {
  files: ChecklistFile[];
  /** Paths ticked. */
  chosen: ReadonlySet<string>;
  onChange: (chosen: Set<string>) => void;
  /** The diff shown beside the list for the file under the cursor. */
  loadDiff: (file: ChecklistFile) => Promise<string>;
  /** What a tick means, in the list's title and hints: "stash" → "Stash 2 of 3", "in/out of stash". */
  verb: string;
  isInputActive: boolean;
  showHints: boolean;
  emptyText?: string;
}

/**
 * Files as a checklist beside each one's diff — which of them an action takes. Ticking only
 * changes the selection: nothing is written to the work tree or the index. Space (or a click on
 * the box) ticks the file under the cursor, `a` ticks all or none.
 *
 * `stash save` picks with it what to share, `stash apply` what to take; not `StatusView`, whose
 * boxes stage for real.
 */
const FileChecklist = ({
  files,
  chosen,
  onChange,
  loadDiff,
  verb,
  isInputActive,
  showHints,
  emptyText = 'No files.',
}: FileChecklistProps) => {
  const colors = useColors();
  const [currentPath, setCurrentPath] = useState<string>();
  const current = files.find((file) => file.path === currentPath);
  const { data: diff = '' } = useLoader(
    () => (current ? loadDiff(current) : Promise.resolve('')),
    [current?.path, current?.version],
  );

  const toggle = (path: string) => {
    const next = new Set(chosen);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    onChange(next);
  };
  const toggleAll = () =>
    onChange(new Set(chosen.size === files.length ? [] : files.map((file) => file.path)));

  useInput(
    (input) => {
      if (input === ' ' && current) toggle(current.path);
      else if (input === 'a') toggleAll();
    },
    { isActive: isInputActive },
  );

  const items: PickItem<ChecklistFile>[] = files.map((file) => {
    const on = chosen.has(file.path);
    return {
      id: file.path,
      label: file.label ?? file.path,
      hint: file.hint,
      hintColor: file.hintColor,
      labelColor: on ? undefined : colors.muted,
      value: file,
      controls: [
        {
          id: 'pick',
          glyph: on ? '[x]' : '[ ]',
          color: on ? colors.ok : colors.muted,
          onPress: () => toggle(file.path),
        },
      ],
    };
  });
  const title = `${verb.charAt(0).toUpperCase()}${verb.slice(1)}`;

  return (
    <ListDetail
      detailScroll={false}
      title={`${title} ${chosen.size} of ${files.length}`}
      items={items}
      emptyText={emptyText}
      detailTitle={current?.path ?? 'Diff'}
      reservedChrome={[]}
      activateOnClick={false}
      isInputActive={isInputActive}
      showHints={showHints}
      fitToHost
      hints={[
        {
          key: 'Space',
          label: `in/out of ${verb}`,
          onPress: () => current && toggle(current.path),
        },
        { key: 'a', label: 'all/none', onPress: toggleAll },
        PATCH_SCROLL_HINT,
      ]}
      onSelectionChange={(item) => setCurrentPath(item?.id)}
      renderDetail={(item) =>
        item?.value ? (
          <Box flexDirection="column" flexGrow={1} minHeight={0}>
            {!chosen.has(item.value.path) && (
              <Text color={colors.warn}>Left out — Space puts it in the {verb}.</Text>
            )}
            <PatchLines text={diff} isActive={isInputActive} />
          </Box>
        ) : null
      }
    />
  );
};

export default FileChecklist;
