import { Text, useInput } from 'ink';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

import useViewport from '../../hooks/useViewport';
import { useColors, useTuiTheme } from '../../providers/TuiThemeProvider';
import type { TuiTheme } from '../../theme';
import Box from '../Box';
import type { Hint } from '../HintBar';
import HintBar from '../HintBar';
import Panel from '../Panel';
import type { PickItem } from '../PickList';
import PickList, { firstSelectable, moveInList } from '../PickList';

/** Share of the app's width the list gets, with the detail pane taking the rest. */
const LIST_SHARE = 0.42;

/** Below this the two panes are stacked rather than set side by side. */
const SIDE_BY_SIDE_COLUMNS = 96;

type Viewport = ReturnType<typeof useViewport>;

//? Stacked, the two panes share the rows; side by side they each get all of
//? them. `panelFrame` is charged once either way — the detail pane's own frame
//? is inside the budget the row count is measured against.
const listDetailContentRows = (
  viewport: Viewport,
  layout: 'list' | 'grid',
  reservedChrome: string[],
): number =>
  viewport.contentRows(
    ['appShell', 'viewHints', ...(layout === 'grid' ? [] : ['panelFrame']), ...reservedChrome],
    3,
  );

const stackedListRows = (contentRows: number): number =>
  Math.max(2, Math.floor(contentRows / 2));

/**
 * Rows the detail pane of a list-layout `ListDetail` has for its content, on this terminal.
 *
 * The pane is a flex child, so a component inside it measures only as tall as its own content
 * — it cannot find out how much room there is by measuring. Something that wants to fill the
 * pane (a list that scrolls in it, a dialog) asks here instead: the same budget `ListDetail`
 * itself splits between the panes.
 */
export const listDetailPaneRows = (viewport: Viewport, reservedChrome: string[] = []): number => {
  const contentRows = listDetailContentRows(viewport, 'list', reservedChrome);
  //? Stacked, the detail pane also has its own frame and title to pay for under the list
  return viewport.columns >= SIDE_BY_SIDE_COLUMNS
    ? contentRows
    : Math.max(3, contentRows - stackedListRows(contentRows) - 3);
};

/**
 * Cells a list row's own text has, for a `ListDetail` on a terminal this wide: the list pane's
 * width less its border and padding (4) and the cursor marker every row starts with (2).
 *
 * For a caller laying its labels out as a table — fixed columns that must fit the pane rather
 * than be cut off at its edge — which needs the same answer `ListDetail` uses to size the pane.
 */
export const listTextWidth = (columns: number, theme: TuiTheme): number => {
  const appWidth = Math.max(columns - theme.sizes.app.horizontalMargin, theme.sizes.app.minWidth);
  const paneWidth = columns >= SIDE_BY_SIDE_COLUMNS ? Math.floor(appWidth * LIST_SHARE) : appWidth;
  return Math.max(1, paneWidth - 6);
};

export interface ListDetailProps<T> {
  /** Names the list pane, with its count in the badge. */
  title: string;
  items: PickItem<T>[];
  /** Pack options into a responsive grid; headers keep their own row. */
  layout?: 'list' | 'grid';
  gridCellWidth?: number;
  gridCellHeight?: number;
  renderGridCell?: (
    item: PickItem<T>,
    width: number,
    selected: boolean,
    height: number,
  ) => ReactNode;
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
  /**
   * Chrome parts the caller draws around this, by name in the theme's
   * `chrome` table — a search line, a status row — so the list is sized to
   * what is really left rather than running past the bottom of the terminal.
   */
  reservedChrome?: readonly string[];
  /**
   * The row to start on, by id — for a view that is remounted (after handing
   * the terminal to an editor, say) and should come back where it was.
   * Falls back to the first selectable row when it is gone.
   */
  initialSelectedId?: string;
  /** What Enter is called in the hints, when "open" is not what it does. */
  activateLabel?: string;
  /**
   * See `PickList`'s own — false makes a click select only, leaving Enter to activate; a
   * function decides per row.
   */
  activateOnClick?: boolean | ((item: PickItem<T>) => boolean);
  /** See `PickList`'s own: which `items` are on screen, as the list scrolls. */
  onWindowChange?: (from: number, to: number) => void;
}

/**
 * A scrolling list beside a pane describing whatever it is pointing at.
 *
 * Most dashboard views are this shape — giti's files, commits, branches and
 * remotes, agenti's agent files, MCP servers and skills — and they differ only
 * in what goes in the two panes. The cursor, the scroll window, the key handling
 * and the row budget are the same problem every time, so they are solved once
 * here. It prices its own hint strip as the `viewHints` chrome part.
 *
 * The panes stack on a narrow terminal rather than shrinking. Two panes at 40
 * columns are two columns of ellipses; one pane at 80 is a pane you can read,
 * and the list is still the half you are steering with.
 */
export const ListDetail = <T,>({
  title,
  items,
  layout = 'list',
  gridCellWidth = 24,
  gridCellHeight = 1,
  renderGridCell,
  emptyText,
  detailTitle,
  renderDetail,
  onActivate,
  hints = [],
  onSelectionChange,
  isInputActive = true,
  confirmClick = false,
  reservedChrome = [],
  initialSelectedId,
  activateLabel = 'open',
  activateOnClick = true,
  onWindowChange,
}: ListDetailProps<T>) => {
  const colors = useColors();
  const theme = useTuiTheme();
  const viewport = useViewport();
  const [selected, setSelected] = useState(() => {
    const at = initialSelectedId ? items.findIndex((item) => item.id === initialSelectedId) : -1;
    return at >= 0 ? at : firstSelectable(items);
  });

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
  //? Held until the rows it names exist: a view that loads its data
  //? asynchronously mounts with an empty list, and resolving the id then would
  //? find nothing and lose it for good
  const pendingInitialId = useRef(initialSelectedId);

  useEffect(() => {
    setSelected((at) => {
      const rows = itemsRef.current;
      if (pendingInitialId.current !== undefined && rows.length > 0) {
        const wanted = rows.findIndex((row) => row.id === pendingInitialId.current);
        pendingInitialId.current = undefined;
        if (wanted >= 0) return wanted;
      }
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
  //? Keyed on the id under the cursor as well as its index: a refresh that
  //? deletes or inserts rows above the cursor puts a different row at the same
  //? index, and a caller mirroring the selection would go on acting on the old one
  const currentId = current?.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: currentId is the trigger, read via the ref
  useEffect(() => {
    onSelectionChangeRef.current?.(itemsRef.current[selected], selected);
  }, [selected, currentId]);

  //? Read during a click, where it still holds the selection as it was *before*
  //? the click moved it — which is what `confirmClick` compares against.
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const appWidth = Math.max(
    viewport.columns - theme.sizes.app.horizontalMargin,
    theme.sizes.app.minWidth,
  );
  const sideBySide = layout === 'grid' || viewport.columns >= SIDE_BY_SIDE_COLUMNS;
  const listWidth = sideBySide
    ? Math.floor(appWidth * (layout === 'grid' ? 0.6 : LIST_SHARE))
    : appWidth;
  const columns = layout === 'grid' ? Math.max(1, Math.floor((listWidth - 4) / gridCellWidth)) : 1;

  useInput(
    (_input, key) => {
      //? Shift+↑/↓ is left to the detail pane — a diff beside the list scrolls on it
      if (key.shift && (key.upArrow || key.downArrow)) return;
      if (key.upArrow) setSelected((at) => moveInList(items, columns, at, 'up'));
      else if (key.downArrow) setSelected((at) => moveInList(items, columns, at, 'down'));
      else if (layout === 'grid' && key.leftArrow)
        setSelected((at) => moveInList(items, columns, at, 'left'));
      else if (layout === 'grid' && key.rightArrow)
        setSelected((at) => moveInList(items, columns, at, 'right'));
      else if (key.return && current && !current.isHeader && !current.disabled) {
        onActivate?.(current, selected);
      }
    },
    { isActive: isInputActive },
  );

  const contentRows = listDetailContentRows(viewport, layout, reservedChrome);
  // Grid frame: two borders, one title and one scroll indicator.
  const listRows =
    layout === 'grid'
      ? Math.max(3, contentRows - 4)
      : sideBySide
        ? contentRows
        : stackedListRows(contentRows);

  const navigationHints: Hint[] = [
    { key: layout === 'grid' ? '↑/↓/←/→' : '↑/↓', label: 'move' },
    ...(onActivate ? [{ key: 'Enter', label: activateLabel }] : []),
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
          columns={columns}
          cellHeight={layout === 'grid' ? Math.min(gridCellHeight, listRows) : 1}
          renderCell={
            layout === 'grid' && renderGridCell
              ? (item, width, selected) =>
                  renderGridCell(item, width, selected, Math.min(gridCellHeight, listRows))
              : undefined
          }
          emptyText={emptyText ?? 'Nothing to show.'}
          onSelect={setSelected}
          activateOnClick={activateOnClick}
          onWindowChange={onWindowChange}
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
