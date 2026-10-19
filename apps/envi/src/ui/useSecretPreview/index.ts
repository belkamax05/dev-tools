import { useState } from 'react';

import { isOpRef, readOpRef } from '../../core/onePassword';

export type SecretPreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; value: string }
  | { status: 'error'; error: string };

const IDLE: SecretPreviewState = { status: 'idle' };

export interface Secrets {
  /** What reading `value`'s reference from 1Password gave so far. */
  stateOf: (value: string) => SecretPreviewState;
  /** Read `value`'s reference, once — a read in flight or done is not asked for again. */
  read: (value: string) => void;
  /** The secret itself: a reference read from 1Password (kept for display too), else as is. */
  secretOf: (value: string) => Promise<string>;
  /** What `ValueBlock` takes for `secretPreview`: only for a reference. */
  blockProps: (value: string) => { secretPreview?: { state: SecretPreviewState; onRead: () => void } };
  /** `value` as a list row shows it once secrets are revealed: a reference read, its secret. */
  shown: (value: string, reveal: boolean) => string;
}

/**
 * The app's one cache of `op://` reads, shared by every tab: nothing is asked of 1Password while
 * secrets are hidden, and once [v] reveals them the row in front of you is read — so a
 * reference's secret is a single key away, and moving back to a row shows it again.
 */
export const useSecretPreview = (): Secrets => {
  const [states, setStates] = useState<Record<string, SecretPreviewState>>({});
  const set = (ref: string, state: SecretPreviewState) =>
    setStates((was) => ({ ...was, [ref]: state }));

  const stateOf = (value: string): SecretPreviewState => states[value.trim()] ?? IDLE;

  const read = (value: string) => {
    if (!isOpRef(value)) return;
    const ref = value.trim();
    const known = states[ref]?.status;
    if (known === 'loading' || known === 'ok') return;
    set(ref, { status: 'loading' });
    readOpRef(ref)
      .then((secret) => set(ref, { status: 'ok', value: secret }))
      .catch((error: Error) => set(ref, { status: 'error', error: error.message }));
  };

  const secretOf = async (value: string) => {
    if (!isOpRef(value)) return value;
    const ref = value.trim();
    const known = states[ref];
    if (known?.status === 'ok') return known.value;
    set(ref, { status: 'loading' });
    try {
      const secret = await readOpRef(ref);
      set(ref, { status: 'ok', value: secret });
      return secret;
    } catch (error) {
      set(ref, { status: 'error', error: (error as Error).message });
      throw error;
    }
  };

  const blockProps = (value: string) =>
    isOpRef(value) ? { secretPreview: { state: stateOf(value), onRead: () => read(value) } } : {};

  const shown = (value: string, reveal: boolean) => {
    if (!reveal || !isOpRef(value)) return value;
    const state = stateOf(value);
    return state.status === 'ok' ? state.value : value;
  };

  return { stateOf, read, secretOf, blockProps, shown };
};

export default useSecretPreview;
