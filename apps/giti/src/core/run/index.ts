export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  ok: boolean;
}

export interface RunOptions {
  /** Written to git's stdin — a patch for `git apply`. */
  input?: string;
  /** Extra environment, e.g. `GIT_EDITOR=true` so `--continue` never opens an editor. */
  env?: Record<string, string>;
  /** Called with each line git writes to stderr as it arrives — its progress output. */
  onProgress?: (line: string) => void;
}

/**
 * Run git in `cwd` and collect what it said.
 *
 * Not `gitExec`: the dashboard's actions need stdin (patches) and live
 * progress, which that helper does not offer. Git's own prompts are switched
 * off — a credential prompt on a stdin nobody is typing into would hang the
 * TUI — and so is its pager and colour, which only get in the way of parsing.
 */
export const git = async (
  args: string[],
  cwd: string,
  options: RunOptions = {},
): Promise<RunResult> => {
  const child = Bun.spawn(['git', ...args], {
    cwd,
    stdin: options.input === undefined ? 'ignore' : new TextEncoder().encode(options.input),
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_PAGER: 'cat',
      GIT_OPTIONAL_LOCKS: '0',
      NO_COLOR: '1',
      ...options.env,
    },
  });

  const readStderr = async () => {
    if (!options.onProgress) return new Response(child.stderr).text();
    //? Progress is written with carriage returns, one line rewritten in place;
    //? each piece between CR/LF is one update worth showing
    let all = '';
    const decoder = new TextDecoder();
    for await (const chunk of child.stderr) {
      const text = decoder.decode(chunk, { stream: true });
      all += text;
      for (const line of text.split(/[\r\n]+/)) if (line.trim()) options.onProgress(line.trim());
    }
    return all;
  };

  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), readStderr()]);
  const exitCode = await child.exited;
  return { stdout, stderr: stderr.trim(), exitCode, ok: exitCode === 0 };
};

/** The first line of what went wrong, for a status line. */
export const failure = (result: RunResult, fallback: string) =>
  (result.stderr || result.stdout).split('\n').find((line) => line.trim()) ?? fallback;

export default git;
