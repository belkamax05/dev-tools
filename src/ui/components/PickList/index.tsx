import { type DOMElement, Text } from 'ink';
import { useEffect, useMemo, useRef } from 'react';

import useClickable from '../../hooks/useClickable';
import useScrollWindow from '../../hooks/useScrollWindow';
import { useColors } from '../../providers/TuiThemeProvider';
import Box from '../Box';

/**
 * One row of a `PickList`.
 *
 * A header is a row that draws but cannot be landed on — the group names that
 * make a long catalogue readable. Keeping them in the same array as the options,
 * rather than nesting sections, is what lets one cursor and one scroll window
 * serve the whole list.
 */
export interface PickItem<T = unknown> {
  id: string;
  label: string;
  /** Secondary text, dimmed. Dropped in grid mode, where there is no room. */
  hint?: string;
  value?: T;
  isHeader?: boolean;
  disabled?: boolean;
  /** Marks the option that is currently in force, independent of the cursor. */
  isCurrent?: boolean;
}

interface PickCellProps<T> {
  item: PickItem<T>;
  /**
   * Cells to pad the label into, or undefined to let the row flex.
   *
   * Only a caller that gave the list a width knows how wide a cell is; a list
   * that is flexing does not, and guessing produces labels truncated to a width
   * the panel never had. So the two cases lay out differently: a measured list
   * pads its labels into a column, a flexing one lets Yoga place them.
   */
  width?: number;
  isSelected: boolean;
  isFocused: boolean;
  onHover: (hovered: boolean) => void;
  onClick: () => void;
}

const PickCell = <T,>({
  item,
  width,
  isSelected,
  isFocused,
  onHover,
  onClick,
}: PickCellProps<T>) => {
  const colors = useColors();
  const ref = useRef<DOMElement>(null);
  const { isHovered } = useClickable(ref, {
    onClick,
    isActive: !item.isHeader && !item.disabled,
  });

  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;
  useEffect(() => {
    onHoverRef.current(isHovered);
  }, [isHovered]);

  if (item.isHeader) {
    return (
      <Box>
        <Text bold color={colors.muted} wrap="truncate">
          {item.label.toUpperCase()}
        </Text>
      </Box>
    );
  }

  const highlight = isHovered || (isSelected && isFocused);
  const color = item.disabled
    ? colors.muted
    : highlight
      ? colors.accentText
      : isSelected
        ? colors.accent
        : item.isCurrent
          ? colors.ok
          : colors.text;

  //? The marker column is two cells wide and always drawn, so the labels line up
  //? whether or not anything is selected — a list whose text shifts sideways as
  //? the cursor moves is unreadable while it moves.
  const marker = isSelected ? '❯ ' : item.isCurrent ? '• ' : '  ';
  const hint = item.hint ?? '';

  //? Measured list: pad the label so the hints line up into a column. The
  //? separating space is only spent when there is a hint to separate from —
  //? charging for it either way costs the label a column on every row that has
  //? no hint, which is exactly enough to truncate the longest category name.
  let labelText = item.label;
  if (width !== undefined) {
    const room = Math.max(1, width - marker.length - (hint === '' ? 0 : hint.length + 1));
    labelText = item.label.length > room ? item.label.slice(0, room) : item.label.padEnd(room);
  }

  return (
    <Box
      ref={ref}
      width={width}
      //? A flexing cell has to claim the row, or the spacer below it has nothing
      //? to distribute and the hint is drawn hard against the end of the label
      //? instead of at the right edge. A measured cell must not, or it would
      //? stretch past the column width it was given.
      flexGrow={width === undefined ? 1 : 0}
      backgroundColor={highlight ? colors.accent : undefined}
    >
      <Text color={color} bold={isSelected || item.isCurrent} wrap="truncate">
        {marker}
        {labelText}
      </Text>
      {hint !== '' && (
        <>
          {/* Flexing list: the spacer is what puts the hint at the right edge,
              since there is no known width to pad against. */}
          {width === undefined && <Box flexGrow={1} />}
          <Text color={highlight ? colors.accentText : colors.muted} wrap="truncate">
            {' '}
            {hint}
          </Text>
        </>
      )}
    </Box>
  );
};

/**
 * The list laid out as terminal rows.
 *
 * Headers always take a row to themselves; the options between two headers pack
 * across it. Packing per group rather than across the whole list is what keeps a
 * group's first entry at the start of a row, so the groups stay visually
 * separate instead of running together at whatever column the last one ended on.
 */
export const packRows = <T,>(items: PickItem<T>[], columns: number): number[][] => {
  if (columns <= 1) return items.map((_, index) => [index]);

  const rows: number[][] = [];
  let row: number[] = [];
  const flush = () => {
    if (row.length > 0) rows.push(row);
    row = [];
  };

  items.forEach((item, index) => {
    if (item.isHeader) {
      flush();
      rows.push([index]);
      return;
    }
    row.push(index);
    if (row.length === columns) flush();
  });
  flush();
  return rows;
};

export interface PickListProps<T> {
  title?: string;
  items: PickItem<T>[];
  /** Index into `items`. Headers are skipped by `nextSelectable`. */
  selected: number;
  isFocused?: boolean;
  visibleRows: number;
  width?: number;
  /**
   * Lay short options out across the panel instead of one per row. The width is
   * there whether or not it gets used, and a long catalogue read one entry per
   * row is a scroll where it could have been a glance.
   */
  columns?: number;
  borderColor?: string;
  /** Shown in place of the rows when there is nothing to list. */
  emptyText?: string;
  onSelect: (index: number) => void;
  onActivate: (index: number) => void;
  onHover?: (index: number | null) => void;
}

/**
 * A scrolling list of options, driven by the mouse as readily as the keyboard.
 *
 * Ink draws every child it is given, so a list longer than the terminal spills
 * off the bottom and takes the layout with it. Everything here follows from
 * that: the rows are windowed, the window follows the cursor, and the wheel
 * moves the window without moving the cursor — which is what a wheel does
 * everywhere else.
 */
export const PickList = <T,>({
  title,
  items,
  selected,
  isFocused = true,
  visibleRows,
  width,
  columns = 1,
  borderColor,
  emptyText = 'Nothing here.',
  onSelect,
  onActivate,
  onHover,
}: PickListProps<T>) => {
  const colors = useColors();
  const rows = useMemo(() => packRows(items, columns), [items, columns]);
  const selectedRow = useMemo(
    () =>
      Math.max(
        0,
        rows.findIndex((row) => row.includes(selected)),
      ),
    [rows, selected],
  );

  const size = Math.max(1, visibleRows);
  const [start, setStart] = useScrollWindow(rows.length, selectedRow, size);
  const shown = rows.slice(start, start + size);

  const ref = useRef<DOMElement>(null);
  useClickable(ref, {
    onWheel: (event) => {
      const last = Math.max(0, rows.length - size);
      setStart((at) => (event.wheel === 'down' ? Math.min(at + 3, last) : Math.max(0, at - 3)));
    },
  });

  //? Two columns of border and two of padding are not available to the text.
  //? Unknown until the caller says how wide it is — a flexing list lets Yoga
  //? place its cells rather than padding them into a column that may not exist.
  const inner = width === undefined ? undefined : Math.max(4, width - 4);
  const cellWidth = inner === undefined ? undefined : Math.max(6, Math.floor(inner / columns));
  const frameColor = borderColor ?? (isFocused ? colors.accent : colors.muted);
  const hiddenRows = rows.length - start - size;

  return (
    <Box
      ref={ref}
      flexDirection="column"
      width={width}
      borderStyle="round"
      borderColor={frameColor}
      paddingX={1}
      flexGrow={width === undefined ? 1 : 0}
      flexShrink={0}
    >
      {title !== undefined && (
        <Box justifyContent="space-between">
          <Text bold color={frameColor}>
            {title}
          </Text>
          {items.length > 0 && (
            <Text color={colors.muted}>
              {selected + 1}/{items.length}
            </Text>
          )}
        </Box>
      )}

      {items.length === 0 ? (
        <Text color={colors.muted} wrap="truncate">
          {emptyText}
        </Text>
      ) : (
        shown.map((row) => (
          <Box key={`row-${row[0]}`} flexDirection="row">
            {row.map((index) => {
              const item = items[index] as PickItem<T>;
              return (
                <PickCell
                  key={item.id}
                  item={item}
                  width={item.isHeader ? inner : cellWidth}
                  isSelected={index === selected}
                  isFocused={isFocused}
                  onHover={(hovered) => onHover?.(hovered ? index : null)}
                  onClick={() => {
                    onSelect(index);
                    onActivate(index);
                  }}
                />
              );
            })}
          </Box>
        ))
      )}

      {hiddenRows > 0 && (
        <Text color={colors.muted} wrap="truncate">
          {'  '}
          {hiddenRows} more row{hiddenRows === 1 ? '' : 's'} ↓
        </Text>
      )}
    </Box>
  );
};

/**
 * The next row a cursor may rest on, skipping headers and disabled options.
 *
 * Returns the index unchanged when there is nowhere to go, so a cursor at the
 * end of a list stays put rather than wrapping onto a heading.
 */
export const nextSelectable = <T,>(items: PickItem<T>[], from: number, step: number): number => {
  for (let index = from + step; index >= 0 && index < items.length; index += step) {
    const item = items[index];
    if (item && !item.isHeader && !item.disabled) return index;
  }
  return from;
};

/** The first row a cursor may rest on — where a freshly built list starts. */
export const firstSelectable = <T,>(items: PickItem<T>[]): number => nextSelectable(items, -1, 1);

/**
 * Where an arrow key lands in a list laid out `columns` wide.
 *
 * Left and right step one option; up and down move a whole row, which in a
 * single-column list is the same thing. Landing on a header or a disabled option
 * carries on in the same direction rather than stopping, so the cursor never
 * parks somewhere Enter would do nothing.
 */
export const moveInList = <T,>(
  items: PickItem<T>[],
  columns: number,
  from: number,
  direction: 'up' | 'down' | 'left' | 'right',
): number => {
  if (direction === 'left') return nextSelectable(items, from, -1);
  if (direction === 'right') return nextSelectable(items, from, 1);

  const rows = packRows(items, columns);
  const rowAt = rows.findIndex((row) => row.includes(from));
  if (rowAt === -1) return firstSelectable(items);
  const column = Math.max(0, (rows[rowAt] as number[]).indexOf(from));

  const step = direction === 'down' ? 1 : -1;
  for (let index = rowAt + step; index >= 0 && index < rows.length; index += step) {
    const row = rows[index] as number[];
    //? Short row — the last row of a group — takes the nearest column it has.
    const candidate = row[Math.min(column, row.length - 1)] as number;
    const item = items[candidate];
    if (item && !item.isHeader && !item.disabled) return candidate;
  }
  return from;
};

export default PickList;
