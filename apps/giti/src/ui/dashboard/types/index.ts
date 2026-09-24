import type { Handoff } from '@/dev-tools/ui/app/runTuiSession';

export type Tone = 'ok' | 'warn' | 'error' | 'info';

/** Something that can be put back — offered in the status line after a discard or drop. */
export interface UndoOffer {
  label: string;
  run: () => Promise<{ ok: boolean; message: string }>;
}

/** What the dashboard hands every view that acts on the repository. */
export interface GitViewProps {
  root: string;
  /** Bumped by the file watcher and after every action; views reload on it. */
  refreshKey: number;
  /** Ask everything to re-read — after an action the watcher might be slower to report. */
  reload: () => void;
  notify: (message: string, tone?: Tone) => void;
  /** True while a view owns the keyboard (a prompt, a search) — the app's own keys stand down. */
  onCaptureInput: (captured: boolean) => void;
  handoff: (intent: Handoff) => void;
  offerUndo: (offer: UndoOffer) => void;
  /** Chrome the app draws above the view (the operation banner), for the row budget. */
  reservedChrome: string[];
}
