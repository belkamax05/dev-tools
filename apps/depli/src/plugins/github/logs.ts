import type { Env, LogChunk, StepRun } from '../../core/plugin';
import { type GithubOptions, githubJobLog } from './api';

/** A missing/expired/skipped Actions log does not imply the check came from another provider. */
export const checkLog = async (
  options: GithubOptions,
  env: Env,
  run: StepRun,
): Promise<LogChunk> => {
  const unavailable = (message: string, more = false): LogChunk => ({
    text: '',
    next: 0,
    more,
    unavailable: message,
  });
  if (!run.id.startsWith('check-'))
    return unavailable('GitHub gives whole-run logs only as a zip — [O] opens the run');
  if (run.detail === 'skipped')
    return unavailable(
      'This Actions job was skipped, so it has no log — choose another run with , / .',
    );
  if (run.state === 'running' || run.state === 'queued')
    return unavailable('GitHub shows a job’s log once it has finished — [O] follows it live', true);
  const jobId = run.url?.match(/\/(?:job|jobs)\/(\d+)(?:[/?#]|$)/)?.[1] ?? run.id.slice(6);
  const text = await githubJobLog(options, env, jobId);
  if (text === undefined)
    return unavailable(
      'GitHub has no downloadable log for this check (it may be skipped, expired or unavailable) — [O] opens the run',
    );
  return { text, next: text.length, more: false };
};
