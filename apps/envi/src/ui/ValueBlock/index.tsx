import { Text } from 'ink';
import { useEffect } from 'react';

import ActionButton from '@/dev-tools/ui/components/ActionButton';
import Box from '@/dev-tools/ui/components/Box';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import { maskValue } from '../../config/settings';
import { isOpRef, OP_LABEL } from '../../core/onePassword';
import type { SecretPreviewState } from '../useSecretPreview';

/** `PATH`, `XDG_DATA_DIRS`, `NIX_PATH`… — a `:`-joined list read far better one entry a line. */
export const isPathList = (key: string, value: string) =>
  value.includes(':') && /(PATH|DIRS)$/.test(key) && !/^\w+:\/\//.test(value);

/**
 * One line of a value for a list row: newlines shown, long values cut by the pane. An `op://`
 * reference is never masked — it is a pointer into 1Password, not the secret.
 */
export const preview = (value: string, secret: boolean, reveal: boolean) =>
  secret && !reveal && !isOpRef(value) ? maskValue(value) : value.replace(/\n/g, '⏎');

export interface ValueBlockProps {
  name: string;
  value: string;
  secret: boolean;
  /** Secrets drawn in full — the app-wide [v]. */
  reveal: boolean;
  /**
   * For an `op://` value: what reading it from 1Password gave so far, and how to ask. While
   * secrets are revealed the block reads it on its own, so the secret is one key away.
   */
  secretPreview?: { state: SecretPreviewState; onRead: () => void };
  /** [v]: reveal every secret in the app — the note offers it as a button too. */
  onReveal?: () => void;
  /** [C]: the secret itself onto the clipboard, a reference read first. */
  onCopySecret?: () => void;
}

/**
 * "Secret — [v] Reveal secrets [C] Copy secret": what can be done about a hidden value, as
 * buttons — each the key it names, and clickable, as every other hint in the app. A caller that
 * gives neither handler gets the same words as plain text.
 */
const SecretActions = ({
  lead,
  onReveal,
  onCopySecret,
}: {
  lead: string;
  onReveal?: () => void;
  onCopySecret?: () => void;
}) => {
  const colors = useColors();
  if (!onReveal && !onCopySecret)
    return (
      <Text color={colors.muted} wrap="wrap">
        {`${lead} — [v] reveals every secret · [C] copies it.`}
      </Text>
    );
  return (
    <Box flexDirection="row" flexWrap="wrap">
      <Text color={colors.muted}>{`${lead} — `}</Text>
      {onReveal && <ActionButton hotkey="v" label="Reveal secrets" onPress={onReveal} />}
      {onReveal && onCopySecret && <Text> </Text>}
      {onCopySecret && <ActionButton hotkey="C" label="Copy secret" onPress={onCopySecret} />}
    </Box>
  );
};

/**
 * A variable's value as the detail pane draws it: masked when it is a secret and secrets are
 * hidden, one entry a line for a path list (numbered, with entries that repeat flagged — a `PATH`
 * that has grown the same folder twice is the usual reason to look at it), wrapped otherwise.
 * Always whole: the detail pane scrolls, so a long `PATH` is read to its last entry.
 */
export const ValueBlock = ({
  name,
  value,
  secret,
  reveal,
  secretPreview,
  onReveal,
  onCopySecret,
}: ValueBlockProps) => {
  const colors = useColors();
  const ref = isOpRef(value);
  const read = secretPreview?.state;
  const onRead = secretPreview?.onRead;

  //? Revealed means revealed: a reference in view is read without a second key
  useEffect(() => {
    if (ref && reveal && read?.status === 'idle') onRead?.();
  }, [ref, reveal, read?.status, onRead]);

  if (ref) {
    return (
      <Box flexDirection="column">
        <Text color={colors.accent} bold>{`🔑 ${OP_LABEL} reference`}</Text>
        <Text color={colors.text} wrap="wrap">
          {value}
        </Text>
        <Box marginTop={1} flexDirection="column">
          {!reveal ? (
            secretPreview ? (
              <SecretActions
                lead={`Read with op when a command needs it; revealing reads it from ${OP_LABEL}`}
                onReveal={onReveal}
                onCopySecret={onCopySecret}
              />
            ) : (
              <Text color={colors.muted} wrap="wrap">
                Read with op when a command needs it (envi get, envi run, dfs deploy).
              </Text>
            )
          ) : !read || read.status === 'idle' || read.status === 'loading' ? (
            <Text color={colors.muted}>{`Asking ${OP_LABEL}…`}</Text>
          ) : read.status === 'error' ? (
            <Text color={colors.error} wrap="wrap">{`${OP_LABEL}: ${read.error}`}</Text>
          ) : (
            <>
              <Text color={colors.ok}>{`From ${OP_LABEL}:`}</Text>
              <Text color={colors.text} wrap="wrap">
                {read.value || '(empty)'}
              </Text>
            </>
          )}
        </Box>
      </Box>
    );
  }
  if (secret && !reveal) {
    return (
      <Box flexDirection="column">
        <Text color={colors.warn}>{maskValue(value) || '(empty)'}</Text>
        <SecretActions lead="Secret" onReveal={onReveal} onCopySecret={onCopySecret} />
      </Box>
    );
  }
  if (!value) return <Text color={colors.muted}>(empty)</Text>;

  if (isPathList(name, value)) {
    const parts = value.split(':');
    const seen = new Set<string>();
    return (
      <Box flexDirection="column">
        {parts.map((part, index) => {
          const repeat = seen.has(part);
          seen.add(part);
          return (
            <Text
              key={`${index}:${part}`}
              wrap="truncate-middle"
              color={repeat ? colors.warn : colors.text}
            >
              {`${String(index + 1).padStart(2)}  ${part || '(empty entry)'}${repeat ? '  ← again' : ''}`}
            </Text>
          );
        })}
      </Box>
    );
  }

  const lines = value.split('\n');
  return (
    <Box flexDirection="column">
      {lines.map((line, index) => (
        <Text key={`${index}:${line}`} color={colors.text} wrap="wrap">
          {line || ' '}
        </Text>
      ))}
    </Box>
  );
};

export default ValueBlock;
