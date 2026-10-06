import { createInterface } from 'node:readline/promises';

/**
 * One line of input from the terminal, trimmed. Undefined when the user backs out (Ctrl+C or
 * Ctrl+D), so a caller can tell "cancelled" from "answered with nothing".
 *
 * Plain readline rather than the dashboard's Ink: the scripted commands must never load React.
 */
const ask = async (question: string): Promise<string | undefined> => {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const controller = new AbortController();
  prompt.once('close', () => controller.abort());
  prompt.once('SIGINT', () => controller.abort());
  try {
    return (await prompt.question(question, { signal: controller.signal })).trim();
  } catch {
    process.stdout.write('\n');
    return undefined;
  } finally {
    prompt.close();
  }
};

/** A yes/no question that defaults to no — the safe answer for anything that stops a process. */
export const confirm = async (question: string) =>
  /^y(es)?$/i.test((await ask(`${question} [y/N] `)) ?? '');

export default ask;
