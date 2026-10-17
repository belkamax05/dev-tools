import { Text } from 'ink';

import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import type { StepRun } from '../../../core/plugin';

export interface HistoryStripProps {
  runs: StepRun[];
  /** Cells the strip may take. */
  cols: number;
}

/**
 * Recent runs as one strip of blocks, oldest left: colour is the result, length is how long the
 * run took (1–4 cells, against the median, so one stuck build does not flatten the rest). Text in
 * theme colours — it sits on the app's background in every terminal.
 */
export const HistoryStrip = ({ runs, cols }: HistoryStripProps) => {
  const colors = useColors();
  const tone: Record<StepRun['state'], string> = {
    success: colors.ok,
    failure: colors.error,
    running: colors.accent,
    queued: colors.muted,
    aborted: colors.muted,
    other: colors.muted,
  };
  const durations = runs
    .map((run) => run.durationMs ?? 0)
    .filter(Boolean)
    .sort((a, b) => a - b);
  const median = durations[Math.floor(durations.length / 2)] || 1;
  let used = 0;
  const cells = [...runs]
    .reverse()
    .map((run) => {
      const length = Math.min(
        4,
        Math.max(1, Math.round(((run.durationMs || median) / median) * 2)),
      );
      return { run, length };
    })
    //? Newest kept when there is no room for all: drop from the old end
    .reverse()
    .filter(({ length }) => {
      used += length + 1;
      return used <= cols;
    })
    .reverse();
  return (
    <Text wrap="truncate">
      {cells.map(({ run, length }) => (
        <Text key={run.id} color={tone[run.state]}>
          {'█'.repeat(length)}{' '}
        </Text>
      ))}
    </Text>
  );
};

export default HistoryStrip;
