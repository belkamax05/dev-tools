'use server';

import { spawn } from 'node:child_process';
import gitSpawnCwd from '../gitSpawnCwd';
import gitSpawnEnv from '../gitSpawnEnv';

interface GitExecOptions {
  stream?: boolean;
}

const gitExec = (args: string[], cwd: string, options: GitExecOptions = {}) =>
  new Promise<{ stdout: string; stderr: string; exitCode: number | null }>((resolve) => {
    const { stream = false } = options;

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

    if (!stream) {
      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });
    }

    child.on('close', (exitCode) => {
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
