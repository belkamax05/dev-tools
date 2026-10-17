import { type DOMElement, Text, useInput } from 'ink';
import { useEffect, useMemo, useRef, useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import useClickable from '@/dev-tools/ui/hooks/useClickable';
import useScrollbarDrag from '@/dev-tools/ui/hooks/useScrollbarDrag';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import { appendLog, classifyLine, type LineTone } from '../../../core/logs';
import type { LogChunk, StepRun } from '../../../core/plugin';

/** How often a live log is read again. */
const POLL_MS = 3_000;

export interface LogPanelProps {
  run: StepRun;
  /** Which step and run this is — the log is read from scratch only when it changes. */
  runKey: string;
  /** Read the run's log from a byte offset — through the step's plugin, read-only. */
  read: (run: StepRun, start: number) => Promise<LogChunk>;
  rows: number;
  width: number;
  /** Older / newer run of the same step: `,` and `.`. */
  onOtherRun: (delta: number) => void;
  runIndex: number;
  runCount: number;
  isActive: boolean;
}

/**
 * A run's log, highlighted, following its tail while it runs: read in chunks from the last byte
 * offset every few seconds, so a long build is never downloaded twice. PgUp/PgDn (or Shift+↑/↓)
 * scroll and stop following, `G` follows again, `g` goes to the top.
 */
export const LogPanel = ({
  run,
  runKey,
  read,
  rows,
  width,
  onOtherRun,
  runIndex,
  runCount,
  isActive,
}: LogPanelProps) => {
  const colors = useColors();
  const [lines, setLines] = useState<string[]>([]);
  const [partial, setPartial] = useState('');
  const [live, setLive] = useState(false);
  const [note, setNote] = useState<string>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  //? Lines up from the bottom; 0 follows the tail
  const [scroll, setScroll] = useState(0);
  //? The chain is re-read while a step runs, handing in a fresh `run` each time: read through refs,
  //? so only a different run (runKey) starts the log again from byte 0
  const runRef = useRef(run);
  runRef.current = run;
  const readRef = useRef(read);
  readRef.current = read;

  // biome-ignore lint/correctness/useExhaustiveDependencies: runKey stands for run and read
  useEffect(() => {
    let alive = true;
    let next = 0;
    let acc: string[] = [];
    let rest = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    setLines([]);
    setPartial('');
    setNote(undefined);
    setError(undefined);
    setLoading(true);
    setScroll(0);
    const tick = async () => {
      try {
        const chunk = await readRef.current(runRef.current, next);
        if (!alive) return;
        next = chunk.next;
        setNote(chunk.unavailable);
        ({ lines: acc, partial: rest } = appendLog(acc, rest, chunk.text));
        setLines(acc);
        setPartial(rest);
        setLive(chunk.more);
        setError(undefined);
        if (chunk.more) timer = setTimeout(tick, POLL_MS);
      } catch (failure) {
        if (alive) setError((failure as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    };
    tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [runKey]);

  const all = useMemo(() => (partial ? [...lines, partial] : lines), [lines, partial]);
  //? The header row, and the note when there is one, come out of the rows for lines
  const body = Math.max(1, rows - 1 - (note ? 2 : 0));
  const maxScroll = Math.max(0, all.length - body);
  const offset = Math.min(scroll, maxScroll);
  const shown = all.slice(Math.max(0, all.length - body - offset), all.length - offset);

  /** Up (into older lines) by a positive count; down towards the tail by a negative one. */
  const scrollBy = (lines: number) =>
    setScroll((at) => Math.max(0, Math.min(maxScroll, Math.min(at, maxScroll) + lines)));

  //? The wheel over the panel scrolls it, three lines a notch, as most terminals do
  const rootRef = useRef<DOMElement>(null);
  const trackRef = useRef<DOMElement>(null);
  useClickable(rootRef, {
    onWheel: (event) => scrollBy(event.wheel === 'up' ? 3 : -3),
    isActive,
  });

  //? Keys that work in every terminal (j/k, Space) beside the ones some terminals keep for
  //? themselves (PgUp/PgDn, Shift+↑/↓)
  useInput(
    (input, key) => {
      if (key.pageUp || (key.ctrl && input === 'u'))
        scrollBy(key.pageUp ? body : Math.ceil(body / 2));
      else if (key.pageDown || input === ' ' || (key.ctrl && input === 'd'))
        scrollBy(-(key.ctrl ? Math.ceil(body / 2) : body));
      else if (input === 'k' || (key.shift && key.upArrow)) scrollBy(1);
      else if (input === 'j' || (key.shift && key.downArrow)) scrollBy(-1);
      else if (input === 'g' || key.home) setScroll(maxScroll);
      else if (input === 'G' || key.end) setScroll(0);
      else if (input === ',') onOtherRun(1);
      else if (input === '.') onOtherRun(-1);
    },
    { isActive },
  );

  //? A scrollbar beside the lines: where the window is in the whole log
  const thumb = all.length > body ? Math.max(1, Math.round((body * body) / all.length)) : body;
  const thumbTop =
    all.length > body
      ? Math.round(((maxScroll - offset) / Math.max(1, maxScroll)) * (body - thumb))
      : 0;

  useScrollbarDrag(trackRef, {
    thumbTop,
    thumbSize: thumb,
    rows: body,
    maxOffset: maxScroll,
    onChange: (top) => setScroll(maxScroll - top),
    isActive,
  });

  const tone: Record<LineTone, string> = {
    error: colors.error,
    warn: colors.warn,
    ok: colors.ok,
    command: colors.accent,
    heading: colors.heading,
    muted: colors.muted,
    text: colors.text,
  };

  const status = loading
    ? 'reading…'
    : error
      ? `✗ ${error}`
      : `${all.length} lines · ${live ? '● live' : 'finished'} · ${offset ? `↑ ${offset} — [G] follow` : 'following'}`;

  return (
    <Box ref={rootRef} flexDirection="column" flexShrink={0}>
      <Text wrap="truncate">
        <Text color={colors.heading} bold>
          {run.label}
        </Text>
        <Text color={colors.muted}>
          {' '}
          {runIndex + 1}/{runCount} [,] older [.] newer ·{' '}
        </Text>
        <Text color={error ? colors.error : live ? colors.accent : colors.muted}>{status}</Text>
      </Text>
      {note && (
        <Text color={colors.warn} wrap="truncate-end">
          {note}
        </Text>
      )}
      <Box flexDirection="row" flexShrink={0}>
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          {shown.map((raw, index) => {
            const line = classifyLine(raw);
            const time = line.time?.slice(11, 19);
            return (
              <Text key={index} wrap="truncate-end">
                {time && <Text color={colors.muted}>{time} </Text>}
                <Text
                  color={tone[line.tone]}
                  bold={line.tone === 'heading' || line.tone === 'error'}
                >
                  {line.text.slice(0, width + 10) || ' '}
                </Text>
              </Text>
            );
          })}
        </Box>
        {all.length > body && (
          <Box ref={trackRef} flexDirection="column" width={1} flexShrink={0} marginLeft={1}>
            {Array.from({ length: Math.min(body, shown.length) }, (_, row) => (
              <Text
                key={`bar-${row}`}
                color={row >= thumbTop && row < thumbTop + thumb ? colors.accent : colors.muted}
              >
                {row >= thumbTop && row < thumbTop + thumb ? '┃' : '│'}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default LogPanel;
