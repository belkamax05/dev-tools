import { join } from 'node:path';

import exec from '@/dev-tools/utils/process/exec';

import type { Env } from '../plugin';
import type { Project } from '../registry';

/** envi from the same dev-tools checkout — the store when the project names no command. */
const enviSet = () => [
  'bun',
  '--no-env-file',
  join(import.meta.dir, '..', '..', '..', '..', '..', 'bin', 'envi'),
  'set',
];

const lastLine = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1) ?? '';

/**
 * Store variables with the project's own command (`envSet`, e.g. `dfs env set`; `envi set`
 * otherwise), run from the project folder, then apply them to `env` — the environment this run
 * reads — so what was just saved is in use without a restart.
 *
 * @returns What the command said, e.g. "Set A, B in /repo/.env.user"
 * @throws When the command fails, with its own error line
 */
export const saveEnv = async (project: Project, env: Env, vars: Record<string, string>) => {
  const command = project.config.envSet?.length ? project.config.envSet : enviSet();
  const assignments = Object.entries(vars).map(([key, value]) => `${key}=${value}`);
  const result = await exec([...command, ...assignments], { cwd: project.dir });
  if (result.exitCode !== 0)
    throw new Error(lastLine(result.stderr) || lastLine(result.stdout) || `${command.join(' ')} failed`);
  //? The run's own environment: the probe that follows reads it, not the file
  Object.assign(env as Record<string, string | undefined>, vars);
  return lastLine(result.stdout) || `saved ${Object.keys(vars).join(', ')}`;
};
