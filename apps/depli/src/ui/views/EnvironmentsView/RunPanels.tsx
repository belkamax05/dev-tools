import { useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import ScrollPanel from '@/dev-tools/ui/components/ScrollPanel';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import type { HistoryRun, JobHistory, StepConfig } from '../../../core/plugin';
import type { DepliData } from '../../useDepli';
import LogPanel from '../LogPanel';
import StageTimings from '../StageTimings';

interface RunProps {
  data: DepliData;
  step: StepConfig;
  job: JobHistory;
  run: HistoryRun;
}

export interface RunStagesProps extends RunProps {
  /** The most rows the stages take; past it they scroll (wheel / scrollbar). */
  maxRows: number;
}

export interface RunLogProps extends RunProps {
  /** The log shown (`l`) — only when the step's plugin reads logs. */
  logOpen: boolean;
  logRows: number;
  width: number;
  /** Older (`1`) or newer (`-1`) run of the job — the log's `,` / `.`. */
  onOtherRun: (delta: number) => void;
}

const runKeyOf = ({ step, job, run }: RunProps) => `${step.id}:${job.job}:${run.id}`;

/**
 * Under a run's page: its stages — read as the job the run belongs to, so an `alsoDeployedBy`
 * job's run shows its own. As tall as they need, up to `maxRows`; the rest scrolls.
 */
export const RunStages = ({ maxRows, ...props }: RunStagesProps) => {
  const { data, step, job, run } = props;
  const [total, setTotal] = useState(1);
  if (!data.jobRunReads(step).timings) return null;
  return (
    <Box flexDirection="column" flexShrink={0} height={Math.max(1, Math.min(total, maxRows))}>
      <ScrollPanel isActive={false} isMouseActive onSize={(size) => setTotal(size.total)}>
        <StageTimings
          run={run}
          runKey={runKeyOf(props)}
          read={(item) => data.readJobTimings(step, job.job, item)}
          title="Stages"
          expanded={data.timingsExpanded}
          onExpandedChange={data.setTimingsExpanded}
        />
      </ScrollPanel>
    </Box>
  );
};

/** Under a run's stages, open: its log. */
export const RunLog = ({ logOpen, logRows, width, onOtherRun, ...props }: RunLogProps) => {
  const colors = useColors();
  const { data, step, job, run } = props;
  if (!logOpen || !data.jobRunReads(step).logs) return null;
  return (
    <Box flexShrink={0} borderStyle="round" borderColor={colors.muted} paddingX={1}>
      <LogPanel
        run={run}
        runKey={runKeyOf(props)}
        read={(item, start) => data.readJobLog(step, job.job, item, start)}
        rows={logRows}
        width={width}
        runIndex={job.runs.indexOf(run)}
        runCount={job.runs.length}
        onOtherRun={onOtherRun}
        isActive
      />
    </Box>
  );
};
