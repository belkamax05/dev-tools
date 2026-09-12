import type ExecResult from '../../../types/ExecResult';

interface ExecOptions {
  /**
   * Inherit this process's stdio so the child writes straight to the terminal. Use it for
   * long-running commands whose progress the user should watch; `stdout`/`stderr` come back empty
   * because nothing was captured.
   */
  stream?: boolean;
  cwd?: string;
}

/**
 * Run a command to completion.
 * @param command - Argv, e.g. `['brew', 'install', 'git-subrepo']`
 * @param options - Streaming and working directory
 * @returns The command's output and exit code. A binary that is not on `PATH` comes back as exit
 * code `127` — the shell's convention for it — rather than as a thrown error, because "the tool
 * is missing" is an answer callers branch on, not a failure of this function.
 */
const exec = async (command: string[], options: ExecOptions = {}): Promise<ExecResult> => {
  const { stream = false, cwd } = options;

  try {
    if (stream) {
      const child = Bun.spawn(command, {
        cwd,
        stdin: 'ignore',
        stdout: 'inherit',
        stderr: 'inherit',
      });
      return { stdout: '', stderr: '', exitCode: await child.exited };
    }

    const child = Bun.spawn(command, { cwd, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    //? Drain both pipes before awaiting `exited`: a child that fills one of them blocks forever
    //? if nobody is reading, and `exited` would never resolve.
    const [stdout, stderr] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);

    return { stdout: stdout.trimEnd(), stderr: stderr.trimEnd(), exitCode: await child.exited };
  } catch (error) {
    return { stdout: '', stderr: (error as Error).message, exitCode: 127 };
  }
};

export default exec;
