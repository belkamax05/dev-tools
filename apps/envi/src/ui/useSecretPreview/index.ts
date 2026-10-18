import { useState } from 'react';

import { isOpRef, readOpRef } from '../../core/onePassword';

export type SecretPreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; value: string }
  | { status: 'error'; error: string };

const IDLE: SecretPreviewState = { status: 'idle' };

/**
 * On-demand reads of `op://` values for a detail pane: nothing is asked of 1Password until [p],
 * and a read is kept for the tab's life (the CLI caches it for the process anyway), so moving
 * back to a row shows it again.
 */
export const useSecretPreview = () => {
  const [states, setStates] = useState<Record<string, SecretPreviewState>>({});
  const set = (ref: string, state: SecretPreviewState) =>
    setStates((was) => ({ ...was, [ref]: state }));

  const stateOf = (ref: string): SecretPreviewState => states[ref.trim()] ?? IDLE;

  const preview = (value: string) => {
    if (!isOpRef(value)) return;
    const ref = value.trim();
    if (states[ref]?.status === 'loading') return;
    set(ref, { status: 'loading' });
    readOpRef(ref)
      .then((secret) => set(ref, { status: 'ok', value: secret }))
      .catch((error: Error) => set(ref, { status: 'error', error: error.message }));
  };

  /** What `ValueBlock` takes for `value`: offers [p] only on a reference. */
  const blockProps = (value: string) =>
    isOpRef(value) ? { secretPreview: { state: stateOf(value) } } : {};

  return { stateOf, preview, blockProps };
};

export default useSecretPreview;
