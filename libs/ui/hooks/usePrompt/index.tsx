import { Text, useInput } from 'ink';
import { type ReactNode, useEffect, useState } from 'react';

import ActionButton from '../../components/ActionButton';
import Box from '../../components/Box';
import { useColors } from '../../providers/TuiThemeProvider';

type Prompt =
  | { kind: 'confirm'; message: string; onYes: () => void }
  | {
      kind: 'text';
      message: string;
      value: string;
      secret: boolean;
      onSubmit: (value: string) => void;
      onChange?: (value: string) => void;
      onCancel?: () => void;
    };

export interface PromptApi {
  /** Ask a yes/no question; `onYes` runs on `y`, anything else cancels. */
  confirm: (message: string, onYes: () => void) => void;
  /**
   * Ask for a line of text. `secret` draws it as dots — for tokens. `onChange` hears every edit
   * as it is typed — a search that narrows a list live — and `onCancel` hears Esc, for a caller
   * that has to undo what `onChange` already applied.
   */
  ask: (
    message: string,
    onSubmit: (value: string) => void,
    options?: {
      initial?: string;
      secret?: boolean;
      onChange?: (value: string) => void;
      onCancel?: () => void;
    },
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
        if (prompt.kind === 'text') prompt.onCancel?.();
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
      const edit = (value: string) => {
        setPrompt({ ...prompt, value });
        prompt.onChange?.(value);
      };
      if (key.backspace || key.delete) {
        edit(prompt.value.slice(0, -1));
        return;
      }
      if (!key.ctrl && !key.meta) {
        const typed = printable(input);
        if (typed) edit(prompt.value + typed);
      }
    },
    { isActive: Boolean(prompt) },
  );

  //? The same answers the keys give, as buttons: a question the pointer cannot answer strands
  //? anyone driving the app with the mouse
  const answer = (yes: boolean) => {
    if (!prompt) return;
    setPrompt(undefined);
    if (prompt.kind === 'confirm') {
      if (yes) prompt.onYes();
    } else if (yes) prompt.onSubmit(prompt.value);
    else prompt.onCancel?.();
  };

  const line =
    prompt?.kind === 'confirm' ? (
      <Box flexDirection="row">
        <Box flexShrink={1} marginRight={1}>
          <Text color={colors.warn} wrap="truncate">
            {prompt.message}
          </Text>
        </Box>
        <Box flexShrink={0}>
          <ActionButton hotkey="y" label="Yes" color={colors.warn} onPress={() => answer(true)} />
          <ActionButton hotkey="N" label="No" onPress={() => answer(false)} />
        </Box>
      </Box>
    ) : prompt?.kind === 'text' ? (
      <Box flexDirection="row">
        <Box flexShrink={1} marginRight={1}>
          <Text wrap="truncate">
            <Text color={colors.accent}>{prompt.message} </Text>
            <Text color={colors.text}>
              {prompt.secret ? '•'.repeat(prompt.value.length) : prompt.value}
            </Text>
            <Text color={colors.highlight}>▌</Text>
          </Text>
        </Box>
        <Box flexShrink={0}>
          <ActionButton hotkey="Enter" label="Save" onPress={() => answer(true)} />
          <ActionButton hotkey="Esc" label="Cancel" onPress={() => answer(false)} />
        </Box>
      </Box>
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
        onChange: options.onChange,
        onCancel: options.onCancel,
      }),
    isOpen: Boolean(prompt),
    line,
  };
};

export default usePrompt;
