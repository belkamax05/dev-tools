import { Text } from 'ink';

import { type ThemeColors, useColors } from '../../providers/TuiThemeProvider';

/** How a status message reads: it worked, look at this, it failed, or just so you know. */
export type Tone = 'ok' | 'warn' | 'error' | 'info';

/** One line of feedback for the header — what the last action did. */
export interface StatusMessage {
  text: string;
  tone: Tone;
}

/** The palette role a tone is drawn in. `info` is context, so it is muted like any other. */
export const toneColor = (colors: ThemeColors, tone: Tone): string =>
  tone === 'ok'
    ? colors.ok
    : tone === 'warn'
      ? colors.warn
      : tone === 'error'
        ? colors.error
        : colors.muted;

export interface StatusNoteProps {
  text: string;
  tone?: Tone;
}

/**
 * A status message, coloured by its tone and cut to one line.
 *
 * `AppShell` draws one from its `status` prop; it is exported for an app that puts something
 * other than its latest message on that line — an undo offer, a load error.
 */
export const StatusNote = ({ text, tone = 'info' }: StatusNoteProps) => {
  const colors = useColors();
  return (
    <Text color={toneColor(colors, tone)} wrap="truncate">
      {text}
    </Text>
  );
};

export default StatusNote;
