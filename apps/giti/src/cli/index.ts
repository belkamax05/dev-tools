#!/usr/bin/env bun
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import formatArg from '@/dev-tools/utils/format/formatArg';

import sysPaths from '../config/sysPaths';
import type { CommandRun } from '../types/CommandRun';

/**
 * Ask the user which command to run, optionally pre-navigated into a group.
 *
 * Imported lazily so the React/Ink tree is never loaded for `giti <command>` — the same reason
 * the TUI-backed commands defer their own renderer.
 */
const pickCommand = async (initialPath?: string[]) => {
  const { default: renderInkCommands } = await import('../ui/renderInkCommands');
  return renderInkCommands({ initialPath });
};

/**
 * Open the dashboard — the repository across seven tabs, with the command menu as one of them.
 *
 * What a bare `giti` does, in place of the menu it used to open. The menu itself is unchanged and
 * still reached directly by `giti <group>`, which is the path that has to keep behaving exactly
 * as it did; this is the front door, not a replacement for it.
 *
 * Lazily imported for the same reason as `pickCommand`: `giti <command>` must not pay for a React
 * tree it never renders.
 */
const openDashboard = async () => {
  const { default: renderInkDashboard } = await import('../ui/renderInkDashboard');
  return renderInkDashboard();
};

const run = async (...[firstArg, ...args]: string[]) => {
  //? No command means the interactive path: the dashboard hands back a name in exactly the form
  //? this function resolves, so a pick goes through the dispatch below like any typed command
  const command = firstArg ?? (await openDashboard());

  //? Backing out of the picker is not a failure — there is simply nothing left to run
  if (!command) return;

  const modulePath = join(sysPaths.commandsDir, `${command}.ts`);
  const folderPath = join(sysPaths.commandsDir, command);

  //? A folder with the same name as the argument means it is a command group. Two paths:
  //? 1. The next arg looks like a sub-command name (no leading `-`) → recurse with the joined
  //?    path, e.g. `giti branch status` → run('branch/status', ...). This mirrors
  //?    shulker-controller's walkCommandTree: each positional arg is consumed as a path segment
  //?    until a leaf is reached.
  //? 2. No sub-command arg (or it starts with `-`) → open the top-level picker pre-navigated
  //?    into this group, the same as `giti mega` already does.
  if (!existsSync(modulePath)) {
    if (existsSync(folderPath)) {
      const [nextArg, ...rest] = args;
      if (nextArg !== undefined && !nextArg.startsWith('-')) {
        return run(`${command}/${nextArg}`, ...rest);
      }
      const subCommand = await pickCommand([command]);
      if (!subCommand) return;
      return run(subCommand, ...args);
    }

    throw new Error(`Command ${formatArg(command)} is not found at ${formatArg(modulePath)}`);
  }

  //? Commands are typed `CommandRun`, which takes the arg list as a single array — the same
  //? shape shulker-controller's dispatch passes. Spreading here would hand each command its
  //? first arg only.
  const { default: runCmd } = (await import(modulePath)) as { default: CommandRun };
  await runCmd(args);
};

export default run;
