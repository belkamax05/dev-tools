import { Text } from 'ink';

import Box from '@/dev-tools/ui/components/Box';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import { maskValue } from '../../config/settings';

/** `PATH`, `XDG_DATA_DIRS`, `NIX_PATH`… — a `:`-joined list read far better one entry a line. */
export const isPathList = (key: string, value: string) =>
  value.includes(':') && /(PATH|DIRS)$/.test(key) && !/^\w+:\/\//.test(value);

export interface ValueBlockProps {
  name: string;
  value: string;
  secret: boolean;
  reveal: boolean;
  /** Lines the caller can spare; a longer value is cut with a count of what was left out. */
  maxLines?: number;
}

/**
 * A variable's value as the detail pane draws it: masked when it is a secret and secrets are
 * hidden, one entry a line for a path list (numbered, with entries that repeat flagged — a `PATH`
 * that has grown the same folder twice is the usual reason to look at it), wrapped otherwise.
 */
export const ValueBlock = ({ name, value, secret, reveal, maxLines = 12 }: ValueBlockProps) => {
  const colors = useColors();
  if (secret && !reveal) {
    return (
      <Box flexDirection="column">
        <Text color={colors.warn}>{maskValue(value) || '(empty)'}</Text>
        <Text color={colors.muted}>Secret by name — [v] reveals every secret.</Text>
      </Box>
    );
  }
  if (!value) return <Text color={colors.muted}>(empty)</Text>;

  if (isPathList(name, value)) {
    const parts = value.split(':');
    const seen = new Set<string>();
    const shown = parts.slice(0, maxLines);
    return (
      <Box flexDirection="column">
        {shown.map((part, index) => {
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
        {parts.length > shown.length && (
          <Text color={colors.muted}>{`… ${parts.length - shown.length} more`}</Text>
        )}
      </Box>
    );
  }

  const lines = value.split('\n');
  return (
    <Box flexDirection="column">
      {lines.slice(0, maxLines).map((line, index) => (
        <Text key={`${index}:${line}`} color={colors.text} wrap="wrap">
          {line || ' '}
        </Text>
      ))}
      {lines.length > maxLines && (
        <Text color={colors.muted}>{`… ${lines.length - maxLines} more lines`}</Text>
      )}
    </Box>
  );
};

export default ValueBlock;
