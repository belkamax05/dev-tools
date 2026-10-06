import { useCallback, useState } from 'react';

import type { StatusMessage, Tone } from '../../components/StatusNote';

export interface StatusApi {
  /** The message to hand `AppShell`'s `status`, if there is one. */
  status: StatusMessage | undefined;
  /** Say something. Stable, so it can be passed to every view without re-rendering them. */
  notify: (text: string, tone?: Tone) => void;
  /** Take the message down — after a refresh, say, when it no longer describes the screen. */
  clear: () => void;
  setStatus: (status: StatusMessage | undefined) => void;
}

/**
 * The app's latest status message and the `notify` its views report through.
 *
 * `initial` is usually the session's notice — what the last handoff did — which is information
 * rather than a result, so a bare string is taken as `info`.
 */
export const useStatus = (initial?: StatusMessage | string): StatusApi => {
  const [status, setStatus] = useState<StatusMessage | undefined>(() =>
    typeof initial === 'string' ? { text: initial, tone: 'info' } : initial,
  );
  const notify = useCallback((text: string, tone: Tone = 'info') => setStatus({ text, tone }), []);
  const clear = useCallback(() => setStatus(undefined), []);
  return { status, notify, clear, setStatus };
};

export default useStatus;
