import { applyVendoredHop, planVendoredHop, type VendoredHop } from '../../core/vendoredHop';
import gitExec from '../gitExec';

export interface RunVendoredHopOptions {
  /** Ask with the checklist. Off: do the recommended ones and only name the rest. */
  interactive: boolean;
}

/**
 * The second half of `giti hop`: once the parent is on its new branch, offer the same branch to
 * every submodule and subrepo inside it — the step `send` / `receive` / `save` already take across
 * the whole tree, which a plain `git switch` never does.
 *
 * Submodules that have the branch are switched by default; one that does not gets the branch only
 * when asked. Subrepos are never moved by default — retargeting one pulls from or pushes to its
 * upstream, so it is offered, and printed as a hint when there is no screen to offer it on.
 *
 * @param cwd - Any directory inside the parent repository, already switched
 */
const runVendoredHop = async (cwd: string, { interactive }: RunVendoredHopOptions) => {
  const rootResult = await gitExec(['rev-parse', '--show-toplevel'], cwd);
  if (rootResult.exitCode !== 0) return;
  const root = rootResult.stdout.trim();
  const headResult = await gitExec(['symbolic-ref', '--quiet', '--short', 'HEAD'], root);
  //? Detached: there is no branch name to follow
  if (headResult.exitCode !== 0) return;
  const branch = headResult.stdout.trim();

  //? Said before the plan's `ls-remote`s, so a slow upstream is not a silent pause after the switch
  const entries = await planVendoredHop(root, branch, (count) =>
    console.log(`🔎 Looking for ${branch} in ${count} vendored repo${count === 1 ? '' : 's'}…`),
  );
  const actionable = entries.filter((entry) => entry.action !== 'none');
  if (actionable.length === 0) return;

  let picked: VendoredHop[];
  if (interactive) {
    const { default: renderInkVendoredHop } = await import('../../ui/renderInkVendoredHop');
    picked = await renderInkVendoredHop(branch, entries);
  } else {
    picked = actionable.filter((entry) => entry.recommended);
    for (const entry of actionable.filter((e) => !e.recommended)) {
      console.log(`ℹ️  ${entry.dir}: ${entry.note}`);
    }
  }

  //? One at a time: subrepo commands each commit in the parent, and two at once would race the index
  for (const entry of picked) {
    const result = await applyVendoredHop(root, entry, branch);
    console.log(`${result.ok ? '✅' : '❌'} ${result.message}`);
  }
};

export default runVendoredHop;
