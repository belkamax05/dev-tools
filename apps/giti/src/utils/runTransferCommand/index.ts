import getMegaTree from '../getMegaTree';
import getRemotes from '../getRemotes';
import getWorkingDir from '../getWorkingDir';
import { runMegaPull, runMegaPush, splitTransferTarget } from '../megaCommands';

/** giti-only: skip the screen, run with the flags as given. Never forwarded to git. */
const YES = new Set(['--yes', '-y']);

/**
 * The body of `giti send` and `giti receive`: a push or pull of the whole tree — the repository
 * and every subrepo, submodule and subtree in it — that takes everything `git push` / `git pull`
 * take.
 *
 * - `<remote> [<branch>]` in front, as git has them: a positional naming one of the repository's
 *   remotes is that, the one after it the branch; the rest name vendored directories.
 * - Every flag giti does not read itself reaches git unchanged (`--no-verify`, `--force-with-lease`,
 *   `--tags`, `--rebase`, `--autostash`, …), for the repository and each vendored push or pull.
 * - With no flag at all, on a terminal, the push / pull screen opens first — flags to toggle, what
 *   would be sent or received — and what is picked there runs the whole tree. `--yes` skips it.
 *
 * @param direction - `send` pushes, `receive` pulls
 * @param rawArgs - The command's arguments as typed
 */
const runTransferCommand = async (direction: 'send' | 'receive', rawArgs: string[]) => {
  const cwd = getWorkingDir();
  const tree = await getMegaTree(cwd);
  if (!tree) {
    console.error('❌ Not a git repository.');
    process.exitCode = 1;
    return;
  }

  const skipScreen = rawArgs.some((arg) => YES.has(arg));
  const args = rawArgs.filter((arg) => !YES.has(arg));
  const { target, rest } = splitTransferTarget(args, await getRemotes(tree.repo.path));
  const run = (forwarded: string[]) =>
    direction === 'send'
      ? runMegaPush(tree, cwd, forwarded, target)
      : runMegaPull(tree, cwd, forwarded, target);

  //? The interactive path is the zero-flag path, as for `push`/`pull`: any flag says the user
  //? already knows what they want. Never without a terminal — a script or the dashboard pipes
  const interactive =
    !skipScreen &&
    !args.some((arg) => arg.startsWith('-')) &&
    Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (!interactive) return run(rest);

  const options = {
    initialRemote: target.remote,
    initialBranch: target.branch,
    initialFlags: [],
    passthroughFlags: [],
    cwd: tree.repo.path,
    previewCommand: `giti ${direction}`,
    //? The directories named on the command line still narrow the run the screen starts
    onConfirm: (flags: string[]) => run([...rest, ...flags]),
  };
  if (direction === 'send') {
    const { default: renderInkPush } = await import('../../ui/renderInkPush');
    await renderInkPush(options);
  } else {
    const { default: renderInkPull } = await import('../../ui/renderInkPull');
    await renderInkPull(options);
  }
};

export default runTransferCommand;
