import { spawnSync } from 'node:child_process';
import type GitResult from '../../types/GitResult';
import gitSpawnCwd from '../gitSpawnCwd';
import gitSpawnEnv from '../gitSpawnEnv';

/**
 * Execute a git command in the specified directory synchronously
 * @param args - Array of command arguments
 * @param cwd - Current working directory
 * @returns GitResult
 * @example
 * const result = gitExecSync(['status'], '/path/to/repo');
 */
const gitExecSync = (args: string[], cwd: string): GitResult => {
  try {
    const child = spawnSync('git', args, {
      cwd: gitSpawnCwd(cwd),
      env: gitSpawnEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });

    return {
      stdout: child.stdout ? child.stdout.trimEnd() : '',
      stderr: child.stderr ? child.stderr.trimEnd() : '',
      exitCode: child.status,
    };
  } catch (error) {
    return {
      stdout: '',
      stderr: (error as Error).message || 'Unknown error',
      exitCode: 1,
    };
  }
};

export default gitExecSync;
