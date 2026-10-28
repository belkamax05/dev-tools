import { confirm, isCancel } from '@clack/prompts';
import formatArg from '@/dev-tools/utils/format/formatArg';
import formatColor from '@/dev-tools/utils/format/formatColor';
import getBranches from '../../core/branches';
import describePush from '../describePush';
import getDefaultPushRemote from '../getDefaultPushRemote';
import getGitiCommand from '../getGitiCommand';
import getRemotes from '../getRemotes';
import getSendToTargets, { pickSendToRemote } from '../getSendToTargets';
import getWorkingDir from '../getWorkingDir';
import gitExec from '../gitExec';
import runGitStep from '../runGitStep';
import runTransferCommand from '../runTransferCommand';

/** giti-only: skip the confirmation. Never forwarded to git. */
const YES = new Set(['--yes', '-y']);
const REMOTE = '--remote=';

const fail = (message: string) => {
  console.error(`❌ ${message}`);
  process.exitCode = 1;
};

/** `git push --force <remote> HEAD:refs/heads/<branch>` — the full ref, so a new branch is created too. */
const forcePush = async (cwd: string, remote: string, branch: string, from: string, flags: string[]) => {
  const step = await runGitStep(
    `${from} over ${remote}/${branch} (forced)`,
    ['push', '--force', ...flags, remote, `HEAD:refs/heads/${branch}`],
    cwd,
  );
  if (step.exitCode !== 0) {
    step.fail(formatColor('force push failed', 'error'));
    process.exitCode = 1;
    return;
  }
  step.succeed(
    [formatColor(`✅ ${remote}/${branch} is now ${from}`, 'success'), ...describePush(step.output)].join('\n'),
  );
};

/**
 * The body of `giti send-to [<branch>]`: put HEAD on another branch of the remote, replacing
 * whatever that branch held — a force push, so it always asks first (`y`, or the screen's button).
 *
 * - No branch: on a terminal, a picker of the remote's branches (and local ones it lacks) opens,
 *   and confirming there pushes. The checked-out branch is not in it.
 * - The checked-out branch named: there is nothing to force over, so this is a plain `giti send`,
 *   said in a warning.
 * - `--remote=<name>` picks the remote; `--yes` skips the question; every other flag reaches
 *   `git push` unchanged. Only this repository is pushed — vendored ones keep their own branches.
 */
const runSendTo = async (rawArgs: string[]) => {
  const cwd = getWorkingDir();
  const command = getGitiCommand();
  const yes = rawArgs.some((arg) => YES.has(arg));
  const wanted = rawArgs.find((arg) => arg.startsWith(REMOTE))?.slice(REMOTE.length);
  const args = rawArgs.filter((arg) => !YES.has(arg) && !arg.startsWith(REMOTE));
  const positionals = args.filter((arg) => !arg.startsWith('-'));
  const flags = args.filter((arg) => arg.startsWith('-'));
  const usage = `Usage: ${command} send-to [<branch>] [--remote=<name>] [--yes] [git push flags]`;

  if (positionals.length > 1) return fail(`One branch at a time.\n\n${usage}`);
  if ((await gitExec(['rev-parse', '--git-dir'], cwd)).exitCode !== 0) {
    return fail('Not a git repository.');
  }

  const [branches, remotes, pushDefault, current] = await Promise.all([
    getBranches(cwd),
    getRemotes(cwd),
    getDefaultPushRemote(cwd),
    gitExec(['rev-parse', '--abbrev-ref', 'HEAD'], cwd).then((result) => result.stdout.trim()),
  ]);
  const upstream = branches.find((branch) => branch.isCurrent)?.upstream ?? '';
  const remote = wanted ?? pickSendToRemote(upstream, remotes, pushDefault);
  if (!remote) return fail('This repository has no remotes.');
  if (!remotes.includes(remote)) return fail(`${formatArg(remote)} is not a remote.`);
  //? Detached, git names HEAD itself; there is no branch for a plain send to fall back to
  const from = current && current !== 'HEAD' ? current : 'HEAD (detached)';
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);

  const [named] = positionals;
  if (named === undefined) {
    if (!interactive) return fail(`Name the branch to push into — no terminal to pick one on.\n\n${usage}`);
    const targets = getSendToTargets(branches, current, remote);
    if (targets.length === 0) {
      console.log(`ℹ️  ${remote} has no other branch to push into — name a new one: ${command} send-to <branch>`);
      return;
    }
    const { default: renderInkSendTo } = await import('../../ui/renderInkSendTo');
    //? The screen asks for the confirmation itself (y, or its button), so a pick is a yes
    const picked = await renderInkSendTo({ targets, from, remote });
    if (!picked) {
      console.log('Cancelled — nothing pushed.');
      return;
    }
    return forcePush(cwd, remote, picked, from, flags);
  }

  if (named === current) {
    console.warn(
      formatColor(
        `⚠️  ${named} is the branch you are on, so there is nothing to force over — ` +
          `falling back to a regular ${command} send.`,
        'warning',
      ),
    );
    return runTransferCommand('send', [...(wanted ? [remote] : []), ...flags, ...(yes ? ['--yes'] : [])]);
  }

  if (!yes) {
    if (!interactive) return fail(`A force push needs a yes — re-run with --yes.\n\n${usage}`);
    const onRemote = branches.some((branch) => branch.isRemote && branch.name === `${remote}/${named}`);
    console.warn(
      formatColor(
        onRemote
          ? `⚠️  Force push: ${remote}/${named} will be replaced by ${from}. Commits only it has are lost on ${remote}.`
          : `⚠️  ${remote} has no ${named} yet — it will be created at ${from}.`,
        'warning',
      ),
    );
    const proceed = await confirm({ message: `Force-push ${from} into ${remote}/${named}?`, initialValue: false });
    if (isCancel(proceed) || !proceed) {
      console.log('Cancelled — nothing pushed.');
      return;
    }
  }
  return forcePush(cwd, remote, named, from, flags);
};

export default runSendTo;
