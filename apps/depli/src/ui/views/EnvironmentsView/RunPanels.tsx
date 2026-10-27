import Box from '@/dev-tools/ui/components/Box';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import type { HistoryRun, JobHistory, StepConfig } from '../../../core/plugin';
import type { DepliData } from '../../useDepli';
import LogPanel from '../LogPanel';
import StageTimings from '../StageTimings';

export interface RunPanelsProps {
  data: DepliData;
  step: StepConfig;
  job: JobHistory;
  run: HistoryRun;
  /** The log shown (`l`) — only when the step's plugin reads logs. */
  logOpen: boolean;
  logRows: number;
  width: number;
  /** Older (`1`) or newer (`-1`) run of the job — the log's `,` / `.`. */
  onOtherRun: (delta: number) => void;
}

/**
 * Under a run's page: its stages and, open, its log — read as the job the run belongs to, so an
 * `alsoDeployedBy` job's run shows its own.
 */
export const RunPanels = ({
  data,
  step,
  job,
  run,
  logOpen,
  logRows,
  width,
  onOtherRun,
}: RunPanelsProps) => {
  const colors = useColors();
  const reads = data.jobRunReads(step);
  const runKey = `${step.id}:${job.job}:${run.id}`;
  return (
    <>
      {reads.timings && (
        <StageTimings
          run={run}
          runKey={runKey}
          read={(item) => data.readJobTimings(step, job.job, item)}
          title="Stages"
          expanded={data.timingsExpanded}
          onExpandedChange={data.setTimingsExpanded}
        />
      )}
      {logOpen && reads.logs && (
        <Box flexShrink={0} borderStyle="round" borderColor={colors.muted} paddingX={1}>
          <LogPanel
            run={run}
            runKey={runKey}
            read={(item, start) => data.readJobLog(step, job.job, item, start)}
            rows={logRows}
            width={width}
            runIndex={job.runs.indexOf(run)}
            runCount={job.runs.length}
            onOtherRun={onOtherRun}
            isActive
          />
        </Box>
      )}
    </>
  );
};

export default RunPanels;
