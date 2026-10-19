import { log, outro, spinner } from '@clack/prompts';

type Spinner = ReturnType<typeof spinner>;

/**
 * The run's one spinner, shared by every body that reports into a framed run (`send`, `receive`,
 * the per-mechanism `pull`/`push`): it says what is being worked on *now* — "checking", then the
 * git command's latest line — and every finished step is logged above it as a line of its own,
 * until the outro.
 *
 * clack draws a spinner by rewriting its own line, so anything printed while it spins is torn by
 * the next frame. That is why every line a step prints goes through here: the spinner is taken
 * off first, the line logged, and the next `working` puts it back.
 *
 * ! Like `runGitStep`'s live log, only on a terminal of known width — piped or unsized, a spinner
 * ! is nothing but escape codes, and `working` does nothing.
 */
let active: Spinner | undefined;

const canSpin = () => Boolean(process.stdout.isTTY) && process.stdout.columns > 0;

/** One line, cut to the terminal: a spinner message that wraps leaves its first line behind. */
const fit = (message: string) => {
  const room = Math.max(10, process.stdout.columns - 6);
  const line = message.split('\n')[0] ?? '';
  return Bun.stringWidth(line) > room ? `${line.slice(0, room - 1)}…` : line;
};

/** Spin with `message` — starting the spinner, or retitling the one already turning. */
const working = (message: string) => {
  if (!canSpin()) return;
  if (active) active.message(fit(message));
  else {
    active = spinner({ indicator: 'dots' });
    active.start(fit(message));
  }
};

/**
 * Take the spinner off the screen without leaving a line of its own.
 *
 * clack starts a spinner by drawing the frame's `│` above it, and its `clear()` erases only the
 * spinner's line — the bar stayed, so the logged line after it (which brings its own bar) sat
 * under two, and a spinner before the frame's `┌` left a stray bar on top. Erased here too.
 */
const settle = () => {
  if (!active) return;
  active.clear();
  active = undefined;
  process.stdout.write('\x1b[1A\x1b[1G\x1b[J');
};

/** clack's `log`, with the spinner taken off before each line. */
const stepLog = {
  success: (message: string) => {
    settle();
    log.success(message);
  },
  info: (message: string) => {
    settle();
    log.info(message);
  },
  warn: (message: string) => {
    settle();
    log.warn(message);
  },
  error: (message: string) => {
    settle();
    log.error(message);
  },
  message: (message: string | string[]) => {
    settle();
    log.message(message);
  },
};

const stepProgress = {
  working,
  settle,
  log: stepLog,
  /** Close the frame — the spinner, if one still turns, goes first. */
  outro: (message: string) => {
    settle();
    outro(message);
  },
};

export default stepProgress;
