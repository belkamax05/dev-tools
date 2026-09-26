import { Text, useInput } from 'ink';
import { useEffect, useMemo, useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import type { Hint } from '@/dev-tools/ui/components/HintBar';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import useCommandFilter from '@/dev-tools/ui/hooks/useCommandFilter';
import useCommandNavigation from '@/dev-tools/ui/hooks/useCommandNavigation';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';
import type PickerItem from '@/dev-tools/types/PickerItem';
import resolvePickerChildren from '@/dev-tools/utils/picker/resolvePickerChildren';

import ListDetail from '@/dev-tools/ui/components/ListDetail';

export interface CommandsViewProps {
  /** The command tree, already folded into groups by `getCommandPickerItems`. */
  items: PickerItem[];
  /**
   * Run the picked command and close the dashboard.
   *
   * The name handed over is exactly what `src/run.ts` resolves onto a
   * file, so a pick feeds the one dispatch path the CLI already has rather than
   * growing a second one.
   */
  onRun: (command: string) => void;
  /**
   * True while the search box has the keyboard, so the shell stops treating
   * digits as tab switches for as long as they are being typed into a query.
   */
  onCaptureInput: (captured: boolean) => void;
}

const isGroup = (item: PickerItem) => item.children !== undefined && !item.runnable;

/**
 * The characters of a chunk that belong in a search query.
 *
 * Control bytes are dropped rather than escaped: they arrive as part of an
 * escape sequence Ink could not name, and a query with a stray ESC in it matches
 * nothing while looking like it should.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping controls is the point
const printable = (input: string): string => input.replace(/[\u0000-\u001F\u007F]/g, '');

/**
 * The command menu, kept as a view rather than as the front door.
 *
 * This is the picker giti used to open on a bare `giti`, moved into a tab: the
 * same tree, the same descend-and-run behaviour, drawn in the dashboard's own
 * chrome instead of its own. `giti <group>` still opens the standalone picker,
 * which is the path that has to keep working unchanged.
 *
 * Search is opt-in, behind `/`, and that is not a stylistic choice. A text box
 * with permanent focus swallows every keystroke, so the digits that switch tabs
 * would type themselves into a query instead — the shell has to be told when the
 * keyboard has been taken, which is what `onCaptureInput` is for.
 */
export const CommandsView = ({ items, onRun, onCaptureInput }: CommandsViewProps) => {
  const colors = useColors();
  const { current, navigateInto, navigateBack } = useCommandNavigation(items);
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  const filtered = useCommandFilter(current.items, query);

  //? Told on every change rather than only on the way in, so backing out of a
  //? search with Esc — or unmounting mid-query — always hands the keyboard back.
  useEffect(() => {
    onCaptureInput(isSearching);
  }, [isSearching, onCaptureInput]);
  useEffect(() => () => onCaptureInput(false), [onCaptureInput]);

  const rows: PickItem<PickerItem>[] = useMemo(
    () =>
      filtered.map((item) => ({
        id: item.value,
        label: isGroup(item) ? `${item.label}/` : item.label,
        hint: isGroup(item) ? 'group' : item.args,
        value: item,
      })),
    [filtered],
  );

  const open = (item: PickerItem) => {
    const children = item.runnable ? undefined : resolvePickerChildren(item);
    if (children) {
      navigateInto(item.label, children);
      setQuery('');
      return;
    }
    onRun(item.value);
  };

  useInput((input, key) => {
    if (isSearching) {
      if (key.escape) {
        setIsSearching(false);
        setQuery('');
        return;
      }
      //? Enter leaves the box but keeps the query: the point of typing one is to
      //? narrow the list and then steer it with the arrows.
      if (key.return) {
        setIsSearching(false);
        return;
      }
      if (key.backspace || key.delete) {
        setQuery((text) => text.slice(0, -1));
        return;
      }
      //? Printable characters only. Ink hands over whatever arrived in one read,
      //? so a fast typist or a paste delivers several at once — and anything it
      //? could not name as a key comes through here too. Stripping the controls
      //? is what keeps escape sequences out of the query.
      if (!key.ctrl && !key.meta) {
        const typed = printable(input);
        if (typed) setQuery((text) => text + typed);
      }
      return;
    }

    //? `startsWith`, not equality: "/" and the first letters of the query land
    //? in the same chunk whenever they are typed faster than the terminal reads,
    //? and an exact match would drop the whole burst on the floor.
    if (input.startsWith('/')) {
      setIsSearching(true);
      setQuery(printable(input.slice(1)));
      return;
    }
    if (key.escape) {
      if (query) setQuery('');
      else if (current.path.length > 0) navigateBack();
    }
  });

  const breadcrumb = ['giti', ...current.path].join(' ');

  const hints: Hint[] = [
    { key: '/', label: 'search', onPress: () => setIsSearching(true) },
    ...(query ? [{ key: 'Esc', label: 'clear', onPress: () => setQuery('') }] : []),
    ...(current.path.length > 0 && !query
      ? [{ key: 'Esc', label: 'back', onPress: () => navigateBack() }]
      : []),
  ];

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      {/* The search line, always drawn so the list never shifts up and down a
          row as a query is started and abandoned. */}
      <Box flexShrink={0}>
        <Text color={colors.muted}>{breadcrumb} </Text>
        {isSearching || query ? (
          <>
            <Text color={colors.accent}>/{query}</Text>
            {isSearching && <Text color={colors.highlight}>▌</Text>}
          </>
        ) : (
          <Text color={colors.muted}>— press / to search</Text>
        )}
      </Box>

      <ListDetail
        title={`Commands (${rows.length})`}
        items={rows}
        emptyText={query ? `Nothing matches "${query}".` : 'No commands here.'}
        detailTitle="Command"
        hints={hints}
        //? The list must not see the keyboard while the query box has it. Enter
        //? closes the search here *and* would activate the highlighted row
        //? there, so one keypress would run a command nobody asked for — and
        //? `amend` and `cancel-all` are on this list.
        isInputActive={!isSearching}
        //? A command runs on the second click, not the first. The rows here are
        //? actions rather than records, and some of them rewrite history.
        confirmClick
        onActivate={(item) => {
          if (item.value) open(item.value);
        }}
        renderDetail={(item) => {
          const command = item?.value;
          if (!command) return null;
          const group = isGroup(command);

          return (
            <Box flexDirection="column">
              <Text bold color={colors.accent} wrap="truncate">
                {command.label}
                {group ? '/' : ''}
              </Text>
              <Text color={colors.muted} wrap="truncate">
                {command.description ?? (group ? 'Command group' : 'No description')}
              </Text>

              {command.args !== undefined && (
                <Box marginTop={1}>
                  <Text color={colors.muted}>args </Text>
                  <Text color={colors.warn} wrap="truncate">
                    {command.args}
                  </Text>
                </Box>
              )}

              <Box marginTop={1} flexDirection="column">
                <Text color={colors.muted}>{group ? 'Enter opens this group' : 'runs'}</Text>
                {!group && (
                  <Text color={colors.highlight} wrap="truncate">
                    giti {command.value.split('/').join(' ')} {command.args ?? ''}
                  </Text>
                )}
              </Box>
            </Box>
          );
        }}
      />
    </Box>
  );
};

export default CommandsView;
