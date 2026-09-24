import type { IdeDefinition } from '../../core/ides';

export type Tone = 'ok' | 'warn' | 'error' | 'info';

/**
 * Something the dashboard cannot do inside its own frame, handed back to the
 * CLI to do on a real terminal before the dashboard reopens.
 */
export type Handoff = { type: 'edit'; path: string };

/**
 * What a view keeps across a handoff. The dashboard is unmounted while an
 * editor runs, so anything worth coming back to — the tab, the row the cursor
 * was on, which folders were open — lives here rather than in component state.
 */
export interface Session {
  tab: string;
  selected: Record<string, string | undefined>;
  expanded: Set<string>;
}

export interface ViewProps {
  root: string;
  ide: IdeDefinition;
  session: Session;
  /** Report the outcome of an action in the header. */
  notify: (message: string, tone?: Tone) => void;
  /** True while a view owns the keyboard (a prompt, a search box) — stops the app's own keys. */
  onCaptureInput: (captured: boolean) => void;
  handoff: (intent: Handoff) => void;
  /** Bumped by the app's refresh key; views re-read their data when it changes. */
  refreshKey: number;
}
