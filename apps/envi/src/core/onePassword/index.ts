/**
 * 1Password secret references: a value written as `op://vault/item/field` in your vars or an env
 * file is a pointer, read with the 1Password CLI (`op read`) only when a command actually needs
 * the secret — never by the dashboard or the shell hook on their own, so a `cd` never prompts.
 */

export const OP_PREFIX = 'op://';

/** The label a reference is shown under, everywhere it is shown. */
export const OP_LABEL = '1Password';

/** A whole value that is a secret reference — `op://vault/item/field`. */
export const isOpRef = (value: string | undefined): boolean =>
  typeof value === 'string' && value.trim().startsWith(OP_PREFIX);

export interface OpReadOptions {
  /**
   * Let `op` ask on the terminal (a sign-in, an account pick). Off for the dashboard, whose
   * terminal Ink owns — the desktop app's own prompt still works there.
   */
  interactive?: boolean;
}

const cache = new Map<string, Promise<string>>();

const opMessage = (stderr: string, code: number) =>
  stderr
    .trim()
    .replace(/^\[ERROR\]\s*\S+\s+\S+\s*/, '')
    .split('\n')[0] || `op exited with ${code}`;

/**
 * The secret a reference points at, read with `op read`. Each reference is read once per process
 * — a second call for the same one waits on the first rather than asking 1Password again.
 */
export const readOpRef = (ref: string, options: OpReadOptions = {}): Promise<string> => {
  const key = ref.trim();
  const cached = cache.get(key);
  if (cached) return cached;
  const reading = (async () => {
    //? Looked up on PATH as it is now — Bun.spawn alone uses the one the process started with
    const op = Bun.which('op', { PATH: process.env.PATH ?? '' });
    if (!op) throw new Error('the 1Password CLI (op) is not installed or not on PATH');
    let child: ReturnType<typeof Bun.spawn>;
    try {
      child = Bun.spawn([op, 'read', '--no-newline', key], {
        stdin: options.interactive ? 'inherit' : 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      });
    } catch {
      throw new Error('the 1Password CLI (op) is not installed or not on PATH');
    }
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout as ReadableStream).text(),
      new Response(child.stderr as ReadableStream).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(opMessage(stderr, code));
    return stdout;
  })();
  //? A failure is not cached: signing in to 1Password and trying again should work
  reading.catch(() => cache.delete(key));
  cache.set(key, reading);
  return reading;
};

export interface OpFailure {
  key: string;
  ref: string;
  error: string;
}

/**
 * Read every reference among `values` (all of them, or just `keys`), one after another so 1Password
 * asks at most once. Returns the secrets by key and what could not be read.
 */
export const readOpRefs = async (
  values: Record<string, string>,
  keys: Iterable<string> = Object.keys(values),
  options: OpReadOptions = {},
): Promise<{ secrets: Record<string, string>; failures: OpFailure[] }> => {
  const secrets: Record<string, string> = {};
  const failures: OpFailure[] = [];
  for (const key of new Set(keys)) {
    const ref = values[key];
    if (ref === undefined || !isOpRef(ref)) continue;
    try {
      secrets[key] = await readOpRef(ref, options);
    } catch (error) {
      failures.push({ key, ref, error: (error as Error).message });
    }
  }
  return { secrets, failures };
};
