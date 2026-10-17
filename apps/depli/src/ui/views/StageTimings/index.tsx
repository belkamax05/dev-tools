import { Text, useInput } from 'ink';
import { useEffect, useRef, useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import ActionButton from '@/dev-tools/ui/components/ActionButton';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import type { RunTimings, StageTiming, StepRun } from '../../../core/plugin';

export const duration = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};
const icons: Record<StageTiming['state'], string> = {
  pending: '·',
  running: '◐',
  paused: 'Ⅱ',
  success: '✓',
  failure: '✗',
  aborted: '⊘',
  skipped: '–',
  other: '?',
};

/** Selected-run timings refresh independently of the chain, only while the run remains active. */
export const StageTimings = ({
  run,
  read,
  runKey,
  isActive = true,
  expanded,
  onExpandedChange,
  title = 'Timings',
  toggleKey = 's',
  showBranch = false,
  stale = false,
}: {
  run: StepRun;
  read: (run: StepRun) => Promise<RunTimings>;
  runKey: string;
  isActive?: boolean;
  title?: string;
  toggleKey?: string | null;
  showBranch?: boolean;
  stale?: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) => {
  const colors = useColors();
  const [timings, setTimings] = useState<RunTimings>();
  useInput(
    (input) => {
      if (toggleKey && input === toggleKey) onExpandedChange(!expanded);
    },
    { isActive },
  );
  const [error, setError] = useState<string>();
  const readRef = useRef(read);
  readRef.current = read;
  const runRef = useRef(run);
  runRef.current = run;
  // biome-ignore lint/correctness/useExhaustiveDependencies: runKey identifies the selected run; other inputs stay fresh via refs
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setTimings(undefined);
    setError(undefined);
    const tick = async () => {
      try {
        const next = await readRef.current(runRef.current);
        if (!live) return;
        setTimings(next);
        setError(undefined);
        if (next.more) timer = setTimeout(tick, 3_000);
      } catch (failure) {
        if (!live) return;
        setError((failure as Error).message);
        if (runRef.current.state === 'running' || runRef.current.state === 'queued')
          timer = setTimeout(tick, 5_000);
      }
    };
    tick();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [runKey]);

  const state =
    timings && !timings.unavailable
      ? timings.more
        ? 'running'
        : (timings.state ?? (run.state === 'running' ? 'success' : run.state))
      : run.state;
  const status =
    state === 'running'
      ? 'Running'
      : state === 'queued'
        ? 'Queued'
        : state === 'failure'
          ? 'Failed'
          : state === 'aborted'
            ? 'Aborted'
            : 'Complete';
  const showStale = stale && status === 'Complete';
  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      marginBottom={1}
      borderStyle="round"
      borderColor={colors.muted}
      paddingX={1}
    >
      <ActionButton
        hotkey={toggleKey ?? undefined}
        label={`${expanded ? '▾' : '▸'} ${title} · ${run.label}${showStale ? ' · Stale' : ''} · ${status}`}
        color={showStale ? colors.warn : colors.heading}
        onPress={() => onExpandedChange(!expanded)}
        disabled={!isActive}
      />
      {showBranch && run.branch && (
        <Text color={colors.heading} wrap="wrap">
          {run.branch}
        </Text>
      )}
      {timings && !timings.unavailable && (
        <Text wrap="wrap">
          <Text color={colors.text}>
            {timings.more ? 'Elapsed ' : 'Total '}
            {timings.elapsedMs === undefined ? '—' : duration(timings.elapsedMs)}
          </Text>
          <Text color={colors.muted}>
            {timings.estimatedTotalMs === undefined
              ? ' · estimate unavailable'
              : ` · ${timings.more ? 'est. total' : 'avg total'} ~${duration(timings.estimatedTotalMs)}`}
          </Text>
          {timings.more &&
            timings.elapsedMs !== undefined &&
            timings.estimatedTotalMs !== undefined && (
              <Text
                color={timings.elapsedMs > timings.estimatedTotalMs ? colors.warn : colors.accent}
              >
                {timings.elapsedMs > timings.estimatedTotalMs
                  ? ` · ${duration(timings.elapsedMs - timings.estimatedTotalMs)} past average`
                  : ` · ~${duration(timings.estimatedTotalMs - timings.elapsedMs)} left`}
              </Text>
            )}
        </Text>
      )}
      {!expanded &&
        timings?.more &&
        timings.stages
          .filter((stage) => stage.state === 'running' || stage.state === 'paused')
          .map((stage) => (
            <Text key={stage.id} color={colors.accent} wrap="wrap">
              {icons[stage.state]} {stage.label}
              {stage.state === 'paused' ? ' · waiting for input' : ''}
            </Text>
          ))}
      {error && (
        <Text color={colors.warn} wrap="wrap">
          Could not read stage timings: {error}
        </Text>
      )}
      {!timings && !error && <Text color={colors.muted}>Reading stage timings…</Text>}
      {timings?.unavailable && (
        <Text color={colors.muted} wrap="wrap">
          {timings.unavailable}
          {showBranch ? '' : ' [l] opens logs.'}
        </Text>
      )}
      {expanded && timings && !timings.unavailable && (
        <>
          <Text color={colors.muted} wrap="wrap">
            {timings.previousRuns.length
              ? `Average of earlier successful builds of this job: ${timings.previousRuns.map((id) => `#${id}`).join(', ')}`
              : 'No earlier successful builds to compare.'}
          </Text>
          {!timings.stages.length && <Text color={colors.muted}>Waiting for the first stage…</Text>}
          {timings.stages.map((stage) => {
            const running = stage.state === 'running' || stage.state === 'paused';
            const elapsed = stage.durationMs;
            const average = stage.averageMs;
            const over = elapsed !== undefined && average !== undefined && elapsed > average;
            const color =
              stage.state === 'failure' || stage.state === 'aborted'
                ? colors.error
                : stage.state === 'success'
                  ? colors.ok
                  : running
                    ? colors.accent
                    : colors.muted;
            const delta =
              elapsed !== undefined && average !== undefined ? elapsed - average : undefined;
            const ratio =
              elapsed !== undefined &&
              average !== undefined &&
              average > 0 &&
              stage.state !== 'skipped'
                ? elapsed / average
                : undefined;
            return (
              <Box key={stage.id} flexDirection="column" flexShrink={0}>
                <Text color={color} bold={running} wrap="wrap">
                  {icons[stage.state]} {stage.label}
                  {stage.state === 'pending'
                    ? ' · pending (previous build)'
                    : stage.state === 'paused'
                      ? ' · waiting for input'
                      : running
                        ? ' · running'
                        : stage.state === 'skipped'
                          ? ' · skipped'
                          : ''}
                </Text>
                <Text wrap="wrap">
                  <Text color={color}>
                    {' '}
                    {elapsed === undefined || stage.state === 'skipped' ? '—' : duration(elapsed)}
                  </Text>
                  <Text color={colors.muted}>
                    {average === undefined
                      ? ' · no baseline'
                      : ` / avg ${duration(average)} (${stage.samples})`}
                  </Text>
                  {delta !== undefined &&
                    stage.state !== 'skipped' &&
                    stage.state !== 'pending' && (
                      <Text color={over ? colors.warn : colors.muted}>
                        {running
                          ? over
                            ? ` · ${duration(delta)} over avg`
                            : ' · elapsed'
                          : ` · ${delta >= 0 ? '+' : '−'}${duration(Math.abs(delta))}`}
                      </Text>
                    )}
                </Text>
                {ratio !== undefined && (
                  <Text color={over ? colors.warn : color}>
                    {' '}
                    {'━'.repeat(Math.min(12, Math.round(ratio * 12)))}
                    <Text color={colors.muted}>
                      {'─'.repeat(Math.max(0, 12 - Math.round(ratio * 12)))}{' '}
                      {Math.round(ratio * 100)}% of avg
                    </Text>
                  </Text>
                )}
              </Box>
            );
          })}
          <Text color={colors.muted}>
            {showBranch ? '[j/k] scroll stages' : '[l] live logs · [j/k] scroll stages'}
          </Text>
        </>
      )}
    </Box>
  );
};
export default StageTimings;
