import type ExecResult from './ExecResult';

/**
 * One package manager, described by everything `ensureInstalled` needs from it. Adding a manager
 * (apt, cargo, npm, ...) means adding a folder under `utils/install/` that default-exports one of
 * these — no change to the callers.
 */
export default interface Installer {
  /** How the manager is spelled on the command line, e.g. `brew`. Used in messages. */
  readonly name: string;
  /**
   * Argv that installs `packageName`. Shared by `install` and by the message shown when the
   * manager is unavailable, so the command we suggest is always the command we would have run.
   */
  readonly installCommand: (packageName: string) => string[];
  /** Whether the manager itself can be run on this machine. */
  readonly isAvailable: () => Promise<boolean>;
  /** Whether the manager reports `packageName` as already installed. */
  readonly isInstalled: (packageName: string) => Promise<boolean>;
  /** Install `packageName`, streaming the manager's own progress output to the terminal. */
  readonly install: (packageName: string) => Promise<ExecResult>;
}
