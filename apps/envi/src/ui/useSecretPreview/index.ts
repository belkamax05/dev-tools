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
 *
 * Also one variable's own reveal ([u], beside [v]'s reveal-everything) and the secret itself
 * to the clipboard ([C]) — a reference read first, so what lands there is the token, not the
 * `op://` pointer.
 */
export const useSecretPreview = () => {
  const [states, setStates] = useState<Record<string, SecretPreviewState>>({});
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());
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

  /** This variable is shown in full, whatever the reveal-everything toggle says. */
  const isRevealed = (key: string) => revealed.has(key);

  /** Show (or mask again) one variable; a reference is read on the way, so there is a value. */
  const toggleReveal = (key: string, value: string) => {
    const showing = revealed.has(key);
    setRevealed((was) => {
      const next = new Set(was);
      if (showing) next.delete(key);
      else next.add(key);
      return next;
    });
    if (!showing && isOpRef(value) && stateOf(value).status !== 'ok') preview(value);
    return !showing;
  };

  /** The secret itself: a reference read from 1Password (kept for the preview too), else as is. */
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

  /** What `ValueBlock` takes for `value`: offers [p] only on a reference. */
  const blockProps = (value: string) =>
    isOpRef(value) ? { secretPreview: { state: stateOf(value) } } : {};

  return { stateOf, preview, blockProps, isRevealed, toggleReveal, secretOf };
};

export default useSecretPreview;
