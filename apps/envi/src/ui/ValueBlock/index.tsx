import { Text } from 'ink';

import Box from '@/dev-tools/ui/components/Box';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import { maskValue } from '../../config/settings';
import { isOpRef, OP_LABEL } from '../../core/onePassword';
import type { SecretPreviewState } from '../useSecretPreview';

/** `PATH`, `XDG_DATA_DIRS`, `NIX_PATH`… — a `:`-joined list read far better one entry a line. */
export const isPathList = (key: string, value: string) =>
  value.includes(':') && /(PATH|DIRS)$/.test(key) && !/^\w+:\/\//.test(value);

export interface ValueBlockProps {
  name: string;
  value: string;
  secret: boolean;
  reveal: boolean;
  /**
   * For an `op://` value: what reading it from 1Password gave so far. Unset, the block only says
   * where the secret lives; set, it offers [p] and shows the result.
   */
  secretPreview?: { state: SecretPreviewState };
}

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
}: ValueBlockProps) => {
  const colors = useColors();
  if (isOpRef(value)) {
    //? The reference is a pointer, not the secret — always drawn; the secret only once asked for
    const read = secretPreview?.state;
    return (
      <Box flexDirection="column">
        <Text color={colors.accent} bold>{`🔑 ${OP_LABEL} reference`}</Text>
        <Text color={colors.text} wrap="wrap">
          {value}
        </Text>
        <Box marginTop={1} flexDirection="column">
          {!read || read.status === 'idle' ? (
            <Text color={colors.muted} wrap="wrap">
              {secretPreview
                ? 'Read with op when a command needs it — [p] previews the secret, [u] shows it, [C] copies it.'
                : 'Read with op when a command needs it (envi get, envi run, dfs deploy).'}
            </Text>
          ) : read.status === 'loading' ? (
            <Text color={colors.muted}>{`Asking ${OP_LABEL}…`}</Text>
          ) : read.status === 'error' ? (
            <Text color={colors.error} wrap="wrap">{`${OP_LABEL}: ${read.error}`}</Text>
          ) : (
            <>
              <Text color={colors.ok}>{`From ${OP_LABEL}:`}</Text>
              {secret && !reveal ? (
                <>
                  <Text color={colors.warn}>{maskValue(read.value) || '(empty)'}</Text>
                  <Text color={colors.muted}>
                    Secret by name — [u] reveals this one, [v] every secret · [C] copies it.
                  </Text>
                </>
              ) : (
                <Text color={colors.text} wrap="wrap">
                  {read.value || '(empty)'}
                </Text>
              )}
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
        <Text color={colors.muted}>
          Secret by name — [u] reveals this one, [v] every secret · [C] copies it.
        </Text>
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
