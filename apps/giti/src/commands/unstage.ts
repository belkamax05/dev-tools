import type { CommandRun } from '../types/CommandRun';
import runStageCommand from '../utils/runStageCommand';
import { CHANGE_KINDS } from '../utils/selectChanges';
import unstageFiles from '../utils/unstageFiles';

const run: CommandRun = async (args) => {
  try {
    await runStageCommand(args, {
      from: 'staged',
      verb: 'unstage',
      kinds: CHANGE_KINDS.filter((kind) => kind !== 'untracked'),
      apply: unstageFiles,
    });
  } catch (error) {
    console.error('❌ Operation failed:', (error as Error).message);
  }
};

export const meta = {
  name: 'unstage',
  description:
    'Unstage paths, or every staged change of a kind: --modified, --added, --deleted, --renamed, --all. Bare: count what is staged',
};

export default run;
