import { Badge, StatusMessage, TextInput } from '@inkjs/ui';
import { Box, Text, useInput } from 'ink';
import { useCallback, useMemo, useState } from 'react';
import type PickerItem from '../../../types/PickerItem';
import type PickerSelection from '../../../types/PickerSelection';
import resolvePickerChildren from '../../../utils/picker/resolvePickerChildren';
import useCommandFilter from '../../hooks/useCommandFilter';
import useCommandNavigation from '../../hooks/useCommandNavigation';
import ScrollableSelect from '../ScrollableSelect';

export interface CommandPickerProps {
  items: PickerItem[];
  /** Header text, shown verbatim, e.g. `giti TUI`. */
  title: string;
  /** Leads the example command line — defaults to `title`. */
  commandPrefix?: string;
  /**
   * Groups to descend into before the first render, outermost first.
   *
   * E.g. `['mega']` opens the picker already inside the mega group, so `giti mega` behaves
   * like pressing Enter on the mega folder from the top-level picker.
   */
  initialPath?: string[];
  onPick: (selection: PickerSelection) => void;
  onCancel: () => void;
}

const isGroup = (item: PickerItem) => item.children !== undefined;

/**
 * Two-pane command browser: a searchable list of the current level on the left, a preview of the
 * highlighted row on the right. Enter runs a leaf and descends into a group; Esc climbs back out.
 */
const CommandPicker = ({
  items,
  title,
  commandPrefix,
  initialPath,
  onPick,
  onCancel,
}: CommandPickerProps) => {
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState('');

  //? Build the initial navigation stack by walking `items` along `initialPath`. Each segment
  //? resolves the matching group's children so the picker renders already descended into it.
  const initialStack = useMemo(() => {
    if (!initialPath?.length) return undefined;
    const root = { path: [] as string[], items };
    const stack = [root];
    let current = items;
    for (const segment of initialPath) {
      const group = current.find((item) => item.label === segment && item.children !== undefined);
      if (!group) break;
      const children = resolvePickerChildren(group);
      if (!children) break;
      const parent = stack[stack.length - 1]!;
      stack.push({ path: [...parent.path, group.label], items: children });
      current = children;
    }
    return stack.length > 1 ? stack : undefined;
  }, [items, initialPath]);

  const { current, navigateInto, navigateBack } = useCommandNavigation(items, initialStack);
  const filtered = useCommandFilter(current.items, query);

  const selected = filtered.find((item) => item.value === highlighted) ?? filtered[0];

  //? TextInput swallows every character, so single-letter shortcuts would type into the search
  //? box and act at the same time. Esc walks back out, Ctrl+C leaves.
  useInput((input, key) => {
    if (key.escape && current.path.length > 0) navigateBack();
    if (key.ctrl && input === 'c') onCancel();
  });

  const handleSelect = useCallback(
    (value: string) => {
      const item = filtered.find((candidate) => candidate.value === value);
      if (!item) return;

      const children = item.runnable ? undefined : resolvePickerChildren(item);
      if (children) {
        navigateInto(item.label, children);
        setQuery('');
        setHighlighted('');
        return;
      }

      onPick({ item, path: current.path });
    },
    [filtered, current.path, navigateInto, onPick],
  );

  const options = filtered.map((item) => ({
    label: `${isGroup(item) ? '📁 ' : ''}${item.label}`,
    value: item.value,
  }));

  const prefix = commandPrefix ?? title;
  const example = selected && [prefix, ...current.path, selected.label].join(' ');
  const enterAction = selected && isGroup(selected) && !selected.runnable ? 'open' : 'run';

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box>
        <Text bold color="cyan">
          {title}
        </Text>
        <Text> </Text>
        {/*? TextInput keeps its own buffer, so remounting it per level is what actually clears
            the box — resetting `query` alone would leave stale text on screen filtering nothing */}
        <TextInput key={current.path.join('/')} placeholder="Search..." onChange={setQuery} />
      </Box>

      {/* Breadcrumb */}
      {current.path.length > 0 && (
        <Box marginTop={1} gap={1}>
          {current.path.map((segment, index) => (
            <Box key={segment} gap={1}>
              {index > 0 && <Text dimColor>→</Text>}
              <Badge color="blue">{segment}</Badge>
            </Box>
          ))}
        </Box>
      )}

      {/* Main layout */}
      <Box flexDirection="row" marginTop={1}>
        {/* Left command list */}
        <Box width="40%" flexDirection="column" borderStyle="round" borderColor="gray">
          {options.length > 0 ? (
            <ScrollableSelect
              options={options}
              onChange={handleSelect}
              onHighlight={setHighlighted}
              highlightText={query || undefined}
            />
          ) : (
            <StatusMessage variant="warning">No commands</StatusMessage>
          )}
        </Box>

        {/* Right preview panel */}
        <Box
          width="60%"
          flexDirection="column"
          borderStyle="round"
          borderColor="gray"
          paddingLeft={2}
        >
          {selected ? (
            <>
              <Text bold>{selected.label}</Text>
              <Text dimColor>
                {selected.description ?? (isGroup(selected) ? 'Command group' : 'No description')}
              </Text>

              {selected.args && (
                <Box gap={1}>
                  <Badge color="yellow">Args</Badge>
                  <Text>{selected.args}</Text>
                </Box>
              )}

              {enterAction === 'open' ? (
                <StatusMessage variant="info">
                  Press Enter to navigate into this group
                </StatusMessage>
              ) : (
                <>
                  <Text dimColor>Example:</Text>
                  <Text color="magenta">
                    {example} {selected.args ?? ''}
                  </Text>
                </>
              )}
            </>
          ) : (
            <StatusMessage variant="warning">No command selected</StatusMessage>
          )}
        </Box>
      </Box>

      {/* Footer */}
      <Box marginTop={1} gap={1}>
        <Text dimColor>↑↓ select •</Text>
        {example && <Text color="magenta">{example}</Text>}
        <Text dimColor>
          • Enter {enterAction} • Ctrl+C quit{current.path.length > 0 && ' • Esc back'}
        </Text>
      </Box>
    </Box>
  );
};

export default CommandPicker;
