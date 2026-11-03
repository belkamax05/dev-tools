import { getAdvertisedRefs, getRefs, getRemoteNames, getTopLevel } from '../core/refs';
import type { CommandRun } from '../types/CommandRun';
import getWorkingDir from '../utils/getWorkingDir';

const run: CommandRun = async (args) => {
  try {
    const root = await getTopLevel(getWorkingDir());
    const remote = args.includes('--remote') || args.includes('-r');

    //? On a terminal the browser; piped (or --print), one ref per line to grep through
    if (process.stdin.isTTY && process.stdout.isTTY && !args.includes('--print')) {
      const { default: renderInkRefs } = await import('../ui/renderInkRefs');
      await renderInkRefs({ cwd: root });
      return;
    }

    const refs = await getRefs(root);
    const advertised = remote
      ? (
          await Promise.all(
            (await getRemoteNames(root)).map((name) => getAdvertisedRefs(root, name, refs)),
          )
        ).flat()
      : [];
    for (const ref of [...refs, ...advertised]) {
      const extra = [
        ref.symref && `→ ${ref.symref}`,
        ref.peeled && `^{} ${ref.peeled}`,
        ref.upstream && `⇡ ${ref.upstream}${ref.track ? ` (${ref.track})` : ''}`,
        ref.fetched && `${ref.fetched}${ref.localRef ? ` as ${ref.localRef}` : ''}`,
      ]
        .filter(Boolean)
        .join('  ');
      console.log(
        [ref.hash || '-'.repeat(40), ref.type.padEnd(7), ref.storage.padEnd(12), ref.id, extra]
          .filter(Boolean)
          .join('  '),
      );
    }
  } catch (error) {
    console.error('❌ Operation failed:', (error as Error).message);
    process.exitCode = 1;
  }
};

export const meta = {
  name: 'refs',
  //? git has its own `git refs` (2.46+), which an alias cannot shadow: `giti refs` only
  gitAlias: false,
  description:
    'Browse every ref — root refs and everything under refs/, grouped by namespace — with its raw object, reflog and preview; --print lists them, --remote adds ls-remote',
};

export default run;
