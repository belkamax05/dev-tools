import type { IdeDefinition } from '../../core/ides';
import type { Scope } from '../../core/scope';

export type Tone = 'ok' | 'warn' | 'error' | 'info';

/**
 * Something the dashboard cannot do inside its own frame, handed back to the
 * CLI to do on a real terminal before the dashboard reopens.
 */
export type Handoff =
  | { type: 'edit'; path: string }
  /** A terminal program — Claude Code — run in the foreground until it exits. */
  | { type: 'run'; command: string[]; cwd: string; label: string };

/**
 * What a view keeps across a handoff. The dashboard is unmounted while an
 * editor runs, so anything worth coming back to — the tab, the row the cursor
 * was on, which folders were open — lives here rather than in component state.
 */
export interface Session {
  tab: string;
  selected: Record<string, string | undefined>;
  expanded: Set<string>;
  /** The Agents tab shows file content (or a diff) only once asked to, and keeps showing it. */
  preview: boolean;
  /** Where the IDE tab's keyboard was: the list, or which link in the detail pane. */
  ideFocus: { pane: 'list' | 'detail'; link: number };
  /** Which of the scope's IDEs the tabs are showing. */
  activeIde?: string;
}

export interface ViewProps {
  /** The repository, or the user's home for the user scope. */
  scope: Scope;
  /** `scope.root`, for the many places that only need the path. */
  root: string;
  /** The IDE the tab is showing — one of `ides`, switched with `[` / `]`. */
  ide: IdeDefinition;
  /** Every IDE this scope is kept in step with. */
  ides: IdeDefinition[];
  session: Session;
  /** Report the outcome of an action in the header. */
  notify: (message: string, tone?: Tone) => void;
  /** True while a view owns the keyboard (a prompt, a search box) — stops the app's own keys. */
  onCaptureInput: (captured: boolean) => void;
  handoff: (intent: Handoff) => void;
  /** Bumped by the app's refresh key; views re-read their data when it changes. */
  refreshKey: number;
}
