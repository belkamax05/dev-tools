import type { FolderContext, FolderState } from '../../config/settings';
import type { DetectedManager } from '../../core/manifest';

export type Tone = 'ok' | 'warn' | 'error' | 'info';

/**
 * What the dashboard keeps across a handoff — every install, update and removal runs on the real
 * terminal and the dashboard is remounted afterwards — and across tab switches.
 */
export interface Session {
  tab: string;
  selected: Record<string, string | undefined>;
  filter: string;
  onlyOutdated: boolean;
  onlyDifferent: boolean;
  /** The Compare tab's package-name filter. */
  compareFilter?: string;
  /** The Add tab's last search, so coming back from an install shows the same results. */
  search?: string;
  /** The Add tab's prod/dev switch; undefined until toggled, then it overrides `installAs`. */
  installDev?: boolean;
  /** The version picker, when open: on which package, and whether it adds or changes it. */
  picker?: { name: string; mode: 'set' | 'add' };
}

export interface ViewProps {
  dir: string;
  context: FolderContext;
  manager: DetectedManager;
  session: Session;
  notify: (text: string, tone?: Tone) => void;
  /** True while a view owns the keyboard (a prompt, a picker) — stops the app's own keys. */
  onCaptureInput: (captured: boolean) => void;
  /**
   * Hand the terminal to one or more package-manager commands, run in `cwd` (this folder by
   * default) one after another, stopping at the first failure; the dashboard reopens after.
   */
  runCommands: (commands: string[][], label: string, cwd?: string) => void;
  /** Change the folder's state and save it — notes, compare folders, toggles. */
  updateState: (mutate: (state: FolderState) => FolderState) => void;
  /** Bumped by the app's refresh key; views re-read their data when it changes. */
  refreshKey: number;
}
