import { Text } from 'ink';
import { useEffect, useRef, useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import type { RunTimings, StepRun } from '../../../core/plugin';
import StageTimings from '../StageTimings';

/** Follow job-wide activity even when nothing is running on the currently selected branch. */
export const OtherRuns = ({
  initial,
  read,
  readTimings,
  scope,
  expanded,
  onExpandedChange,
  isActive,
}: {
  initial: StepRun[];
  read: () => Promise<StepRun[]>;
  readTimings: (run: StepRun) => Promise<RunTimings>;
  scope: string;
  expanded: Record<string, boolean>;
  onExpandedChange: (key: string, expanded: boolean) => void;
  isActive: boolean;
}) => {
  const colors = useColors();
  const [runs, setRuns] = useState(initial);
  const [error, setError] = useState<string>();
  const readRef = useRef(read);
  readRef.current = read;
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const next = await readRef.current();
        if (!live) return;
        setRuns(next);
        setError(undefined);
      } catch (failure) {
        if (live) setError((failure as Error).message);
      }
      if (live) timer = setTimeout(tick, 5_000);
    };
    tick();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, []);
  if (!runs.length && !error) return null;
  return (
    <Box flexDirection="column" flexShrink={0}>
      {!!runs.length && (
        <>
          <Text color={colors.warn} bold>
            Other branches running · {runs.length}
          </Text>
          <Text color={colors.muted} wrap="wrap">
            This job is also busy on other branches.
          </Text>
        </>
      )}
      {error && (
        <Text color={colors.warn} wrap="wrap">
          Other-branch activity could not refresh: {error}
        </Text>
      )}
      {runs.map((run) => {
        const key = `${scope}:${run.id}`;
        return (
          <StageTimings
            key={key}
            run={run}
            runKey={key}
            read={readTimings}
            expanded={expanded[key] === true}
            onExpandedChange={(value) => onExpandedChange(key, value)}
            isActive={isActive}
            title="Build"
            showBranch
            toggleKey={null}
          />
        );
      })}
    </Box>
  );
};
export default OtherRuns;
