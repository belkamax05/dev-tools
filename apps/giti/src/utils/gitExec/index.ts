'use server';

import { spawn } from 'node:child_process';
import gitSpawnCwd from '../gitSpawnCwd';
import gitSpawnEnv from '../gitSpawnEnv';

interface GitExecOptions {
  stream?: boolean;
  /**
   * Called with every line git prints, stdout and stderr alike, as it arrives — for showing a
   * long command's progress live (`runGitStep`) while still collecting its output. Progress
   * redraws (`\r`) count as line breaks. Ignored when `stream` is set, which hands the terminal
   * to git directly.
   */
  onLine?: (line: string) => void;
}

const gitExec = (args: string[], cwd: string, options: GitExecOptions = {}) =>
  new Promise<{ stdout: string; stderr: string; exitCode: number | null }>((resolve) => {
    const { stream = false, onLine } = options;

    let repoDir: string;
    try {
      repoDir = gitSpawnCwd(cwd);
    } catch (error) {
      resolve({ stdout: '', stderr: (error as Error).message, exitCode: 1 });
      return;
    }

    const child = spawn('git', args, {
      cwd: repoDir,
      env: gitSpawnEnv(),
      stdio: stream ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    //? Text after the last line break is held back until the rest of its line arrives, so a
    //? chunk boundary never splits one line into two callbacks.
    let pending = '';
    const emit = (text: string) => {
      if (!onLine) return;
      const parts = (pending + text).split(/\r\n|\r|\n/);
      pending = parts.pop() ?? '';
      for (const line of parts) if (line.trim()) onLine(line);
    };

    if (!stream) {
      child.stdout?.on('data', (data) => {
        stdout += data.toString();
        emit(data.toString());
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
        emit(data.toString());
      });
    }

    child.on('close', (exitCode) => {
      if (onLine && pending.trim()) onLine(pending);
      resolve({
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd(),
        exitCode,
      });
    });

    child.on('error', (err) => {
      resolve({
        stdout: '',
        stderr: stream ? '' : err.message,
        exitCode: 1,
      });
    });
  });

export default gitExec;
