import type { ChainStep } from '../chain';
import type { Connection, Env, LogChunk, StepRun } from '../plugin';
import { contextFor, inputFor, type Project } from '../registry';

/** A run's log through its step's plugin. Read-only — a GET wherever it comes from. */
export const readLog = async (
  project: Project,
  connections: Record<string, Connection>,
  env: Env,
  entry: ChainStep,
  run: StepRun,
  branch: string,
  targetEnv: string,
  start: number,
): Promise<LogChunk> => {
  const provider = project.providers.find((item) => item.name === entry.step.provider);
  const kind = provider?.plugin.steps[entry.step.kind];
  if (!provider || !kind?.logs)
    return { text: '', next: 0, more: false, unavailable: `${entry.step.label} has no logs` };
  return kind.logs(
    contextFor(project, provider, env, connections[provider.name]),
    inputFor(project, entry.step, branch, targetEnv),
    run,
    start,
  );
};

export type LineTone = 'error' | 'warn' | 'ok' | 'command' | 'heading' | 'muted' | 'text';

export interface LogLine {
  /** A timestamp the line started with, drawn dim before it. */
  time?: string;
  text: string;
  tone: LineTone;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes are control characters
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g;
const TIMESTAMP = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z)\s?/;

/**
 * What a log line is, for colour: errors and failures, warnings, success, the commands a job
 * runs (`+ cmd`, `> git …`, `$ cmd`), structure (Jenkins `[Pipeline]` steps, Actions
 * `##[group]`, stage names) — and everything else as plain text. Escape codes are dropped first:
 * the colours here are the theme's, not whatever the build tool chose.
 */
export const classifyLine = (raw: string): LogLine => {
  let text = raw.replace(ANSI, '').replace(/\r/g, '');
  const stamp = text.match(TIMESTAMP);
  const time = stamp?.[1];
  if (stamp) text = text.slice(stamp[0].length);
  const tone: LineTone =
    /^##\[error\]|\b(error|failed|failure|exception|fatal)\b|^Finished: (FAILURE|ABORTED|UNSTABLE)/i.test(
      text,
    ) && !/\b0 (errors?|failed)\b|no errors?/i.test(text)
      ? 'error'
      : /^##\[warning\]|\bwarn(ing)?\b|deprecated/i.test(text)
        ? 'warn'
        : /^Finished: SUCCESS|^✓|\bsucceeded\b|\bpassed\b/i.test(text)
          ? 'ok'
          : /^\[Pipeline\] (\{ \(|stage)|^##\[group\]|^={3,}|^-{3,} .* -{3,}$/.test(text)
            ? 'heading'
            : /^\[Pipeline\]|^##\[endgroup\]|^\s*$/.test(text)
              ? 'muted'
              : /^\s*(\+|>|\$) \S/.test(text)
                ? 'command'
                : 'text';
  return { time, text: text.replace(/^##\[(group|endgroup|error|warning)\]/, ''), tone };
};

/** Lines kept per log — older ones are dropped from the top as a live log grows. */
export const MAX_LOG_LINES = 5_000;

/** Append a chunk to the lines read so far: the last line of a chunk may continue in the next. */
export const appendLog = (lines: string[], partial: string, text: string) => {
  const parts = `${partial}${text}`.split('\n');
  const rest = parts.pop() ?? '';
  const next = [...lines, ...parts];
  return { lines: next.length > MAX_LOG_LINES ? next.slice(-MAX_LOG_LINES) : next, partial: rest };
};
