import type { CommandRun } from '../types/CommandRun';
import commit from '../utils/commit';
import getStatus from '../utils/getStatus';
import getWorkingDir from '../utils/getWorkingDir';
import stageAll from '../utils/stageAll';

/** The message when none is given. */
const DEFAULT_MESSAGE = 'wip';

/**
 * `wip [message]`: stage everything and commit it, hooks skipped — no questions, no flags. The
 * first argument, if any, is the message (`giti wip "half of the parser"`); quote it to use
 * more than one word.
 */
const run: CommandRun = async (args) => {
  try {
    const rootDir = getWorkingDir();
    const message = args[0]?.trim() || DEFAULT_MESSAGE;

    //? Staging everything from a clean tree leaves git with nothing to commit, and git reports
    //? that on stdout — so the failure branch below would print a bare "Commit failed:" with an
    //? empty reason. The answer is already known here, so say it plainly instead.
    if (!(await getStatus(rootDir)).trim()) {
      console.log('ℹ️  Nothing to commit — working tree is clean.');
      return;
    }

    console.log('📦 Staging all files...');
    await stageAll(rootDir);

    console.log(`💾 Committing "${message}"...`);
    const result = await commit(rootDir, message, { noVerify: true });

    if (result.exitCode === 0) {
      console.log(`✅ Committed as "${message}".`);
      console.log(result.stdout);
    } else {
      console.error('❌ Commit failed:', result.stderr || result.stdout);
    }
  } catch (error) {
    console.error('❌ Operation failed:', (error as Error).message);
  }
};

export const meta = {
  name: 'wip',
  description:
    'Stage all changes and commit them, bypassing hooks — the first argument is the message ("wip" when none is given)',
};

export default run;
