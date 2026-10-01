import { parseArgs } from 'node:util';
import formatColor from '@/dev-tools/utils/format/formatColor';
import getStatus from '../getStatus';
import getWorkingDir from '../getWorkingDir';
import resolveRepoPaths from '../resolveRepoPaths';
import selectChanges, { type ChangeKind, type ChangeSide } from '../selectChanges';

interface StageCommandOptions {
  /** The side whose files are picked from — `unstaged` to stage them, `staged` to unstage them. */
  from: ChangeSide;
  verb: 'stage' | 'unstage';
  /** Kinds this direction can act on: untracked files can be staged but never unstaged. */
  kinds: readonly ChangeKind[];
  apply: (cwd: string, paths: string[]) => Promise<void>;
}

/**
 * The shared body of `giti stage` and `giti unstage`: explicit paths are passed straight to git,
 * kind flags (`--modified`, `--deleted`, …) pick matching files from `git status`, and `--all`
 * takes every kind. With neither, it only reports what there is — moving the whole index is
 * never what a bare command does.
 */
const runStageCommand = async (
  args: string[],
  { from, verb, kinds, apply }: StageCommandOptions,
) => {
  const { values, positionals } = parseArgs({
    args,
    options: {
      all: { type: 'boolean', short: 'a', default: false },
      ...Object.fromEntries(kinds.map((kind) => [kind, { type: 'boolean' as const }])),
    },
    allowPositionals: true,
    strict: false,
  });
  const flags = values as Record<string, unknown>;
  //? Everything below speaks in repository-root paths (what `git status` prints), so git runs
  //? from the root too — from a subfolder those paths would point somewhere else
  const { root, paths: typed } = await resolveRepoPaths(getWorkingDir(), positionals);
  const done = verb === 'stage' ? 'Staged' : 'Unstaged';

  if (typed.length > 0) {
    await apply(root, typed);
    console.log(`✅ ${done} ${typed.length} path(s)`);
    return;
  }

  const raw = await getStatus(root);
  const chosen = flags.all === true ? [...kinds] : kinds.filter((kind) => flags[kind] === true);

  if (chosen.length === 0) {
    const counts = kinds
      .map((kind) => [kind, selectChanges(raw, from, [kind]).length] as const)
      .filter(([, count]) => count > 0);
    const side = from === 'unstaged' ? 'Unstaged' : 'Staged';
    console.log(
      counts.length
        ? `${side}: ${counts.map(([kind, count]) => `${count} ${kind}`).join(', ')}`
        : `Nothing to ${verb}.`,
    );
    const kindFlags = kinds.map((kind) => `--${kind}`).join(' ');
    console.log(formatColor(`Usage: giti ${verb} <paths…> | ${kindFlags} | --all`, 'debug'));
    return;
  }

  const paths = selectChanges(raw, from, chosen);
  if (paths.length === 0) {
    console.log(`ℹ️  No ${chosen.join('/')} files to ${verb}.`);
    return;
  }
  await apply(root, paths);
  console.log(`✅ ${done} ${paths.length} ${chosen.join('/')} path(s)`);
};

export default runStageCommand;
