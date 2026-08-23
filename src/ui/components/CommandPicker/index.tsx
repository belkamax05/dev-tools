import { Badge, StatusMessage, TextInput } from '@inkjs/ui';
import { Box, Text, useInput } from 'ink';
import { useCallback, useState } from 'react';
import type PickerItem from '../../../types/PickerItem';
import type PickerSelection from '../../../types/PickerSelection';
import resolvePickerChildren from '../../../utils/picker/resolvePickerChildren';
import useCommandFilter from '../../hooks/useCommandFilter';
import useCommandNavigation from '../../hooks/useCommandNavigation';
import ScrollableSelect from '../ScrollableSelect';

export interface CommandPickerProps {
  items: PickerItem[];
  /** Shown in the header, e.g. `giti` or `shu`. */
  title: string;
  /** Leads the example command line — defaults to `title`. */
  commandPrefix?: string;
  onPick: (selection: PickerSelection) => void;
  onCancel: () => void;
}

const isGroup = (item: PickerItem) => item.children !== undefined;

/**
 * Two-pane command browser: a searchable list of the current level on the left, a preview of the
 * highlighted row on the right. Enter runs a leaf and descends into a group; Esc climbs back out.
 */
const CommandPicker = ({ items, title, commandPrefix, onPick, onCancel }: CommandPickerProps) => {
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState('');

  const { current, navigateInto, navigateBack } = useCommandNavigation(items);
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
          {title} TUI
        </Text>
        <Text> </Text>
        <TextInput placeholder="Search..." onChange={setQuery} />
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
                <StatusMessage variant="info">Press Enter to navigate into this group</StatusMessage>
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
