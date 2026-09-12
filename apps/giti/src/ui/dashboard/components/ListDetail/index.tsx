import { Text, useInput } from 'ink';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import type { Hint } from '@/dev-tools/ui/components/HintBar';
import HintBar from '@/dev-tools/ui/components/HintBar';
import Panel from '@/dev-tools/ui/components/Panel';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import PickList, { firstSelectable, moveInList } from '@/dev-tools/ui/components/PickList';
import useViewport from '@/dev-tools/ui/hooks/useViewport';
import { useColors, useTuiTheme } from '@/dev-tools/ui/providers/TuiThemeProvider';

/** Share of the app's width the list gets, with the detail pane taking the rest. */
const LIST_SHARE = 0.42;

/** Below this the two panes are stacked rather than set side by side. */
const SIDE_BY_SIDE_COLUMNS = 96;

export interface ListDetailProps<T> {
  /** Names the list pane, with its count in the badge. */
  title: string;
  items: PickItem<T>[];
  /** Shown in place of the rows when there is nothing to list. */
  emptyText?: string;
  /** Names the detail pane. Defaults to the selected row's own label. */
  detailTitle?: string;
  /** Draws the right-hand pane for whichever row the cursor is on. */
  renderDetail: (item: PickItem<T> | undefined, index: number) => ReactNode;
  /** Enter, and a click, on a row that can be acted on. */
  onActivate?: (item: PickItem<T>, index: number) => void;
  /** Appended to the navigation hints this already draws. */
  hints?: Hint[];
  /** Told which row the cursor moved to, for a caller that mirrors it elsewhere. */
  onSelectionChange?: (item: PickItem<T> | undefined, index: number) => void;
  /**
   * False while something above this has taken the keyboard — a search box, a
   * dialog — so the arrows and Enter stop reaching the list.
   *
   * ! Not optional in spirit: a caller that binds Enter itself and leaves this
   * ! true gets *both* handlers on one keypress. That is not a cosmetic clash
   * ! when the list activates commands — the Enter closing a search box also
   * ! runs whatever the cursor happened to be on.
   */
  isInputActive?: boolean;
  /**
   * Require a row to be selected before a click activates it, turning the first
   * click into a select and the second into the action.
   *
   * For lists whose rows *do* something. A single stray click that runs a
   * command is a much worse outcome than an extra click, and the keyboard path
   * is unaffected either way.
   */
  confirmClick?: boolean;
}

/**
 * A scrolling list beside a pane describing whatever it is pointing at.
 *
 * Five of giti's seven views are this shape — files, commits, branches, remotes,
 * vendored directories — and they differ only in what goes in the two panes. The
 * cursor, the scroll window, the key handling and the row budget are the same
 * problem every time, so they are solved once here.
 *
 * The panes stack on a narrow terminal rather than shrinking. Two panes at 40
 * columns are two columns of ellipses; one pane at 80 is a pane you can read,
 * and the list is still the half you are steering with.
 */
export const ListDetail = <T,>({
  title,
  items,
  emptyText,
  detailTitle,
  renderDetail,
  onActivate,
  hints = [],
  onSelectionChange,
  isInputActive = true,
  confirmClick = false,
}: ListDetailProps<T>) => {
  const colors = useColors();
  const theme = useTuiTheme();
  const viewport = useViewport();
  const [selected, setSelected] = useState(0);

  /**
   * The rows, reachable from an effect without being one of its dependencies.
   *
   * Callers build `items` inline, so it is a fresh array on every render. As a
   * dependency it would re-home the cursor on every keystroke in the app; the
   * thing that actually means "the list changed" is its length. Reading the rows
   * through a ref is what lets the effect below depend on the length alone and
   * still see the current rows — and, unlike a lint suppression, it is not
   * something an autofix can quietly undo.
   */
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const count = items.length;

  //? A list that changed under the cursor — a refresh, a different filter — can
  //? leave it past the end or parked on a header. Re-homing on the first
  //? selectable row is the only answer that is right for both.
  useEffect(() => {
    setSelected((at) => {
      const rows = itemsRef.current;
      //? Clamped first, then checked. A list that got shorter leaves the cursor
      //? past the end, and `rows[at]` there is undefined — which would send it
      //? all the way back to the top rather than to the nearest row that still
      //? exists. Using `count` here is also what makes it an honest dependency
      //? rather than one a lint autofix is entitled to remove.
      const clamped = Math.max(0, Math.min(at, count - 1));
      const item = rows[clamped];
      if (item && !item.isHeader && !item.disabled) return clamped;
      return firstSelectable(rows);
    });
  }, [count]);

  const current = items[selected];

  //? Held in a ref for the same reason: callers write `onSelectionChange`
  //? inline, so as a dependency it would re-report on every render.
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  useEffect(() => {
    onSelectionChangeRef.current?.(itemsRef.current[selected], selected);
  }, [selected]);

  //? Read during a click, where it still holds the selection as it was *before*
  //? the click moved it — which is what `confirmClick` compares against.
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  useInput(
    (_input, key) => {
      if (key.upArrow) setSelected((at) => moveInList(items, 1, at, 'up'));
      else if (key.downArrow) setSelected((at) => moveInList(items, 1, at, 'down'));
      else if (key.return && current && !current.isHeader && !current.disabled) {
        onActivate?.(current, selected);
      }
    },
    { isActive: isInputActive },
  );

  const appWidth = Math.max(
    viewport.columns - theme.sizes.app.horizontalMargin,
    theme.sizes.app.minWidth,
  );
  const sideBySide = viewport.columns >= SIDE_BY_SIDE_COLUMNS;
  const listWidth = sideBySide ? Math.floor(appWidth * LIST_SHARE) : undefined;

  //? Stacked, the two panes share the rows; side by side they each get all of
  //? them. `panelFrame` is charged once either way — the detail pane's own frame
  //? is inside the budget the row count is measured against.
  const contentRows = viewport.contentRows(['appShell', 'viewHints', 'panelFrame'], 3);
  const listRows = sideBySide ? contentRows : Math.max(2, Math.floor(contentRows / 2));

  const navigationHints: Hint[] = [
    { key: '↑/↓', label: 'move' },
    ...(onActivate ? [{ key: 'Enter', label: 'open' }] : []),
    ...hints,
  ];

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexDirection={sideBySide ? 'row' : 'column'} flexGrow={1} overflow="hidden">
        <PickList
          title={title}
          items={items}
          selected={selected}
          visibleRows={listRows}
          width={listWidth}
          emptyText={emptyText ?? 'Nothing to show.'}
          onSelect={setSelected}
          onActivate={(index) => {
            const item = items[index];
            if (!item) return;
            //? `PickList` calls `onSelect` then `onActivate` on the same click,
            //? and `selectedRef` has not been re-rendered in between — so this
            //? is genuinely "was it already selected when you clicked it".
            if (confirmClick && selectedRef.current !== index) return;
            onActivate?.(item, index);
          }}
        />

        <Panel
          title={detailTitle ?? current?.label ?? 'Details'}
          color={colors.muted}
          grow
          width={sideBySide ? undefined : appWidth}
        >
          {items.length === 0 ? (
            <Text color={colors.muted} wrap="truncate">
              Nothing selected.
            </Text>
          ) : (
            renderDetail(current, selected)
          )}
        </Panel>
      </Box>

      <Box marginTop={1} flexShrink={0}>
        <HintBar hints={navigationHints} />
      </Box>
    </Box>
  );
};

export default ListDetail;
