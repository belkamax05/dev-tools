import { spawn } from 'node:child_process';

import type { OperationResult } from '../agents';
import { findIdeBinary, type IdeDefinition } from '../ides';

/**
 * How to open a repository in an IDE: the binary and its arguments, and
 * whether it takes over the terminal (Claude Code) or opens a window of its
 * own beside it (everything with a GUI).
 */
export interface LaunchPlan {
  command: string[];
  cwd: string;
  terminal: boolean;
}

export const launchPlan = (ide: IdeDefinition, root: string): LaunchPlan | undefined => {
  const binary = findIdeBinary(ide);
  if (!binary) return undefined;
  //? A terminal program is started in the repository; a GUI one is handed it
  //? as an argument, which is how every editor here opens a folder
  return ide.launch === 'terminal'
    ? { command: [binary], cwd: root, terminal: true }
    : { command: [binary, root], cwd: root, terminal: false };
};

/** Start a GUI IDE detached, so it outlives nothing it should not and the caller never waits. */
export const launchDetached = (plan: LaunchPlan): OperationResult => {
  const [bin = '', ...args] = plan.command;
  try {
    spawn(bin, args, { cwd: plan.cwd, stdio: 'ignore', detached: true })
      .on('error', () => {})
      .unref();
    return { ok: true, message: `Opened ${plan.cwd} in ${bin.split('/').pop()}` };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
};

export default launchPlan;
