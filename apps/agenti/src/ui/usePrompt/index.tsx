import { Text, useInput } from 'ink';
import { type ReactNode, useEffect, useState } from 'react';

import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

type Prompt =
  | { kind: 'confirm'; message: string; onYes: () => void }
  | {
      kind: 'text';
      message: string;
      value: string;
      secret: boolean;
      onSubmit: (value: string) => void;
    };

export interface PromptApi {
  /** Ask a yes/no question; `onYes` runs on `y`, anything else cancels. */
  confirm: (message: string, onYes: () => void) => void;
  /** Ask for a line of text. `secret` draws it as dots — for tokens. */
  ask: (
    message: string,
    onSubmit: (value: string) => void,
    options?: { initial?: string; secret?: boolean },
  ) => void;
  isOpen: boolean;
  /** The prompt line to draw, or undefined when nothing is being asked. */
  line: ReactNode | undefined;
}

//? Ink hands over whatever arrived in one read, escape sequences included —
//? only printable characters belong in a typed value
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
const printable = (input: string) => input.replace(/[\u0000-\u001F\u007F]/g, '');

/**
 * A one-line question in place of a dialog: "Delete rules/x.md? [y/N]", or a
 * text field.
 *
 * Deletes, overwrites and mode switches all go through `confirm` — the web
 * version's `window.confirm`s, kept. While a prompt is open it owns the
 * keyboard (`onCaptureInput`), so the `x` that opened a delete prompt cannot
 * also reach the list, and the list's Enter cannot answer the question.
 */
export const usePrompt = (onCaptureInput: (captured: boolean) => void): PromptApi => {
  const colors = useColors();
  const [prompt, setPrompt] = useState<Prompt | undefined>(undefined);

  useEffect(() => {
    onCaptureInput(Boolean(prompt));
  }, [prompt, onCaptureInput]);
  useEffect(() => () => onCaptureInput(false), [onCaptureInput]);

  useInput(
    (input, key) => {
      if (!prompt) return;
      if (key.escape) {
        setPrompt(undefined);
        return;
      }
      if (prompt.kind === 'confirm') {
        setPrompt(undefined);
        if (input === 'y' || input === 'Y') prompt.onYes();
        return;
      }
      if (key.return) {
        setPrompt(undefined);
        prompt.onSubmit(prompt.value);
        return;
      }
      if (key.backspace || key.delete) {
        setPrompt({ ...prompt, value: prompt.value.slice(0, -1) });
        return;
      }
      if (!key.ctrl && !key.meta) {
        const typed = printable(input);
        if (typed) setPrompt({ ...prompt, value: prompt.value + typed });
      }
    },
    { isActive: Boolean(prompt) },
  );

  const line =
    prompt?.kind === 'confirm' ? (
      <Text wrap="truncate">
        <Text color={colors.warn}>{prompt.message}</Text>
        <Text color={colors.muted}> [y/N]</Text>
      </Text>
    ) : prompt?.kind === 'text' ? (
      <Text wrap="truncate">
        <Text color={colors.accent}>{prompt.message} </Text>
        <Text color={colors.text}>
          {prompt.secret ? '•'.repeat(prompt.value.length) : prompt.value}
        </Text>
        <Text color={colors.highlight}>▌</Text>
        <Text color={colors.muted}> Enter save · Esc cancel</Text>
      </Text>
    ) : undefined;

  return {
    confirm: (message, onYes) => setPrompt({ kind: 'confirm', message, onYes }),
    ask: (message, onSubmit, options = {}) =>
      setPrompt({
        kind: 'text',
        message,
        value: options.initial ?? '',
        secret: Boolean(options.secret),
        onSubmit,
      }),
    isOpen: Boolean(prompt),
    line,
  };
};

export default usePrompt;
