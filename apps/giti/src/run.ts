#!/usr/bin/env bun
import formatArg from '@/dev-tools/utils/format/formatArg';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import sysPaths from './config/sysPaths';
import type { CommandRun } from './types/CommandRun';
import getGitCommands from './utils/getGitCommands';

/**
 * Ask the user which command to run, optionally pre-navigated into a group.
 *
 * Imported lazily so the React/Ink tree is never loaded for `giti <command>` — the same reason
 * the TUI-backed commands defer their own renderer.
 */
const pickCommand = async (initialPath?: string[]) => {
  const { default: renderInkCommands } = await import('./ui/renderInkCommands');
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
  const { default: renderInkDashboard } = await import('./ui/renderInkDashboard');
  return renderInkDashboard();
};

/** A name giti cannot resolve: said in one line, exit 1 — not a stack trace. */
const notFound = (message: string) => {
  console.error(`❌ ${message}`);
  process.exitCode = 1;
};

/**
 * Other names for a top-level command or group, resolved before anything else.
 *
 * `branch` is git's own command, so without this `giti branch` would fall through to git; giti
 * means its `branches` group instead — `giti branch` / `giti branch list` never reach git.
 * Raw `git branch` is still there as `giti git branch …`.
 */
const COMMAND_ALIASES: Record<string, string> = {
  branch: 'branches',
};

const run = async (...[firstArg, ...args]: string[]): Promise<void> => {
  //? No command means the interactive path: the dashboard hands back a name in exactly the form
  //? this function resolves, so a pick goes through the dispatch below like any typed command
  const picked = firstArg ?? (await openDashboard());
  const command = (picked && COMMAND_ALIASES[picked]) ?? picked;

  //? Backing out of the picker is not a failure — there is simply nothing left to run
  if (!command) return;

  const modulePath = join(sysPaths.commandsDir, `${command}.ts`);
  const folderPath = join(sysPaths.commandsDir, command);

  //? A folder with the same name as the argument means it is a command group. Two paths:
  //? 1. The next arg looks like a sub-command name (no leading `-`) → recurse with the joined
  //?    path, e.g. `giti branches status` → run('branches/status', ...). This mirrors
  //?    shulker-controller's walkCommandTree: each positional arg is consumed as a path segment
  //?    until a leaf is reached.
  //? 2. No sub-command arg (or it starts with `-`) → open the top-level picker pre-navigated
  //?    into this group, the same as `giti mega` already does.
  if (!existsSync(modulePath)) {
    if (existsSync(folderPath)) {
      const [nextArg, ...rest] = args;
      //? `stash` is giti's folder (remote stashes) and git's command (local ones): what giti does
      //? not have — `giti stash pop`, `giti stash -m wip` — is git's, as for any other name
      const gitOwnsTheRest = async () =>
        !command.includes('/') && (await getGitCommands(sysPaths.rootDir)).main.has(command);
      if (nextArg !== undefined && !nextArg.startsWith('-')) {
        const sub = join(sysPaths.commandsDir, command, nextArg);
        if (existsSync(`${sub}.ts`) || existsSync(sub)) return run(`${command}/${nextArg}`, ...rest);
        if (await gitOwnsTheRest()) return run('git', command, ...args);
        //? A giti folder means nothing to git, so an unknown sub-command is giti's to report
        const known = readdirSync(folderPath)
          .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.startsWith('_'))
          .map((file) => file.slice(0, -3));
        return notFound(`No ${formatArg(`${command}/${nextArg}`)} — ${command}/ has ${known.join(', ')}`);
      }
      if (nextArg !== undefined && (await gitOwnsTheRest())) return run('git', command, ...args);
      //? A folder with a screen of its own (`stash/_index.ts`, its dashboard) opens that instead
      //? of the picker; `_` keeps it out of the command list and the git aliases
      const folderIndex = join(folderPath, '_index.ts');
      if (nextArg === undefined && existsSync(folderIndex)) {
        const { default: runIndex } = (await import(folderIndex)) as { default: CommandRun };
        return runIndex(args);
      }
      const subCommand = await pickCommand([command]);
      if (!subCommand) return;
      return run(subCommand, ...args);
    }

    //? Not a giti command: hand it to git as it is — `giti log -3`, `giti rebase -i`, an alias
    //? of the user's own — the same raw pass-through as `giti git <args>`, subfolder included
    if (command.includes('/')) return notFound(`No giti command ${formatArg(command)} — giti list shows them all`);
    return run('git', command, ...args);
  }

  //? Commands are typed `CommandRun`, which takes the arg list as a single array — the same
  //? shape shulker-controller's dispatch passes. Spreading here would hand each command its
  //? first arg only.
  const { default: runCmd } = (await import(modulePath)) as { default: CommandRun };
  await runCmd(args);
};

export default run;
