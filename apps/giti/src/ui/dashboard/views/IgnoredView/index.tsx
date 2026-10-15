import { type DOMElement, Text, useInput } from 'ink';
import { useEffect, useMemo, useRef, useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import HintBar from '@/dev-tools/ui/components/HintBar';
import Panel from '@/dev-tools/ui/components/Panel';
import useClickable from '@/dev-tools/ui/hooks/useClickable';
import useLoader from '@/dev-tools/ui/hooks/useLoader';
import useScrollWindow from '@/dev-tools/ui/hooks/useScrollWindow';
import useViewport from '@/dev-tools/ui/hooks/useViewport';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import {
  applyIgnoredOptions,
  buildIgnoredTree,
  type ClearIgnoredResult,
  clearIgnored,
  formatSize,
  getIgnored,
  type IgnoredNode,
  type IgnoredOptions,
  type IgnoredPreview,
  ignoredPaths,
  measureIgnored,
  previewIgnored,
} from '../../../../core/ignored';
import SpinnerGlyph from '../../SpinnerGlyph';

export interface IgnoredViewProps {
  root: string;
  /** Esc: back to wherever this was opened from. */
  onClose: () => void;
  /** The ticked paths were removed (or some refused); the view rescans on its own afterwards. */
  onCleared: (result: ClearIgnoredResult) => void;
  /** Told true while open — Space, Enter and the arrows belong to the tree, not the app. */
  onCaptureInput?: (captured: boolean) => void;
  /** Chrome drawn around this, by name in the theme's `chrome` table, for the row budget. */
  reservedChrome?: readonly string[];
  /** Paths to leave out or start ticked — from a caller's own cleanup rules. */
  options?: IgnoredOptions;
}

interface Row {
  node: IgnoredNode;
  depth: number;
}

type Tick = 'all' | 'some' | 'none';

const GLYPH: Record<Tick, string> = { all: '[x]', some: '[-]', none: '[ ]' };

const TreeRow = ({
  row,
  tick,
  isCursor,
  isOpen,
  onTick,
  onFold,
}: {
  row: Row;
  tick: Tick;
  isCursor: boolean;
  isOpen: boolean;
  onTick: () => void;
  onFold: () => void;
}) => {
  const colors = useColors();
  const ref = useRef<DOMElement>(null);
  const foldRef = useRef<DOMElement>(null);
  const { isHovered } = useClickable(ref, { onClick: onTick });
  useClickable(foldRef, { onClick: onFold, isActive: !row.node.ignored });
  const { node, depth } = row;
  const tickColor = tick === 'all' ? colors.error : tick === 'some' ? colors.warn : colors.muted;
  const nameColor = isHovered
    ? colors.highlight
    : isCursor
      ? colors.accent
      : node.ignored
        ? colors.text
        : colors.muted;

  return (
    <Box flexDirection="row">
      <Box ref={foldRef} flexShrink={0}>
        <Text color={isCursor ? colors.accent : colors.muted}>
          {`${isCursor ? '❯' : ' '} ${'  '.repeat(depth)}${node.ignored ? ' ' : isOpen ? '▾' : '▸'} `}
        </Text>
      </Box>
      <Box ref={ref} flexDirection="row" flexGrow={1} overflow="hidden">
        <Box flexShrink={0}>
          <Text color={tickColor}>{`${GLYPH[tick]} `}</Text>
        </Box>
        <Box flexGrow={1} flexShrink={1} overflow="hidden">
          <Text color={nameColor} bold={isCursor} wrap="truncate-start">
            {`${node.name}${node.isDir ? '/' : ''}`}
            {node.sensitive && <Text color={colors.warn}>{'  ⚠ may hold secrets'}</Text>}
          </Text>
        </Box>
        <Box flexShrink={0}>
          <Text color={node.ignored ? colors.text : colors.muted}>{` ${formatSize(node.size)}`}</Text>
        </Box>
      </Box>
    </Box>
  );
};

/** Below this the preview sits under the tree rather than beside it — ListDetail's breakpoint. */
const SIDE_BY_SIDE_COLUMNS = 96;

/** Lines one wheel notch scrolls the preview — the step every other pane uses. */
const WHEEL_STEP = 3;

/** The secondary pane: whatever the cursor is on, read before deciding to delete it. */
const PreviewPane = ({
  title,
  preview,
  start,
  rows,
  width,
  onWheel,
}: {
  title: string;
  preview: IgnoredPreview | undefined;
  start: number;
  rows: number;
  width?: string;
  onWheel: (step: number) => void;
}) => {
  const colors = useColors();
  const ref = useRef<DOMElement>(null);
  useClickable(ref, {
    onWheel: (event) => onWheel(event.wheel === 'down' ? WHEEL_STEP : -WHEEL_STEP),
  });
  const lines = preview?.lines ?? [];
  const shown = lines.slice(start, start + rows);
  const position =
    lines.length > rows
      ? ` · ${start + 1}–${Math.min(lines.length, start + rows)} of ${lines.length}`
      : '';

  return (
    <Panel ref={ref} title={title} width={width} grow>
      <Text color={colors.muted} wrap="truncate">
        {preview ? `${preview.summary}${position}` : 'Nothing selected'}
      </Text>
      {shown.map((line, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional; equal lines repeat
        <Text key={start + index} color={colors.text} wrap="truncate">
          {line || ' '}
        </Text>
      ))}
    </Panel>
  );
};

/**
 * Everything git ignores in the work tree — build output, caches, logs, dependencies — as a tree
 * to clear by hand.
 *
 * Nothing starts ticked. Space ticks a row (a folder ticks every ignored path under it), Enter
 * removes what is ticked, at once and for good: there is no undo, which is why nothing is ever
 * pre-selected and why files that look like credentials (`.env`, keys) say so on their row.
 * Biggest first at every level, since the point is usually getting space back.
 *
 * The preview pane beside it shows the start of the file under the cursor, what an ignored
 * folder holds, or which paths a folder row would tick (`previewIgnored`).
 *
 * Keys: ↑/↓ move · ←/→ fold · Space tick · a tick all · Enter clear · PgUp/PgDn or Shift+↑/↓
 * scroll the preview · Esc back. Rows, the fold arrows and the hints are clickable; the wheel
 * over the preview scrolls it.
 */
export const IgnoredView = ({
  root,
  onClose,
  onCleared,
  onCaptureInput,
  reservedChrome = [],
  options,
}: IgnoredViewProps) => {
  const colors = useColors();
  const viewport = useViewport();
  const [scan, setScan] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [ticked, setTicked] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    onCaptureInput?.(true);
    return () => onCaptureInput?.(false);
  }, [onCaptureInput]);

  const { data: scanned, isLoading } = useLoader(
    async () => applyIgnoredOptions(await getIgnored(root), options),
    [root, scan],
  );
  const entries = scanned?.entries;
  //? Preselection applies to the tree as it first opens; after a clear the rescan starts unticked
  const preselectedOnce = useRef(false);
  useEffect(() => {
    if (!scanned || preselectedOnce.current) return;
    preselectedOnce.current = true;
    if (scanned.preselected.length) setTicked(new Set(scanned.preselected));
  }, [scanned]);
  //? Sizes come second: listing is instant, `du` over a big node_modules is not, and the tree is
  //? usable before the numbers arrive
  const { data: sizes } = useLoader(
    () =>
      entries
        ? measureIgnored(
            root,
            entries.map((e) => e.path),
          )
        : Promise.resolve(undefined),
    [entries],
  );
  const tree = buildIgnoredTree(entries ?? [], sizes);

  const rows: Row[] = [];
  const walk = (nodes: IgnoredNode[], depth: number) => {
    for (const node of nodes) {
      rows.push({ node, depth });
      if (!node.ignored && !collapsed.has(node.path)) walk(node.children, depth + 1);
    }
  };
  walk(tree, 0);

  const at = Math.min(cursor, Math.max(0, rows.length - 1));
  const current = rows[at];

  const tickOf = (node: IgnoredNode): Tick => {
    const paths = ignoredPaths(node);
    const count = paths.filter((path) => ticked.has(path)).length;
    return count === 0 ? 'none' : count === paths.length ? 'all' : 'some';
  };

  const toggle = (node: IgnoredNode | undefined) => {
    if (!node || busy) return;
    const paths = ignoredPaths(node);
    const on = tickOf(node) !== 'all';
    setTicked((was) => {
      const next = new Set(was);
      for (const path of paths) {
        if (on) next.add(path);
        else next.delete(path);
      }
      return next;
    });
  };

  const allPaths = tree.flatMap(ignoredPaths);
  const toggleAll = () => {
    if (busy) return;
    setTicked(ticked.size === allPaths.length ? new Set() : new Set(allPaths));
  };

  const fold = (node: IgnoredNode | undefined, open?: boolean) => {
    if (!node || node.ignored) return;
    setCollapsed((was) => {
      const next = new Set(was);
      const shut = open === undefined ? !was.has(node.path) : !open;
      if (shut) next.add(node.path);
      else next.delete(node.path);
      return next;
    });
  };

  const parentRow = (index: number) => {
    const depth = rows[index]?.depth ?? 0;
    for (let i = index - 1; i >= 0; i--) if ((rows[i]?.depth ?? 0) < depth) return i;
    return index;
  };

  const sizeOf = (paths: Set<string>) => {
    let total = 0;
    for (const path of paths) {
      const size = sizes?.get(path);
      if (size === undefined) return undefined;
      total += size;
    }
    return total;
  };

  const clear = async () => {
    if (busy || ticked.size === 0) return;
    setBusy(true);
    const result = await clearIgnored(root, [...ticked]);
    setTicked(new Set());
    setBusy(false);
    onCleared(result);
    setScan((n) => n + 1);
  };

  //? The preview reads at most 64 KB, so it is cheap enough to redo on every cursor move
  const previewPath = current?.node.path;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the row's path and a rescan are the triggers
  const preview = useMemo(
    () => (current ? previewIgnored(root, current.node) : undefined),
    [root, previewPath, scan, entries],
  );
  const [previewStart, setPreviewStart] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a different row is read from its top
  useEffect(() => setPreviewStart(0), [previewPath]);

  const contentRows = Math.max(
    3,
    viewport.contentRows(['viewHeader', 'panelFrame', 'viewHints', ...reservedChrome], 3),
  );
  //? Side by side where both panes still have room to say something; stacked below that, the
  //? same breakpoint ListDetail uses everywhere else in the dashboard
  const sideBySide = viewport.columns >= SIDE_BY_SIDE_COLUMNS;
  const listRows = sideBySide ? contentRows : Math.max(3, Math.floor((contentRows - 3) / 2));
  //? One row of the preview pane is its summary line
  const previewRows = Math.max(1, (sideBySide ? contentRows : contentRows - 3 - listRows) - 1);
  const previewLines = preview?.lines ?? [];
  const previewLast = Math.max(0, previewLines.length - previewRows);
  const scrollPreview = (step: number) =>
    setPreviewStart((was) => Math.max(0, Math.min(previewLast, was + step)));

  useInput((input, key) => {
    if (busy) return;
    if (key.escape || input === 'q') onClose();
    else if (key.shift && key.upArrow) scrollPreview(-1);
    else if (key.shift && key.downArrow) scrollPreview(1);
    else if (key.pageUp) scrollPreview(-previewRows);
    else if (key.pageDown) scrollPreview(previewRows);
    else if (key.upArrow || input === 'k') setCursor(Math.max(0, at - 1));
    else if (key.downArrow || input === 'j') setCursor(Math.min(rows.length - 1, at + 1));
    else if (key.rightArrow || input === 'l') fold(current?.node, true);
    else if (key.leftArrow || input === 'h') {
      //? On an open folder ← folds it; anywhere else it climbs to the folder above
      if (current && !current.node.ignored && !collapsed.has(current.node.path)) {
        fold(current.node, false);
      } else setCursor(parentRow(at));
    } else if (input === ' ') toggle(current?.node);
    else if (input === 'a') toggleAll();
    else if (key.return) void clear();
  });

  const [start] = useScrollWindow(rows.length, at, listRows);
  const shown = rows.slice(start, start + listRows);

  const total = sizeOf(new Set(allPaths));
  const tickedSize = sizeOf(ticked);
  const header = busy
    ? 'Removing…'
    : isLoading && !entries
      ? 'Reading ignored files…'
      : ticked.size
        ? `${ticked.size} ticked · ${formatSize(tickedSize)} — Enter removes them for good`
        : allPaths.length
          ? `${allPaths.length} ignored paths · nothing ticked — Space ticks a row`
          : 'Nothing ignored in this work tree';

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexShrink={0}>
        <Text wrap="truncate" color={ticked.size ? colors.warn : colors.muted}>
          {(busy || (isLoading && !entries)) && <SpinnerGlyph />}
          {header}
        </Text>
      </Box>
      <Box flexDirection={sideBySide ? 'row' : 'column'} flexGrow={1} overflow="hidden">
        <Panel
          title="Ignored files"
          badge={allPaths.length ? formatSize(total) : undefined}
          width={sideBySide ? '55%' : undefined}
          isFocused
          grow
        >
          {rows.length === 0 ? (
            <Text color={colors.muted}>
              {isLoading ? 'Scanning…' : 'git ignores nothing here — nothing to clear.'}
            </Text>
          ) : (
            shown.map((row, index) => (
              <TreeRow
                key={row.node.path}
                row={row}
                tick={tickOf(row.node)}
                isCursor={start + index === at}
                isOpen={!collapsed.has(row.node.path)}
                onTick={() => {
                  setCursor(start + index);
                  toggle(row.node);
                }}
                onFold={() => {
                  setCursor(start + index);
                  fold(row.node);
                }}
              />
            ))
          )}
        </Panel>
        <PreviewPane
          title={current ? `${current.node.name}${current.node.isDir ? '/' : ''}` : 'Preview'}
          preview={preview}
          start={previewStart}
          rows={previewRows}
          width={sideBySide ? '45%' : undefined}
          onWheel={scrollPreview}
        />
      </Box>
      <Box flexShrink={0} marginTop={1}>
        <HintBar
          isActive={!busy}
          hints={[
            { key: 'Space', label: 'tick', onPress: () => toggle(current?.node) },
            {
              key: 'Enter',
              label: ticked.size ? `remove ${ticked.size}` : 'remove ticked',
              onPress: ticked.size ? () => void clear() : undefined,
            },
            {
              key: 'a',
              label: allPaths.length && ticked.size === allPaths.length ? 'untick all' : 'tick all',
              onPress: toggleAll,
            },
            { key: 'Esc', label: 'back', onPress: onClose },
            { key: '←/→', label: 'fold' },
            { key: 'PgUp/PgDn', label: 'scroll preview' },
          ]}
        />
      </Box>
    </Box>
  );
};

export default IgnoredView;
