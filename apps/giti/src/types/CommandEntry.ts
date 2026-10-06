import type { CommandMeta } from './CommandMeta';

/** One command module under `src/commands`, as discovered on disk. */
export interface CommandEntry {
  /** Name the CLI resolves onto a file, slash-separated when nested (e.g. `subrepo/install`). */
  name: string;
  /** Last segment of `name` — how the command is labelled inside its group. */
  key: string;
  /** Absolute path of the command module. */
  path: string;
  /** Absent for a command that exports no `meta` (see `subrepo/hi.ts`). */
  meta?: CommandMeta;
}
