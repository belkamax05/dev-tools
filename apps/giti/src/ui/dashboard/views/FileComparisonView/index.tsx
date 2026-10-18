import { type DOMElement, measureElement, Text, useInput } from 'ink';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import ActionButton from '@/dev-tools/ui/components/ActionButton';
import Box from '@/dev-tools/ui/components/Box';
import Panel from '@/dev-tools/ui/components/Panel';
import ScrollPanel from '@/dev-tools/ui/components/ScrollPanel';
import useClickable from '@/dev-tools/ui/hooks/useClickable';
import useLoader from '@/dev-tools/ui/hooks/useLoader';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import highlightCode, { wrapCodeLine } from '@/dev-tools/ui/utils/highlightCode';
import useViewport from '@/dev-tools/ui/hooks/useViewport';

import fileComparison from '../../../../core/fileComparison';
import type { FileChange } from '../../../../core/status';

interface FileComparisonViewProps {
  root: string;
  change: FileChange;
  side: 'staged' | 'unstaged';
  refreshKey: number;
  onClose: () => void;
  onCaptureInput: (captured: boolean) => void;
}

const FileComparisonView = ({
  root,
  change,
  side,
  refreshKey,
  onClose,
  onCaptureInput,
}: FileComparisonViewProps) => {
  const colors = useColors();
  const [focused, setFocused] = useState<'before' | 'after'>('after');
  const [synced, setSynced] = useState(true);
  const [offsets, setOffsets] = useState({ before: 0, after: 0 });
  const scroll = (side: 'before' | 'after', offset: number) =>
    setOffsets((previous) =>
      synced ? { before: offset, after: offset } : { ...previous, [side]: offset },
    );
  const toggleSync = () => {
    if (!synced)
      setOffsets((previous) => ({ before: previous[focused], after: previous[focused] }));
    setSynced((previous) => !previous);
  };
  const left = useRef<DOMElement>(null);
  const right = useRef<DOMElement>(null);
  useClickable(left, { onClick: () => setFocused('before') });
  useClickable(right, { onClick: () => setFocused('after') });
  useEffect(() => {
    onCaptureInput(true);
    return () => onCaptureInput(false);
  }, [onCaptureInput]);
  useInput((input, key) => {
    if (key.escape) onClose();
    else if (key.tab) setFocused((side) => (side === 'before' ? 'after' : 'before'));
    else if (input === '[') setFocused('before');
    else if (input === ']') setFocused('after');
    else if (input === 's') toggleSync();
  });
  const { data, error } = useLoader(
    () => fileComparison(root, change, side),
    [root, change.path, side, refreshKey],
  );
  const viewport = useViewport();
  const [codeWidth, setCodeWidth] = useState(30);
  useLayoutEffect(() => {
    if (left.current)
      setCodeWidth(Math.max(1, Math.floor(measureElement(left.current).width) - 13));
  }, [viewport, data]);
  const aligned = useMemo(() => {
    if (!data) return [];
    const before = highlightCode(data.before, change.origPath ?? change.path);
    const after = highlightCode(data.after, change.path);
    return data.rows.map((row) => {
      const a = wrapCodeLine(row.before ? (before[row.before - 1] ?? []) : [], codeWidth);
      const b = wrapCodeLine(row.after ? (after[row.after - 1] ?? []) : [], codeWidth);
      return { ...row, left: a, right: b, height: Math.max(a.length, b.length) };
    });
  }, [data, change.path, change.origPath, codeWidth]);
  const tokenColor = (role: string) => {
    if (/comment|quote/.test(role)) return colors.muted;
    if (/keyword|literal|selector|meta/.test(role)) return colors.highlight;
    if (/string|regexp/.test(role)) return colors.ok;
    if (/number|symbol|bullet/.test(role)) return colors.warn;
    if (/title|name|attr|built_in|type/.test(role)) return colors.accent;
    return colors.text;
  };
  const source = (side: 'before' | 'after') =>
    aligned.map((row, index) => {
      const number = row[side];
      const chunks = side === 'before' ? row.left : row.right;
      return (
        <Box key={index} height={row.height} flexShrink={0} flexDirection="column">
          {Array.from({ length: row.height }, (_, line) => (
            <Text key={line} wrap="truncate">
              <Text
                color={
                  row.changed && number
                    ? side === 'before'
                      ? colors.error
                      : colors.ok
                    : colors.muted
                }
              >
                {line === 0 && number
                  ? String(number).padStart(5) +
                    (row.changed ? (side === 'before' ? ' − ' : ' + ') : '   ')
                  : '        '}
              </Text>
              {(chunks[line] ?? []).map((token, i) => (
                <Text key={i} color={tokenColor(token.role)}>
                  {token.text}
                </Text>
              ))}
            </Text>
          ))}
        </Box>
      );
    });
  return (
    <Box flexDirection="column" flexGrow={1} minHeight={0}>
      <Box flexShrink={0}>
        <Text bold color={colors.heading}>
          {change.path} · Side by side{' '}
        </Text>
        <ActionButton hotkey="Esc" label="Back" onPress={onClose} />
      </Box>
      <Box flexShrink={0}>
        <ActionButton hotkey="s" label="Sync scroll" isOn={synced} onPress={toggleSync} />
        <ActionButton
          hotkey="["
          label="Left"
          isOn={focused === 'before'}
          onPress={() => setFocused('before')}
        />
        <ActionButton
          hotkey="]"
          label="Right"
          isOn={focused === 'after'}
          onPress={() => setFocused('after')}
        />
        <Text color={colors.muted}>
          {' '}
          Tab selects side · PgUp/PgDn · wheel or drag each scrollbar
        </Text>
      </Box>
      {error ? (
        <Text color={colors.error}>{error}</Text>
      ) : !data ? (
        <Text>Reading file revisions…</Text>
      ) : data.binary ? (
        <Text>Binary file — no text comparison.</Text>
      ) : (
        <Box flexDirection="row" flexGrow={1} minHeight={0}>
          <Box ref={left} width="50%" flexDirection="column">
            <Panel
              title={side === 'staged' ? 'HEAD' : 'Index (staged)'}
              grow
              isFocused={focused === 'before'}
            >
              <ScrollPanel
                isActive={focused === 'before'}
                isMouseActive
                keyboardMode="preview"
                scrollOffset={offsets.before}
                onScroll={(offset) => scroll('before', offset)}
              >
                {source('before')}
              </ScrollPanel>
            </Panel>
          </Box>
          <Box ref={right} width="50%" flexDirection="column">
            <Panel
              title={side === 'staged' ? 'Index (staged)' : 'Working copy'}
              grow
              isFocused={focused === 'after'}
            >
              <ScrollPanel
                isActive={focused === 'after'}
                isMouseActive
                keyboardMode="preview"
                scrollOffset={offsets.after}
                onScroll={(offset) => scroll('after', offset)}
              >
                {source('after')}
              </ScrollPanel>
            </Panel>
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default FileComparisonView;
