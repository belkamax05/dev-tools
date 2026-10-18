import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import sysPaths from '../../config/sysPaths';
import getGitCommands from '.';

/** Every alias giti hands git: the `name = ...` keys of the generated `.gitconfig-commands`. */
const gitiAliases = () =>
  readFileSync(join(sysPaths.rootDir, '.gitconfig-commands'), 'utf8')
    .split('\n')
    .map((line) => line.match(/^([A-Za-z0-9-]+)\s*=/)?.[1])
    .filter((alias): alias is string => Boolean(alias));

describe('giti aliases against git', () => {
  test('git lists its own commands, so a clash check has something to check against', async () => {
    const { main } = await getGitCommands(sysPaths.rootDir);
    expect(main.has('push')).toBe(true);
    expect(gitiAliases().length).toBeGreaterThan(0);
  });

  //? git runs its own command and ignores an alias of the same name, silently — so `git <alias>`
  //? for any of these never reaches giti
  test('no giti alias is named like one of git’s own commands', async () => {
    const { main } = await getGitCommands(sysPaths.rootDir);
    expect(gitiAliases().filter((alias) => main.has(alias))).toEqual([]);
  });

  //? The same, for `git-*` programs on this machine's PATH (git-subrepo, git-lfs…) — a clash here
  //? depends on what is installed, so it differs between machines
  test('no giti alias is named like a git-* program on PATH', async () => {
    const { others } = await getGitCommands(sysPaths.rootDir);
    expect(gitiAliases().filter((alias) => others.has(alias))).toEqual([]);
  });
});
